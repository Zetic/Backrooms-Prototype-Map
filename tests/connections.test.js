// Connection zones (tpl/connections.js): where ladders, stairs and ramps fit,
// what selecting one builds, and the space it reserves.
// run: node tests/connections.test.js
const assert = require('node:assert/strict');
const { BR } = require('./helpers');
require('../src/tpl/render2d'); require('../src/tpl/elevation-view');
const E = BR.ELEV, T = BR.TPL, CAT = T.CAT, EPS = 1e-7;
const ok = (name) => console.log('ok   ' + name);
const valid = (b, what) => assert.deepEqual(E.validate(b).errors, [], what);
const strip = (x) => JSON.stringify(x);
const source = (id, seed, extra) => T.generate(Object.assign({ archetype: id, seed }, extra || {}));

// ---- 1. zones are opportunities: an unselected zone cuts, reserves and connects nothing
{
  const b = E.prepare(source('ranch', 7));
  const z = b.connectionZones;
  assert(z.some((q) => q.type === 'stair' && q.direction === 'up') && z.some((q) => q.type === 'stair' && q.direction === 'down'), 'a house offers stairs both ways');
  assert(z.some((q) => q.type === 'ladder' && q.direction === 'up') && z.some((q) => q.type === 'ladder' && q.direction === 'down'), 'and keeps its ladder');
  for (const q of z) {
    assert.equal(q.state, 'available');
    for (const k of ['id', 'owner', 'direction', 'type', 'surface', 'room', 'rects', 'entry', 'exit', 'floorZ', 'targetZ', 'width', 'clearance']) assert(q[k] !== undefined, q.id + ' has ' + k);
    assert(Math.abs(q.entry[2] - q.floorZ) < EPS, 'a zone starts on its room floor');
  }
  assert.equal(b.holes.length, 0); assert.equal(b.connectors.length, 0);
  assert(!b.volumes.some((v) => v.kind === 'connector'), 'no reservation');
  assert(!b.navigation.edges.some((e) => e.connector), 'no traversal edge');
  assert.equal(b.levels.length, 1, 'no extra floor');
  valid(b, 'a blueprint with zones only');
  ok('zones describe area, endpoints, type, width and headroom, and change nothing until selected');
}

// ---- 2. a selected stair or ramp: real landings, cutouts where its space passes, navigation, slope rules
{
  const cases = [['ranch', 'stair'], ['bungalow', 'stair'], ['park', 'ramp'], ['park', 'stair'], ['suburban', 'stair']];
  let n = 0;
  for (const [id, type] of cases) for (const dir of ['up', 'down']) for (const seed of [7, 11, 23]) {
    const v = E.connectionVariant(source(id, seed), { direction: dir, type });
    valid(v, id + ' ' + type + ' ' + dir); n++;
    const c = v.connectors[0], R = CAT.CONNECTIONS[type], host = v.surfaces.find((s) => s.id === c.from), land = v.surfaces.find((s) => s.id === c.to);
    assert.equal(c.kind, type);
    assert(c.width >= R.minWidth - EPS && c.clearance >= R.clearance - EPS);
    for (let k = 1; k < c.path.length; k++) {
      const p = c.path[k - 1], q = c.path[k], run = Math.hypot(q[0] - p[0], q[1] - p[1]), sl = Math.abs(q[2] - p[2]) / run;
      assert(run > 0, 'no vertical segments in a stair or ramp');
      if (sl > EPS) assert(sl >= R.slope[0] - EPS && sl <= R.slope[1] + EPS, type + ' slope ' + sl);
    }
    assert(Math.abs(c.path[0][2] - host.floorZ) < EPS && Math.abs(c.path[c.path.length - 1][2] - land.floorZ) < EPS, 'both ends on real floors');
    // cutouts: through the host floor going down, the host ceiling going up, nowhere else
    const faces = new Set(v.holes.map((h) => h.face));
    assert.deepEqual([...faces], [dir === 'down' ? 'floor' : 'ceiling'], id + ' ' + dir + ' cuts ' + [...faces]);
    assert(v.holes.every((h) => h.surface === host.id && h.connector === c.id));
    // one new floor (the landing), none along the slope
    assert.equal(v.levels.length, 2, 'sloped routes add no intermediate floors');
    assert.equal(E.reachable(v, v.portals.map((p) => 's:' + p.room)).size, v.surfaces.length, 'the landing is reached through the route');
    assert(v.navigation.edges.some((e) => e.connector === c.id && e.connected));
    assert.equal(v.connectionZones.find((z) => z.id === c.zone).state, 'connected');
    assert.equal(v.capabilities[dir].selected, true); assert.equal(v.capabilities[dir].type, type);
  }
  ok(n + ' stairs and ramps meet real floors, keep their slope, width and headroom, cut only what they pass through, add one landing floor');
}

