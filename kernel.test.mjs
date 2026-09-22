import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from './kernel.mjs';

function closeTo(actual, expected, epsilon, message) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${message}: expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

test('age 0 is fully trusted regardless of confirmations (no confirmations)', () => {
  const result = K.trustScore(0, 0);
  assert.equal(result.ok, true);
  assert.equal(result.value, 1);
});

test('age 0 is fully trusted regardless of confirmations (many confirmations)', () => {
  const result = K.trustScore(0, 7);
  assert.equal(result.ok, true);
  assert.equal(result.value, 1);
});

test('pure decay at 100 hours with zero confirmations matches e^-1', () => {
  const result = K.trustScore(100, 0);
  assert.equal(result.ok, true);
  closeTo(result.value, 0.36787944117144233, 1e-9, 'decay-only trust at 100h');
});

test('confirmations pull trust back up but never fully cancel age', () => {
  const result = K.trustScore(100, 5);
  assert.equal(result.ok, true);
  closeTo(result.value, 0.9481123849, 1e-6, 'boosted trust at 100h/5 confirmations');
  assert.ok(result.value < 1, 'confirmations must not fully cancel age');
});

test('negative age is rejected without throwing', () => {
  const result = K.trustScore(-1, 0);
  assert.equal(result.ok, false);
  assert.equal(result.why, 'ageHours must be a finite number >= 0');
});

test('non-integer confirmations is rejected without throwing', () => {
  const result = K.trustScore(10, 2.5);
  assert.equal(result.ok, false);
  assert.equal(result.why, 'confirmations must be a non-negative integer');
});

// --- boundary: decayRate must be strictly > 0, not >= 0 ---
test('decayRate of exactly 0 is rejected (boundary, not >=)', () => {
  const result = K.trustScore(10, 0, { decayRate: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'decayRate must be a finite number > 0');
});

// --- boundary: confirmRate must be strictly > 0, not >= 0 ---
test('confirmRate of exactly 0 is rejected (boundary, not >=)', () => {
  const result = K.trustScore(10, 2, { confirmRate: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'confirmRate must be a finite number > 0');
});

// --- kills && -> || mutants in isFinitePositiveNumber: a negative finite
// number must still be rejected even though typeof/isFinite both hold ---
test('negative decayRate is rejected, not just non-positive-looking values', () => {
  const result = K.trustScore(10, 0, { decayRate: -5 });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'decayRate must be a finite number > 0');
});

test('negative confirmRate is rejected', () => {
  const result = K.trustScore(10, 2, { confirmRate: -3 });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'confirmRate must be a finite number > 0');
});

// --- kills && -> || mutant that would let a non-number coerce truthy
// through a stray "x > 0" check ---
test('string decayRate is rejected even though it coerces > 0', () => {
  const result = K.trustScore(10, 0, { decayRate: '5' });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'decayRate must be a finite number > 0');
});

test('string confirmRate is rejected even though it coerces > 0', () => {
  const result = K.trustScore(10, 2, { confirmRate: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'confirmRate must be a finite number > 0');
});

// --- pins the exact wording of both messages, so a mutated "> 0" -> ">= 0"
// in the string literal itself cannot survive ---
test('decayRate rejection message is worded with strict >, not >=', () => {
  const result = K.trustScore(10, 0, { decayRate: -1 });
  assert.equal(result.why, 'decayRate must be a finite number > 0');
  assert.equal(result.why.includes('>='), false);
});

test('confirmRate rejection message is worded with strict >, not >=', () => {
  const result = K.trustScore(10, 2, { confirmRate: -1 });
  assert.equal(result.why, 'confirmRate must be a finite number > 0');
  assert.equal(result.why.includes('>='), false);
});

// --- kills both || -> && mutants in the opts guard: each of null, an
// array, and a non-array non-object must independently be rejected ---
test('null opts is rejected, not silently treated as absent', () => {
  const result = K.trustScore(10, 2, null);
  assert.equal(result.ok, false);
  assert.equal(result.why, 'opts must be a plain object');
});

test('array opts is rejected even though typeof array === "object"', () => {
  const result = K.trustScore(10, 2, []);
  assert.equal(result.ok, false);
  assert.equal(result.why, 'opts must be a plain object');
});

test('non-object primitive opts is rejected', () => {
  const result = K.trustScore(10, 2, 'not-an-object');
  assert.equal(result.ok, false);
  assert.equal(result.why, 'opts must be a plain object');
});
