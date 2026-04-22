/**
 * chain/unblind.js
 * Unblind confidential outputs of a Liquid transaction.
 *
 * In a Confidential Transaction:
 *   - Amounts are hidden behind Pedersen commitments.
 *   - Only the holder of the blinding PRIVATE key can recover the real value.
 *   - The Confidential class from liquidjs-lib does the ECDH + ChaCha20 decrypt.
 *
 * This module is used by:
 *   - The compliance audit layer (verify declared vs actual amount)
 *   - The regulator dashboard (reveal amounts for flagged transactions)
 *
 * Security note: the blinding key is stored in the blinding_keys table with
 * principle of least privilege — access is logged on every query.
 */

const liquid = require('liquidjs-lib');
const { confidential: confModule } = liquid;
const { getZkp } = require('./zkp');
const esplora = require('./esplora');

// ── Core unblind function ────────────────────────────────────────────────────

/**
 * Unblind a single transaction output using a blinding private key.
 *
 * @param {string} txid            - Transaction ID (hex)
 * @param {string} blindingKeyHex  - Blinding PRIVATE key (hex, 32 bytes)
 * @param {number} [outputIndex]   - Specific vout to unblind (default: all outputs)
 *
 * @returns {Promise<UnblindResult>}
 *
 * @typedef {object} UnblindResult
 * @property {string}  txid
 * @property {boolean} verified
 * @property {Array<OutputDetail>} outputs
 *
 * @typedef {object} OutputDetail
 * @property {number}  vout
 * @property {boolean} confidential
 * @property {number|null} value     - satoshis (null if unblind failed)
 * @property {string|null} asset     - asset ID hex in display order (big-endian)
 * @property {boolean} unblinded
 * @property {string|null} error
 */
async function unblindTransaction(txid, blindingKeyHex, outputIndex = null) {
  const zkp = await getZkp();
  const conf = new confModule.Confidential(zkp);

  // Fetch the raw transaction (includes rangeproofs + nonces)
  const rawHex = await esplora.getTxHex(txid);
  const tx     = liquid.Transaction.fromHex(rawHex);

  const blindingKey = Buffer.from(blindingKeyHex, 'hex');

  const results = [];

  const outputsToProcess = outputIndex !== null
    ? [{ out: tx.outs[outputIndex], idx: outputIndex }]
    : tx.outs.map((out, idx) => ({ out, idx }));

  for (const { out, idx } of outputsToProcess) {
    const detail = { vout: idx, confidential: false, value: null, asset: null, unblinded: false, error: null };

    // Explicit (non-confidential) output — value is visible on-chain
    if (isExplicitOutput(out)) {
      detail.confidential = false;
      detail.value = confModule.confidentialValueToSatoshi(out.value);
      // asset bytes = 33 bytes (0x01 prefix + 32 bytes reversed asset ID)
      detail.asset = toDisplayAsset(out.asset);
      detail.unblinded = true;
      results.push(detail);
      continue;
    }

    // Confidential output — attempt unblind
    detail.confidential = true;
    try {
      const revealed = conf.unblindOutputWithKey(out, blindingKey);
      detail.value     = parseInt(revealed.value, 10);
      // revealed.asset is 32 bytes in LE order — convert to display (BE) hex
      detail.asset     = Buffer.from(revealed.asset).reverse().toString('hex');
      detail.unblinded = true;
    } catch (err) {
      // Key doesn't match this output — normal if we only own one output
      detail.error = `Cannot unblind with provided key: ${err.message}`;
    }

    results.push(detail);
  }

  const anyUnblinded = results.some(r => r.unblinded && r.confidential);
  const totalValue   = results.reduce((s, r) => s + (r.value ?? 0), 0);

  return {
    txid,
    verified : results.some(r => r.unblinded),
    outputs  : results,
    // Convenience: total of successfully unblinded confidential outputs
    totalUnblindedSat: results
      .filter(r => r.unblinded && r.confidential)
      .reduce((s, r) => s + (r.value ?? 0), 0),
    // Convenience: sum of all visible outputs (explicit + unblinded)
    totalVisibleSat: totalValue,
  };
}

// ── Verify declared amount vs on-chain unblinded amount ──────────────────────

/**
 * Compliance check: compare the declared amount in the Travel Rule record
 * against the real on-chain unblinded amount.
 *
 * @param {string} txid
 * @param {string} blindingKeyHex
 * @param {number} declaredAmountSat
 * @param {string} [expectedAssetId]  - optional: verify asset matches too
 *
 * @returns {Promise<{ match: boolean, delta: number, details: UnblindResult }>}
 */
async function verifyDeclaredAmount(txid, blindingKeyHex, declaredAmountSat, expectedAssetId) {
  const details = await unblindTransaction(txid, blindingKeyHex);

  if (!details.verified) {
    return {
      match  : false,
      delta  : null,
      error  : 'Could not unblind any output with the provided key',
      details,
    };
  }

  // Find the output that best matches the declared amount
  const candidates = details.outputs.filter(o => o.unblinded && o.confidential);
  const best = candidates.find(o =>
    o.value === declaredAmountSat &&
    (!expectedAssetId || o.asset === expectedAssetId)
  );

  if (best) {
    return { match: true, delta: 0, details };
  }

  // Closest match — useful for detecting amount manipulation
  const closest = candidates.reduce(
    (prev, curr) =>
      Math.abs(curr.value - declaredAmountSat) < Math.abs((prev?.value ?? Infinity) - declaredAmountSat)
        ? curr : prev,
    null
  );

  const delta = closest ? closest.value - declaredAmountSat : null;

  return { match: false, delta, details };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * An output is explicit (non-confidential) if:
 *   - Its value buffer starts with 0x01 (explicit value prefix in Elements)
 *   - It has no rangeProof (or empty rangeProof)
 */
function isExplicitOutput(out) {
  if (!out.value || out.value.length === 0) return false;
  // 0x01 = explicit; 0x08 or 0x09 = confidential commitment
  return out.value[0] === 0x01;
}

/**
 * Convert internal LE 33-byte asset buffer to big-endian display hex.
 * Input:  33 bytes → 0x01 + 32 LE bytes
 * Output: 64-char hex string (big-endian, as shown in block explorers)
 */
function toDisplayAsset(assetBytes) {
  if (!assetBytes || assetBytes.length < 33) return null;
  return Buffer.from(assetBytes.slice(1)).reverse().toString('hex');
}

module.exports = { unblindTransaction, verifyDeclaredAmount };
