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

// ── v2: the evidence ledger ─────────────────────────────────────────────
const D = K.DAY_MS;
const NOW = Date.parse('2026-10-11T00:00:00Z');
const P = (daysAgo) => ({ at: NOW - daysAgo * D, pass: true });
const F = (daysAgo) => ({ at: NOW - daysAgo * D, pass: false });

test('DAY_MS and defaults are what the page promises', () => {
  assert.equal(K.DAY_MS, 86400000);
  assert.deepEqual({ ...K.ASSESS_DEFAULTS },
    { halfLifeDays: 30, prior: 0.5, priorMass: 1, minMass: 1, trustAt: 0.8 });
  assert.ok(Object.isFrozen(K.ASSESS_DEFAULTS));
});

test('toMs reads numbers and date strings, refuses the rest', () => {
  assert.equal(K.toMs(0), 0);
  assert.equal(K.toMs(123), 123);
  assert.equal(K.toMs(Infinity), null);
  assert.equal(K.toMs(NaN), null);
  assert.equal(K.toMs(''), null);
  assert.equal(K.toMs('   '), null);
  assert.equal(K.toMs('garbage'), null);
  assert.equal(K.toMs(' 2026-10-11T00:00:00Z '), NOW);
  assert.equal(K.toMs({}), null);
  assert.equal(K.toMs(null), null);
  assert.equal(K.toMs(undefined), null);
});

test('weightAt halves every half-life', () => {
  assert.equal(K.weightAt(NOW, NOW, 30), 1);
  assert.equal(K.weightAt(NOW - 30 * D, NOW, 30), 0.5);
  assert.equal(K.weightAt(NOW - 60 * D, NOW, 30), 0.25);
  assert.equal(K.weightAt(NOW - 10 * D, NOW, 10), 0.5);
});

test('one fresh pass is NOT trust (defaults): 0.75, DOUBTED, re-run now', () => {
  const r = K.assess([P(0)], NOW);
  assert.equal(r.ok, true);
  assert.equal(r.score, 0.75);
  assert.equal(r.mass, 1);
  assert.equal(r.verdict, 'DOUBTED');
  assert.equal(r.reverifyBy, NOW);
  assert.equal(r.staleAt, null);
  assert.equal(r.lapseAt, null);
  assert.equal(r.reason, 'below the trust bar — fix and re-run now');
});

test('a pass one half-life old is STALE, drifting to the prior not to zero', () => {
  const r = K.assess([P(30)], NOW);
  assert.equal(r.mass, 0.5);
  assert.equal(r.score, 1 / 1.5);
  assert.equal(r.verdict, 'STALE');
  assert.equal(r.reverifyBy, NOW);
  assert.equal(r.reason, 'not enough live evidence — re-run now');
  const empty = K.assess([], NOW);
  assert.equal(empty.score, 0.5);
  assert.equal(empty.verdict, 'STALE');
});

test('mass exactly at minMass is not STALE', () => {
  assert.equal(K.assess([P(0)], NOW, { minMass: 1 }).verdict, 'DOUBTED');
  assert.equal(K.assess([P(0)], NOW, { minMass: 1.0001 }).verdict, 'STALE');
});

test('score exactly at trustAt is TRUSTED', () => {
  const r = K.assess([P(0)], NOW, { prior: 0.6 });
  assert.equal(r.score, 0.8);
  assert.equal(r.verdict, 'TRUSTED');
  assert.equal(K.assess([P(0)], NOW, { prior: 0.6, trustAt: 0.80001 }).verdict, 'DOUBTED');
});

test('counts and masses split passes from failures, any order', () => {
  const r = K.assess([F(30), P(0), P(30), F(0)], NOW);
  assert.equal(r.passes, 2);
  assert.equal(r.fails, 2);
  assert.equal(r.passMass, 1.5);
  assert.equal(r.failMass, 1.5);
  assert.equal(r.mass, 3);
  assert.equal(r.score, 2 / 4);
  assert.equal(r.verdict, 'DOUBTED');
});

test('a recent failure costs more than an old one', () => {
  const recent = K.assess([P(60), P(30), F(0)], NOW).score;
  const old = K.assess([F(60), P(30), P(0)], NOW).score;
  assert.ok(recent < old);
});

test('TRUSTED: staleAt and lapseAt are closed-form, reverifyBy is the earlier', () => {
  const r = K.assess([P(0), P(0)], NOW);
  assert.equal(r.verdict, 'TRUSTED');
  assert.equal(r.staleAt, NOW + 30 * D);
  assert.ok(Math.abs(r.lapseAt - (NOW + 30 * D * Math.log2(4 / 3))) < 1);
  assert.equal(r.reverifyBy, r.lapseAt);
  assert.equal(r.reason, 'score decays under the trust bar');
  const at = K.assess([P(0), P(0)], r.lapseAt);
  assert.ok(Math.abs(at.score - 0.8) < 1e-9);
});

test('TRUSTED where staleness comes first', () => {
  const r = K.assess([P(0), P(0), P(0), P(0)], NOW, { minMass: 2, trustAt: 0.6 });
  assert.equal(r.verdict, 'TRUSTED');
  assert.equal(r.staleAt, NOW + 30 * D);
  assert.ok(Math.abs(r.lapseAt - (NOW + 30 * D * 4)) < 1);
  assert.equal(r.reverifyBy, r.staleAt);
  assert.equal(r.reason, 'evidence goes stale');
});

test('a tie between lapse and staleness reports staleness', () => {
  const r = K.assess([P(0), P(0)], NOW, { trustAt: 0.75 });
  assert.equal(r.staleAt, NOW + 30 * D);
  assert.equal(r.lapseAt, NOW + 30 * D);
  assert.equal(r.reason, 'evidence goes stale');
});

