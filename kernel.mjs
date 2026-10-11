// kernel.mjs
// TrustDecay — pure functions for scoring how much to trust a witness log
// entry today, given its age in hours and how many independent
// confirmations it has received. No I/O. Never throws: bad input returns
// { ok: false, why }.

const DEFAULT_DECAY_RATE = 0.01;   // per hour of age
const DEFAULT_CONFIRM_RATE = 0.5;  // per independent confirmation

function isFiniteNonNegativeNumber(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

function isFinitePositiveNumber(x) {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

/**
 * trustScore(ageHours, confirmations, opts?)
 *
 * decay        = exp(-decayRate * ageHours)          — in (0, 1], =1 at age 0
 * headroom     = 1 - decay                            — room confirmations can reclaim
 * confirmBoost = 1 - exp(-confirmRate * confirmations) — in [0, 1), diminishing returns
 * trust        = decay + headroom * confirmBoost
 *              = 1 - headroom * exp(-confirmRate * confirmations)
 *
 * Invariants this gives:
 *   - trust(0, anyConfirmations) === 1        (fresh entries always fully trusted)
 *   - for fixed confirmations, trust is strictly non-increasing as age grows
 *   - for fixed age > 0, trust is strictly non-decreasing as confirmations grow
 *   - trust never reaches exactly 1 for age > 0 at any finite confirmation
 *     count (confirmations never fully cancel age — only approach it asymptotically)
 *   - result is always clamped into [0, 1]
 */
export function trustScore(ageHours, confirmations, opts = {}) {
  if (!isFiniteNonNegativeNumber(ageHours)) {
    return { ok: false, why: 'ageHours must be a finite number >= 0' };
  }
  if (!Number.isInteger(confirmations) || confirmations < 0) {
    return { ok: false, why: 'confirmations must be a non-negative integer' };
  }
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    return { ok: false, why: 'opts must be a plain object' };
  }

  const decayRate = opts.decayRate === undefined ? DEFAULT_DECAY_RATE : opts.decayRate;
  const confirmRate = opts.confirmRate === undefined ? DEFAULT_CONFIRM_RATE : opts.confirmRate;

  if (!isFinitePositiveNumber(decayRate)) {
    return { ok: false, why: 'decayRate must be a finite number > 0' };
  }
  if (!isFinitePositiveNumber(confirmRate)) {
    return { ok: false, why: 'confirmRate must be a finite number > 0' };
  }

  const decay = Math.exp(-decayRate * ageHours);
  const headroom = 1 - decay;
  const confirmBoost = 1 - Math.exp(-confirmRate * confirmations);
  const raw = decay + headroom * confirmBoost;
  const value = Math.min(1, Math.max(0, raw));

  return { ok: true, value };
}

// ─────────────────────────────────────────────────────────────────────────
// v2 — the evidence ledger (Kar, choosing-session 2026-10-11).
//
// trustScore above says a fresh entry is fully trusted (trust(0)=1) and
// lets age drag trust toward 0. Both are wrong for a trust rail:
//   - one fresh run is not proof — a thing cannot validate itself once;
//   - old evidence should fade toward UNKNOWN (the prior), not toward
//     distrust. Silence is not a failure, and it is not a pass either.
// assess() keeps a decayed ledger of passes AND failures on the wall clock
// (half-life in days), folds them against a prior, and answers three
// things: the score now, a verdict (TRUSTED / DOUBTED / STALE), and the
// exact moment the verdict lapses unless someone re-runs the proof.
// Pure. Never throws: bad input returns { ok: false, why }.
// ─────────────────────────────────────────────────────────────────────────

export const DAY_MS = 86400000;

export const ASSESS_DEFAULTS = Object.freeze({
  halfLifeDays: 30,  // evidence loses half its weight every 30 days
  prior: 0.5,        // what we believe with no evidence at all
  priorMass: 1,      // how hard the prior pulls (in "fresh runs")
  minMass: 1,        // below this much live evidence the verdict is STALE
  trustAt: 0.8,      // score needed for TRUSTED
});

// Reads a timestamp as epoch ms: a finite number, or a parseable date string.
export function toMs(at) {
  if (typeof at === 'number') return Number.isFinite(at) ? at : null;
  if (typeof at === 'string' && at.trim() !== '') {
    const t = Date.parse(at.trim());
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// Weight of evidence observed at atMs, seen from nowMs: halves every half-life.
export function weightAt(atMs, nowMs, halfLifeDays) {
  return Math.pow(2, -(nowMs - atMs) / (halfLifeDays * DAY_MS));
}

function readOpts(opts) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    return { why: 'opts must be a plain object' };
  }
  const o = { ...ASSESS_DEFAULTS };
  for (const k of Object.keys(ASSESS_DEFAULTS)) {
    if (opts[k] !== undefined) o[k] = opts[k];
  }
  for (const k of ['halfLifeDays', 'priorMass', 'minMass']) {
    if (!isFinitePositiveNumber(o[k])) return { why: `${k} must be a finite number > 0` };
  }
  for (const k of ['prior', 'trustAt']) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      return { why: `${k} must be a finite number in [0,1]` };
    }
  }
  return { o };
}

