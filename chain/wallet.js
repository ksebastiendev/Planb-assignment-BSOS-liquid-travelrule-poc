/**
 * chain/wallet.js
 * Liquid testnet wallet utilities using liquidjs-lib + ecpair.
 *
 * Concepts:
 *   - Every participant has TWO key pairs:
 *       1. spending key   → controls who can spend the UTXO
 *       2. blinding key   → used to blind/unblind confidential amounts
 *   - The "confidential address" (blech32, starts with "tlq1") embeds
 *     the blinding PUBLIC key so senders can encrypt amounts to it.
 *   - Only the holder of the blinding PRIVATE key can see the real value.
 */

const liquid = require('liquidjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('@bitcoinerlab/secp256k1');
const esplora = require('./esplora');

const ECPair = ECPairFactory(ecc);

// Liquid testnet network parameters (bech32 = "tex", blech32 prefix = "tlq")
const NETWORK = liquid.networks.testnet;

// ── Key / address generation ──────────────────────────────────────────────────

/**
 * Generate a new Liquid testnet wallet.
 *
 * Returns:
 *   privateKey          - spending key (hex, keep secret)
 *   publicKey           - spending public key (hex)
 *   blindingPrivateKey  - blinding key (hex, keep secret — needed to unblind TXs)
 *   blindingPublicKey   - blinding public key (hex — embedded in confAddr)
 *   address             - unconfidential P2WPKH address  (tex1q…)
 *   confidentialAddress - blinded address               (tlq1qq…)
 */
function generateWallet() {
  const spendingKP = ECPair.makeRandom({ network: NETWORK });
  const blindingKP  = ECPair.makeRandom({ network: NETWORK });

  const p2wpkh = liquid.payments.p2wpkh({
    pubkey : Buffer.from(spendingKP.publicKey),
    network: NETWORK,
  });

  const confidentialAddress = liquid.address.toConfidential(
    p2wpkh.address,
    Buffer.from(blindingKP.publicKey),
  );

  return {
    privateKey        : Buffer.from(spendingKP.privateKey).toString('hex'),
    publicKey         : Buffer.from(spendingKP.publicKey).toString('hex'),
    blindingPrivateKey: Buffer.from(blindingKP.privateKey).toString('hex'),
    blindingPublicKey : Buffer.from(blindingKP.publicKey).toString('hex'),
    address           : p2wpkh.address,
    confidentialAddress,
    network           : 'liquidtestnet',
  };
}

/**
 * Restore a wallet from existing private keys (hex strings).
 * Useful for loading a wallet saved in .env or a secrets store.
 */
function restoreWallet(privateKeyHex, blindingPrivateKeyHex) {
  const spendingKP = ECPair.fromPrivateKey(Buffer.from(privateKeyHex, 'hex'), { network: NETWORK });
  const blindingKP  = ECPair.fromPrivateKey(Buffer.from(blindingPrivateKeyHex, 'hex'), { network: NETWORK });

  const p2wpkh = liquid.payments.p2wpkh({
    pubkey : Buffer.from(spendingKP.publicKey),
    network: NETWORK,
  });

  const confidentialAddress = liquid.address.toConfidential(
    p2wpkh.address,
    Buffer.from(blindingKP.publicKey),
  );

  return {
    privateKey        : privateKeyHex,
    publicKey         : Buffer.from(spendingKP.publicKey).toString('hex'),
    blindingPrivateKey: blindingPrivateKeyHex,
    blindingPublicKey : Buffer.from(blindingKP.publicKey).toString('hex'),
    address           : p2wpkh.address,
    confidentialAddress,
    network           : 'liquidtestnet',
  };
}

// ── Balance via Esplora ───────────────────────────────────────────────────────

/**
 * Get the balance of an address from Esplora.
 *
 * NOTE: Esplora returns `value: null` for confidential UTXOs because the
 * amounts are hidden. Only UTXOs sent to the UNCONFIDENTIAL address have
 * a visible value in the REST API.
 *
 * To get balances of confidential UTXOs, use chain/unblind.js with the
 * blinding private key.
 *
 * @param {string} address - tex1q… or tlq1qq… address
 * @returns {{ utxos, explicitSat, confidentialCount, assetBreakdown }}
 */
async function getBalance(address) {
  // Esplora works with both confidential and unconfidential addresses.
  // Use the unconfidential form for the query when needed.
  const queryAddress = liquid.address.isConfidential(address)
    ? liquid.address.fromConfidential(address).unconfidentialAddress
    : address;

  const utxos = await esplora.getAddressUtxos(queryAddress);

  const explicit     = utxos.filter(u => u.value !== null && u.value !== undefined);
  const confidential = utxos.filter(u => u.value === null || u.value === undefined);

  // Visible balance breakdown by asset
  const assetBreakdown = {};
  for (const u of explicit) {
    const id = u.asset || 'unknown';
    assetBreakdown[id] = (assetBreakdown[id] || 0) + u.value;
  }

  return {
    utxos,
    explicitSat      : explicit.reduce((s, u) => s + u.value, 0),
    confidentialCount: confidential.length,
    assetBreakdown,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the output script (Buffer) for a given address.
 * Works for both confidential and unconfidential addresses.
 */
function toOutputScript(addr) {
  return liquid.address.toOutputScript(addr);
}

/**
 * Convert an asset hex string (display order, big-endian) to the 32-byte
 * little-endian Buffer used internally by liquidjs-lib PSETs.
 */
function assetToLE(assetHex) {
  return liquid.AssetHash.fromHex(assetHex).bytes.slice(1); // strip 0x01 prefix
}

module.exports = {
  generateWallet,
  restoreWallet,
  getBalance,
  toOutputScript,
  assetToLE,
  NETWORK,
  ECPair,
  ecc,
};
