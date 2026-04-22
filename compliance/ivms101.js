/**
 * compliance/ivms101.js
 * IVMS 101 message builder for Travel Rule compliance.
 * Spec: https://intervasp.org/
 *
 * Builds the minimal structure required by FATF Recommendation 16:
 *   - Originator natural person + account
 *   - Beneficiary natural person + account
 *   - Transfer details
 */

const { v4: uuidv4 } = require('uuid');

// ── Person builders ───────────────────────────────────────────────────────────

/**
 * Build an IVMS101 NaturalPerson object.
 * @param {object} p
 * @param {string} p.firstName
 * @param {string} p.lastName
 * @param {string} [p.dateOfBirth]        - YYYY-MM-DD
 * @param {string} [p.placeOfBirth]
 * @param {string} [p.nationalId]         - passport / national ID number
 * @param {string} [p.nationalIdType]     - PASSPORT | IDCARD | TAXID
 * @param {string} [p.countryOfResidence] - ISO 3166-1 alpha-2
 */
function buildNaturalPerson({
  firstName,
  lastName,
  dateOfBirth,
  placeOfBirth,
  nationalId,
  nationalIdType = 'PASSPORT',
  countryOfResidence,
}) {
  const person = {
    name: {
      nameIdentifier: [
        {
          primaryIdentifier: lastName,
          secondaryIdentifier: firstName,
          nameIdentifierType: 'LEGL', // Legal name
        },
      ],
    },
  };

  if (dateOfBirth || placeOfBirth) {
    person.dateAndPlaceOfBirth = {};
    if (dateOfBirth) person.dateAndPlaceOfBirth.dateOfBirth = dateOfBirth;
    if (placeOfBirth) person.dateAndPlaceOfBirth.placeOfBirth = placeOfBirth;
  }

  if (nationalId) {
    person.nationalIdentification = {
      nationalIdentifier: nationalId,
      nationalIdentifierType: nationalIdType,
    };
  }

  if (countryOfResidence) {
    person.countryOfResidence = countryOfResidence;
  }

  return person;
}

/**
 * Build an IVMS101 LegalPerson object (for VASP identity).
 */
function buildLegalPerson({ name, lei, countryOfRegistration }) {
  const entity = {
    name: {
      nameIdentifier: [
        { legalPersonName: name, legalPersonNameIdentifierType: 'LEGL' },
      ],
    },
  };
  if (lei) {
    entity.nationalIdentification = {
      nationalIdentifier: lei,
      nationalIdentifierType: 'LEIX', // LEI
    };
  }
  if (countryOfRegistration) {
    entity.countryOfRegistration = countryOfRegistration;
  }
  return entity;
}

// ── Account (blockchain address) ─────────────────────────────────────────────

function buildAccountAddress(address) {
  return { virtualAssetAccountAddress: address };
}

// ── Full IVMS101 message ──────────────────────────────────────────────────────

/**
 * Build a complete IVMS101 Travel Rule message.
 *
 * @param {object} opts
 * @param {object} opts.originator          - { person, address, vaspName, vaspLei }
 * @param {object} opts.beneficiary         - { person, address, vaspName, vaspLei }
 * @param {object} opts.transfer            - { txid, assetId, amountSat, assetTicker }
 * @returns {{ id: string, message: object }}
 */
function buildIvms101Message({ originator, beneficiary, transfer }) {
  const id = uuidv4();

  const message = {
    ivms101Version: '2020-06',
    originatingVASP: {
      originatingVASP: buildLegalPerson({
        name: originator.vaspName,
        lei: originator.vaspLei,
      }),
      originator: {
        originatorPersons: [{ naturalPerson: originator.person }],
        accountNumber: [originator.address],
      },
    },
    beneficiaryVASP: {
      beneficiaryVASP: buildLegalPerson({
        name: beneficiary.vaspName,
        lei: beneficiary.vaspLei,
      }),
      beneficiary: {
        beneficiaryPersons: [{ naturalPerson: beneficiary.person }],
        accountNumber: [beneficiary.address],
      },
    },
    transfer: {
      virtualAsset: transfer.assetTicker || transfer.assetId,
      amount: transfer.amountSat.toString(),
      transferRef: transfer.txid,
    },
  };

  return { id, message };
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Minimal FATF R16 completeness check.
 * Returns { valid: bool, errors: string[] }
 */
function validateIvms101(message) {
  const errors = [];

  const orig = message?.originatingVASP?.originator;
  const bene = message?.beneficiaryVASP?.beneficiary;

  if (!orig) errors.push('Missing originator');
  if (!bene) errors.push('Missing beneficiary');

  if (orig) {
    const person = orig.originatorPersons?.[0]?.naturalPerson;
    if (!person?.name?.nameIdentifier?.[0]?.primaryIdentifier)
      errors.push('Originator: missing last name');
    if (!person?.name?.nameIdentifier?.[0]?.secondaryIdentifier)
      errors.push('Originator: missing first name');
    if (!orig.accountNumber?.[0])
      errors.push('Originator: missing account address');
  }

  if (bene) {
    const person = bene.beneficiaryPersons?.[0]?.naturalPerson;
    if (!person?.name?.nameIdentifier?.[0]?.primaryIdentifier)
      errors.push('Beneficiary: missing last name');
    if (!orig?.accountNumber?.[0])
      errors.push('Beneficiary: missing account address');
  }

  if (!message?.transfer?.transferRef)
    errors.push('Transfer: missing txid reference');

  return { valid: errors.length === 0, errors };
}

module.exports = {
  buildNaturalPerson,
  buildLegalPerson,
  buildAccountAddress,
  buildIvms101Message,
  validateIvms101,
};
