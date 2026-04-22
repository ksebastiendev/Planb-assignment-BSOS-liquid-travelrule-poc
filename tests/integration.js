/**
 * tests/integration.js
 * Flow complet Travel Rule — tests d'intégration sans dépendance externe.
 *
 * - Démarre l'app Express sur un port éphémère
 * - Force le mode démo (supprime VASP_PRIVATE_KEY de l'env)
 * - Utilise fetch natif (Node 18+)
 * - Affiche un résumé pass/fail coloré
 *
 * Usage : node tests/integration.js
 */

'use strict';

// ── Force démo mode avant tout require() de l'app ────────────────────────────
// Les routes lisent process.env au moment du require() du module.
// On supprime les clés hot-wallet AVANT de charger l'app.
delete process.env.VASP_PRIVATE_KEY;
delete process.env.VASP_BLINDING_KEY;
process.env.NODE_ENV = 'test';
process.env.DB_PATH  = ':memory:'; // SQLite en mémoire — aucune persistence

// ── Imports ───────────────────────────────────────────────────────────────────
const { createApp } = require('../api');
const path          = require('path');
const fs            = require('fs');

// ── Couleurs terminal ─────────────────────────────────────────────────────────
const c = {
  reset : '\x1b[0m',
  bold  : '\x1b[1m',
  green : '\x1b[32m',
  red   : '\x1b[31m',
  yellow: '\x1b[33m',
  cyan  : '\x1b[36m',
  grey  : '\x1b[90m',
};
const ok   = `${c.green}✔${c.reset}`;
const fail = `${c.red}✘${c.reset}`;
const info = `${c.cyan}→${c.reset}`;

// ── Runner ────────────────────────────────────────────────────────────────────

const results = [];

function assert(label, condition, got) {
  const passed = Boolean(condition);
  results.push({ label, passed, got });
  const icon = passed ? ok : fail;
  const detail = passed ? '' : `${c.grey} (got: ${JSON.stringify(got)})${c.reset}`;
  console.log(`      ${icon} ${label}${detail}`);
  return passed;
}