// ---- 3. reservations follow the slope: room under the high end, none under the low end
{
  const v = E.connectionVariant(source('park', 7), { direction: 'up', type: 'ramp' }), c = v.connectors[0], host = v.surfaces.find((s) => s.id === c.from);
  const res = c.reservations;
  assert(res.length > 10, 'a ramp reserves itself piece by piece: ' + res.length);
  const flights = res.filter((r) => r.z1 - r.z0 > c.clearance + E.SLAB - EPS && r.z0 > host.floorZ + EPS);
  const high = res.reduce((a, r) => (r.z0 > a.z0 ? r : a)), low = res.find((r) => Math.abs(r.z0 - host.floorZ) < EPS && r.rects[0] !== res[0].rects[0]) || res[1];
  // a closet-sized room standing on the host floor, 2.4 m tall
  const under = (r) => [{ id: 'room', kind: 'room', rects: r.rects.map((q) => q.slice()), z0: host.floorZ - E.SLAB, z1: host.floorZ + 2.4 }];
  const ledger = new E.ReservationIndex();
  assert(ledger.reserve('ramp', res).ok);
  assert(high.z0 >= host.floorZ + 2.4, 'the high end leaves headroom beneath it');
  assert(ledger.reserve('neighbour-high', under(high)).ok, 'a room fits under the high end of the ramp');
  assert(!ledger.reserve('neighbour-low', under(low)).ok, 'a room under the low end is refused');
  // the old single bounding prism would have refused both
  const box = BR.TG.bbox(res.flatMap((r) => r.rects)), old = new E.ReservationIndex();
  old.reserve('ramp', [{ id: 'box', kind: 'connector', rects: [box], z0: Math.min(...res.map((r) => r.z0)), z1: Math.max(...res.map((r) => r.z1)) }]);
  assert(!old.reserve('neighbour-high', under(high)).ok, 'a bounding box would have blocked it');
  const vol = (r) => r.rects.reduce((n, q) => n + (q[2] - q[0]) * (q[3] - q[1]), 0) * (r.z1 - r.z0);
  const boxVol = (box[2] - box[0]) * (box[3] - box[1]) * (Math.max(...res.map((r) => r.z1)) - Math.min(...res.map((r) => r.z0)));
  assert(res.reduce((n, r) => n + vol(r), 0) < boxVol * 0.6, 'sliced reservation is well under its bounding box');
  void flights;
  // going down: past the cutout the ramp runs under intact floor, and the host floor above it stays
  const d = E.connectionVariant(source('park', 7), { direction: 'down', type: 'ramp' }), dc = d.connectors[0], dh = d.surfaces.find((s) => s.id === dc.from);
  const tunnel = dc.reservations.filter((r) => r.z1 <= dh.floorZ - E.SLAB + EPS);
  assert(tunnel.length > 0, 'part of a long downward ramp runs beneath the floor it left');
  for (const r of tunnel) assert(!d.holes.some((h) => BR.TG.roverlap(h.rect, r.rects[0])), 'no cutout over the tunnel');
  // a room inside the route's space, in the same blueprint, is refused
  const bad = JSON.parse(JSON.stringify(v)), mid = res[Math.floor(res.length / 2)];
  bad.rooms.push({ id: 'intruder', type: 'closet', name: 'intruder', floorZ: mid.z0 + 0.1, ceiling: 2, ceilingZ: mid.z0 + 2.1, band: 'up', rects: mid.rects.map((q) => q.slice()), level: 0, tags: [] });
  E.refresh(bad, { zones: v.connectionZones });
  assert(E.validate(bad).errors.some((e) => /crosses occupied room|overlaps/.test(e)));
  ok('ramp reservations follow the slope: ' + res.length + ' prisms; a room fits under the high end, not the low; tunnels keep the floor above');
}

