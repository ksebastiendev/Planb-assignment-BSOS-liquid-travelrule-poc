/**
 * tests/esplora.test.js
 * Basic connectivity test against the public Blockstream Esplora testnet node.
 * Run: node --test tests/
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { esplora } = require('../chain');

describe('Esplora client — Liquid testnet', () => {
  it('ping() returns a block height > 0', async () => {
    const result = await esplora.ping();
    assert.equal(result.ok, true);
    assert.ok(typeof result.tipHeight === 'number', 'tipHeight should be a number');
    assert.ok(result.tipHeight > 0, `tipHeight should be > 0, got ${result.tipHeight}`);
    console.log(`  tip height = ${result.tipHeight}`);
  });

  it('getBlocksTipHash() returns a 64-char hex string', async () => {
    const hash = await esplora.getBlocksTipHash();
    assert.match(hash, /^[0-9a-f]{64}$/, 'Expected 64-char hex block hash');
    console.log(`  tip hash = ${hash}`);
  });
});
