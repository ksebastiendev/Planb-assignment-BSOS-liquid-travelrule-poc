/**
 * chain/zkp.js
 * Singleton initializer for @vulpemventures/secp256k1-zkp (async WASM).
 * Import this module anywhere that needs ZKP operations; the WASM is
 * loaded once and cached for the lifetime of the process.
 */

const zkpPkg = require('@vulpemventures/secp256k1-zkp');

let _zkp = null;

async function getZkp() {
  if (_zkp) return _zkp;
  _zkp = await zkpPkg.default();
  return _zkp;
}

module.exports = { getZkp };
