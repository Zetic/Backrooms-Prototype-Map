// The test mode, decided in one place. Every test file reads it from here.
//
//   quick (the default): the everyday run. Two world seeds, smaller samples
//     where a check samples many seeds or sizes; timing checks report.
//   full (`--full`, or BR_TEST_MODE=full): everything, as before a PR and in
//     CI. Five world seeds, full samples; timing checks fail on a clear
//     regression.
//
// The checks are the same in both modes; only how much they look at changes.
// tests/run-all.js passes the mode down through BR_TEST_MODE.
const at = process.argv.indexOf('--full');
if (at >= 0) { process.argv.splice(at, 1); process.env.BR_TEST_MODE = 'full'; }
const full = process.env.BR_TEST_MODE === 'full';

/** a sample size: `quick` in quick mode, `fullN` in full mode */
const size = (quick, fullN) => (full ? fullN : quick);

/**
 * A timing check that does not flake. `measure()` returns one measurement
 * (lower is better). Over budget, it is measured again, up to `passes` times
 * in all, and the best pass counts: a busy machine only ever slows a pass
 * down. In full mode the check fails when even the best pass is over
 * `budget × margin` (a clear regression); in quick mode it only reports.
 * Returns { ok, warn, value, detail } for the file's own check function.
 */
function timing(budget, measure, { passes = 3, margin = 1.25, unit = 'ms', digits = 2 } = {}) {
  const seen = [measure()];
  while (Math.min(...seen) >= budget && seen.length < passes) seen.push(measure());
  const value = Math.min(...seen), over = value >= budget, regressed = value >= budget * margin;
  const fmt = (v) => v.toFixed(digits) + ' ' + unit;
  let detail = fmt(value) + (seen.length > 1 ? ', best of ' + seen.map(fmt).join(' / ') : '');
  if (over) detail += full
    ? (regressed ? '; over the ' + fmt(budget * margin) + ' allowed' : '; over budget, within the ' + Math.round((margin - 1) * 100) + '% margin')
    : '; over budget, reported only in quick mode';
  return { ok: !regressed || !full, warn: over, value, detail };
}

/** print a timing result with the same prefixes as the checks: ok, WARN or FAIL */
function timingLine(name, t) {
  return (t.ok ? (t.warn ? 'WARN ' : 'ok   ') : 'FAIL ') + name + ' (' + t.detail + ')';
}

module.exports = { full, mode: full ? 'full' : 'quick', size, timing, timingLine };
