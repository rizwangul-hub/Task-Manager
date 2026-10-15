import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductionJwtSecretErrors } from '../src/config/env.js';

test('production JWT validation rejects missing and example secrets', () => {
  const errors = getProductionJwtSecretErrors({
    accessSecret: 'your_super_secret_access_jwt_key_min_32_chars',
    refreshSecret: 'replace-with-a-different-unique-random-secret-at-least-32-characters'
  });

  assert.equal(errors.length, 2);
  assert.match(errors[0], /non-example secret/);
  assert.match(errors[1], /non-example secret/);
});

test('production JWT validation requires distinct explicit secrets', () => {
  assert.equal(getProductionJwtSecretErrors({ accessSecret: '', refreshSecret: '' }).length, 2);
  assert.deepEqual(getProductionJwtSecretErrors({
    accessSecret: 'a'.repeat(40),
    refreshSecret: 'a'.repeat(40)
  }), ['JWT access and refresh secrets must be distinct.']);
});

test('production JWT validation accepts two distinct non-example secrets', () => {
  assert.deepEqual(getProductionJwtSecretErrors({
    accessSecret: 'a'.repeat(40),
    refreshSecret: 'b'.repeat(40)
  }), []);
});
