/**
 * api/routes/verify.js
 *
 * GET /verify/node           — test de connectivité Esplora
 * GET /verify/:txid          — vérification on-chain vs compliance record
 *   ?blindingKey=<hex>       — si fournie, unblind les outputs confidentiels
 *
 * La vérification compare :
 *   - Le montant DÉCLARÉ dans le record IVMS101 (off-chain)
 *   - Le montant RÉEL on-chain (Liquid testnet via Esplora + unblind)
 *
 * Un écart (delta ≠ 0) déclenche un flag réglementaire.
 */

'use strict';

const express = require('express');
const { esplora, unblind: unblindLib } = require('../../chain');
const { db } = require('../../compliance');

const router = express.Router();

const EXPLORER_BASE = 'https://blockstream.info/liquidtestnet/tx';

// ── GET /verify/node ──────────────────────────────────────────────────────────
// Doit être déclaré avant /:txid pour ne pas être capturé par le pattern.

/**
 * @swagger
 * /verify/node:
 *   get:
 *     tags: [Verify]
 *     summary: Liquid Network node connectivity check
 *     description: Pings the Blockstream Esplora API and returns the current tip block height.
 *     responses:
 *       200:
 *         description: Node is reachable.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:        { type: boolean, example: true }
 *                 tipHeight: { type: integer, example: 2407354 }
 *                 baseUrl:   { type: string, example: 'https://blockstream.info/liquidtestnet/api' }
 *       503:
 *         description: Esplora unreachable.
 */
