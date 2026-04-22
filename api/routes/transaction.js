/**
 * api/routes/transaction.js
 *
 * POST /transaction  — flow complet Travel Rule + CT Liquid
 * GET  /transaction  — liste les compliance_records
 * GET  /transaction/:id — détail d'un record
 *
 * Référence réglementaire simulée : BCB Resolução 520 (Brésil)
 * Corridor : BR (EuroExchange) → CI (AbidjanPay)
 */

'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');

const { transaction: ct, wallet: walletLib } = require('../../chain');
const { db, ivms101 }                        = require('../../compliance');

require('dotenv').config();

const router = express.Router();

// ── Configuration ─────────────────────────────────────────────────────────────

const EXPLORER_BASE = 'https://blockstream.info/liquidtestnet/tx';

// Hot wallet de la VASP originatrice — configurée via .env
// Si absente → mode démo : on simule un txid sans diffuser réellement sur le réseau.
const VASP_WALLET = (process.env.VASP_PRIVATE_KEY && process.env.VASP_BLINDING_KEY)
  ? walletLib.restoreWallet(process.env.VASP_PRIVATE_KEY, process.env.VASP_BLINDING_KEY)
  : null;

const VASP_NAME = process.env.VASP_NAME || 'EuroExchange SA';
const VASP_LEI  = process.env.VASP_LEI  || 'FR-LEI-EUROEXCH-001';
const PARTNER_VASP_NAME = process.env.PARTNER_VASP_NAME || 'AbidjanPay SARL';
const PARTNER_VASP_LEI  = process.env.PARTNER_VASP_LEI  || 'CI-LEI-ABIDJANPAY-001';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Split "Prénom Nom" → { firstName, lastName }.
 * Dernier token = lastName, tout le reste = firstName.
 */
function splitName(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName : parts[parts.length - 1],
  };
}

/**
 * Mappe le body de la requête vers une NaturalPerson IVMS101.
 * Supporte les champs `cpf` (Brésil) et `nationalId` (générique).
 */
function bodyToNaturalPerson(p) {
  const { firstName, lastName } = splitName(p.name);
  return ivms101.buildNaturalPerson({
    firstName,
    lastName,
    nationalId  : p.cpf || p.nationalId || undefined,
    nationalIdType: p.cpf ? 'TAXID' : (p.nationalIdType || 'IDCARD'),
    countryOfResidence: p.country || undefined,
  });
}

/**
 * Simulation de la transmission inter-VASP (corridor partner).
 * Dans un vrai système : appel REST vers l'API du VASP destinataire.
 * Ici : on enregistre un compliance_record côté "récepteur" dans la même DB.
 */
function simulateCorridorTransmission({ recordId, txid, ivms101Payload, amountDeclared, asset }) {
  const now  = new Date().toISOString();
  const relayId = uuidv4();
  db.insertComplianceRecord({
    id             : relayId,
    txid,
    ivms101_payload: ivms101Payload,
    amount_declared: amountDeclared,
    asset,
    corridor_step  : 'settlement',
    status         : 'confirmed',
    created_at     : now,
    updated_at     : now,
  });
  db.audit(
    'corridor.transmitted',
    relayId,
    { originRecordId: recordId, partnerVasp: PARTNER_VASP_NAME },
    'corridor-simulator'
  );
  return relayId;
}

