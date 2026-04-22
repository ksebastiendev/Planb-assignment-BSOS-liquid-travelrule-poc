---
name: BSOS Liquid Travel Rule POC — état du projet
description: État d'avancement, modules implémentés, décisions techniques clés
type: project
---

Stack : Node.js 24, liquidjs-lib, @vulpemventures/secp256k1-zkp, node:sqlite (built-in), Express, Esplora REST.

**Why:** better-sqlite3 incompatible Node 24 → migration vers node:sqlite natif.
**Why:** liquidjs npm = moteur templates Shopify → utiliser liquidjs-lib.
**How to apply:** Toujours vérifier la compatibilité native addon avant d'ajouter une dépendance.

## Modules implémentés et testés

### chain/
- esplora.js — client REST Esplora testnet (ping, getTx, getAddress, broadcast…)
- zkp.js — singleton WASM secp256k1-zkp (init async, cached)
- wallet.js — generateWallet(), restoreWallet(), getBalance()
- transaction.js — buildAndSendCT() : PSET v2 → blind → sign → broadcast
- unblind.js — unblindTransaction(), verifyDeclaredAmount()

### compliance/
- db.js — node:sqlite, tables : transfers, ivms101_messages, audit_log, vasps, compliance_records, blinding_keys
- ivms101.js — builder IVMS101, validator FATF R16

### api/routes/
- transaction.js — POST /transaction (8 étapes : validate→IVMS101→preflight→CT→update→blindingKey→corridor→response)
- audit.js — GET /audit/:txid (accès réglementaire loggé, retourne blinding key)
- verify.js — GET /verify/:txid?blindingKey= (compare déclaré vs on-chain)

## Décisions techniques clés

### CT blinding flow
- assetBlindingFactor pour inputs explicites = Buffer.alloc(32) (ZERO)
- asset dans ownedInputs = AssetHash.fromHex(id).bytes.slice(1) — 32 bytes little-endian
- nonce input explicit = Buffer.alloc(1) (1 byte, pas 0 bytes)
- Fee output : pas de script, pas de blindingPublicKey

### Mode démo
Si VASP_PRIVATE_KEY absent dans .env → txid simulé, pas de broadcast réel.
Faucet testnet : https://liquidtestnet.com/faucet

## Prochaines étapes probables
- Frontend dashboard (frontend/index.html) — mise à jour avec les nouvelles routes
- Simulateur corridor complet (simulator/seed.js)
- Tests end-to-end avec un vrai wallet faucet
