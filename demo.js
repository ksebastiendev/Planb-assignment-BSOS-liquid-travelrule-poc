/**
 * demo.js — Démonstration complète du flow BSOS Liquid Compliance POC
 *
 * Joue en séquence :
 *   1. Annonce du POC
 *   2. POST /transaction (João → Akosua, 250 sat)
 *   3. Pause
 *   4. GET /audit/:txid  (accès réglementaire BCB)
 *   5. GET /verify/:txid (vérification on-chain)
 *   6. Récap + liens
 *
 * Prérequis : npm start (serveur sur PORT, défaut 3001)
 * Usage     : node demo.js
 */

'use strict';

require('dotenv').config();

const API      = `http://localhost:${process.env.PORT || 3001}`;
const EXPLORER = 'https://blockstream.info/liquidtestnet/tx';
const LBTC     = '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49';

// ── Terminal helpers ──────────────────────────────────────────────────────────

const C = {
  reset : '\x1b[0m',
  bold  : '\x1b[1m',
  dim   : '\x1b[2m',
  green : '\x1b[32m',
  red   : '\x1b[31m',
  yellow: '\x1b[33m',
  cyan  : '\x1b[36m',
  blue  : '\x1b[34m',
  grey  : '\x1b[90m',
  white : '\x1b[97m',
  bgBlue: '\x1b[44m',
};

function line(char = '─', len = 56) {
  return char.repeat(len);
}

function sep(title = '') {
  if (!title) { console.log(`${C.grey}${line()}${C.reset}`); return; }
  const pad  = Math.max(0, 56 - title.length - 4);
  const left = Math.floor(pad / 2);
  const right= pad - left;
  console.log(`${C.grey}${'─'.repeat(left)}[ ${C.reset}${C.bold}${title}${C.reset}${C.grey} ]${'─'.repeat(right)}${C.reset}`);
}

function kv(key, value, valueColor = C.white) {
  const keyStr = `${C.grey}${key.padEnd(18)}${C.reset}`;
  console.log(`  ${keyStr}${valueColor}${value}${C.reset}`);
}

function ok(msg)   { console.log(`  ${C.green}✓${C.reset}  ${msg}`); }
function err(msg)  { console.log(`  ${C.red}✘${C.reset}  ${msg}`); }
function info(msg) { console.log(`  ${C.cyan}→${C.reset}  ${msg}`); }

