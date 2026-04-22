# BSOS Liquid Compliance POC

**Privacy-preserving cross-border settlement with Travel Rule compliance on Liquid Network**

---

## Demo

- Video walkthrough : https://www.loom.com/share/07df3a9b846c40ba9f3d36df75df057c
- Live dashboard    : http://localhost:3001
- API docs          : http://localhost:3001/api-docs

---

## Overview

This project demonstrates how Confidential Transactions on the Liquid Network can be combined with an off-chain compliance layer to satisfy FATF Travel Rule obligations — specifically Brazil's BCB Resolução 520 — without exposing sensitive financial data on a public ledger. The originating VASP submits identity data (IVMS 101) before broadcasting a Confidential Transaction; the blinding key required to decrypt on-chain amounts is stored under restricted access so regulators can verify the declared amount matches the actual transfer. Built as a proof-of-concept for the Plan ₿ Academy BSOS assignment, this repository is intentionally production-adjacent: real Liquid testnet transactions, real ZKP operations, and a compliance database designed around the principle of least privilege.

---

## Architecture

The system runs two parallel tracks that are linked by a single cryptographic artifact — the blinding key.

**On-chain track:** A Confidential Transaction is built, blinded, signed, and broadcast to the Liquid Network testnet. Amounts and asset IDs are hidden inside Pedersen commitments; an outside observer sees only encrypted values.

**Off-chain track:** Before broadcasting, the API builds an IVMS 101 message containing originator KYC data (name, national ID, address, account reference) and beneficiary information, stores it in a compliance record, and persists the blinding key in a segregated table. The blinding key is the only artifact that bridges both tracks: given a `txid` and its blinding key, anyone with access can cryptographically verify that the on-chain amount matches what was declared in the IVMS 101 message.

```
  Brazil User
      │
      ▼
  Partner Exchange (EuroExchange SA)
      │  POST /transaction  {originator KYC, beneficiary, amount, asset}
      ▼
  ┌─────────────────────────────────────────────────────────┐
  │  BSOS Compliance API                                    │
  │                                                         │
  │  1. Validate → 2. Build IVMS101 → 3. Insert record     │
  │  4. Build PSET v2 CT → 5. Blind outputs                │
  │  6. Sign → 7. Broadcast → 8. Store blinding key        │
  └────────────────┬──────────────────────────┬────────────┘
                   │                          │
        Liquid Network testnet         Compliance DB
        (CT, amounts hidden)           ├── compliance_records
                                       │     txid + IVMS101 payload
                                       │     amount_declared + asset
                                       └── blinding_keys (isolated)
                                             txid + blinding_key
                                             accessed_at (audit trail)
      │
      ▼
  Corridor Partner (AbidjanPay SARL)
      │  IVMS101 settlement record
      ▼
  Recipient


  Regulatory Access Path (BCB regulator)
  ────────────────────────────────────────
  GET /audit/:txid
      │  returns: IVMS101 identity data + blinding key
      │  effect:  logs accessed_at timestamp
      ▼
  GET /verify/:txid
      │  fetches raw TX from Esplora
      │  unobfuscates outputs using blinding key
      │  compares on-chain amount vs declared amount
      ▼
  { verified: true, delta: 0 }  ← or regulatory flag if delta ≠ 0
```

---

## Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| Liquid Network client | `liquidjs-lib` v6 | Only mature JS library for PSET v2 / CT on Liquid |
| ZKP operations | `@vulpemventures/secp256k1-zkp` (WASM) | Range proofs + surjection proofs required for CT blinding |
| Key management | `ecpair` + `@bitcoinerlab/secp256k1` | Standard Bitcoin/Liquid keypair derivation |
| Database | `node:sqlite` (built-in, Node 22.5+) | Zero native dependencies — avoids better-sqlite3 compilation issues on Node 24 / ARM64 |
| API server | Express 4 | Minimal, battle-tested, sufficient for a POC |
| On-chain data | Blockstream Esplora REST API | Public, no authentication, supports Liquid testnet |
| Identity standard | IVMS 101 (InterVASP) | FATF R16 mandated format for Travel Rule data exchange |
| Runtime | Node.js 24 | Required for built-in `node:sqlite`; native `fetch` removes axios for test scripts |

---

## Prerequisites

- **Node.js 24+** — required for `node:sqlite` (built-in since 22.5)
- **npm** — for installing dependencies
- **Internet access** — the API calls Blockstream Esplora at startup and for every on-chain query
- **VASP_PRIVATE_KEY** *(optional)* — a funded Liquid testnet private key to broadcast real Confidential Transactions; without it the server runs in demo mode with simulated transaction IDs

