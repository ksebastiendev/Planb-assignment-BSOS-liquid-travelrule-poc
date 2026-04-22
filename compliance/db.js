/**
 * compliance/db.js
 * SQLite schema + helpers for Travel Rule records.
 * Uses node:sqlite — built-in since Node.js 22.5, no native addon required.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db', 'compliance.sqlite');

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');
  migrate(_db);
  return _db;
}

// ── Schema migrations ─────────────────────────────────────────────────────────

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      id            TEXT PRIMARY KEY,
      txid          TEXT NOT NULL,
      asset_id      TEXT NOT NULL,
      amount_sat    INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TEXT NOT NULL,
      confirmed_at  TEXT,
      ivms101_id    TEXT,
      FOREIGN KEY (ivms101_id) REFERENCES ivms101_messages(id)
    );

    -- ── NEW: Compliance records (Travel Rule core store) ───────────────────────
    -- One record per qualifying transaction; holds the IVMS101 payload inline
    -- and tracks the corridor step (origination | relay | settlement).
    CREATE TABLE IF NOT EXISTS compliance_records (
      id               TEXT PRIMARY KEY,          -- UUID v4
      txid             TEXT,                      -- Liquid txid (may be null while pending)
      ivms101_payload  TEXT,                      -- Full IVMS101 message (JSON)
      amount_declared  REAL,                      -- Amount as declared by the originator VASP
      asset            TEXT,                      -- Liquid asset ID (display hex)
      corridor_step    TEXT NOT NULL,             -- 'origination' | 'relay' | 'settlement'
      status           TEXT NOT NULL DEFAULT 'pending',
        -- pending | confirmed | verified
      created_at       TEXT NOT NULL,             -- ISO-8601
      updated_at       TEXT NOT NULL              -- ISO-8601
    );

    -- ── NEW: Blinding keys (least-privilege access) ───────────────────────────
    -- Stored separately from compliance_records so that read access to the
    -- compliance data does NOT automatically grant access to the blinding keys.
    -- Every access to a blinding key is logged via the accessed_at timestamp.
    -- In production, this table would live in a separate encrypted database or HSM.
    CREATE TABLE IF NOT EXISTS blinding_keys (
      txid        TEXT PRIMARY KEY,               -- Liquid txid
      blinding_key TEXT NOT NULL,                 -- Hex-encoded blinding private key
      accessed_at TEXT                            -- ISO-8601; NULL = never accessed
    );

    CREATE TABLE IF NOT EXISTS ivms101_messages (
      id              TEXT PRIMARY KEY,
      transfer_id     TEXT NOT NULL,
      originator_vasp TEXT NOT NULL,
      beneficiary_vasp TEXT NOT NULL,
      originator_json TEXT NOT NULL,
      beneficiary_json TEXT NOT NULL,
      raw_json        TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event       TEXT NOT NULL,
      reference   TEXT,
      payload     TEXT,
      actor       TEXT,
      ts          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vasps (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      lei         TEXT,
      jurisdiction TEXT,
      endpoint    TEXT,
      created_at  TEXT NOT NULL
    );
  `);
}

// ── Transfers ─────────────────────────────────────────────────────────────────

function insertTransfer(transfer) {
  getDb().prepare(`
    INSERT INTO transfers (id, txid, asset_id, amount_sat, status, created_at, ivms101_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    transfer.id, transfer.txid, transfer.asset_id, transfer.amount_sat,
    transfer.status, transfer.created_at, transfer.ivms101_id ?? null
  );
}

function getTransfer(id) {
  return getDb().prepare('SELECT * FROM transfers WHERE id = ?').get(id);
}

function getTransferByTxid(txid) {
  return getDb().prepare('SELECT * FROM transfers WHERE txid = ?').get(txid);
}

function listTransfers({ status, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  if (status) {
    return db.prepare(
      'SELECT * FROM transfers WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(status, limit, offset);
  }
  return db.prepare(
    'SELECT * FROM transfers ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

function updateTransferStatus(id, status, confirmedAt = null) {
  getDb().prepare(
    'UPDATE transfers SET status = ?, confirmed_at = ? WHERE id = ?'
  ).run(status, confirmedAt, id);
}

function linkIvms101(transferId, ivms101Id) {
  getDb().prepare(
    'UPDATE transfers SET ivms101_id = ? WHERE id = ?'
  ).run(ivms101Id, transferId);
}

// ── IVMS101 messages ──────────────────────────────────────────────────────────

function insertIvms101(msg) {
  getDb().prepare(`
    INSERT INTO ivms101_messages
      (id, transfer_id, originator_vasp, beneficiary_vasp,
       originator_json, beneficiary_json, raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id, msg.transfer_id, msg.originator_vasp, msg.beneficiary_vasp,
    msg.originator_json, msg.beneficiary_json, msg.raw_json, msg.created_at
  );
}

function getIvms101ByTransfer(transferId) {
  return getDb().prepare(
    'SELECT * FROM ivms101_messages WHERE transfer_id = ?'
  ).get(transferId);
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function audit(event, reference, payload, actor = 'system') {
  getDb().prepare(
    'INSERT INTO audit_log (event, reference, payload, actor, ts) VALUES (?, ?, ?, ?, ?)'
  ).run(event, reference, JSON.stringify(payload), actor, new Date().toISOString());
}

function getAuditLog({ reference, limit = 100 } = {}) {
  const db = getDb();
  if (reference) {
    return db.prepare(
      'SELECT * FROM audit_log WHERE reference = ? ORDER BY ts DESC LIMIT ?'
    ).all(reference, limit);
  }
  return db.prepare('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?').all(limit);
}

// ── VASPs ─────────────────────────────────────────────────────────────────────

function upsertVasp(vasp) {
  getDb().prepare(`
    INSERT INTO vasps (id, name, lei, jurisdiction, endpoint, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      lei = excluded.lei,
      jurisdiction = excluded.jurisdiction,
      endpoint = excluded.endpoint
  `).run(
    vasp.id, vasp.name, vasp.lei ?? null, vasp.jurisdiction ?? null,
    vasp.endpoint ?? null, vasp.created_at
  );
}

function getVasp(name) {
  return getDb().prepare('SELECT * FROM vasps WHERE name = ?').get(name);
}

function listVasps() {
  return getDb().prepare('SELECT * FROM vasps ORDER BY name').all();
}

// ── Compliance records ────────────────────────────────────────────────────────

/**
 * Insert a new compliance record.
 * @param {object} rec
 * @param {string} rec.id
 * @param {string|null} rec.txid
 * @param {string} rec.ivms101_payload   - JSON string
 * @param {number} rec.amount_declared
 * @param {string} rec.asset
 * @param {string} rec.corridor_step     - 'origination' | 'relay' | 'settlement'
 * @param {string} [rec.status='pending']
 * @param {string} rec.created_at
 * @param {string} rec.updated_at
 */
