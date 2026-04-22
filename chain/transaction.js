/**
 * chain/transaction.js
 * Build, blind, sign and broadcast a Confidential Transaction on Liquid testnet.
 *
 * Flow:
 *   1. Fetch UTXOs for fromWallet via Esplora
 *   2. Coin-select to cover (amount + fee)
 *   3. Build PSET v2 (liquidjs-lib Creator → Updater)
 *   4. Blind outputs with secp256k1-zkp (ZKPGenerator → Blinder)
 *   5. Sign inputs (Signer → Finalizer)
 *   6. Extract raw tx hex (Extractor)
 *   7. Broadcast via Esplora POST /tx
 *   8. Return { txid, blindingKey }
 *
 * Prerequisites:
 *   - fromWallet must have funds on Liquid testnet.
 *     Faucet: https://liquidtestnet.com/faucet
 *   - toAddress can be confidential (tlq1…) or unconfidential (tex1…).
 */

const liquid = require('liquidjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc  = require('@bitcoinerlab/secp256k1');
const esplora = require('./esplora');
const { getZkp } = require('./zkp');

const ECPair = ECPairFactory(ecc);
const NETWORK = liquid.networks.testnet;

// Default fee in satoshis (Liquid fees are very low)
const DEFAULT_FEE_SAT = 500;

// ── Coin selection ────────────────────────────────────────────────────────────

/**
 * Greedy UTXO selection: pick smallest UTXOs that cover (target + fee).
 * Only considers explicit (visible) UTXOs — confidential ones need unblinding first.
 *
 * @param {Array}  utxos     - from Esplora (must have .value set, not null)
 * @param {string} assetId   - asset to select
 * @param {number} targetSat - amount to send (sat)
 * @param {number} feeSat    - transaction fee (sat)
 * @returns {{ selected: Array, change: number }}
 */
function selectUtxos(utxos, assetId, targetSat, feeSat) {
  const eligible = utxos
    .filter(u => u.value !== null && (!u.asset || u.asset === assetId))
    .sort((a, b) => a.value - b.value); // smallest first

  const need = targetSat + feeSat;
  let total = 0;
  const selected = [];

  for (const u of eligible) {
    selected.push(u);
    total += u.value;
    if (total >= need) break;
  }

  if (total < need) {
    throw new Error(
      `Insufficient funds: need ${need} sat, found ${total} sat (explicit UTXOs only)`
    );
  }

  return { selected, change: total - need };
}

// ── Build & send CT ───────────────────────────────────────────────────────────

/**
 * Build a Confidential Transaction, sign it and broadcast to Liquid testnet.
 *
 * @param {object} fromWallet  - wallet object from chain/wallet.js generateWallet()
 * @param {string} toAddress   - recipient address (confidential or plain)
 * @param {number} amountSat   - amount to send in satoshis
 * @param {string} assetId     - Liquid asset ID (hex, display order)
 * @param {object} [opts]
 * @param {number} [opts.feeSat=500] - fee in satoshis
 *
 * @returns {Promise<{ txid: string, blindingKey: string, rawHex: string }>}
 */
async function buildAndSendCT(fromWallet, toAddress, amountSat, assetId, opts = {}) {
  const feeSat = opts.feeSat ?? DEFAULT_FEE_SAT;
  const zkp    = await getZkp();

  // ── 1. Fetch UTXOs ──────────────────────────────────────────────────────────
  const allUtxos = await esplora.getAddressUtxos(fromWallet.address);
  const { selected, change } = selectUtxos(allUtxos, assetId, amountSat, feeSat);

  // ── 2. Spending key pair ────────────────────────────────────────────────────
  const spendingKP = ECPair.fromPrivateKey(
    Buffer.from(fromWallet.privateKey, 'hex'),
    { network: NETWORK }
  );
  const p2wpkh = liquid.payments.p2wpkh({
    pubkey : Buffer.from(spendingKP.publicKey),
    network: NETWORK,
  });

  // Per-tx ephemeral blinding key for the change output (or reuse wallet key)
  const changeBlindingKP = ECPair.fromPrivateKey(
    Buffer.from(fromWallet.blindingPrivateKey, 'hex'),
    { network: NETWORK }
  );

  // ── 3. Resolve recipient script & blinding pub key ──────────────────────────
  const isRecipientConfidential = liquid.address.isConfidential(toAddress);
  const recipientScript = liquid.address.toOutputScript(toAddress);
  const recipientBlindingPubKey = isRecipientConfidential
    ? liquid.address.fromConfidential(toAddress).blindingKey
    : null;

  // ── 4. Build PSET ──────────────────────────────────────────────────────────
  const pset    = liquid.Creator.newPset();
  const updater = new liquid.Updater(pset);

  // Add inputs
  const inputs = selected.map(u => ({ txid: u.txid, txIndex: u.vout }));
  updater.addInputs(inputs);

  // Set witness UTXO on each input (needed for segwit signing)
  for (let i = 0; i < selected.length; i++) {
    const u = selected[i];
    updater.addInWitnessUtxo(i, {
      script: p2wpkh.output,
      value : liquid.ElementsValue.fromNumber(u.value).bytes,
      asset : liquid.AssetHash.fromHex(assetId).bytes,  // 33 bytes with 0x01 prefix
      nonce : Buffer.alloc(1),                           // explicit (non-confidential) nonce
    });
    updater.addInSighashType(i, liquid.Transaction.SIGHASH_ALL);
  }

  // Build output list
  const outputs = [];

  // Main output (to recipient)
  const mainOut = {
    asset : assetId,
    amount: amountSat,
    script: recipientScript,
  };
  if (recipientBlindingPubKey) {
    mainOut.blindingPublicKey = recipientBlindingPubKey;
    mainOut.blinderIndex      = 0;
  }
  outputs.push(mainOut);

  // Change output (back to sender as confidential)
  if (change > 0) {
    outputs.push({
      asset            : assetId,
      amount           : change,
      script           : p2wpkh.output,
      blindingPublicKey: Buffer.from(changeBlindingKP.publicKey),
      blinderIndex     : 0,
    });
  }

  // Fee output (always explicit in Elements — no script)
  outputs.push({ asset: assetId, amount: feeSat });

  updater.addOutputs(outputs);

  // ── 5. Blind outputs ────────────────────────────────────────────────────────
  // For each explicit (non-confidential) input, describe it to the ZKP generator
  const assetLE = liquid.AssetHash.fromHex(assetId).bytes.slice(1); // 32 bytes LE

  const ownedInputs = selected.map((u, index) => ({
    index,
    value              : u.value.toString(10),
    asset              : assetLE,
    assetBlindingFactor: Buffer.alloc(32), // ZERO — explicit input has no blinding
    valueBlindingFactor: Buffer.alloc(32), // ZERO
  }));

  const zkpGen = new liquid.ZKPGenerator(
    zkp,
    liquid.ZKPGenerator.WithOwnedInputs(ownedInputs)
  );
  const zkpVal = new liquid.ZKPValidator(zkp);

  // Compute blinding factors and proofs for all outputs that have a blindingPublicKey
  const outBlindArgs = zkpGen.blindOutputs(pset, liquid.Pset.ECCKeysGenerator(ecc));

  const blinder = new liquid.Blinder(pset, ownedInputs, zkpVal, zkpGen);
  blinder.blindLast({ outputBlindingArgs: outBlindArgs });

  // ── 6. Sign inputs ──────────────────────────────────────────────────────────
  const signer = new liquid.Signer(pset);

  for (let i = 0; i < selected.length; i++) {
    const sighash = pset.inputs[i].sighashType ?? liquid.Transaction.SIGHASH_ALL;
    const preimage = pset.getInputPreimage(i, sighash);
    const sig      = spendingKP.sign(preimage, true); // low-r canonical

    signer.addSignature(
      i,
      {
        partialSig: {
          pubkey   : Buffer.from(spendingKP.publicKey),
          signature: liquid.script.signature.encode(Buffer.from(sig), sighash),
        },
      },
      liquid.Pset.ECDSASigValidator(ecc)
    );
  }

  // ── 7. Finalize & extract ───────────────────────────────────────────────────
  const finalizer = new liquid.Finalizer(pset);
  finalizer.finalize();

  const tx     = liquid.Extractor.extract(pset);
  const rawHex = tx.toHex();

  // ── 8. Broadcast ───────────────────────────────────────────────────────────
  const txid = await esplora.broadcastTx(rawHex);

  return {
    txid,
    // The change output blinding key — pass to compliance layer for audit
    blindingKey: fromWallet.blindingPrivateKey,
    rawHex,
  };
}

module.exports = { buildAndSendCT, selectUtxos };
