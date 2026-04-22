/**
 * simulator/seed.js
 * Génère 5 transactions de test réalistes via POST /transaction.
 *
 * Prérequis : le serveur doit tourner sur PORT (défaut 3001)
 * Usage     : node simulator/seed.js
 */

'use strict';

require('dotenv').config();

const API      = `http://localhost:${process.env.PORT || 3001}`;
const EXPLORER = 'https://blockstream.info/liquidtestnet/tx';

// tL-BTC asset ID — Liquid testnet
const LBTC = '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49';

// ── Couleurs terminal ─────────────────────────────────────────────────────────
const C = {
  reset : '\x1b[0m',
  bold  : '\x1b[1m',
  green : '\x1b[32m',
  red   : '\x1b[31m',
  yellow: '\x1b[33m',
  cyan  : '\x1b[36m',
  grey  : '\x1b[90m',
  blue  : '\x1b[34m',
};

// ── Profils réalistes ─────────────────────────────────────────────────────────
// CPF fictifs au format brésilien (valides structurellement)
// Adresses Liquid testnet fictives (format blech32 correct pour la validation)

const TRANSACTIONS = [
  {
    label  : 'Corridor BR → CI (Côte d\'Ivoire)',
    amount : 500,
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
  },
  {
    label  : 'Corridor BR → TW (Taiwan)',
    amount : 1200,
    originator: {
      name        : 'Maria Oliveira',
      cpf         : '234.567.890-11',
      address     : 'Av. Paulista 1578, São Paulo, SP, BR',
      accountRef  : 'BR-EUROEXCH-002345',
      walletAddress: 'tlq1qqh4ct7m2wnrs8xz5pb3kj6q0fa9dve48lyteg37mdk5j6l8c4q9st7upn',
      country     : 'BR',
    },
    beneficiary: {
      name        : 'Chen Wei',
      accountRef  : 'TW-TAIPAYFINTECH-009001',
      walletAddress: 'tlq1qqk6dvq9s3yxp2tz8mc4nl7r1gb0ewa5jfzulh48nek6k7m9d5rasutv8p',
    },
  },
  {
    label  : 'Corridor BR → JP (Japon)',
    amount : 750,
    originator: {
      name        : 'Carlos Mendez',
      cpf         : '345.678.901-22',
      address     : 'Rua XV de Novembro 320, Curitiba, PR, BR',
      accountRef  : 'BR-EUROEXCH-003456',
      walletAddress: 'tlq1qqm8ewrasz6yq3uc9nd5om8s2hc1fxb6kgawvm59okf7l8n0e6sbtvwq9r',
      country     : 'BR',
    },
    beneficiary: {
      name        : 'Yuki Tanaka',
      accountRef  : 'JP-TOKYOPAY-007654',
      walletAddress: 'tlq1qqn9fxstbu7zr4vd0oe6pn9t3id2gyc7lhbxwn60plg8m9o1f7tcu8xrk0',
    },
  },
  {
    label  : 'Corridor BR → IN (Inde)',
    amount : 300,
    originator: {
      name        : 'Ana Costa',
      cpf         : '456.789.012-33',
      address     : 'Rua Augusta 654, São Paulo, SP, BR',
      accountRef  : 'BR-EUROEXCH-004567',
      walletAddress: 'tlq1qqp0gytucv8as5we1pf7qo0u4je3hzd8mic4yn71qmh9n0p2g8udv9ysn1',
      country     : 'BR',
    },
    beneficiary: {
      name        : 'Priya Sharma',
      accountRef  : 'IN-MUMBAIREMIT-003210',
      walletAddress: 'tlq1qqq1hzuvdw9bt6xf2qg8rp1v5kf4iae9njd5zo82rnio1q3h9fsew0zto2',
    },
  },
  {
    label  : 'Corridor BR → KR (Corée du Sud)',
    amount : 2000,
    originator: {
      name        : 'Pedro Alves',
      cpf         : '567.890.123-44',
      address     : 'Av. Beira Mar Norte 100, Florianópolis, SC, BR',
      accountRef  : 'BR-EUROEXCH-005678',
      walletAddress: 'tlq1qqr2izwved0cu7yg3rh9sq2w6lg5jbf0oke6ap93sojp2r4i0gtfx1aut3',
      country     : 'BR',
    },
    beneficiary: {
      name        : 'Kim Min-jun',
      accountRef  : 'KR-SEOPAY-002109',
      walletAddress: 'tlq1qqs3jawxfe1dv8zh4si0tr3x7mh6kcg1plf7bq04tpkq3s5j1hug42bvu4',
    },
  },
];

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function post(path, body) {
  const res  = await fetch(API + path, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// ── Liveness check ────────────────────────────────────────────────────────────

async function waitForServer(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return true;
    } catch { /* retry */ }
    if (i < retries - 1) {
      process.stdout.write(`  Attente du serveur (${i + 1}/${retries})…\r`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`\n${C.bold}${C.cyan}╔════════════════════════════════════════════════════╗`);
  console.log(`║  BSOS Liquid Compliance — Seed (5 transactions)    ║`);
  console.log(`╚════════════════════════════════════════════════════╝${C.reset}\n`);
  console.log(`${C.grey}  API  : ${API}`);
  console.log(`  Asset: tL-BTC testnet${C.reset}\n`);

  // Vérifier que le serveur tourne
  const alive = await waitForServer();
  if (!alive) {
    console.error(`${C.red}✘ Serveur inaccessible sur ${API}`);
    console.error(`  Démarrez-le avec : npm start${C.reset}`);
    process.exit(1);
  }

  const results = [];
  let i = 0;

  for (const tx of TRANSACTIONS) {
    i++;
    const { originator, beneficiary, amount, label } = tx;

    process.stdout.write(`  ${C.grey}[${i}/${TRANSACTIONS.length}]${C.reset} ${label}…`);

    const payload = {
      originator,
      beneficiary,
      amount,
      asset    : LBTC,
      toAddress: beneficiary.walletAddress,
    };

    const { status, body } = await post('/transaction', payload);

    if (status === 201) {
      const txid = body.txid || '?';
      console.log(` ${C.green}✓${C.reset}`);
      console.log(`      ${C.bold}${originator.name}${C.reset} ${C.grey}→${C.reset} ${C.bold}${beneficiary.name}${C.reset}`);
      console.log(`      Montant  : ${C.yellow}${amount.toLocaleString('fr-FR')} sat${C.reset}`);
      console.log(`      txid     : ${C.blue}${txid.slice(0, 20)}…${C.reset}`);
      console.log(`      recordId : ${C.grey}${(body.recordId || '').slice(0, 8)}…${C.reset}`);
      if (body.demoMode) {
        console.log(`      ${C.grey}(mode démo — pas de hot wallet configuré)${C.reset}`);
      }
      results.push({ ok: true, label, originator: originator.name, beneficiary: beneficiary.name, amount, txid, recordId: body.recordId });
    } else {
      const errMsg = body.error || body.details?.join(', ') || `HTTP ${status}`;
      console.log(` ${C.red}✘${C.reset}`);
      console.log(`      ${C.red}Erreur : ${errMsg}${C.reset}`);
      results.push({ ok: false, label, error: errMsg });
    }
    console.log('');
  }

  // ── Résumé ─────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length;
  const total  = results.length;
  const totalAmt = results.filter(r => r.ok).reduce((s, r) => s + r.amount, 0);

  console.log(`${C.bold}╔════════════════════════════════════════════════════╗`);
  console.log(`║  Résumé${C.reset}${C.bold}                                           ║`);
  console.log(`╚════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Transactions : ${C.green}${C.bold}${passed}${C.reset}/${total} réussies`);
  console.log(`  Volume total : ${C.yellow}${totalAmt.toLocaleString('fr-FR')} sat${C.reset}`);
  console.log(`  Explorer     : ${EXPLORER}\n`);
}

seed().catch(err => {
  console.error(`\n${C.red}Erreur inattendue :${C.reset}`, err.message);
  process.exit(1);
});