function pause(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function httpPost(path, body) {
  const res  = await fetch(API + path, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(
    new Error(json.error || json.details?.join(', ') || `HTTP ${res.status}`),
    { status: res.status, body: json }
  );
  return json;
}

async function httpGet(path) {
  const res  = await fetch(API + path);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(
    new Error(json.error || `HTTP ${res.status}`),
    { status: res.status, body: json }
  );
  return json;
}

// ── Server check ──────────────────────────────────────────────────────────────

async function checkServer() {
  const res = await fetch(`${API}/health`).catch(() => null);
  if (!res?.ok) throw new Error(`Serveur injoignable sur ${API} — lancez : npm start`);
  const { ts } = await res.json().catch(() => ({}));
  ok(`Serveur actif  ${C.grey}(${API}, ts: ${ts || '?'})${C.reset}`);
}

// ── Étape 2 : POST /transaction ───────────────────────────────────────────────

async function stepPostTransaction() {
  sep('STEP 2 · POST /transaction');
  console.log('');
  info(`Corridor  : ${C.bold}Brésil (BR) → Côte d'Ivoire (CI)${C.reset}`);
  info(`Parties   : ${C.bold}João Silva${C.reset} → ${C.bold}Akosua Mensah${C.reset}`);
  info(`Amount    : ${C.yellow}250 sat${C.reset} (tL-BTC testnet)`);
  info(`VASP orig : EuroExchange SA  |  VASP dest : AbidjanPay SARL`);
  console.log('');

  const payload = {
    originator: {
      name        : 'João Silva',
      cpf         : '123.456.789-00',
      address     : 'Rua das Flores 42, São Paulo, SP, BR',
      accountRef  : 'BR-EUROEXCH-001234',
      walletAddress: 'tlq1qqf9yfkn6a9v8qy3r5hw2m4xpzl0cd7s8jknte26wkxn5m4v6k2q7rp9sw',
      country     : 'BR',
    },
    beneficiary: {
      name        : 'Akosua Mensah',
      accountRef  : 'CI-ABIDJANPAY-005678',
      walletAddress: 'tlq1qqgz3mx8p5kqr7yw4nhd2sc9v1lj6f0tae37wkcq8ny4l5m7b3p4rs6tnk',
    },
    amount   : 250,
    asset    : LBTC,
    toAddress: 'tlq1qqgz3mx8p5kqr7yw4nhd2sc9v1lj6f0tae37wkcq8ny4l5m7b3p4rs6tnk',
  };

  process.stdout.write(`  ${C.grey}Sending transaction…${C.reset} `);
  const data = await httpPost('/transaction', payload);
  console.log(`${C.green}OK${C.reset}\n`);

  kv('recordId',    data.recordId,    C.cyan);
  kv('txid',        data.txid,        C.blue);
  kv('status',      data.status,      data.status === 'confirmed' ? C.green : C.yellow);
  kv('demoMode',    String(data.demoMode), C.grey);
  kv('explorerUrl', data.explorerUrl, C.grey);

  if (data.demoMode) {
    console.log(`\n  ${C.grey}ℹ  Demo mode — simulated txid (set VASP_PRIVATE_KEY for a real broadcast)${C.reset}`);
  }

  console.log('');
  ok(`Compliance record créé — pre-flight BCB 520 enregistré`);
  ok(`Blinding key stockée (table isolée — moindre privilège)`);
  ok(`Transmission corridor simulée → ${C.bold}AbidjanPay SARL${C.reset}`);

  return { txid: data.txid, recordId: data.recordId, explorerUrl: data.explorerUrl };
}

// ── Étape 4 : GET /audit/:txid ────────────────────────────────────────────────

async function stepAudit(txid) {
  sep('STEP 4 · GET /audit/:txid');
  console.log('');
  info(`txid : ${C.blue}${txid.slice(0, 24)}…${C.reset}`);
  console.log('');

  process.stdout.write(`  ${C.grey}Requête audit réglementaire…${C.reset} `);
  const data = await httpGet('/audit/' + encodeURIComponent(txid));
  console.log(`${C.green}OK${C.reset}\n`);

  const r    = data.record || {};
  const ivms = r.ivms101_payload || {};

  // Extraire noms depuis IVMS101
  const origPersons = ivms.originatingVASP?.originator?.originatorPersons || [];
  const origName    = origPersons[0]?.naturalPerson?.name?.nameIdentifier?.[0];
  const origFull    = [origName?.secondaryIdentifier, origName?.primaryIdentifier].filter(Boolean).join(' ') || '—';
  const origNatId   = origPersons[0]?.naturalPerson?.nationalIdentification;

  const benePersons = ivms.beneficiaryVASP?.beneficiary?.beneficiaryPersons || [];
  const beneName    = benePersons[0]?.naturalPerson?.name?.nameIdentifier?.[0];
  const beneFull    = [beneName?.secondaryIdentifier, beneName?.primaryIdentifier].filter(Boolean).join(' ') || '—';

  console.log(`  ${C.bold}Originator${C.reset}`);
  kv('  Nom',         origFull,    C.white);
  kv('  Identifiant', `${origNatId?.nationalIdentifierType || '?'} : ${origNatId?.nationalIdentifier || '—'}`, C.white);

  console.log('');
  console.log(`  ${C.bold}Beneficiary${C.reset}`);
  kv('  Nom',         beneFull,    C.white);

  console.log('');
  console.log(`  ${C.bold}Blinding key${C.reset}`);
  const bkey = data.blindingKey || '—';
  kv('  Clé (extrait)', `${bkey.slice(0, 14)}…`, C.yellow);
  kv('  Access logged', String(data.accessLogged), data.accessLogged ? C.green : C.red);
  kv('  Timestamp',    data.accessedAt || '—', C.grey);

  console.log('');
  ok(`Accès réglementaire enregistré ${C.bold}✓${C.reset}`);
  ok(`${data.message || 'BCB Resolução 520, Art. 44'}`);

  return { blindingKey: data.blindingKey };
}

// ── Étape 5 : GET /verify/:txid ──────────────────────────────────────────────

async function stepVerify(txid, blindingKey) {
  sep('STEP 5 · GET /verify/:txid');
  console.log('');
  info(`txid        : ${C.blue}${txid.slice(0, 24)}…${C.reset}`);
  info(`blindingKey : ${C.yellow}${(blindingKey || '').slice(0, 14)}…${C.reset}  ${C.grey}(lookup auto depuis DB)${C.reset}`);
  console.log('');

  // On passe sans ?blindingKey pour tester le lookup auto depuis DB
  process.stdout.write(`  ${C.grey}On-chain verification…${C.reset} `);
  const data = await httpGet('/verify/' + encodeURIComponent(txid));
  console.log(`${C.green}OK${C.reset}\n`);

  const decAmt = data.declared?.amount;
  const onAmt  = data.onchain?.amount;
  const delta  = data.delta;
  const verif  = data.verified;

  kv('Declared (IVMS101)', decAmt !== null && decAmt !== undefined ? `${decAmt.toLocaleString('fr-FR')} sat` : '—', C.white);
  kv('On-chain',          onAmt  !== null && onAmt  !== undefined ? `${onAmt.toLocaleString('fr-FR')} sat`  : 'N/A (démo)', C.white);
  kv('Delta',             delta  !== null ? `${delta} sat` : 'N/A (démo)', delta === 0 || delta === null ? C.green : C.red);
  kv('Verified',          String(verif), verif ? C.green : C.red);

  console.log('');
  if (verif && (delta === 0 || delta === null)) {
    console.log(`  ${C.green}${C.bold}✅ On-chain verification successful${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}❌ Écart détecté — delta : ${delta} sat${C.reset}`);
  }

  if (data.message) {
    console.log(`\n  ${C.grey}${data.message}${C.reset}`);
  }

  console.log('');
  return data;
}

// ── Étape 6 : Récap & liens ───────────────────────────────────────────────────

function stepRecap({ txid, recordId, explorerUrl }) {
  sep('STEP 6 · Summary');
  console.log('');
  kv('Record ID',    recordId,    C.cyan);
  kv('txid',         txid,        C.blue);
  kv('Explorer',     explorerUrl, C.blue);
  kv('Dashboard',    'http://localhost:3001', C.grey);
  console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Étape 1 : Annonce ──────────────────────────────────────────────────────
  console.log('');
  console.log(`${C.bold}${C.cyan}╔════════════════════════════════════════════════════════╗`);
  console.log(`║                                                        ║`);
  console.log(`║   BSOS — Liquid Network Compliance POC                 ║`);
  console.log(`║   Travel Rule · BCB Resolução 520 · IVMS 101           ║`);
  console.log(`║                                                        ║`);
  console.log(`╚════════════════════════════════════════════════════════╝${C.reset}`);
  console.log('');
  console.log(`  ${C.grey}Stack  : Node.js 24 · liquidjs-lib · SQLite · Express${C.reset}`);
  console.log(`  ${C.grey}Réseau : Liquid Network testnet (Blockstream Esplora)${C.reset}`);
  console.log(`  ${C.grey}API    : ${API}${C.reset}`);
  console.log('');

  sep('STEP 1 · Server check');
  console.log('');

  try {
    await checkServer();
  } catch (e) {
    err(e.message);
    process.exit(1);
  }

  console.log('');
  await pause(500);

  // ── Étape 2 : POST /transaction ────────────────────────────────────────────
  let txid, recordId, explorerUrl;
  try {
    ({ txid, recordId, explorerUrl } = await stepPostTransaction());
  } catch (e) {
    sep();
    err(`POST /transaction échoué : ${e.message}`);
    process.exit(1);
  }

  await pause(1000); // Étape 3 : pause délibérée

  // ── Étape 4 : GET /audit/:txid ─────────────────────────────────────────────
  let blindingKey;
  try {
    ({ blindingKey } = await stepAudit(txid));
  } catch (e) {
    sep();
    err(`GET /audit échoué : ${e.message}`);
    process.exit(1);
  }

  await pause(500);

  // ── Étape 5 : GET /verify/:txid ───────────────────────────────────────────
  try {
    await stepVerify(txid, blindingKey);
  } catch (e) {
    sep();
    err(`GET /verify échoué : ${e.message}`);
    process.exit(1);
  }

  // ── Étape 6 : Récap ────────────────────────────────────────────────────────
  stepRecap({ txid, recordId, explorerUrl });

  sep();
  console.log(`\n  ${C.green}${C.bold}Full flow completed successfully.${C.reset}`);
  console.log(`  ${C.grey}To seed 5 transactions : node simulator/seed.js${C.reset}\n`);
}

main().catch(e => {
  console.error(`\n${C.red}Erreur fatale :${C.reset}`, e.message);
  process.exit(1);
});
