/**
 * simulator/actors.js
 * Fictitious VASP actors for the corridor simulation.
 *
 * Corridor: Europe → Africa (France FR → Côte d'Ivoire CI)
 * Inspired by the BSOS use-case: remittances on Liquid Network.
 */

const { v4: uuidv4 } = require('uuid');

// ── VASPs ─────────────────────────────────────────────────────────────────────

const VASPS = {
  EURO_EXCHANGE: {
    id: uuidv4(),
    name: 'EuroExchange SA',
    lei: 'FR-LEI-EUROEXCH-001',
    jurisdiction: 'FR',
    endpoint: 'http://localhost:3001', // self (originating VASP = this node)
    created_at: new Date().toISOString(),
  },
  ABIDJAN_PAY: {
    id: uuidv4(),
    name: 'AbidjanPay SARL',
    lei: 'CI-LEI-ABIDJANPAY-001',
    jurisdiction: 'CI',
    endpoint: 'http://localhost:3002', // simulated remote VASP
    created_at: new Date().toISOString(),
  },
};

// ── KYC-verified customers (fictitious) ───────────────────────────────────────

const CUSTOMERS = {
  ALICE: {
    firstName: 'Alice',
    lastName: 'Dupont',
    dateOfBirth: '1990-03-15',
    placeOfBirth: 'Paris',
    nationalId: 'FR-PASS-AD1990',
    nationalIdType: 'PASSPORT',
    countryOfResidence: 'FR',
    // Liquid testnet address (example — replace with real testnet addr)
    address: 'tex1qw8c5hcmntf48jnhhmk9t5yemcz6xg9jpvnlw3a',
    vaspName: VASPS.EURO_EXCHANGE.name,
    vaspLei: VASPS.EURO_EXCHANGE.lei,
  },
  BOB: {
    firstName: 'Kouamé',
    lastName: 'Brou',
    dateOfBirth: '1985-11-22',
    placeOfBirth: 'Abidjan',
    nationalId: 'CI-NID-KB1985',
    nationalIdType: 'IDCARD',
    countryOfResidence: 'CI',
    address: 'tex1qprk9rz2e3gjnm5lgdqqzj8m57dvf3u5lmx0zvj',
    vaspName: VASPS.ABIDJAN_PAY.name,
    vaspLei: VASPS.ABIDJAN_PAY.lei,
  },
};

// ── Liquid testnet asset IDs (Blockstream public test assets) ─────────────────

const ASSETS = {
  // Liquid test BTC (tL-BTC)
  LBTC: {
    id: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
    ticker: 'tL-BTC',
    precision: 8,
  },
  // FUSD — fictitious stablecoin for the POC
  FUSD: {
    id: 'fictitious-fusd-asset-id-replace-with-real-testnet-asset',
    ticker: 'FUSD',
    precision: 2,
  },
};

module.exports = { VASPS, CUSTOMERS, ASSETS };
