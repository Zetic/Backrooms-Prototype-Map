// Where map generation spends its time, measured on real runs.
//
//   node tools/profile-gen.js                 3 seeds, 6 x 6 cells of band 0
//   node tools/profile-gen.js --seeds 7,99 --cells 4
//   node tools/profile-gen.js --json out.json also write the numbers as JSON
//   node tools/profile-gen.js --big-cache     caches that never evict: the work itself, no rebuilds
//   node --cpu-prof tools/profile-gen.js      plus a V8 profile (open in Chrome DevTools)
//
// It does what the map does for a square of cells, in the map's order:
// plan the cells, plan the growths over them, build every ground site, build
// every raised floor, adapt each blueprint for elevation (spatial), find the
// seams between neighbours, paint the region at detail zoom on a stub canvas,
// and export the square (at most 8 x 8). Each stage is timed on the wall clock, and the
// generator's public functions are wrapped so their time is split by system
// (self time: a wrapped call inside another counts only to the inner one).
// Painting uses a canvas that draws nothing, so it measures the JavaScript
// that decides what to draw, not the browser's rasterising.
const path = require('node:path'), fs = require('node:fs');
const { BR } = require(path.join(__dirname, '..', 'tests', 'helpers'));
require(path.join(__dirname, '..', 'src', 'tpl', 'render2d'));
require(path.join(__dirname, '..', 'src', 'tpl', 'elevation-view'));
require(path.join(__dirname, '..', 'src', 'render'));

const arg = (k, d) => { const a = process.argv.indexOf(k); return a >= 0 ? process.argv[a + 1] : d; };
const BIG = process.argv.includes('--big-cache');
const SEEDS = arg('--seeds', '31337,7,12345').split(',').map(Number), N = +arg('--cells', 6), OUT = arg('--json', null);
const now = () => performance.now();

// ---------------------------------------------------------------- wrapping
const stats = new Map(), stack = [];
function wrap(obj, key, name, cached) {
  const f = obj[key];
  if (typeof f !== 'function' || f.__wrapped) return;
  const g = function (...a) {
    // a cache hit is not work: call it straight through, unwrapped (timing it would cost more than the hit)
    if (cached && cached.call(this, ...a)) return f.apply(this, a);
    const fr = { child: 0, name }, t0 = now();
    stack.push(fr);
    try { return f.apply(this, a); } finally {
      const dt = now() - t0;
      stack.pop();
      if (stack.length) stack[stack.length - 1].child += dt;
      const s = stats.get(name) || { calls: 0, self: 0, total: 0 };
      s.calls++; s.self += dt - fr.child;
      // `total` counts only outermost calls of this name, so recursion is not counted twice
      if (!stack.some((x) => x.name === name)) s.total += dt;
      stats.set(name, s);
    }
  };
  g.__wrapped = true;
  obj[key] = g;
}
const groups = {
  TPL: ['generate', 'validate', 'compose', 'resolve'], FILL: ['generate', 'pick'], LOT: ['build', 'yard'], FLOORS: ['apply'],
  ELEV: ['prepare', 'bakeStairs', 'connectionVariant', 'ladderVariant', 'linkFloors', 'findZones', 'validate', 'capabilities', 'reachable', 'capCeilings', 'layoutRoute', 'refresh', 'drawCutaway', 'cutawayParts'],
  CLAIM: ['stairTop', 'raiseStair', 'pitSpot', 'drill', 'markDrop'], BIOME: ['furnish'],
  GROWTH: ['plan', 'raisedSite', 'raises', 'kept', 'landingSite', 'schedule'], SEAM: ['between', 'within', 'cuts'], POI: ['place', 'plan']
};
for (const [ns, keys] of Object.entries(groups)) if (BR[ns]) for (const k of keys) wrap(BR[ns], k, ns + '.' + k);
wrap(BR.World.prototype, 'cell', 'World.cell (plan a cell)', function (i, j) { return this.cells.has(i + ',' + j); });
wrap(BR.World.prototype, 'build', 'World.build (site)', function (s) { return this.builds.has(s.id); });
wrap(BR.World.prototype, 'buildRaw', 'World.buildRaw (uncached)');
// how many times each site is built from scratch, cached or not
const builtTimes = new Map();
for (const k of ['build', 'buildRaw']) { const f = BR.World.prototype[k]; BR.World.prototype[k] = function (s) { if (k === 'buildRaw' || !this.builds.has(s.id)) { const key = this.seed + '/' + s.id; builtTimes.set(key, (builtTimes.get(key) || 0) + 1); if (k === 'buildRaw') rawBuilds++; } return f.call(this, s); }; }
let rawBuilds = 0;
for (const k of ['keepsUnder', 'spatial', 'raisedBuild', 'graph', 'exportRegion', 'afterBuild', 'seamsBetween', 'reservationPlan']) wrap(BR.BandWorld.prototype, k, 'BandWorld.' + k);
wrap(BR, 'draw', 'render.draw');

// ---------------------------------------------------------------- the run
const stub = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'canvas' ? {} : () => ({ width: 10 })), set: (o, k, v) => { o[k] = v; return true; } });
if (typeof globalThis.document === 'undefined') globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: stub }) };
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return stub(); } };

const stageTotals = {}, perSeed = [], counts = { cells: 0, sites: 0, raised: 0, growths: 0, buildMs: [] };
// per stage: which wrapped functions its time went to (self time), and the heap after it
const stageFns = {}, heap = {};
function stage(name, fn) {
  const before = new Map([...stats].map(([k, v]) => [k, v.self])), t0 = now();
  const r = fn();
  const dt = now() - t0;
  stageTotals[name] = (stageTotals[name] || 0) + dt;
  const m = stageFns[name] || (stageFns[name] = {});
  for (const [k, v] of stats) { const d = v.self - (before.get(k) || 0); if (d > 0) m[k] = (m[k] || 0) + d; }
  heap[name] = Math.max(heap[name] || 0, process.memoryUsage().heapUsed / 2 ** 20);
  return [r, dt];
}

