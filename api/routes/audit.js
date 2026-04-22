/**
 * api/routes/audit.js
 *
 * GET /audit           — journal d'audit complet (derniers événements en tête)
 * GET /audit/:txid     — audit réglementaire ciblé sur une transaction
 *
 * La route /:txid est la route "régulateur" :
 *   - Récupère le compliance_record (IVMS101 + montant déclaré)
 *   - Récupère la blinding key (avec log d'accès — BCB Resolução 520)
 *   - Retourne le tout avec accusé de réception réglementaire
 *
 * Sécurité : chaque accès à une blinding key est horodaté dans blinding_keys.accessed_at.
 * En production, cette route serait protégée par mTLS + JWT régulateur.
 */

'use strict';

const express = require('express');
const { db }  = require('../../compliance');

const router = express.Router();

// ── GET /audit  (journal général) ────────────────────────────────────────────

/**
 * @swagger
 * /audit:
 *   get:
 *     tags: [Audit]
 *     summary: Retrieve the general audit event log
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100 }
 *         description: Maximum number of events to return (most recent first).
 *     responses:
 *       200:
 *         description: Array of audit log events.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:         { type: integer }
 *                   event_type: { type: string, example: 'audit.regulatory_access' }
 *                   entity_id:  { type: string }
 *                   payload:    { type: object }
 *                   actor:      { type: string, example: 'regulator' }
 *                   created_at: { type: string, format: date-time }
 */
router.get('/', (req, res) => {
  try {
    const limit  = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    const events = db.getAuditLog({ limit });
    res.json(
      events.map(e => ({
        ...e,
        payload: safeJsonParse(e.payload),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /audit/:txid  (accès réglementaire) ───────────────────────────────────

/**
 * @swagger
 * /audit/{txid}:
 *   get:
 *     tags: [Audit]
 *     summary: Regulatory audit access (BCB Resolution 520)
 *     description: >
 *       Retrieves the full IVMS101 compliance record and the blinding key
 *       for a given transaction. Every call is logged with an `accessed_at`
 *       timestamp, satisfying BCB Resolution 520 Art. 44 audit trail requirements.
 *       In production this route would be protected by mTLS + regulator JWT.
 *     parameters:
 *       - in: path
 *         name: txid
 *         required: true
 *         schema: { type: string }
 *         description: Liquid Network transaction ID.
 *         example: 9e3b1a7f4c2d8e0a1b3c5d7f9e2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8
 *     responses:
 *       200:
 *         description: Compliance record with full IVMS101 payload and blinding key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuditResponse'
 *       404:
 *         description: No compliance record found for this txid.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:txid', (req, res) => {
  const { txid } = req.params;

  // ── 1. Récupérer le compliance_record ─────────────────────────────────────
  const record = db.getComplianceRecordByTxid(txid);

  if (!record) {
    // Fallback : chercher dans l'ancien store transfers si la transaction
    // a été soumise avant la migration du schéma.
    const legacyRecord = db.getTransferByTxid(txid);
    if (!legacyRecord) {
      return res.status(404).json({
        error: 'Aucun compliance record trouvé pour ce txid',
        txid,
      });
    }
    // Répondre avec les données minimales du legacy store
    return res.json({
      record        : legacyRecord,
      blindingKey   : null,
      accessLogged  : false,
      legacyRecord  : true,
      message       : 'Record trouvé dans le store hérité (transfers). Blinding key non disponible.',
    });
  }

  // ── 2. Récupérer la blinding key (accès loggé) ────────────────────────────
  const bkRow = db.getBlindingKey(txid);   // logged_at mis à jour automatiquement

  // ── 3. Logger l'accès réglementaire dans l'audit log ─────────────────────
  db.audit(
    'audit.regulatory_access',
    txid,
    {
      recordId      : record.id,
      corridorStep  : record.corridor_step,
      amountDeclared: record.amount_declared,
      blindingKeyAccessed: !!bkRow,
    },
    'regulator'
  );

  // ── 4. Préparer la réponse ────────────────────────────────────────────────
  const ivmsPayload = record.ivms101_payload
    ? safeJsonParse(record.ivms101_payload)
    : null;

  return res.json({
    record: {
      id            : record.id,
      txid          : record.txid,
      ivms101_payload: ivmsPayload,
      amount_declared: record.amount_declared,
      asset         : record.asset,
      corridor_step : record.corridor_step,
      status        : record.status,
      created_at    : record.created_at,
      updated_at    : record.updated_at,
    },
    blindingKey : bkRow?.blinding_key ?? null,
    accessLogged: true,
    accessedAt  : bkRow?.accessed_at ?? new Date().toISOString(),
    message     : 'Accès audit réglementaire enregistré — BCB Resolução 520',
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────

function safeJsonParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

module.exports = router;
