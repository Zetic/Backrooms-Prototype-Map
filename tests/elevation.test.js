const assert = require('node:assert/strict');
const { BR } = require('./helpers');
require('../src/tpl/elevation');
const E = BR.ELEV, copy = (b) => JSON.parse(JSON.stringify(b));
let builds = 0;
function good(b) { assert.deepEqual(E.validate(b).errors, [], b.name); builds++; }
function bad(b, pattern) { assert(E.validate(b).errors.some((s) => pattern.test(s)), E.validate(b).errors.join('; ')); }

for (const direction of ['up', 'down']) for (let seed = 0; seed < 100; seed++) {
  const spec = { seed, direction, site: seed % 3 === 0 ? { w: 40.5, h: 36.5 } : seed % 3 === 1 ? { w: 48, h: 42 } : { w: 40, h: 36 } };
  const b = E.generate(spec); good(b);
  assert.deepEqual(b, E.generate(spec), 'deterministic complete elevation export');
  assert.equal(b.connectors.filter((c) => c.kind === 'ramp').length, 4);
  assert.equal(b.bands.length, 2);
  assert.equal(new Set(b.rooms.map((r) => r.floorZ)).size, 6);
  const start = b.surfaces.find((s) => s.room === 'entry');
  assert.equal(E.reachable(b, [start.id]).size, b.surfaces.length, 'all surfaces reachable from ground, without an outside shortcut');
  const stack = b.rooms.find((r) => r.id === 'stack');
  assert.equal(stack.band, 'ground', 'compact pocket retains its home band');
  assert(!b.portals.some((p) => p.room === stack.id), 'occupancy does not invent a band entrance');
  const target = b.bandTerritories.find((t) => t.band !== 'ground');
  if (direction === 'up') assert(target.rects.some((r) => JSON.stringify(r) === JSON.stringify(stack.rects[0])), 'stack occupies neighboring reference section');
  assert.notDeepEqual(b.bandTerritories[0].rects, target.rects, 'territory masks differ by height');
  assert(b.volumes.some((v) => v.kind === 'void'), 'atrium is reserved even with no floor');
  assert(b.connectors.every((c) => c.direction === 'both'));
}
console.log('ok   200 exploration fills: both directions, sizes, determinism, stacked geometry and reachability');

const fixture = E.generate({ seed: 7 });
{
  const b = copy(fixture), start = b.surfaces.find((s) => s.room === 'entry').id;
  b.navigation.edges = b.navigation.edges.filter((e) => e.to !== 's:arrival' && e.from !== 's:arrival');
  bad(b, /unreachable/);
  assert(!E.reachable(b, [start]).has('s:arrival'));
}
{
  const b = copy(fixture);
  b.rooms.find((r) => r.id === 'stack').floorZ = 5.8;
  E.refresh(b); bad(b, /overlaps.*in 3D/);
}
{
  const b = copy(fixture); b.connectors[0].landings[0][2] += 0.5; bad(b, /landing does not meet/);
  const c = copy(fixture); c.connectors[0].path[1][0] = c.connectors[0].path[0][0]; bad(c, /too steep|outside reservation/);
  const d = copy(fixture); d.volumes = d.volumes.filter((v) => v.id !== d.connectors[0].reservation.id); bad(d, /no spatial reservation/);
  const h = copy(fixture); h.holes = []; bad(h, /cutouts/);
  const o = copy(fixture); o.openings = []; bad(o, /matching physical opening/);
  const v = copy(fixture); v.rooms[0].ceiling = 1; v.rooms[0].ceilingZ = 1; E.refresh(v); bad(v, /headroom/);
}
{
  const b = copy(fixture), start = 's:entry';
  for (const c of b.connectors) c.direction = 'forward';
  E.refresh(b);
  assert(E.reachable(b, [start]).has('s:arrival'));
  assert(!E.reachable(b, ['s:arrival']).has(start), 'directed traversal is respected');
}
console.log('ok   rejects broken landings, missing cuts/reservations, steep routes, overlaps, low headroom and disconnected floors');

{
  const ledger = new E.ReservationIndex();
  assert(ledger.reserve(fixture.fillId, fixture.volumes).ok);
  const voidRect = fixture.voids[0].rects[0], q = [voidRect[0] + 1, voidRect[1] + 1, voidRect[0] + 2, voidRect[1] + 2];
  const intruder = [{ id: 'neighbor-room', kind: 'room', rects: [q], z0: 7.5, z1: 10 }];
  assert(!ledger.reserve('neighbor', intruder).ok, 'empty atrium blocks neighboring geometry');
  assert.equal(ledger.snapshot().length, 1, 'failed claim is atomic');
  const free = [{ id: 'free', kind: 'room', rects: [[18, 30, 20, 35]], z0: 0, z1: 3 }];
  assert(ledger.reserve('neighbor', free).ok, 'unoccupied territory remains usable');
  const saved = ledger.snapshot();
  assert(!ledger.reserve(fixture.fillId, fixture.volumes.concat(free)).ok);
  assert.deepEqual(ledger.snapshot(), saved, 'failed replacement preserves prior reservation');
  assert(ledger.reserve(fixture.fillId, fixture.volumes).ok, 'owner replacement is supported');
  const before = ledger.snapshot(); before[0].volumes[0].z0 = -100;
  assert.notDeepEqual(ledger.snapshot(), before, 'snapshot is detached');
  assert.throws(() => ledger.reserve('broken', [{ rects: [[0,0,1,1]], z0: 2, z1: 1 }]), /invalid/);
  ledger.release('neighbor'); assert.equal(ledger.snapshot().length, 1);
  const reverse = new E.ReservationIndex(); reverse.reserve('neighbor', intruder);
  assert.throws(() => E.generate({ seed: 7, reservations: reverse }), /conflicts/);
}
console.log('ok   atomic shared reservations, protected voids, replacement and inverse generation order');

