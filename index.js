/**
 * index.js — BSOS Liquid Compliance server entry point
 */

require('dotenv').config();
const { createApp } = require('./api');
const { esplora } = require('./chain');

const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
  // Connectivity check at startup
  console.log('Checking Liquid testnet connectivity…');
  try {
    const { tipHeight, baseUrl } = await esplora.ping();
    console.log(`✓ Connected to Esplora: ${baseUrl}`);
    console.log(`  Liquid testnet tip: block #${tipHeight.toLocaleString()}`);
  } catch (err) {
    console.warn(`⚠  Esplora unreachable at startup: ${err.message}`);
    console.warn('   Server will start anyway — on-chain queries will fail until the node is reachable.');
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`\nBSOS Compliance API running on http://localhost:${PORT}`);
    console.log(`  Dashboard: open frontend/index.html in a browser`);
    console.log(`  Routes:`);
    console.log(`    POST /transaction          Submit a transfer`);
    console.log(`    GET  /transaction          List transfers`);
    console.log(`    GET  /transaction/:id      Get transfer detail`);
    console.log(`    GET  /verify/node          Node connectivity check`);
    console.log(`    GET  /verify/:txid         Full verification`);
    console.log(`    GET  /audit                Audit log`);
  });
}

main();