---

## API Documentation

Swagger UI is available at **http://localhost:3001/api-docs** once the server is running. It documents all endpoints with request/response schemas, parameter descriptions, and live try-it-out support.

## Quick Start

```bash
git clone <repo-url> && cd bsos-liquid-compliance
npm install
cp .env.example .env          # edit if you have a testnet wallet
npm start                     # server on http://localhost:3001
node demo.js                  # run the full 6-step compliance flow
```

Open `frontend/index.html` in a browser to explore the dashboard. To seed five realistic cross-corridor transactions:

```bash
npm run seed
```

---

## API Reference

### `POST /transaction`

Submit a cross-border transfer. Triggers IVMS 101 construction, Confidential Transaction build, and compliance record creation in a single atomic flow.

**Request body**

```json
{
  "originator": {
    "name": "João Silva",
    "cpf": "123.456.789-00",
    "address": "Rua das Flores 42, São Paulo, SP, BR",
    "accountRef": "BR-EUROEXCH-001234",
    "walletAddress": "tlq1qq...",
    "country": "BR"
  },
  "beneficiary": {
    "name": "Akosua Mensah",
    "accountRef": "CI-ABIDJANPAY-005678",
    "walletAddress": "tlq1qq..."
  },
  "amount": 250,
  "asset": "144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49",
  "toAddress": "tlq1qq..."
}
```

**Response `201`**

```json
{
  "recordId": "a3f2c1d0-...",
  "txid": "9e3b1a7f...",
  "status": "confirmed",
  "demoMode": false,
  "explorerUrl": "https://blockstream.info/liquidtestnet/tx/9e3b1a7f...",
  "corridor": {
    "originatingVASP": "EuroExchange SA",
    "beneficiaryVASP": "AbidjanPay SARL",
    "corridorStep": "origination"
  },
  "ivms101": { "...": "full IVMS101 message object" }
}
```

---

### `GET /audit/:txid`

Regulatory access endpoint. Returns the full IVMS 101 identity payload and the blinding key for the given transaction. Every call is logged with an `accessed_at` timestamp (BCB Resolução 520, Art. 44).

**Response `200`**

```json
{
  "txid": "9e3b1a7f...",
  "record": {
    "id": "a3f2c1d0-...",
    "ivms101_payload": {
      "originatingVASP": { "originator": { "...": "NaturalPerson with name + national ID" } },
      "beneficiaryVASP":  { "beneficiary": { "...": "NaturalPerson" } }
    },
    "amount_declared": 250,
    "asset": "144c654344aa...",
    "status": "confirmed"
  },
  "blindingKey": "a1b2c3d4...",
  "accessLogged": true,
  "accessedAt": "2026-04-21T18:00:00.000Z",
  "message": "BCB Resolução 520, Art. 44 — regulatory access logged"
}
```

---

### `GET /verify/:txid`

Fetches the raw transaction from Esplora, unobfuscates its outputs using the stored blinding key, and compares the on-chain amount against the IVMS 101 declared amount. If the blinding key is not passed as `?blindingKey=<hex>`, it is looked up automatically from the compliance database.

**Response `200`**

```json
{
  "txid": "9e3b1a7f...",
  "declared": { "amount": 250, "asset": "144c6543...", "source": "off-chain IVMS101 — compliance record" },
  "onchain":  { "amount": 250, "asset": "144c6543...", "source": "Liquid testnet — output unblindé" },
  "verified": true,
  "delta": 0,
  "verifiedAt": "2026-04-21T18:00:01.000Z",
  "message": "Le montant on-chain correspond au montant déclaré dans le record IVMS101"
}
```

A non-zero `delta` indicates a discrepancy between the declared and on-chain amounts and would trigger a regulatory flag in a production implementation.

---

## Demo Mode vs Live Mode

**Demo mode** (default) — when `VASP_PRIVATE_KEY` is absent from `.env`, the API skips the actual PSET v2 build and broadcast. It generates a synthetic transaction ID, prefixes the blinding key with `demo-`, and marks the record as `demoMode: true`. All compliance logic, IVMS 101 construction, database writes, audit logging, and the verify flow run normally — only the Liquid Network broadcast is skipped. This is the recommended mode for evaluating the compliance layer without a funded wallet.