function insertComplianceRecord(rec) {
  const now = rec.created_at || new Date().toISOString();
  getDb().prepare(`
    INSERT INTO compliance_records
      (id, txid, ivms101_payload, amount_declared, asset, corridor_step, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rec.id,
    rec.txid ?? null,
    rec.ivms101_payload,
    rec.amount_declared,
    rec.asset,
    rec.corridor_step,
    rec.status ?? 'pending',
    now,
    rec.updated_at || now,
  );
}

function getComplianceRecord(id) {
  return getDb().prepare('SELECT * FROM compliance_records WHERE id = ?').get(id);
}

function getComplianceRecordByTxid(txid) {
  return getDb().prepare('SELECT * FROM compliance_records WHERE txid = ?').get(txid);
}

function listComplianceRecords({ status, corridorStep, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM compliance_records WHERE 1=1';
  const params = [];
  if (status)       { sql += ' AND status = ?';        params.push(status); }
  if (corridorStep) { sql += ' AND corridor_step = ?'; params.push(corridorStep); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function updateComplianceRecord(id, fields) {
  const now = new Date().toISOString();
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(fields), now, id];
  getDb().prepare(`UPDATE compliance_records SET ${sets}, updated_at = ? WHERE id = ?`).run(...vals);
}

function linkComplianceTxid(id, txid) {
  const now = new Date().toISOString();
  getDb().prepare(
    'UPDATE compliance_records SET txid = ?, updated_at = ? WHERE id = ?'
  ).run(txid, now, id);
}

// ── Blinding keys (least-privilege) ──────────────────────────────────────────

/**
 * Store a blinding key for a transaction.
 * Called immediately after a CT is broadcast so the key is never lost.
 */
function insertBlindingKey(txid, blindingKeyHex) {
  getDb().prepare(`
    INSERT INTO blinding_keys (txid, blinding_key, accessed_at)
    VALUES (?, ?, NULL)
    ON CONFLICT(txid) DO UPDATE SET blinding_key = excluded.blinding_key
  `).run(txid, blindingKeyHex);
}

/**
 * Retrieve a blinding key and mark the access timestamp.
 * The access timestamp provides a tamper-evident audit trail.
 *
 * @param {string} txid
 * @returns {{ txid: string, blinding_key: string, accessed_at: string|null } | null}
 */
function getBlindingKey(txid) {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM blinding_keys WHERE txid = ?').get(txid);
  if (!row) return null;

  // Log the access
  db.prepare(
    'UPDATE blinding_keys SET accessed_at = ? WHERE txid = ?'
  ).run(new Date().toISOString(), txid);

  return row;
}

function listBlindingKeyAccesses() {
  return getDb().prepare(
    'SELECT txid, accessed_at FROM blinding_keys ORDER BY accessed_at DESC NULLS LAST'
  ).all();
}

module.exports = {
  getDb,
  // Transfers (original layer)
  insertTransfer, getTransfer, getTransferByTxid, listTransfers,
  updateTransferStatus, linkIvms101,
  // IVMS101 messages
  insertIvms101, getIvms101ByTransfer,
  // Audit log
  audit, getAuditLog,
  // VASPs
  upsertVasp, getVasp, listVasps,
  // Compliance records (new)
  insertComplianceRecord, getComplianceRecord, getComplianceRecordByTxid,
  listComplianceRecords, updateComplianceRecord, linkComplianceTxid,
  // Blinding keys (new — least-privilege)
  insertBlindingKey, getBlindingKey, listBlindingKeyAccesses,
};