router.get('/node', async (_req, res) => {
  try {
    const result = await esplora.ping();
    res.json(result);
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ── GET /verify/:txid ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /verify/{txid}:
 *   get:
 *     tags: [Verify]
 *     summary: On-chain amount verification via blinding key
 *     description: >
 *       Fetches the raw Liquid Network transaction from Esplora, unblinds its
 *       outputs using the stored blinding key, and compares the on-chain amount
 *       with the declared IVMS101 amount. A non-zero `delta` indicates a
 *       discrepancy and would trigger a regulatory flag in production.
 *       If `blindingKey` is not provided as a query parameter, it is looked up
 *       automatically from the compliance database (requires a prior call to
 *       `GET /audit/:txid` or the blinding key to have been stored at submission).
 *     parameters:
 *       - in: path
 *         name: txid
 *         required: true
 *         schema: { type: string }
 *         description: Liquid Network transaction ID.
 *         example: 9e3b1a7f4c2d8e0a1b3c5d7f9e2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8
 *       - in: query
 *         name: blindingKey
 *         required: false
 *         schema: { type: string }
 *         description: >
 *           Hex-encoded blinding private key for the recipient output.
 *           Optional — auto-looked up from the compliance database if omitted.
 *     responses:
 *       200:
 *         description: Verification result with declared vs on-chain amounts and delta.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerifyResponse'
 *       404:
 *         description: Transaction not found in compliance database or on-chain.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:txid', async (req, res) => {
  const { txid }       = req.params;
  const blindingKeyHex = req.query.blindingKey || null;

  // ── 1. Récupérer le compliance record ─────────────────────────────────────
  const record = db.getComplianceRecordByTxid(txid);

  // ── 2. Récupérer la blinding key (query param en priorité, sinon DB) ───────
  //    En production : la clé ne serait jamais envoyée en query param.
  //    Ici, pour la démo, on accepte les deux sources.
  let effectiveBlindingKey = blindingKeyHex;
  if (!effectiveBlindingKey && record) {
    const bkRow = db.getBlindingKey(txid);
    effectiveBlindingKey = bkRow?.blinding_key ?? null;
  }

  // ── 3. Statut on-chain (Esplora) ───────────────────────────────────────────
  let onChainStatus = null;
  try {
    onChainStatus = await esplora.getTxStatus(txid);
  } catch (chainErr) {
    // Tx pas encore propagée ou txid invalide — on continue avec ce qu'on a.
    onChainStatus = { found: false, error: chainErr.message };
  }

  // ── 4. Rien trouvé nulle part ──────────────────────────────────────────────
  if (!record && (!onChainStatus || onChainStatus.found === false)) {
    return res.status(404).json({
      error: 'Transaction introuvable : ni en base de compliance, ni sur la chaîne',
      txid,
    });
  }

  // ── 5. Unblind des outputs (si blinding key disponible) ───────────────────
  let unblindResult = null;
  let onchainAmount = null;
  let onchainAsset  = null;

  if (effectiveBlindingKey && !effectiveBlindingKey.startsWith('demo-')) {
    try {
      unblindResult = await unblindLib.unblindTransaction(txid, effectiveBlindingKey);

      // On cherche le premier output confidentiel unblindé (output du destinataire)
      const bestOutput = unblindResult.outputs.find(
        o => o.unblinded && o.confidential && o.value > 0
      ) || unblindResult.outputs.find(
        o => o.unblinded && o.value > 0
      );

      if (bestOutput) {
        onchainAmount = bestOutput.value;
        onchainAsset  = bestOutput.asset;
      }
    } catch (unblindErr) {
      unblindResult = { error: unblindErr.message };
    }
  }

  // ── 6. Comparaison déclaré vs on-chain ────────────────────────────────────
  const declaredAmount = record?.amount_declared ?? null;
  const declaredAsset  = record?.asset ?? null;

  let verified        = false;
  let delta           = null;
  let verificationMsg = null;

  if (declaredAmount !== null && onchainAmount !== null) {
    delta    = onchainAmount - declaredAmount;
    verified = delta === 0 && (!declaredAsset || !onchainAsset || declaredAsset === onchainAsset);

    if (verified) {
      verificationMsg = 'Le montant on-chain correspond au montant déclaré dans le record IVMS101';
    } else if (delta !== 0) {
      verificationMsg = `ÉCART DÉTECTÉ : on-chain=${onchainAmount} sat, déclaré=${declaredAmount} sat (Δ=${delta > 0 ? '+' : ''}${delta})`;
    } else {
      verificationMsg = 'Asset ID ne correspond pas entre le record off-chain et la transaction on-chain';
    }
  } else if (declaredAmount !== null && effectiveBlindingKey?.startsWith('demo-')) {
    // Mode démo : pas de vrai unblind possible
    // delta = 0 par convention — on ne peut pas détecter un écart sans vraie clé
    verified        = true;
    delta           = 0;
    verificationMsg = 'DEMO MODE — unblind non exécuté (clé de démo). Montant déclaré accepté tel quel.';
  } else if (declaredAmount !== null && !effectiveBlindingKey) {
    verificationMsg = 'Blinding key absente — impossible de vérifier le montant on-chain. '
                    + 'Fournissez ?blindingKey=<hex> ou consultez GET /audit/:txid.';
  } else if (onchainAmount !== null) {
    verificationMsg = 'Pas de record compliance trouvé — montant on-chain visible mais non vérifié.';
  }

  // ── 7. Logger la vérification dans l'audit log ────────────────────────────
  if (record) {
    db.audit(
      verified ? 'verify.match' : 'verify.mismatch',
      txid,
      { declaredAmount, onchainAmount, delta, verified },
      'verify-endpoint'
    );
  }

  // ── 8. Réponse ─────────────────────────────────────────────────────────────
  const ivmsPayload = record?.ivms101_payload
    ? safeJsonParse(record.ivms101_payload)
    : null;

  return res.json({
    txid,
    explorerUrl : `${EXPLORER_BASE}/${txid}`,
    onChainStatus,

    declared: declaredAmount !== null ? {
      amount : declaredAmount,
      asset  : declaredAsset,
      source : 'off-chain IVMS101 — compliance record',
    } : null,

    onchain: onchainAmount !== null ? {
      amount : onchainAmount,
      asset  : onchainAsset,
      source : 'Liquid testnet — output unblindé',
    } : null,

    verified,
    delta,
    verifiedAt : new Date().toISOString(),
    message    : verificationMsg,

    // Détail de l'unblind (outputs individuels)
    outputs: unblindResult?.outputs ?? null,

    // Contexte compliance
    complianceRecord: record ? {
      id           : record.id,
      corridorStep : record.corridor_step,
      status       : record.status,
      createdAt    : record.created_at,
    } : null,

    ivms101: ivmsPayload,
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────

function safeJsonParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

module.exports = router;