**Live mode** — set `VASP_PRIVATE_KEY` and `VASP_BLINDING_KEY` in `.env` with a funded Liquid testnet keypair. The API will build a real PSET v2 Confidential Transaction, blind the outputs using secp256k1-zkp ZKP operations, sign with the spending key, and broadcast via Esplora. The resulting `txid` is verifiable on [blockstream.info/liquidtestnet](https://blockstream.info/liquidtestnet).

**Obtaining testnet funds**

1. Generate a wallet:
   ```bash
   node -e "const {wallet}=require('./chain'); console.log(JSON.stringify(wallet.generateWallet(), null, 2))"
   ```
2. Copy `confidentialAddress` (starts with `tlq1qq`)
3. Request tL-BTC from the Liquid testnet faucet: `https://liquidtestnet.com/faucet`
4. Set `VASP_PRIVATE_KEY` and `VASP_BLINDING_KEY` in `.env` with the values printed by the command above

---

## Travel Rule Compliance

### BCB Resolução 520

Brazil's Central Bank Regulation 520 (effective June 2023) requires Virtual Asset Service Providers to collect, retain, and transmit originator and beneficiary identity data for transfers above BRL 1,200 equivalent. This POC implements the following obligations:

- **Pre-flight data collection** — IVMS 101 message is built and persisted *before* the transaction is broadcast (corridor step: `origination`)
- **Beneficiary VASP transmission** — a settlement record is created for the receiving VASP (corridor step: `settlement`), simulating the inter-VASP data share
- **Regulatory access** — `GET /audit/:txid` provides a logged access path for competent authorities with timestamped audit trail
- **Amount verification** — `GET /verify/:txid` allows cryptographic proof that the on-chain settlement matches the declared amount

### IVMS 101

The following fields are implemented per the FATF R16 minimum data set:

| Field | Source | IVMS 101 path |
|---|---|---|
| Full legal name | `originator.name` | `naturalPerson.name.nameIdentifier[].primaryIdentifier` + `secondaryIdentifier` |
| National identifier | `originator.cpf` | `naturalPerson.nationalIdentification.nationalIdentifier` (type: `TAXID`) |
| Geographic address | `originator.address` | `naturalPerson.geographicAddress[].addressLine` |
| Account number | `originator.accountRef` | `originatorPersons[].accountNumber` |
| Beneficiary name | `beneficiary.name` | `beneficiaryPersons[].naturalPerson.name` |
| VASP identifiers | env config | `originatingVASP.legalPerson` + LEI |

### Blinding Key Custody

Each transaction's blinding key is stored in a dedicated `blinding_keys` table, physically separated from the `compliance_records` table. Access to the blinding key is gated through `GET /audit/:txid`, which logs an `accessed_at` timestamp on every read. This implements a least-privilege model: the compliance officer querying IVMS 101 data does not automatically receive the blinding key, and the regulator who receives it leaves a non-repudiable audit trail.

In a production deployment, the blinding key table would reside in a separate database with distinct access credentials, or be encrypted at rest under a Hardware Security Module key.

---

## Design Decisions & Limitations

**Single-custody blinding key.** The originating VASP holds both the blinding key and the compliance record. If the VASP is compromised or uncooperative, there is no independent path for a regulator to verify on-chain amounts. A production system would use threshold custody (multi-party key sharding) or escrow to a neutral third party.

**Jurisdiction asymmetry.** The compliance model is modelled on BCB Resolução 520 (Brazil). The receiving-side VASP (AbidjanPay, CI) is simulated without a symmetric compliance obligation. Real cross-border Travel Rule enforcement requires bilateral VASP agreements and jurisdiction-to-jurisdiction regulatory treaties that this POC does not implement.

**Demo mode cannot detect fraud.** In demo mode, the verify endpoint unconditionally returns `delta = 0` and `verified = true` because there is no real on-chain output to unobfuscate. This is by design for evaluation purposes, but it means the anti-fraud property of the system only holds in live mode with a real funded wallet.

**Single-output unblind heuristic.** The verify route selects the first confidential unblinded output with `value > 0` as the "recipient output". Multi-output transactions (e.g. batch payments) would require a more sophisticated output-identification mechanism, such as tagging outputs with a BIP-32 derivation index during construction.

**No inter-VASP transport encryption.** The corridor transmission to the beneficiary VASP is simulated by writing a second database record. A production implementation would use an encrypted, authenticated channel — typically TRISA or OpenVASP — to transmit the IVMS 101 message to the receiving institution.

**SQLite is single-writer.** The built-in `node:sqlite` module uses a synchronous API on a single connection. Under concurrent load this becomes a bottleneck. For production, replace with PostgreSQL and move blinding key storage to a separate service with its own access controls.

---

## License

MIT © 2026 KOUGBLENOU Sebastien Donan / Plan ₿ Academy BSOS Assignment
