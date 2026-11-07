const assert = require('node:assert/strict');

function keyReceipt(receipt, input) {
  assert.equal(receipt.operationId, input.operationId);
  assert.equal(receipt.assetType, 'KEY');
  assert.equal(receipt.status, 'ACTIVE');
  assert.match(receipt.providerReference, /^[\x21-\x7e]{1,255}$/);
  for (const field of ['algorithm', 'keySize', 'usage']) assert.equal(receipt[field], input[field]);
  assert.match(receipt.publicKeyFingerprint, /^SHA256:[a-f0-9]{64}$/i);
  const validFrom = Date.parse(receipt.validFrom), expiresAt = Date.parse(receipt.expiresAt);
  assert.ok(validFrom <= Date.now() && expiresAt > Date.now());
  assert.ok(expiresAt - validFrom <= input.validityDays * 86_400_000);
}

function sameKey(first, second) {
  for (const field of ['providerReference', 'algorithm', 'keySize', 'usage', 'publicKeyFingerprint', 'validFrom', 'expiresAt']) {
    assert.equal(first[field], second[field], 'Stable key receipt field ' + field);
  }
}

function revocationReceipt(receipt, input) {
  assert.deepEqual(receipt, { operationId: input.operationId, providerReference: input.providerReference, revoked: true });
}

module.exports = { keyReceipt, sameKey, revocationReceipt };
