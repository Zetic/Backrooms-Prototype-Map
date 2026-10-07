// World atriums must use their territory without losing physical walkability.
const assert = require('node:assert/strict');
const { BR } = require('./helpers');
const { walk1m } = require('./walk');
const E = BR.ELEV, cfg = BR.BAND_CFG;
assert.equal(cfg.fillWidth, 56); assert.equal(cfg.fillDepth, 48);
assert(cfg.fillWidth * cfg.fillDepth < 80 * 72 / 2, 'less than half the former claim');
let minFloor = 1, minClaim = 1;
for (let seed = 0; seed < 50; seed++) for (const direction of ['up', 'down']) {
  const spec = { seed, direction, rise: cfg.spacing, site: { w: cfg.fillWidth, h: cfg.fillDepth }, infill: true };
  const b = E.generate(spec), area = b.site.w * b.site.h;
  assert.deepEqual(E.validate(b).errors, []);
  assert.deepEqual(b, E.generate(spec), 'infill exports remain deterministic');
  assert.equal(b.portals.length, 2, 'internal infill doors never become world portals');
  assert.equal(b.connectors.filter((c) => c.kind === 'ramp').length, 4);
  assert.equal(E.reachable(b, ['s:entry']).size, b.rooms.length);
  assert.equal(E.reachable(b, ['s:arrival']).size, b.rooms.length);
  for (const z of [0, direction === 'up' ? cfg.spacing : -cfg.spacing]) {
    // Inspect real room/wall/opening geometry, independently of the graph.
    const slice = (vs) => vs.filter((v) => v.floorZ === z).map((v) => ({ ...v, level: 0 }));
    const floor = { site: b.site, rooms: slice(b.rooms), walls: slice(b.walls), openings: slice(b.openings),
      portals: slice(b.portals), columns: slice(b.columns || []) };
    const w = walk1m(floor);
    assert.equal(w.unreached, 0, seed + ' ' + direction + ' ' + z + ': all floor reached by a 1 m walker');
    assert.deepEqual(w.stuck, []); assert.equal(w.pieces, 1);
    const coverage = floor.rooms.reduce((sum, r) => sum + r.area, 0) / area;
    assert(coverage >= 0.55, 'each reference floor uses at least 55% of the claim');
    minFloor = Math.min(minFloor, coverage);
    assert(floor.rooms.some((r) => r.tags.includes('vertical-infill')));
  }
  // A room underneath another floor is legal; a room in the shaft/headroom
  // is not. Both follow actual Z volumes, rather than blanket XY exclusion.
  const infill = b.surfaces.filter((s) => s.room.startsWith('infill:'));
  assert(infill.some((s) => b.surfaces.some((q) => !q.room.startsWith('infill:') && q.floorZ !== s.floorZ &&
    s.rects.some((r) => q.rects.some((v) => BR.TG.roverlap(r, v))))));
  for (const s of infill) {
    const v = b.volumes.find((v) => v.id === 'volume:' + s.id);
    for (const c of b.connectors) assert(!E.volumeOverlap(v, c.reservation));
    for (const q of b.voids) assert(!E.volumeOverlap(v, q));
    assert.equal(s.owner, b.fillId, 'all infill belongs to the same territory');
  }
  const used = new BR.TG.Raster(b.site.w * 2, b.site.h * 2, 0);
  for (const v of b.volumes) for (const q of v.rects) used.fill(q.map((n) => n * 2), 1);
  const coverage = used.count(1) / used.a.length;
  assert(coverage >= 0.9, 'rooms, ramps and atrium account for at least 90% of claimed XY');
  minClaim = Math.min(minClaim, coverage);
}
console.log('ok   100 compact populated atriums, both directions; physical walkability, clearances and shared ownership');
console.log('ok   minimum reference floor coverage ' + (minFloor * 100).toFixed(1) + '%, combined claim use ' + (minClaim * 100).toFixed(1) + '%');
