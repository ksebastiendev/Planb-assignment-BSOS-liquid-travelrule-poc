/**
 * api/index.js
 * Express app factory — import and mount all routes.
 */

const express    = require('express');
const path       = require('path');
const cors       = require('cors');
const swaggerUi  = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');
require('dotenv').config();

const transactionRouter = require('./routes/transaction');
const auditRouter       = require('./routes/audit');
const verifyRouter      = require('./routes/verify');

// ── Swagger definition ────────────────────────────────────────────────────────

const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title      : 'BSOS Liquid Compliance API',
      version    : '1.0.0',
      description:
        'Privacy-preserving cross-border settlement with Travel Rule compliance on Liquid Network. ' +
        'Implements BCB Resolution 520 / FATF Recommendation 16.',
    },
    servers: [{ url: `http://localhost:${process.env.PORT || 3001}`, description: 'Local dev server' }],
    tags: [
      { name: 'Transactions', description: 'Submit and list compliant cross-border transfers' },
      { name: 'Audit',        description: 'Regulatory access to IVMS101 compliance records' },
      { name: 'Verify',       description: 'On-chain amount verification via blinding key' },
    ],
    components: {
      schemas: {
        OriginatorInput: {
          type: 'object',
          required: ['name', 'walletAddress'],
          properties: {
            name        : { type: 'string', example: 'João Silva' },
            cpf         : { type: 'string', example: '123.456.789-00', description: 'Brazilian tax ID (CPF). Maps to IVMS101 TAXID.' },
            address     : { type: 'string', example: 'Rua das Flores 42, São Paulo, SP, BR' },
            accountRef  : { type: 'string', example: 'BR-EUROEXCH-001234' },
            walletAddress: { type: 'string', example: 'tlq1qqf9yfkn6a9v8qy3r5hw2m4xpzl0cd7s8jknte26wkxn5m4v6k2q7rp9sw' },
            country     : { type: 'string', example: 'BR' },
          },
        },
        BeneficiaryInput: {
          type: 'object',
          required: ['name', 'walletAddress'],
          properties: {
            name         : { type: 'string', example: 'Akosua Mensah' },
            accountRef   : { type: 'string', example: 'CI-ABIDJANPAY-005678' },
            walletAddress: { type: 'string', example: 'tlq1qqgz3mx8p5kqr7yw4nhd2sc9v1lj6f0tae37wkcq8ny4l5m7b3p4rs6tnk' },
          },
        },
        TransactionRequest: {
          type: 'object',
          required: ['originator', 'beneficiary', 'amount', 'asset', 'toAddress'],
          properties: {
            originator: { '$ref': '#/components/schemas/OriginatorInput' },
            beneficiary: { '$ref': '#/components/schemas/BeneficiaryInput' },
            amount    : { type: 'integer', minimum: 1, example: 250, description: 'Amount in satoshis.' },
            asset     : { type: 'string', example: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49', description: 'Liquid asset ID (tL-BTC on testnet).' },
            toAddress : { type: 'string', example: 'tlq1qqgz3mx8p5kqr7yw4nhd2sc9v1lj6f0tae37wkcq8ny4l5m7b3p4rs6tnk', description: 'Recipient confidential address (blech32).' },
          },
        },
        TransactionResponse: {
          type: 'object',
          properties: {
            recordId   : { type: 'string', format: 'uuid', example: 'a3f2c1d0-1234-5678-abcd-000000000001' },
            txid       : { type: 'string', example: '9e3b1a7f4c2d8e0a1b3c5d7f9e2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8' },
            status     : { type: 'string', enum: ['pending', 'confirmed', 'verified'], example: 'confirmed' },
            demoMode   : { type: 'boolean', example: true, description: 'True when VASP_PRIVATE_KEY is absent — txid is simulated.' },
            explorerUrl: { type: 'string', format: 'uri', example: 'https://blockstream.info/liquidtestnet/tx/9e3b...' },
            corridor   : {
              type: 'object',
              properties: {
                originatingVASP: { type: 'string', example: 'EuroExchange SA' },
                beneficiaryVASP: { type: 'string', example: 'AbidjanPay SARL' },
                corridorStep   : { type: 'string', example: 'origination' },
              },
            },
            ivms101: { type: 'object', description: 'Full IVMS101 message built from originator KYC data.' },
          },
        },
        AuditResponse: {
          type: 'object',
          properties: {
            record: {
              type: 'object',
              properties: {
                id             : { type: 'string', format: 'uuid' },
                txid           : { type: 'string' },
                ivms101_payload: { type: 'object', description: 'Parsed IVMS101 message.' },
                amount_declared: { type: 'number', example: 250 },
                asset          : { type: 'string' },
                corridor_step  : { type: 'string', enum: ['origination', 'relay', 'settlement'] },
                status         : { type: 'string' },
                created_at     : { type: 'string', format: 'date-time' },
              },
            },
            blindingKey : { type: 'string', example: 'a1b2c3d4e5f6...', description: 'Hex-encoded blinding private key for CT output decryption.' },
            accessLogged: { type: 'boolean', example: true },
            accessedAt  : { type: 'string', format: 'date-time' },
            message     : { type: 'string', example: 'BCB Resolução 520, Art. 44 — regulatory access logged' },
          },
        },
        VerifyResponse: {
          type: 'object',
          properties: {
            txid       : { type: 'string' },
            explorerUrl: { type: 'string', format: 'uri' },
            declared: {
              type: 'object',
              properties: {
                amount: { type: 'number', example: 250 },
                asset : { type: 'string' },
                source: { type: 'string', example: 'off-chain IVMS101 — compliance record' },
              },
            },
            onchain: {
              type: 'object',
              nullable: true,
              properties: {
                amount: { type: 'number', example: 250 },
                asset : { type: 'string' },
                source: { type: 'string', example: 'Liquid testnet — output unblindé' },
              },
            },
            verified  : { type: 'boolean', example: true },
            delta     : { type: 'number', nullable: true, example: 0, description: 'on-chain minus declared, in satoshis. Non-zero triggers a regulatory flag.' },
            verifiedAt: { type: 'string', format: 'date-time' },
            message   : { type: 'string' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error  : { type: 'string', example: 'Champs manquants' },
            details: { type: 'array', items: { type: 'string' }, example: ['originator.name requis'] },
          },
        },
      },
    },
  },
  apis: [
    `${__dirname}/routes/transaction.js`,
    `${__dirname}/routes/audit.js`,
    `${__dirname}/routes/verify.js`,
  ],
});

// ── App factory ───────────────────────────────────────────────────────────────

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Static assets (frontend/)
  app.use(express.static(path.join(__dirname, '../frontend')));

  // Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'BSOS Compliance API',
    customCss: '.swagger-ui .topbar { display: none }',
    customJs: '/swagger-back-btn.js',
  }));

  // Root → Dashboard
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  });

  // Health
  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

  // Routes
  app.use('/transaction', transactionRouter);
  app.use('/audit', auditRouter);
  app.use('/verify', verifyRouter);

  // 404
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
