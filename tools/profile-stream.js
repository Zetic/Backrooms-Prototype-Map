// What a streaming consumer pays for each new cell, measured on real runs.
//
//   node tools/profile-stream.js                 3 seeds, a walk 24 cells east along row 0
//   node tools/profile-stream.js --seeds 7 --steps 12 --rows 3
//
// A player walking east keeps a band of `rows` cells (centred on row 0)
// ready. Each step brings one new column of cells into reach, and for each
// new cell the walk does what a runtime provider needs before it can mesh it:
// its growth and the band below's (prepareGrowth), every ground site built,
// every raised floor over it built, each blueprint adapted for elevation
// (spatial, without the optional up/down zone search the export adds), and
// the seams to its neighbours. Caches never evict, so a cell's cost is only
// the work it adds over what is already known. The first step pays for the
// whole starting window, so it is reported apart.
const path = require('node:path');
const { BR } = require(path.join(__dirname, '..', 'tests', 'helpers'));
const arg = (k, d) => { const a = process.argv.indexOf(k); return a >= 0 ? process.argv[a + 1] : d; };
const SEEDS = arg('--seeds', '31337,7,12345').split(',').map(Number), STEPS = +arg('--steps', 24), ROWS = +arg('--rows', 3);
const now = () => performance.now();
const big = { limits: { cells: 1e6, builds: 1e7 }, elevationLimits: { bands: 64, claims: 1e6, branches: 1e6, raised: 1e6, footprints: 1e6 } };

const perCell = [], parts = { growth: 0, build: 0, raised: 0, spatial: 0, seams: 0 }, firsts = [];
for (const seed of SEEDS) {
  const W = new BR.BandWorld(seed, big), r0 = -Math.floor(ROWS / 2);
  for (let step = 0; step <= STEPS; step++) {
    const t0 = now(), cells = [];
    // the first step readies the starting window (columns -1..1), later steps one new column ahead
    const cols = step === 0 ? [-1, 0, 1] : [step + 1];
    for (const i of cols) for (let j = r0; j < r0 + ROWS; j++) cells.push([i, j]);
    const add = (k, t) => { if (step > 0) parts[k] += now() - t; };
    let t = now();
    for (const [i, j] of cells) W.prepareGrowth(0, i, j);
    add('growth', t); t = now();
    const sites = cells.flatMap(([i, j]) => W.cell(i, j, 0).sites);
    for (const s of sites) W.build(s);
    add('build', t); t = now();
    const raised = cells.flatMap(([i, j]) => W.raisedSites(0, i, j));
    for (const rs of raised) W.raisedBuild(rs);
    add('raised', t); t = now();
    for (const s of sites.concat(raised)) W.spatial(s);
    add('spatial', t); t = now();
    for (const s of sites) for (const n of W.neighbours(s)) W.seamsBetween(s, n);
    add('seams', t);
    const dt = now() - t0;
    if (step === 0) firsts.push(dt); else perCell.push(dt / cells.length);
  }
  console.error('seed ' + seed + ' done');
}
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
perCell.sort((a, b) => a - b);
const sum = perCell.reduce((a, b) => a + b, 0), mean = sum / perCell.length;
console.log('Walk: ' + SEEDS.length + ' seeds x ' + STEPS + ' steps x ' + ROWS + ' rows (' + perCell.length + ' new cells of 128 m)');
console.log('  starting window (' + 3 * ROWS + ' cells, cold): ' + firsts.map((v) => (v / 1000).toFixed(1) + ' s').join(', '));
console.log('  each new cell: mean ' + mean.toFixed(0) + ' ms, median ' + q(perCell, 0.5).toFixed(0) + ' ms, p90 ' + q(perCell, 0.9).toFixed(0) + ' ms, max ' + perCell[perCell.length - 1].toFixed(0) + ' ms');
console.log('  per 32 m chunk (a cell is 16 chunks): mean ' + (mean / 16).toFixed(1) + ' ms');
const tot = Object.values(parts).reduce((a, b) => a + b, 0);
console.log('  where it went: ' + Object.entries(parts).map(([k, v]) => k + ' ' + (100 * v / tot).toFixed(0) + '%').join(', '));
console.log('  heap at the end: ' + (process.memoryUsage().heapUsed / 2 ** 20).toFixed(0) + ' MB (the last seed\'s world, nothing evicted)');