async function http(method, url, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// ── Test body fixtures ────────────────────────────────────────────────────────

const ASSET = '144c654344aa716d6f3abcc1ca90e5641e4e2a7f2003f5acacc0f239df3d5f7f';

const TX_BODY = {
  originator: {
    name       : 'João Silva',
    cpf        : '123.456.789-00',
    address    : 'Rua das Flores 42, São Paulo, BR',
    accountRef : 'BR-PART-001234',
    walletAddress: 'tlq1qqtest123',
  },
  beneficiary: {
    name       : 'Akosua Mensah',
    accountRef : 'CI-ABIDJAN-005678',
    walletAddress: 'tlq1qqtest456',
  },
  amount   : 250,
  asset    : ASSET,
  toAddress: 'tlq1qqtest456',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testPostTransaction(base) {
  console.log(`\n${c.bold}TEST 1 — POST /transaction${c.reset}`);
  const { status, body } = await http('POST', `${base}/transaction`, TX_BODY);
  console.log(`  ${info} status ${status}`);

  assert('HTTP 201',                   status === 201,              status);
  assert('recordId présent',           typeof body.recordId === 'string' && body.recordId.length > 0, body.recordId);
  assert('txid présent (64 chars)',     typeof body.txid === 'string' && body.txid.length === 64,      body.txid);
  assert('status === "confirmed"',     body.status === 'confirmed', body.status);
  assert('explorerUrl présent',        typeof body.explorerUrl === 'string' && body.explorerUrl.includes(body.txid), body.explorerUrl);
  assert('demoMode === true',          body.demoMode === true,      body.demoMode);
  assert('ivms101 présent',            typeof body.ivms101 === 'object' && body.ivms101 !== null,      !!body.ivms101);
  assert('corridor.transmitted true',  body.corridor?.transmitted === true, body.corridor?.transmitted);
  assert('corridor.partnerVasp set',   typeof body.corridor?.partnerVasp === 'string',                 body.corridor?.partnerVasp);

  // Vérifier que l'IVMS101 a le bon nom d'origine
  const origName = body.ivms101?.originatingVASP?.originator?.originatorPersons?.[0]?.naturalPerson?.name?.nameIdentifier?.[0];
  assert('IVMS101 originator lastName = "Silva"',  origName?.primaryIdentifier === 'Silva',  origName?.primaryIdentifier);
  assert('IVMS101 originator firstName = "João"',  origName?.secondaryIdentifier === 'João', origName?.secondaryIdentifier);

  const beneId = body.ivms101?.beneficiaryVASP?.beneficiary?.beneficiaryPersons?.[0]?.naturalPerson?.name?.nameIdentifier?.[0];
  assert('IVMS101 beneficiary lastName = "Mensah"', beneId?.primaryIdentifier === 'Mensah', beneId?.primaryIdentifier);

  // Vérifier montant dans le transfer
  const amtStr = body.ivms101?.transfer?.amount;
  assert('IVMS101 transfer.amount = "250"', amtStr === '250', amtStr);

  return { recordId: body.recordId, txid: body.txid };
}

async function testGetAudit(base, txid) {
  console.log(`\n${c.bold}TEST 2 — GET /audit/:txid${c.reset}`);
  console.log(`  ${info} txid: ${txid.substring(0, 16)}…`);
  const { status, body } = await http('GET', `${base}/audit/${txid}`);
  console.log(`  ${info} status ${status}`);

  assert('HTTP 200',                   status === 200,              status);
  assert('record présent',             typeof body.record === 'object' && body.record !== null, !!body.record);
  assert('blindingKey présente',       typeof body.blindingKey === 'string' && body.blindingKey.length > 0, body.blindingKey);
  assert('accessLogged === true',      body.accessLogged === true,  body.accessLogged);
  assert('accessedAt présent',         typeof body.accessedAt === 'string', body.accessedAt);
  assert('message contient "BCB"',     body.message?.includes('BCB'), body.message);

  // Record fields
  assert('record.txid correspond',     body.record?.txid === txid,  body.record?.txid?.substring(0, 16));
  assert('record.amount_declared = 250', body.record?.amount_declared === 250, body.record?.amount_declared);
  assert('record.status = "confirmed"', body.record?.status === 'confirmed', body.record?.status);
  assert('record.corridor_step set',   typeof body.record?.corridor_step === 'string', body.record?.corridor_step);

  // IVMS101 parsé (pas une string brute)
  const ivms = body.record?.ivms101_payload;
  assert('ivms101_payload est un objet parsé', typeof ivms === 'object' && ivms !== null, typeof ivms);
  assert('ivms101_payload.ivms101Version présent', ivms?.ivms101Version === '2020-06', ivms?.ivms101Version);
}

async function testGetVerify(base, txid) {
  console.log(`\n${c.bold}TEST 3 — GET /verify/:txid (lookup auto blinding key)${c.reset}`);
  console.log(`  ${info} txid: ${txid.substring(0, 16)}… (sans ?blindingKey param)`);
  const { status, body } = await http('GET', `${base}/verify/${txid}`);
  console.log(`  ${info} status ${status}`);

  assert('HTTP 200',                   status === 200,              status);
  assert('verified === true',          body.verified === true,      body.verified);
  assert('delta === 0',                body.delta === 0,            body.delta);
  assert('declared.amount = 250',      body.declared?.amount === 250, body.declared?.amount);
  assert('declared.source contient "IVMS101"', body.declared?.source?.includes('IVMS101'), body.declared?.source);
  assert('txid correspond',            body.txid === txid,          body.txid?.substring(0, 16));
  assert('explorerUrl présent',        typeof body.explorerUrl === 'string', body.explorerUrl);
  assert('verifiedAt présent',         typeof body.verifiedAt === 'string',  body.verifiedAt);
  assert('complianceRecord présent',   body.complianceRecord !== null,       !!body.complianceRecord);
  assert('ivms101 présent',            body.ivms101 !== null,                !!body.ivms101);
  assert('message explicite',          typeof body.message === 'string' && body.message.length > 0, body.message);
}

async function testValidationErrors(base) {
  console.log(`\n${c.bold}TEST 4 — Validation erreurs (body invalide)${c.reset}`);

  // Body vide
  {
    const { status, body } = await http('POST', `${base}/transaction`, {});
    assert('Body vide → 400',          status === 400,              status);
    assert('Erreur details array',     Array.isArray(body.details), body.details);
  }

  // Amount négatif
  {
    const bad = { ...TX_BODY, amount: -1 };
    const { status } = await http('POST', `${base}/transaction`, bad);
    assert('amount=-1 → 400',         status === 400,              status);
  }

  // Amount zéro
  {
    const bad = { ...TX_BODY, amount: 0 };
    const { status } = await http('POST', `${base}/transaction`, bad);
    assert('amount=0 → 400',          status === 400,              status);
  }

  // txid inconnu → 404
  {
    const { status } = await http('GET', `${base}/audit/0000000000000000000000000000000000000000000000000000000000000000`);
    assert('audit txid inconnu → 404', status === 404,             status);
  }
}

async function testListEndpoints(base, recordId) {
  console.log(`\n${c.bold}TEST 5 — GET /transaction (liste + détail)${c.reset}`);

  // Liste
  {
    const { status, body } = await http('GET', `${base}/transaction`);
    assert('Liste → 200',              status === 200,              status);
    assert('Liste est un tableau',     Array.isArray(body),         typeof body);
    assert('Au moins 1 record',        body.length >= 1,            body.length);
    // ivms101_payload ne doit PAS être exposé dans la liste
    const hasPayload = body.some(r => r.ivms101_payload !== undefined);
    assert('ivms101_payload absent de la liste', !hasPayload,       hasPayload);
  }

  // Détail par ID
  {
    const { status, body } = await http('GET', `${base}/transaction/${recordId}`);
    assert('Détail → 200',             status === 200,              status);
    assert('ivms101_payload parsé dans détail', typeof body.ivms101_payload === 'object' && body.ivms101_payload !== null, typeof body.ivms101_payload);
  }

  // ID inconnu → 404
  {
    const { status } = await http('GET', `${base}/transaction/nonexistent-id`);
    assert('ID inconnu → 404',         status === 404,              status);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const app    = createApp();
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s)); // port éphémère
  });

  const { port } = server.address();
  const base     = `http://127.0.0.1:${port}`;

  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════════╗`);
  console.log(`║  BSOS Liquid — Tests d'intégration           ║`);
  console.log(`╚══════════════════════════════════════════════╝${c.reset}`);
  console.log(`${c.grey}  Serveur : ${base}`);
  console.log(`  Mode    : DÉMO (pas de hot wallet, SQLite :memory:)${c.reset}`);

  try {
    // Séquence : chaque test dépend du précédent
    const { recordId, txid } = await testPostTransaction(base);
    await testGetAudit(base, txid);
    await testGetVerify(base, txid);
    await testValidationErrors(base);
    await testListEndpoints(base, recordId);
  } catch (err) {
    console.error(`\n${c.red}Erreur inattendue :${c.reset}`, err.message);
    console.error(err.stack);
  } finally {
    server.close();
  }

  // ── Résumé ────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const total  = results.length;
  const failed = total - passed;

  console.log(`\n${c.bold}╔══════════════════════════════════════════════╗`);
  console.log(`║  Résumé${c.reset}${c.bold}                                       ║`);
  console.log(`╚══════════════════════════════════════════════╝${c.reset}`);
  console.log(`  ${ok} Réussis  : ${c.green}${c.bold}${passed}${c.reset}/${total}`);
  if (failed > 0) {
    console.log(`  ${fail} Échoués  : ${c.red}${c.bold}${failed}${c.reset}/${total}`);
    console.log(`\n${c.red}Assertions échouées :${c.reset}`);
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ${fail} ${r.label} — obtenu : ${JSON.stringify(r.got)}`);
    });
  }

  const allPassed = failed === 0;
  console.log(`\n  ${allPassed ? c.green + c.bold + 'TOUS LES TESTS PASSENT' : c.red + c.bold + 'DES TESTS ÉCHOUENT'}${c.reset}\n`);

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