// ---- 4. preference never overrides physics; auto falls back to the ladder
{
  assert.deepEqual(E.preferenceOf(E.prepare(source('ranch', 7))), ['stair', 'ladder']);
  assert.deepEqual(E.preferenceOf(E.prepare(source('park', 7))), ['ramp', 'stair', 'ladder']);
  assert.deepEqual(E.preferenceOf(E.prepare(source('closet', 7))), ['ladder']);
  assert.deepEqual(E.preferenceOf(E.prepare(BR.FILL.generate({ filler: 'warren', seed: 1, site: { w: 20, h: 20 }, connections: [] }))), ['stair', 'ramp', 'ladder'], 'default preference ends at the ladder');
  assert.throws(() => E.connectionVariant(source('closet', 7), { direction: 'up', type: 'stair' }), /no stair up connection fits/);
  assert.throws(() => E.connectionVariant(source('ranch', 7), { direction: 'up', type: 'ramp' }), /no ramp up connection fits.*ramp/);
  assert.equal(E.connectionVariant(source('closet', 7), { direction: 'down' }).connectors[0].kind, 'ladder');
  assert.equal(E.connectionVariant(source('park', 7), { direction: 'down' }).connectors[0].kind, 'ramp');
  assert.equal(E.connectionVariant(source('ranch', 7), { direction: 'up' }).connectors[0].kind, 'stair');
  // zones never sit on what a route must keep clear of
  const p = E.prepare(source('park', 7));
  for (const z of p.connectionZones.filter((q) => q.type !== 'ladder')) for (const r of z.rects) for (const k of p.zones.filter((q) => !CAT.ZONES[q.type].routes)) for (const q of k.rects) assert(!BR.TG.roverlap(r, q), z.id + ' on a ' + k.type);
  const play = E.prepare(source('lone_zone_playground', 3));
  assert(!play.connectionZones.some((z) => z.type !== 'ladder'), 'a playground takes no stair or ramp');
  assert.throws(() => E.connectionVariant(source('ranch', 7), { direction: 'sideways' }), /direction/);
  assert.throws(() => E.connectionVariant(source('ranch', 7), { type: 'elevator' }), /unknown connection type/);
  ok('templates prefer, physics decides: refused types say why, auto ends at the ladder, zones keep off paths and playgrounds');
}

// ---- 5. heights: exact explicit rises, refused when they cannot clear
{
  const v = E.connectionVariant(source('ranch', 7), { direction: 'up', type: 'stair', rise: 3.37 });
  assert.equal(v.connectors[0].landings[1][2], 3.37, 'an explicit rise is kept exactly, off any 2 m grid');
  valid(v, 'odd rise');
  const host = E.prepare(source('ranch', 7)), z = host.connectionZones.find((q) => q.type === 'stair' && q.direction === 'up'), room = host.rooms.find((r) => r.id === z.room);
  assert(z.targetZ - z.floorZ >= room.ceiling + E.SLAB - EPS, 'a default up rise clears the host ceiling and slab');
  assert.throws(() => E.connectionVariant(source('ranch', 7), { direction: 'up', type: 'stair', rise: 2 }), /cannot clear|no stair/);
  const down = E.connectionVariant(source('ranch', 7), { direction: 'down', type: 'stair', rise: 4.2 });
  assert.equal(down.connectors[0].landings[1][2], -4.2); valid(down, 'deep stair');
  ok('explicit rises are exact (3.37 m, −4.2 m); one too small to clear the ceiling is refused, never moved');
}

