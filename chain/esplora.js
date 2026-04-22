/**
 * chain/esplora.js
 * Liquid testnet Esplora REST client (Blockstream public node)
 * Docs: https://github.com/Blockstream/esplora/blob/master/API.md
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.ESPLORA_BASE_URL || 'https://blockstream.info/liquidtestnet/api';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Transactions ─────────────────────────────────────────────────────────────

/**
 * Fetch a transaction by txid.
 * Returns full tx object including inputs, outputs, status.
 */
async function getTx(txid) {
  const { data } = await http.get(`/tx/${txid}`);
  return data;
}

/**
 * Fetch raw transaction hex.
 */
async function getTxHex(txid) {
  const { data } = await http.get(`/tx/${txid}/hex`);
  return data;
}

/**
 * Fetch transaction status (confirmed, block height, block hash).
 */
async function getTxStatus(txid) {
  const { data } = await http.get(`/tx/${txid}/status`);
  return data;
}

/**
 * Broadcast a signed raw transaction.
 * @param {string} txHex - Signed transaction in hex
 * @returns {string} txid of the broadcasted transaction
 */
async function broadcastTx(txHex) {
  const { data } = await http.post('/tx', txHex, {
    headers: { 'Content-Type': 'text/plain' },
  });
  return data; // returns txid string
}

// ── Addresses ─────────────────────────────────────────────────────────────────

/**
 * Fetch address info (chain_stats, mempool_stats).
 */
async function getAddress(address) {
  const { data } = await http.get(`/address/${address}`);
  return data;
}

/**
 * Fetch UTXOs for an address.
 * Returns array of { txid, vout, status, value }.
 * Note: on Liquid, value may be null for confidential outputs.
 */
async function getAddressUtxos(address) {
  const { data } = await http.get(`/address/${address}/utxo`);
  return data;
}

/**
 * Fetch confirmed + mempool transactions for an address.
 * Paginated: pass last_seen_txid to get older pages.
 */
async function getAddressTxs(address, lastSeenTxid = null) {
  const url = lastSeenTxid
    ? `/address/${address}/txs/chain/${lastSeenTxid}`
    : `/address/${address}/txs`;
  const { data } = await http.get(url);
  return data;
}

// ── Blocks ────────────────────────────────────────────────────────────────────

/**
 * Fetch block details by hash.
 */
async function getBlock(hash) {
  const { data } = await http.get(`/block/${hash}`);
  return data;
}

/**
 * Fetch the latest block height (tip).
 */
async function getBlocksTipHeight() {
  const { data } = await http.get('/blocks/tip/height');
  return data;
}

/**
 * Fetch the latest block hash (tip).
 */
async function getBlocksTipHash() {
  const { data } = await http.get('/blocks/tip/hash');
  return data;
}

/**
 * Fetch block hash at a given height.
 */
async function getBlockAtHeight(height) {
  const { data } = await http.get(`/block-height/${height}`);
  return data; // returns block hash
}

// ── Assets (Liquid-specific) ──────────────────────────────────────────────────

/**
 * Fetch asset info (name, ticker, precision, issuance tx, etc.)
 * @param {string} assetId - Liquid asset ID (hex)
 */
async function getAsset(assetId) {
  const { data } = await http.get(`/asset/${assetId}`);
  return data;
}

/**
 * Fetch transactions associated with an asset issuance.
 */
async function getAssetTxs(assetId) {
  const { data } = await http.get(`/asset/${assetId}/txs`);
  return data;
}

// ── Connectivity check ────────────────────────────────────────────────────────

/**
 * Ping the node and return tip height — use to verify connectivity.
 */
async function ping() {
  const height = await getBlocksTipHeight();
  return { ok: true, tipHeight: height, baseUrl: BASE_URL };
}

module.exports = {
  ping,
  getTx,
  getTxHex,
  getTxStatus,
  broadcastTx,
  getAddress,
  getAddressUtxos,
  getAddressTxs,
  getBlock,
  getBlocksTipHeight,
  getBlocksTipHash,
  getBlockAtHeight,
  getAsset,
  getAssetTxs,
};