test('prior at or above the bar never lapses on score', () => {
  const r = K.assess([P(0)], NOW, { prior: 0.8 });
  assert.equal(r.verdict, 'TRUSTED');
  assert.equal(r.lapseAt, null);
  assert.equal(r.reverifyBy, r.staleAt);
  assert.equal(r.staleAt, NOW);
  const hi = K.assess([P(0), P(0)], NOW, { prior: 0.9 });
  assert.equal(hi.lapseAt, null);
  assert.equal(hi.reverifyBy, NOW + 30 * D);
});

test('half-life and priorMass options change the answer', () => {
  assert.equal(K.assess([P(10)], NOW, { halfLifeDays: 10 }).mass, 0.5);
  assert.equal(K.assess([P(0)], NOW, { priorMass: 3 }).score, 2.5 / 4);
  assert.equal(K.assess([P(0), P(0)], NOW, { halfLifeDays: 10 }).staleAt, NOW + 10 * D);
});

test('date strings work for events and now', () => {
  const r = K.assess([{ at: '2026-10-11T00:00:00Z', pass: true }], '2026-10-11T00:00:00Z');
  assert.equal(r.mass, 1);
});

test('event exactly at now is evidence; one ms later is refused', () => {
  assert.equal(K.assess([{ at: NOW, pass: true }], NOW).ok, true);
  const r = K.assess([{ at: NOW + 1, pass: true }], NOW);
  assert.equal(r.ok, false);
  assert.equal(r.why, 'event 0 is in the future — not evidence yet');
});

test('assess refuses bad input without throwing', () => {
  assert.equal(K.assess('x', NOW).why, 'events must be an array');
  assert.equal(K.assess([], 'nope').why, 'now must be a finite ms number or a date string');
  assert.equal(K.assess([null], NOW).why, 'event 0 must be { at, pass: boolean }');
  assert.equal(K.assess([P(0), 5], NOW).why, 'event 1 must be { at, pass: boolean }');
  assert.equal(K.assess([{ at: NOW, pass: 1 }], NOW).why, 'event 0 must be { at, pass: boolean }');
  assert.equal(K.assess([{ at: 'zz', pass: true }], NOW).why, 'event 0 has an unreadable date');
  assert.equal(K.assess([], NOW, null).why, 'opts must be a plain object');
  assert.equal(K.assess([], NOW, []).why, 'opts must be a plain object');
  assert.equal(K.assess([], NOW, 'x').why, 'opts must be a plain object');
  for (const k of ['halfLifeDays', 'priorMass', 'minMass']) {
    for (const v of [0, -1, NaN, Infinity, '3']) {
      assert.equal(K.assess([], NOW, { [k]: v }).why, `${k} must be a finite number > 0`);
    }
  }
  for (const k of ['prior', 'trustAt']) {
    for (const v of [-0.01, 1.01, NaN, Infinity, '0.5']) {
      assert.equal(K.assess([], NOW, { [k]: v }).why, `${k} must be a finite number in [0,1]`);
    }
    assert.equal(K.assess([], NOW, { [k]: 0 }).ok, true);
    assert.equal(K.assess([], NOW, { [k]: 1 }).ok, true);
  }
  assert.equal(K.assess([], NOW, { unknown: 7 }).ok, true);
});

test('parseLog reads every outcome word and separator', () => {
  for (const w of ['pass', 'passed', 'ok', 'green', 'true', '1', 'PASS', 'Ok']) {
    assert.deepEqual(K.parseLog(`2026-10-11T00:00:00Z, ${w}`).events, [{ at: NOW, pass: true }], w);
  }
  for (const w of ['fail', 'failed', 'red', 'false', '0', 'FAIL']) {
    assert.deepEqual(K.parseLog(`2026-10-11T00:00:00Z ${w}`).events, [{ at: NOW, pass: false }], w);
  }
  const t = K.parseLog('# header\r\n\r\n  2026-10-11T00:00:00Z\tpass\r\n2026-10-11T00:00:00Z; fail\r\n  # indented comment\n');
  assert.equal(t.ok, true);
  assert.deepEqual(t.events, [{ at: NOW, pass: true }, { at: NOW, pass: false }]);
  assert.equal(K.parseLog('Oct 11 2026, pass').events.length, 1);
  assert.deepEqual(K.parseLog(''), { ok: true, events: [] });
});

test('parseLog names the bad line', () => {
  assert.deepEqual(K.parseLog(42), { ok: false, why: 'log must be text' });
  assert.deepEqual(K.parseLog('\npass'), { ok: false, why: 'line 2: expected "<date>, pass|fail"', line: 2 });
  assert.deepEqual(K.parseLog('notadate, pass'), { ok: false, why: 'line 1: unreadable date', line: 1 });
  assert.deepEqual(K.parseLog('2026-10-11, maybe'), { ok: false, why: 'line 1: outcome must be pass or fail', line: 1 });
});

test('fuzz: assess and parseLog never throw on garbage', () => {
  const junk = [undefined, null, 0, -1, NaN, Infinity, '', 'x', [], {}, [null], [{}], [{ at: {}, pass: true }],
    true, Symbol.for('s'), () => 1, [[1, 2]], { length: 3 }, '\u0000\n,,,', 1e308, -0, [{ at: 0, pass: false }]];
  let n = 0;
  for (const a of junk) for (const b of junk) for (const c of junk) {
    assert.doesNotThrow(() => K.assess(a, b, c));
    n++;
  }
  for (const a of junk) assert.doesNotThrow(() => K.parseLog(a));
  assert.ok(n > 9000);
});