// ── POST /transaction ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /transaction:
 *   post:
 *     tags: [Transactions]
 *     summary: Initiate a compliant cross-border settlement
 *     description: >
 *       Executes a Liquid Network Confidential Transaction with pre-flight
 *       Travel Rule data collection (BCB Resolution 520, Art. 44).
 *       The compliance record and IVMS101 message are persisted **before**
 *       the transaction is broadcast, satisfying the pre-flight obligation.
 *       When `VASP_PRIVATE_KEY` is absent the server runs in demo mode —
 *       a synthetic txid is generated and no real broadcast occurs.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransactionRequest'
 *     responses:
 *       201:
 *         description: Transfer submitted and compliance record created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransactionResponse'
 *       400:
 *         description: Missing or invalid request fields.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: IVMS101 payload failed Travel Rule completeness validation.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', async (req, res) => {
  const { originator, beneficiary, amount, asset, toAddress } = req.body;

  // ── 1. Validation ──────────────────────────────────────────────────────────
  const errs = [];
  if (!originator?.name)          errs.push('originator.name requis');
  if (!originator?.walletAddress) errs.push('originator.walletAddress requis');
  if (!beneficiary?.name)         errs.push('beneficiary.name requis');
  if (!beneficiary?.walletAddress)errs.push('beneficiary.walletAddress requis');
  if (amount === undefined || amount === null) errs.push('amount requis');
  if (!asset)                     errs.push('asset requis');
  if (!toAddress)                 errs.push('toAddress requis');

  if (errs.length) {
    return res.status(400).json({ error: 'Champs manquants', details: errs });
  }

  const amountSat = Number(amount);
  if (!Number.isFinite(amountSat) || amountSat <= 0) {
    return res.status(400).json({ error: 'amount doit être un entier positif (satoshis)' });
  }

  // ── 2. Identifiants ────────────────────────────────────────────────────────
  const recordId = uuidv4();
  const now      = new Date().toISOString();

  // ── 3. Build IVMS101 ───────────────────────────────────────────────────────
  const originatorPerson   = bodyToNaturalPerson(originator);
  const beneficiaryPerson  = bodyToNaturalPerson(beneficiary);

  const { id: ivmsId, message: ivmsMessage } = ivms101.buildIvms101Message({
    originator: {
      person  : originatorPerson,
      address : originator.walletAddress,
      vaspName: VASP_NAME,
      vaspLei : VASP_LEI,
    },
    beneficiary: {
      person  : beneficiaryPerson,
      address : beneficiary.walletAddress,
      vaspName: PARTNER_VASP_NAME,
      vaspLei : PARTNER_VASP_LEI,
    },
    transfer: {
      txid    : 'pending',   // sera mis à jour après le broadcast
      assetId : asset,
      amountSat,
    },
  });

  const ivmsPayloadStr = JSON.stringify(ivmsMessage);

  const ivmsValidation = ivms101.validateIvms101(ivmsMessage);
  if (!ivmsValidation.valid) {
    return res.status(422).json({
      error  : 'Payload IVMS101 invalide — Travel Rule non satisfait',
      details: ivmsValidation.errors,
    });
  }

  // ── 4. INSERT compliance_record status="pending" (pre-flight BCB 520) ──────
  db.insertComplianceRecord({
    id             : recordId,
    txid           : null,          // pas encore de txid
    ivms101_payload: ivmsPayloadStr,
    amount_declared: amountSat,
    asset,
    corridor_step  : 'origination',
    status         : 'pending',
    created_at     : now,
    updated_at     : now,
  });

  db.audit('compliance.preflight', recordId, { amountSat, asset, originator: originator.name }, VASP_NAME);

  // ── 5. buildAndSendCT → { txid, blindingKey } ─────────────────────────────
  let txid, blindingKey, demoMode = false;

  try {
    if (!VASP_WALLET) {
      // Mode démo : pas de hot wallet configuré → txid simulé
      txid        = Buffer.from(uuidv4().replace(/-/g, ''), 'hex').toString('hex').padEnd(64, '0');
      blindingKey = 'demo-' + Buffer.from(uuidv4().replace(/-/g, ''), 'hex').toString('hex');
      demoMode    = true;
    } else {
      const result = await ct.buildAndSendCT(
        VASP_WALLET,
        toAddress,
        amountSat,
        asset,
        { feeSat: parseInt(process.env.DEFAULT_FEE_SAT || '500', 10) }
      );
      txid        = result.txid;
      blindingKey = result.blindingKey;
    }
  } catch (broadcastErr) {
    // Rollback : marquer le record comme échoué
    db.updateComplianceRecord(recordId, { status: 'failed' });
    db.audit('compliance.broadcast_error', recordId, { error: broadcastErr.message }, VASP_NAME);
    return res.status(502).json({
      error  : 'Échec de la diffusion de la transaction Liquid',
      detail : broadcastErr.message,
      recordId,
    });
  }

  // ── 6. UPDATE compliance_record : txid + status="confirmed" ───────────────
  db.linkComplianceTxid(recordId, txid);
  db.updateComplianceRecord(recordId, { status: 'confirmed' });
  db.audit('compliance.confirmed', recordId, { txid, demoMode }, VASP_NAME);

  // ── 7. INSERT blinding_key (table séparée — moindre privilège) ────────────
  db.insertBlindingKey(txid, blindingKey);

  // ── 8. Simulation transmission corridor ───────────────────────────────────
  const relayRecordId = simulateCorridorTransmission({
    recordId,
    txid,
    ivms101Payload: ivmsPayloadStr,
    amountDeclared: amountSat,
    asset,
  });

  // ── 9. Réponse ─────────────────────────────────────────────────────────────
  return res.status(201).json({
    recordId,
    txid,
    status     : 'confirmed',
    demoMode,
    ivms101    : ivmsMessage,
    explorerUrl: `${EXPLORER_BASE}/${txid}`,
    corridor   : {
      step           : 'origination',
      relayRecordId,
      partnerVasp    : PARTNER_VASP_NAME,
      transmitted    : true,
    },
    ...(demoMode && {
      warning: 'DEMO MODE — Aucun hot wallet configuré (VASP_PRIVATE_KEY). '
             + 'Ajoutez les variables dans .env pour diffuser de vraies transactions.',
    }),
  });
});