for (const seed of SEEDS) {
  const W = new BR.BandWorld(seed, BIG ? { limits: { cells: 1e6, builds: 1e7 }, elevationLimits: { bands: 64, claims: 1e6, branches: 1e6, raised: 1e6, footprints: 1e6 } } : {}), lo = -Math.floor(N / 2), hi = lo + N - 1, cells = [];
  for (let i = lo; i <= hi; i++) for (let j = lo; j <= hi; j++) cells.push([i, j]);
  const row = { seed };
  [, row.plan] = stage('1 plan cells', () => { for (const [i, j] of cells) { W.cell(i, j, 0); W.cell(i, j, 1); } });
  [, row.growth] = stage('2 plan growths', () => { for (const [i, j] of cells) W.prepareGrowth(0, i, j); });
  const sites = cells.flatMap(([i, j]) => W.cell(i, j, 0).sites);
  [, row.build] = stage('3 build ground sites', () => { for (const s of sites) { const t0 = now(); W.worldFor(0).build(s); counts.buildMs.push(now() - t0); } });
  const raised = cells.flatMap(([i, j]) => W.raisedSites(0, i, j));
  [, row.raised] = stage('4 build raised floors', () => { for (const rs of raised) W.raisedBuild(rs); });
  [, row.spatial] = stage('5 spatial (elevation adapt)', () => { for (const s of sites.concat(raised)) W.spatial(s); });
  [, row.seams] = stage('6 seams', () => { for (const s of sites) for (const n of W.neighbours(s)) W.seamsBetween(s, n); });
  [, row.paint] = stage('7 paint detail (stub canvas)', () => {
    const C = BR.WORLD_CFG.cell, ctx = stub();
    // the whole square at 4 px a metre, in viewport-sized pieces, with no frame budget
    for (const [i, j] of cells) BR.draw(ctx, W, { cx: (i + 0.5) * C, cy: (j + 0.5) * C, zoom: 4, w: C * 4, h: C * 4, dpr: 1 }, { labels: true }, 1e9);
  });
  [, row.export] = stage('8 export the square', () => W.exportRegion(lo, lo, hi, hi, [0]));
  const G = new Set(cells.map(([i, j]) => W.growthAt(0, i, j)).filter(Boolean));
  counts.cells += cells.length; counts.sites += sites.length; counts.raised += raised.length; counts.growths += G.size;
  row.sites = sites.length; row.raisedFloors = raised.length; row.growths = G.size;
  perSeed.push(row);
  console.error('seed ' + seed + ' done: ' + JSON.stringify(row, (k, v) => typeof v === 'number' ? Math.round(v) : v));
}

// ---------------------------------------------------------------- report
const all = Object.values(stageTotals).reduce((a, b) => a + b, 0);
const pct = (v, t) => (100 * v / t).toFixed(1).padStart(5) + '%';
console.log('\nStages, ' + SEEDS.length + ' seeds x ' + N + 'x' + N + ' cells (' + counts.cells + ' cells, ' + counts.sites + ' ground sites, ' + counts.raised + ' raised floors, ' + counts.growths + ' growths)');
for (const [k, v] of Object.entries(stageTotals)) console.log('  ' + k.padEnd(32) + (v / 1000).toFixed(2).padStart(8) + ' s ' + pct(v, all));
console.log('  ' + 'all'.padEnd(32) + (all / 1000).toFixed(2).padStart(8) + ' s');
console.log('\nWhere each stage went (self time of wrapped functions; the rest is unwrapped glue), and the heap after it');
for (const [k, m] of Object.entries(stageFns)) {
  const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, v]) => f + ' ' + (100 * v / stageTotals[k]).toFixed(0) + '%');
  console.log('  ' + k.padEnd(32) + ' heap ' + heap[k].toFixed(0).padStart(5) + ' MB   ' + top.join(', '));
}
const b = counts.buildMs.sort((x, y) => x - y), q = (p) => b[Math.min(b.length - 1, Math.floor(p * b.length))];
console.log('\nGround site build (stage 3, after growth planning warmed some): median ' + q(0.5).toFixed(1) + ' ms, p90 ' + q(0.9).toFixed(1) + ' ms, max ' + b[b.length - 1].toFixed(1) + ' ms');
const times = [...builtTimes.values()], twice = times.filter((t) => t > 1).length;
console.log('Sites built from scratch: ' + times.length + ', of which ' + twice + ' more than once (' + times.reduce((a, b) => a + b, 0) + ' builds in all; ' + rawBuilds + ' of them uncached raw builds for growth planning)');
const rows = [...stats.entries()].sort((a, b) => b[1].self - a[1].self);
const selfAll = rows.reduce((a, [, s]) => a + s.self, 0);
console.log('\nSelf time by wrapped function (time not inside another wrapped call)');
for (const [k, s] of rows.slice(0, 30)) console.log('  ' + k.padEnd(28) + (s.self / 1000).toFixed(2).padStart(8) + ' s ' + pct(s.self, selfAll) + '   calls ' + String(s.calls).padStart(6) + '   avg ' + (s.self / s.calls).toFixed(2) + ' ms');
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ seeds: SEEDS, cells: N, counts: { ...counts, buildMs: undefined }, stages: stageTotals, perSeed, stageFns, heap, functions: Object.fromEntries(rows) }, null, 1));
