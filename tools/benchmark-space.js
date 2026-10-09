// Compare complete room-first generation with a git revision, including output.
// node tools/benchmark-space.js --baseline-ref <commit> --seeds 200 --rounds 3 --json results.json
// Runs separate, alternating processes so V8 optimizes each implementation in
// isolation. Timings exclude loading, output verification and profiling.
// --variant placement|raster loads just that optimization against the baseline.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const arg = (name, fallback) => { const k = process.argv.indexOf(name); return k < 0 ? fallback : process.argv[k + 1]; };
const ref = arg('--baseline-ref', null), seeds = Number(arg('--seeds', 200)), rounds = Number(arg('--rounds', 3));
const recipes = arg('--recipes', 'passage,passage1,backdoor').split(','), wrong = Number(arg('--wrong', 0.35));
const variant = arg('--variant', 'combined');
if (!['combined', 'placement', 'raster'].includes(variant)) throw new Error('--variant must be combined, placement or raster');
if (!Number.isInteger(seeds) || seeds < 1 || !Number.isInteger(rounds) || rounds < 1 || !Number.isFinite(wrong) || wrong < 0 || wrong > 1) throw new Error('invalid seeds, rounds or wrongness');
const files = ['core', 'space/recipes', 'space/space', 'space/route'];
const source = (f, rev) => rev ? execFileSync('git', ['show', rev + ':src/' + f + '.js'], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, 'src', f + '.js'), 'utf8');
if (process.argv.includes('--worker')) {
  const rev = arg('--revision', null), sourceHash = crypto.createHash('sha256');
  for (const f of files) {
    const selectedRef = rev || (variant === 'placement' && f === 'space/space' || variant === 'raster' && f === 'space/route' ? ref : null);
    const code = source(f, selectedRef); sourceHash.update(code); vm.runInThisContext(code, { filename: 'src/' + f + '.js' });
  }
  const SP = globalThis.BR.SPACE, rows = [];
  for (const recipe of recipes) {
    if (!SP.RECIPES[recipe]) throw new Error('unknown recipe ' + recipe);
    for (let seed = seeds + 1; seed <= seeds + 12; seed++) SP.generate({ recipe, seed, wrong });
    const times = [], digest = crypto.createHash('sha256');
    let built = 0, valid = 0, candidates = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const t0 = performance.now(), h = SP.generate({ recipe, seed, wrong });
      times.push(performance.now() - t0);
      if (!h.error) { built++; if (!SP.verify(h).length) valid++; candidates += h.meta.candidates; }
      if (h.meta) delete h.meta.ms;
      digest.update(JSON.stringify(h) + '\n');
    }
    const profile = SP.generate({ recipe, seed: 7, wrong, profile: true }).meta?.profile || null;
    rows.push({ recipe, times, built, valid, candidates, digest: digest.digest('hex'), profile });
  }
  process.stdout.write(JSON.stringify({ sourceHash: sourceHash.digest('hex'), rows }));
} else {
  if (!ref) throw new Error('--baseline-ref must identify the original revision');
  const result = { baselineRef: ref, baselineLabel: arg('--baseline-label', ref), variant, node: process.version, platform: process.platform, arch: process.arch, seeds, rounds, wrong, rows: [] };
  const samples = { baseline: [], current: [] };
  for (let round = 0; round < rounds; round++) for (const kind of round % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
    const args = [__filename, '--worker', '--baseline-ref', ref, '--variant', variant, '--seeds', String(seeds), '--recipes', recipes.join(','), '--wrong', String(wrong)];
    if (kind === 'baseline') args.push('--revision', ref);
    samples[kind].push(JSON.parse(execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })));
    console.log('completed ' + kind + ', round ' + (round + 1));
  }
  const summarize = (times) => {
    const sorted = times.slice().sort((a, b) => a - b), at = (p) => sorted[Math.ceil(sorted.length * p) - 1];
    return { meanMs: times.reduce((a, b) => a + b, 0) / times.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: sorted[sorted.length - 1] };
  };
  for (let i = 0; i < recipes.length; i++) {
    const before = samples.baseline.map((s) => s.rows[i]), after = samples.current.map((s) => s.rows[i]);
    const equal = before.concat(after).every((r) => r.digest === before[0].digest);
    const baseline = summarize(before.flatMap((r) => r.times)), current = summarize(after.flatMap((r) => r.times));
    const row = { recipe: recipes[i], baseline, current, speedup: baseline.meanMs / current.meanMs, identicalOutput: equal,
      built: after[0].built, valid: after[0].valid, meanCandidates: after[0].candidates / Math.max(1, after[0].built), profile: after[0].profile };
    result.rows.push(row);
    console.log(row.recipe + ': ' + baseline.meanMs.toFixed(2) + ' → ' + current.meanMs.toFixed(2) + ' ms, ' + row.speedup.toFixed(2) + 'x; output ' + (equal ? 'identical' : 'DIFFERENT'));
    if (!equal || before.concat(after).some((r) => r.valid !== r.built)) process.exitCode = 1;
  }
  result.sourceHashes = { baseline: samples.baseline[0].sourceHash, current: samples.current[0].sourceHash };
  const out = arg('--json', null);
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
}