let potentials = 0, variants = 0;
for (const a of BR.TPL.listArchetypes()) {
  let tested = false;
  for (let seed = 1; seed <= 8 && !tested; seed++) {
    const source = BR.TPL.generate({ archetype: a.id, seed, wrongness: 0 });
    if (source.error) continue;
    const before = JSON.stringify(source), b = E.prepare(source);
    assert.equal(JSON.stringify(source), before, 'adapter never mutates source');
    for (const dir of ['up','down']) assert(b.capabilities[dir].supported && b.capabilities[dir].candidates.length, a.id + ' ' + dir);
    for (const direction of ['up','down']) { good(E.ladderVariant(source, { direction })); variants++; }
    potentials++; tested = true;
  }
  assert(tested, 'could not build ' + a.id);
}
for (const f of BR.FILL.list()) {
  const site = { w: Math.round(f.site.w[1] * 2) / 2, h: Math.round(f.site.h[1] * 2) / 2 }, source = BR.FILL.generate({ filler: f.id, site, seed: 7, connections: BR.FILL.sampleConnections(site, 2, 7) });
  assert(!source.error, f.id);
  const b = E.prepare(source);
  for (const dir of ['up','down']) assert(b.capabilities[dir].candidates.length, f.id + ' ' + dir);
  for (const direction of ['up','down']) { good(E.ladderVariant(source, { direction })); variants++; }
  potentials++;
}
for (const direction of ['up','down']) for (const approach of ['S','E','N','W']) for (let seed = 1; seed <= 12; seed++) {
  const source = BR.TPL.generate({ archetype:'closet', seed, approach, wrongness:0, site: approach === 'E' || approach === 'W' ? {w:1,h:1.5} : {w:1.5,h:1} });
  const b = E.ladderVariant(source,{direction}); good(b); variants++;
  assert.equal(b.connectors[0].state, 'connected');
  assert.equal(b.capabilities[direction].selected, true);
  assert.equal(b.holes.length, 2);
  assert.equal(E.reachable(b, ['s:r0']).size, 2);
  assert.equal(b.rooms.find((r) => r.id.startsWith('elev:landing')).floorZ, direction === 'up' ? 8 : -8);
}
for (const id of ['circular_hall','twin_domes','radial_suite','sector']) for (const direction of ['up','down']) {
  const source = BR.FILL.generate({ filler:id, seed:7, site:{w:32,h:24}, connections:BR.FILL.sampleConnections({w:32,h:24},2,7) });
  const b = E.ladderVariant(source,{direction}); good(b); variants++;
  for (const c of b.curves || []) assert.equal(b.levels[c.level].elevation, 0, 'curves stay on the original elevation after inserting a lower floor');
}
console.log('ok   ' + potentials + ' templates/fillers support both directions; ' + variants + ' real variants including minimum-size closets and architectural fillers');
assert.throws(() => E.generate({direction:'sideways'}), /direction/);
assert.throws(() => E.generate({site:{w:12,h:12}}), /at least/);
assert.throws(() => E.ladderVariant(BR.TPL.generate({archetype:'closet',seed:7}),{rise:2}), /separation/);
{
  const tall = BR.TPL.generate({archetype:'lone_street',seed:7,wrongness:0});
  assert(tall.rooms[0].ceiling > 8);
  const v = E.ladderVariant(tall,{direction:'up'});
  assert(v.connectors[0].landings[1][2] > tall.rooms[0].ceiling + E.SLAB, 'default landing fits above a tall host ceiling');
  assert.throws(() => E.ladderVariant(tall,{direction:'up',rise:8}), /overlaps/, 'an explicit destination elevation cannot move silently');
}
const source = BR.TPL.generate({archetype:'closet',seed:7,wrongness:0}), ledger = new E.ReservationIndex();
const chosen = E.ladderVariant(source,{direction:'up'});
assert(ledger.reserve('occupied',chosen.volumes).ok);
assert.throws(() => E.ladderVariant(source,{direction:'up',reservations:ledger}), /conflicts/);
console.log('All elevation data checks passed (' + builds + ' complete layouts).');