// ── GET /transaction ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /transaction:
 *   get:
 *     tags: [Transactions]
 *     summary: List compliance records
 *     description: Returns all origination compliance records. The `ivms101_payload` field is omitted from the list for performance; retrieve it via `GET /transaction/:id`.
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, verified, failed] }
 *         description: Filter by status.
 *       - in: query
 *         name: step
 *         schema: { type: string, enum: [origination, relay, settlement] }
 *         description: Filter by corridor step.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Array of compliance records (IVMS101 payload excluded).
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:              { type: string, format: uuid }
 *                   txid:            { type: string }
 *                   amount_declared: { type: number }
 *                   asset:           { type: string }
 *                   corridor_step:   { type: string }
 *                   status:          { type: string }
 *                   created_at:      { type: string, format: date-time }
 */
router.get('/', (req, res) => {
  const { status, step, limit, offset } = req.query;
  try {
    const records = db.listComplianceRecords({
      status      : status || undefined,
      corridorStep: step   || undefined,
      limit       : limit  ? parseInt(limit,  10) : 50,
      offset      : offset ? parseInt(offset, 10) : 0,
    });
    res.json(records.map(r => ({
      ...r,
      ivms101_payload: undefined,   // ne pas exposer le payload dans la liste
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /transaction/:id ──────────────────────────────────────────────────────

/**
 * @swagger
 * /transaction/{id}:
 *   get:
 *     tags: [Transactions]
 *     summary: Get a compliance record with full IVMS101 payload
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Compliance record UUID.
 *     responses:
 *       200:
 *         description: Full compliance record including parsed IVMS101 payload.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:              { type: string }
 *                 txid:            { type: string }
 *                 ivms101_payload: { type: object }
 *                 amount_declared: { type: number }
 *                 status:          { type: string }
 *       404:
 *         description: Record not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', (req, res) => {
  const record = db.getComplianceRecord(req.params.id);
  if (!record) {
    return res.status(404).json({ error: 'Compliance record introuvable' });
  }
  res.json({
    ...record,
    ivms101_payload: record.ivms101_payload
      ? JSON.parse(record.ivms101_payload)
      : null,
  });
});

module.exports = router;