// ---- 6. deterministic; the source is never touched
{
  const s = source('suburban', 41), before = strip(s);
  const a = strip(E.connectionVariant(s, { direction: 'down' }));
  E.connectionVariant(source('ranch', 3), { direction: 'up' });
  assert.equal(strip(E.connectionVariant(s, { direction: 'down' })), a);
  assert.equal(strip(s), before);
  ok('same template and request give the same connection; the source blueprint is unchanged');
}

// ---- 7. placed in the world: every prism and zone moves with the band
{
  const v = E.connectionVariant(source('ranch', 7), { direction: 'up' }), placed = BR.placeElevationBlueprint(JSON.parse(JSON.stringify(v)), 32, 2, 3);
  const c0 = v.connectors[0], c1 = placed.connectors[0];
  c1.reservations.forEach((r, k) => { assert.equal(r.z0, c0.reservations[k].z0 + 32); assert.equal(r.z1, c0.reservations[k].z1 + 32); });
  placed.connectionZones.forEach((z, k) => { assert.equal(z.floorZ, v.connectionZones[k].floorZ + 32); assert.equal(z.entry[2], v.connectionZones[k].entry[2] + 32); });
  valid(placed, 'placed at +32 m');
  // world exports carry the zones of every layout
  const w = new BR.BandWorld(7), x = w.exportRegion(0, 0, 0, 0, [0]);
  assert(x.layouts.every((l) => Array.isArray(l.blueprint.connectionZones) && l.blueprint.connectionZones.some((z) => z.type === 'ladder' && z.direction === 'up')));
  assert(x.layouts.some((l) => l.blueprint.connectionZones.some((z) => z.type === 'stair')), 'some exported layouts offer stairs');
  assert(x.layouts.every((l) => !l.blueprint.holes.length), 'exported zones cut nothing');
  ok('band placement moves every reservation prism and zone; world exports carry zones and no cutouts');
}

// ---- 8. drawn both ways: hidden below in blue, above in violet, ladders never painted as rooms
{
  const log = [];
  const g = new Proxy({ globalAlpha: 1, measureText: (s) => ({ width: String(s).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => log.push([k, ...a])),
    set: (o, k, val) => { o[k] = val; log.push(['set', k, val]); return true; }
  });
  const draw = (b, cut) => { log.length = 0; E.drawCutaway(g, b, { cutZ: cut, scale: 20 }); return log.slice(); };
  const styles = (l, k) => l.filter((x) => x[0] === 'set' && x[1] === k).map((x) => x[2]);
  const down = E.connectionVariant(source('park', 7), { direction: 'down', type: 'ramp' }), d0 = draw(down, 0);
  assert(styles(d0, 'strokeStyle').includes('#86acd0'), 'a route under the floor, and its landing, are outlined in blue');
  assert(styles(d0, 'fillStyle').includes('#c8b69a'), 'the part you see through the cutout is solid');
  const up = E.connectionVariant(source('ranch', 7), { direction: 'up', type: 'stair' }), u0 = draw(up, 0);
  assert(styles(u0, 'strokeStyle').includes('#b5a4c5'), 'the part above the ceiling, and the upper landing, are violet');
  assert(styles(u0, 'fillStyle').includes('#b99f78'), 'the flight inside the room is solid');
  for (const dir of ['up', 'down']) {
    const l = E.ladderVariant(source('lone_vacant_lot', 7), { direction: dir }), out = draw(l, 0);
    assert(!styles(out, 'fillStyle').includes('#d6bd84'), 'a ladder footprint is outlined, not filled like a room');
    assert(styles(out, 'strokeStyle').includes(dir === 'up' ? '#b5a4c5' : '#86acd0'), 'the far landing shows in both directions');
  }
  assert(styles(draw(E.connectionVariant(source('closet', 7), { direction: 'down' }), 0), 'fillStyle').includes('#262421'), 'a hatch in the floor you look at is a dark opening');
  ok('cutaway shows routes and far landings in both directions; ladders are a footprint and a hatch');
}
console.log('All connection zone checks passed.');
