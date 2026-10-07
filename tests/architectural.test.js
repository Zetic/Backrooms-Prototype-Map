// Geometric regression checks: these fillers must read as architecture,
// independent of the grid/walkability checks in fillers.test.js.
const { BR, harness } = require('./helpers');
const { check, finish } = harness(), FILL = BR.FILL;
const cases = [
  ['circular_hall', { w: 28, h: 20 }],
  ['twin_domes', { w: 28, h: 16 }],
  ['sector', { w: 24, h: 20 }],
  ['radial_suite', { w: 32, h: 22 }]
];
const strip = (b) => JSON.stringify(b, (k, v) => k === 'ms' ? undefined : v);
check('the organic fillers from PR 10 are removed', ['meander', 'tail', 'curved'].every((id) => !FILL.fillers[id]));
const bad = [], missing = [];
for (const [filler, site] of cases) for (const seed of [1, 7, 17, 42, 99]) {
  for (const turn of [false, true]) {
    const allowance = turn ? { w: site.h, h: site.w } : site;
    const connections = FILL.sampleConnections(allowance, 3, seed);
    const spec = { filler, site: allowance, seed, connections }, b = FILL.generate(spec);
    if (b.error || b.meta.issues.length) { bad.push(filler + ':' + seed + ' failed to build'); continue; }
    const arcs = (b.curves || []).filter((c) => c.kind === 'arc');
    if (!arcs.length) missing.push(filler + ':' + seed);
    for (const c of arcs) {
      if (!c.center || !(c.radius > 0) || c.pts.slice(1, -1).some((p) => Math.abs(Math.hypot(p[0] - c.center[0], p[1] - c.center[1]) - c.radius) > 0.0015)) bad.push(filler + ':' + seed + ' variable radius');
      if (!(Math.abs(c.angles[1] - c.angles[0]) <= 2 * Math.PI + 1e-9)) bad.push(filler + ':' + seed + ' invalid angular span');
    }
    if (strip(b) !== strip(FILL.generate(Object.assign({}, spec, { connections: connections.slice().reverse() })))) bad.push(filler + ':' + seed + ' connection-order dependent');
  }
}
check('every architectural layout retains circular arcs in either orientation', missing.length === 0, missing.join(', '));
check('all sampled arcs have constant radius and deterministic geometry', bad.length === 0, bad.slice(0, 5).join('; '));

const circle = FILL.generate({ filler: 'circular_hall', seed: 17, site: { w: 28, h: 20 }, connections: [] });
const arcSpan = (b, radius) => (b.curves || []).filter((c) => c.kind === 'arc' && c.radius === radius).reduce((sum, c) => sum + Math.abs(c.angles[1] - c.angles[0]), 0);
check('the circle and wing keep a near-full circular perimeter', arcSpan(circle, circle.curves[0].radius) > Math.PI * 1.7);
const domes = FILL.generate({ filler: 'twin_domes', seed: 17, site: { w: 28, h: 16 }, connections: [] });
const centers = new Set((domes.curves || []).filter((c) => c.kind === 'arc').map((c) => c.center.join(',')));
check('the paired domes have two separate matching semicircles', centers.size === 2 && new Set(domes.curves.filter((c) => c.kind === 'arc').map((c) => c.radius)).size === 1 && Math.abs(arcSpan(domes, domes.curves[0].radius) - 2 * Math.PI) < 0.25);
const suite = FILL.generate({ filler: 'radial_suite', seed: 17, site: { w: 32, h: 22 }, connections: [] });
check('the suite has concentric circulation and several radial rooms', new Set(suite.curves.filter((c) => c.kind === 'arc').map((c) => c.center.join(','))).size === 1 && suite.rooms.filter((r) => r.tags.some((t) => t.startsWith('radial-room-'))).length >= 3);
check('ordinary fillers no longer receive organic spline rounding', ['warren', 'stair_step', 'passage'].every((filler) => {
  const b = FILL.generate({ filler, seed: 17, site: { w: 24, h: 20 }, connections: [] });
  return !b.curves && !b.outline;
}));
finish();
