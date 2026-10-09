// Every check, dependency-free.
//
//   node tests/run-all.js              quick mode: the everyday run
//   node tests/run-all.js --full       full mode: before a PR, and in CI
//   node tests/run-all.js --jobs 2     at most 2 files at a time (default: one per core)
//   node tests/run-all.js world floors only the files whose name starts with these
//
// Files run in parallel, slowest first. Each file's output is printed in one
// block when it ends, never interleaved, with its time. The run fails if any
// file fails. See tests/mode.js for what the two modes do.
const { spawn } = require('node:child_process'), path = require('node:path'), os = require('node:os');

const args = process.argv.slice(2), full = args.includes('--full') || process.env.BR_TEST_MODE === 'full';
let jobs = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
const only = [];
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (a === '--full') continue;
  if (a === '--jobs' || a === '-j') jobs = +args[++k];
  else if (a.startsWith('--jobs=')) jobs = +a.slice(7);
  else if (/^-j\d+$/.test(a)) jobs = +a.slice(2);
  else if (a.startsWith('-')) { console.error('unknown option ' + a); process.exit(2); }
  else only.push(a.replace(/\.test\.js$/, ''));
}
if (!(jobs >= 1)) { console.error('--jobs needs a number of at least 1'); process.exit(2); }

// [file, args, title, cost]: cost is the file's rough time in seconds in full
// mode, used only to start the slowest files first
const SEEDS = full ? ['31337', '7', '12345', '99', '4242'] : ['31337', '7'];
const ALL = ['templates', 'catalogue', 'neighborhood', 'park', 'fillers', 'architectural', 'elevation', 'connections', 'floors', 'journeys', 'claims', 'cutaway', 'elevation-ui', 'band-world', 'band-render', 'seams', 'world', 'ui-smoke', 'space', 'space-performance', 'space-shapes', 'space-shapes-ui', 'space-house'];
const FILES = [
  ['templates', [], 'templates', 5],
  ['space-house', [], 'mansion floors, room relationships and house connections', 50],
  ['space-shapes-ui', [], 'shape experiment controller', 1],
  ['space-shapes', [], 'experimental joined floors and true outlines', 30],
  ['space', [], 'room-first houses and walk-through routes', 30],
  ['space-performance', [], 'room-first output preservation and spatial boundaries', 30],
  ['catalogue', [], 'catalogue (every room and zone, alone; pools)', 2],
  ['neighborhood', [], 'neighborhood (templates inside a template)', 5],
  ['park', [], 'park (a hall tiled by zones)', 4],
  ['fillers', [], 'fillers', 12],
  ['architectural', [], 'architectural curves (constant radii and radial layouts)', 1],
  ['elevation', [], 'elevation (surfaces, vertical fills, capabilities and reservations)', 9],
  ['connections', [], 'connection zones (ladders, stairs, ramps, slope reservations)', 3],
  ['floors', [], 'floors at their own heights (storeys, sunken floors, galleries, template stairs)', 15],
  ['journeys', [], 'journey generator (templates stacked between two bands; lab only)', 5],
  ['claims', [], 'layered ownership (capped ceilings, a stair carried up, pits)', 6],
  ['cutaway', [], 'cutaway visibility and full-width connection footprints', 0.1],
  ['elevation-ui', [], 'elevation lab controller', 2],
  ['band-world', [], 'elevation world (growth, stacked claims, matching, topology and eviction)', 60],
  ['band-render', [], 'elevation map tiles, height and selection caches', 20],
  ['seams', [], 'seams (shared walls between blueprints)', 6],
  ...SEEDS.map((seed) => ['world', [seed], 'world: seed ' + seed, 11]),
  ['ui-smoke', [], 'map page', 15]
].filter(([file]) => !only.length || only.some((o) => file === o || (file.startsWith(o) && !ALL.includes(o))));
if (!FILES.length) { console.error('no test file matches ' + only.join(', ')); process.exit(2); }

const queue = FILES.slice().sort((a, b) => b[3] - a[3]), results = [], t0 = Date.now();
const secs = (ms) => (ms / 1000).toFixed(1) + ' s';
console.log(`${full ? 'Full' : 'Quick'} run: ${FILES.length} test files, ${Math.min(jobs, FILES.length)} at a time` +
  (full ? '' : ' (node tests/run-all.js --full runs every world seed and full samples)'));

function start([file, fileArgs, title]) {
  return new Promise((resolve) => {
    const began = Date.now(), out = [];
    const child = spawn(process.execPath, [path.join(__dirname, file + '.test.js'), ...fileArgs], {
      env: Object.assign({}, process.env, { BR_TEST_MODE: full ? 'full' : 'quick' }), stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => out.push(d));
    child.on('error', (e) => out.push(Buffer.from(String(e.stack || e) + '\n')));
    child.on('close', (code, signal) => {
      const text = Buffer.concat(out).toString(), lines = text.split('\n');
      const r = {
        title, ms: Date.now() - began, ok: code === 0,
        checks: lines.filter((l) => /^(ok|FAIL|WARN) /.test(l)).length,
        failed: lines.filter((l) => /^FAIL /.test(l)).length,
        warned: lines.filter((l) => /^WARN /.test(l)).length
      };
      results.push(r);
      console.log(`\n── ${title} · ${secs(r.ms)} · ${r.ok ? 'passed' : 'FAILED' + (signal ? ' (' + signal + ')' : code ? ' (exit ' + code + ')' : '')}`);
      process.stdout.write(text.endsWith('\n') || !text ? text : text + '\n');
      resolve();
    });
  });
}

async function worker() { while (queue.length) await start(queue.shift()); }

Promise.all(Array.from({ length: Math.min(jobs, FILES.length) }, worker)).then(() => {
  const failed = results.filter((r) => !r.ok), warned = results.filter((r) => r.warned);
  const checks = results.reduce((s, r) => s + r.checks, 0);
  console.log('\n── times');
  for (const r of results.slice().sort((a, b) => b.ms - a.ms))
    console.log('  ' + secs(r.ms).padStart(7) + '  ' + (r.ok ? (r.warned ? 'warn' : 'ok  ') : 'FAIL') + '  ' + r.title);
  console.log(`\n${results.length} files, ${checks} checks, ${secs(Date.now() - t0)} (${full ? 'full' : 'quick'} mode, ${Math.min(jobs, FILES.length)} at a time)`);
  if (warned.length) console.log('Timing over budget, reported only: ' + warned.map((r) => r.title).join('; '));
  if (failed.length) {
    console.log('FAILED: ' + failed.map((r) => r.title).join('; '));
    process.exitCode = 1;
  } else console.log(only.length ? 'All selected files passed.' : `All template, catalogue, neighborhood, park, filler, architectural geometry, elevation, connection zone, floor, journey, claim, band-world, tile renderer, seam, world (${SEEDS.length} seeds), room-first house, output preservation and page checks passed.`);
});