/**
 * assess(events, now, opts?)
 *   events: [{ at: ms | date-string, pass: boolean }]   (any order)
 *   now:    ms | date-string
 *
 *   passMass = Σ w_i over passes,  failMass = Σ w_i over fails,  w_i = 2^(-age_i / halfLife)
 *   mass     = passMass + failMass                        — live evidence, in "fresh runs"
 *   score    = (prior·priorMass + passMass) / (priorMass + mass)
 *   verdict  = mass < minMass ? STALE : score >= trustAt ? TRUSTED : DOUBTED
 *
 * Every weight decays by the same factor k = 2^(-dt/halfLife), so:
 *   staleAt   = now + halfLife · log2(mass / minMass)
 *   lapseAt   = now + halfLife · log2((passMass − trustAt·mass) / (priorMass·(trustAt − prior)))
 *               (only when TRUSTED and trustAt > prior — the prior's pull drags the
 *                score back under the bar; if prior >= trustAt it never lapses on score)
 *   reverifyBy = TRUSTED ? min(staleAt, lapseAt) : now   — re-run the proof by then.
 */
export function assess(events, now, opts = {}) {
  if (!Array.isArray(events)) return { ok: false, why: 'events must be an array' };
  const nowMs = toMs(now);
  if (nowMs === null) return { ok: false, why: 'now must be a finite ms number or a date string' };
  const r = readOpts(opts);
  if (r.why) return { ok: false, why: r.why };
  const { halfLifeDays, prior, priorMass, minMass, trustAt } = r.o;

  let passMass = 0;
  let failMass = 0;
  let passes = 0;
  let fails = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e === null || typeof e !== 'object' || typeof e.pass !== 'boolean') {
      return { ok: false, why: `event ${i} must be { at, pass: boolean }` };
    }
    const atMs = toMs(e.at);
    if (atMs === null) return { ok: false, why: `event ${i} has an unreadable date` };
    if (atMs > nowMs) return { ok: false, why: `event ${i} is in the future — not evidence yet` };
    const w = weightAt(atMs, nowMs, halfLifeDays);
    if (e.pass) { passMass += w; passes++; } else { failMass += w; fails++; }
  }

  const mass = passMass + failMass;
  const score = (prior * priorMass + passMass) / (priorMass + mass);
  const hl = halfLifeDays * DAY_MS;

  let verdict;
  if (mass < minMass) verdict = 'STALE';
  else if (score >= trustAt) verdict = 'TRUSTED';
  else verdict = 'DOUBTED';

  let staleAt = null;
  let lapseAt = null;
  let reverifyBy = nowMs;
  let reason = verdict === 'STALE' ? 'not enough live evidence — re-run now'
    : 'below the trust bar — fix and re-run now';
  if (verdict === 'TRUSTED') {
    staleAt = nowMs + hl * Math.log2(mass / minMass);
    reverifyBy = staleAt;
    reason = 'evidence goes stale';
    if (trustAt > prior) {
      lapseAt = nowMs + hl * Math.log2((passMass - trustAt * mass) / (priorMass * (trustAt - prior)));
      if (lapseAt < staleAt) {
        reverifyBy = lapseAt;
        reason = 'score decays under the trust bar';
      }
    }
  }

  return {
    ok: true, verdict, score, mass, passMass, failMass, passes, fails,
    staleAt, lapseAt, reverifyBy, reason,
  };
}

/**
 * parseLog(text) — one event per line: "<date>, <outcome>" (comma, tab or
 * whitespace). Outcome: pass|ok|green|true|1 or fail|red|false|0 (any case).
 * Blank lines and lines starting with # are skipped.
 */
const PASS_WORDS = new Set(['pass', 'passed', 'ok', 'green', 'true', '1']);
const FAIL_WORDS = new Set(['fail', 'failed', 'red', 'false', '0']);

export function parseLog(text) {
  if (typeof text !== 'string') return { ok: false, why: 'log must be text' };
  const events = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(.+?)[\s,;\t]+(\S+)$/.exec(line);
    if (!m) return { ok: false, why: `line ${i + 1}: expected "<date>, pass|fail"`, line: i + 1 };
    const at = toMs(m[1]);
    if (at === null) return { ok: false, why: `line ${i + 1}: unreadable date`, line: i + 1 };
    const word = m[2].toLowerCase();
    let pass;
    if (PASS_WORDS.has(word)) pass = true;
    else if (FAIL_WORDS.has(word)) pass = false;
    else return { ok: false, why: `line ${i + 1}: outcome must be pass or fail`, line: i + 1 };
    events.push({ at, pass });
  }
  return { ok: true, events };
}
