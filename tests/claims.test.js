// Several owners stacked in one column: ceilings capped under a claim above,
// a template's stair carried on up into one, and pits drilled down out of one.
// Real geometry throughout; the world's own stacking is in band-world.test.js.
const assert = require('node:assert/strict');
const { BR, harness, MODE } = require('./helpers');
const { check, finish } = harness();
const E = BR.ELEV, CLAIM = BR.CLAIM, TG = BR.TG;
const clone = (v) => JSON.parse(JSON.stringify(v));
const overlap = (a, b) => a[0] < b[2] - 1e-7 && b[0] < a[2] - 1e-7 && a[1] < b[3] - 1e-7 && b[1] < a[3] - 1e-7;
const ceilingTop = (b) => Math.max(...b.rooms.map((r) => (b.levels.find((l) => l.index === (r.level || 0)) || b.levels[0]).elevation + (r.floor || 0) + r.ceiling));

// ---- a ceiling capped under the claim above keeps its floor
{
  const bad = [], trimmed = [];
  for (const seed of MODE.size([7, 8, 9, 10], [7, 8, 9, 10, 11, 12, 13, 14, 15, 16])) {
    for (const filler of ['pillar_hall', 'loop_hall', 'office', 'warren', 'ragged_hall']) {
      const site = { w: 34, h: 28 };
      const src = BR.FILL.generate({ filler, seed, site, connections: BR.FILL.sampleConnections(site, 2, seed) });
      if (src.error) continue;
      const before = clone(src), cap = 4;
      if (!E.capCeilings(src, cap)) continue;                 // a stair that no longer fits is refused, not forced
      const floors = (b) => b.rooms.map((r) => [r.id, r.level || 0, r.floor || 0, r.rects]);
      if (JSON.stringify(floors(src)) !== JSON.stringify(floors(before))) bad.push(filler + ':' + seed + ' moved a floor');
      if (ceilingTop(src) > cap + 1e-7) bad.push(filler + ':' + seed + ' is still ' + ceilingTop(src) + ' m tall');
      if (src.rooms.some((r) => r.ceiling < 2.2 - 1e-7)) bad.push(filler + ':' + seed + ' left a room under 2.2 m');
      const a = E.prepare(src);
      if (E.validate(a).errors.length) bad.push(filler + ':' + seed + ': ' + E.validate(a).errors[0]);
      if (ceilingTop(before) > cap + 1e-7) trimmed.push(filler + ':' + seed);
    }
  }
  check('a capped ceiling keeps every floor where it was, over 2.2 m and valid', !bad.length, bad[0] || trimmed.length + ' of them really needed trimming');
  check('fillers tall enough to need capping were among them', trimmed.length > 0);
}
// a cap no room reaches changes nothing at all
{
  const site = { w: 24, h: 20 }, src = BR.FILL.generate({ filler: 'warren', seed: 7, site, connections: BR.FILL.sampleConnections(site, 2, 7) });
  const before = JSON.stringify(src);
  check('a cap above every ceiling changes nothing', E.capCeilings(src, 12) && JSON.stringify(src) === before);
  const low = clone(src);
  check('a cap that would leave a room under 2.2 m is refused', E.capCeilings(low, 2) === false);
}

// ---- a two-storey house's stairwell carried on up
{
  const made = [], bad = [];
  for (const seed of MODE.size([7, 8, 9], [7, 8, 9, 10, 11, 12])) for (const [w, h] of [[22, 18], [30, 24], [19, 11]]) {
    const src = BR.TPL.generate({ archetype: 'two_storey', seed, site: { w, h }, wrongness: 0 });
    if (src.error) continue;
    const stair = CLAIM.stairTop(src);
    if (!stair) { bad.push(seed + '@' + w + ': a two-storey house with no stairwell of its own'); continue; }
    if (stair.sides.some((sd) => !src.walls.some((x) => (x.rooms || []).includes(stair.room.id) && x.kind === 'exterior'))) bad.push(seed + ': a side with no exterior wall');
    let got = null;
    for (const side of stair.sides) for (const reach of [2.5, 1, 4]) if (!got) got = CLAIM.raiseStair(src, { z: 6.5, side, reach });
    if (!got) continue;
    made.push(seed + '@' + w + 'x' + h);
    // the ground plan is untouched: the same rooms, walls, openings and doors below
    const ground = (b) => JSON.stringify({ rooms: b.rooms.filter((r) => (r.level || 0) < 2).map((r) => [r.id, r.level || 0, r.rects, r.ceiling]),
      openings: b.openings.filter((o) => (o.level || 0) < 2), portals: b.portals.filter((p) => (p.level || 0) < 2), footprint: b.footprint.slice(0, 2) });
    if (ground(got.b) !== ground(src)) bad.push(seed + ': the ground floors changed');
    const a = E.prepare(got.b), errors = E.validate(a).errors;
    if (errors.length) { bad.push(seed + ': ' + errors[0]); continue; }
    const landing = a.rooms.find((r) => r.id === got.room);
    if (landing.floorZ !== 6.5) bad.push(seed + ': the landing is at ' + landing.floorZ);
    const flight = a.connectors.find((c) => c.to === 's:' + got.room);
    if (!flight || !['stair', 'ramp'].includes(flight.kind)) { bad.push(seed + ': nothing climbs to the landing'); continue; }
    // you can walk from the front door up to the landing and back down
    const start = a.portals.filter((p) => p.main).map((p) => 's:' + p.room);
    if (!E.reachable(a, start).has('s:' + landing.id)) bad.push(seed + ': the landing is unreachable from the front door');
    if (!E.reachable(a, ['s:' + landing.id]).has(start[0])) bad.push(seed + ': no way back down from the landing');
    // and out of the landing's own door, on the side asked for
    const door = a.portals.find((p) => p.id === got.portal);
    if (!door || door.side !== got.door.side || door.floorZ !== 6.5) bad.push(seed + ': the landing has no door out at its own height');
    if (Math.abs(door.width - got.door.width) > 1e-7 || Math.abs(got.door.s1 - got.door.s0 - got.door.width) > 1e-7) bad.push(seed + ': the door and its span disagree');
    if ([got.door.c, got.door.s0, got.door.s1].some((v) => Math.abs(v * 2 - Math.round(v * 2)) > 1e-7)) bad.push(seed + ': the door is off the half metre');
  }
  check('a two-storey house carries its stairwell up to a landing, walkable both ways, with a door out', !bad.length && made.length > 0, bad[0] || made.length + ' of them: ' + made.slice(0, 3).join(', '));
}
// a template with no stair of its own, or one that is already too tall, carries nothing
{
  const closet = BR.TPL.generate({ archetype: 'closet', seed: 7, site: { w: 6, h: 5 }, wrongness: 0 });
  check('a template with no stairwell has no top to carry up', CLAIM.stairTop(closet) === null);
  const house = BR.TPL.generate({ archetype: 'two_storey', seed: 8, site: { w: 22, h: 18 }, wrongness: 0 });
  const stair = CLAIM.stairTop(house);
  check('a landing under the roof it would stand on is refused', CLAIM.raiseStair(house, { z: stair.ceilingZ, side: stair.sides[0], reach: 2.5 }) === null);
  const inside = ['N', 'E', 'S', 'W'].filter((sd) => !stair.sides.includes(sd));
  check('a landing on a side that is not an outside wall is refused', inside.length > 0 && inside.every((sd) => CLAIM.raiseStair(house, { z: 6.5, side: sd, reach: 2.5 }) === null), 'inside sides: ' + inside.join(', '));
  assert.throws(() => CLAIM.raiseStair(house, { z: 6.5, side: 'up', reach: 2 }), /height, a side and a reach/);
}

// ---- a pit drilled from a floor above into what is below
{
  const site = { w: 30, h: 24 };
  const make = (filler, seed, z) => {
    const f = BR.FILL.generate({ filler, seed, site, connections: BR.FILL.sampleConnections(site, 2, seed), floors: false });
    if (f.error) return null;
    return BR.placeElevationBlueprint(E.prepare(f, { fillId: filler + ':' + seed + '@' + z, deferCapabilities: true }), z, 0, 0);
  };
  const bad = [], drilled = [];
  for (const seed of MODE.size([7, 8], [7, 8, 9, 10, 11])) {
    const top = make('warren', seed, 6.5), bottom = make('pillar_hall', seed + 1, 0);
    if (!top || !bottom) continue;
    const spot = CLAIM.pitSpot(top, bottom, { size: 2, fall: 3, topOrigin: [0, 0], bottomOrigin: [0, 0] });
    if (!spot) continue;
    drilled.push(seed);
    const ts = top.surfaces.find((s) => s.id === spot.top.surface), bs = bottom.surfaces.find((s) => s.id === spot.bottom.surface);
    if (!ts.rects.some((q) => TG.rcontains(q, spot.top.rect)) || !bs.rects.some((q) => TG.rcontains(q, spot.bottom.rect))) bad.push(seed + ': a pit outside the floors it joins');
    if (spot.fall !== Math.round((ts.floorZ - bs.floorZ) * 1000) / 1000 || spot.fall < 3) bad.push(seed + ': ' + spot.fall + ' m is not a drop');
    if (spot.shaft.z0 !== bs.ceilingZ || spot.shaft.z1 !== ts.floorZ - E.SLAB) bad.push(seed + ': the shaft does not run from that ceiling to that floor');
    // nothing else stands in the shaft
    for (const b of [top, bottom]) for (const v of b.volumes) {
      if (v.id === 'volume:' + ts.id || v.id === 'volume:' + bs.id) continue;
      if (E.volumeOverlap(v, { rects: [spot.bottom.rect], z0: spot.shaft.z0, z1: spot.shaft.z1 })) bad.push(seed + ': ' + v.id + ' stands in the shaft');
    }
    CLAIM.drill(top, bottom, spot, 'pit:' + seed);
    for (const [b, face, role] of [[top, 'floor', 'top'], [bottom, 'ceiling', 'bottom']]) {
      const holes = b.holes.filter((h) => h.connector === 'pit:' + seed), drops = b.drops.filter((d) => d.id === 'pit:' + seed);
      if (holes.length !== 1 || holes[0].face !== face) bad.push(seed + ': ' + role + ' has ' + holes.length + ' cutouts');
      if (drops.length !== 1 || drops[0].role !== role || drops[0].fall !== spot.fall) bad.push(seed + ': ' + role + ' is not named once');
      const errors = E.validate(b).errors.filter((e) => !/^no physical/.test(e));   // capabilities are deferred here, as in the world until export
      if (errors.length) bad.push(seed + ' ' + role + ': ' + errors[0]);
      // a pit is no way up and no way down inside one blueprint: it adds no edge
      if (b.navigation.edges.some((e) => e.kind === 'pit' || e.connector === 'pit:' + seed)) bad.push(seed + ': a pit became a connection');
      if (b.connectors.some((c) => c.id === 'pit:' + seed)) bad.push(seed + ': a pit became a connector');
    }
    const shaft = bottom.voids.find((v) => v.id === 'void:pit:' + seed);
    if (!shaft || shaft.z0 !== spot.shaft.z0 || shaft.z1 !== spot.shaft.z1) bad.push(seed + ': the lower claim does not keep the shaft clear');
    if (!bottom.volumes.some((v) => v.id === 'void:pit:' + seed)) bad.push(seed + ': the shaft is not one of its volumes');
    // drilling the same pit again changes nothing
    const again = JSON.stringify(bottom);
    CLAIM.drill(top, bottom, spot, 'pit:' + seed);
    if (JSON.stringify(bottom) !== again) bad.push(seed + ': drilling twice cut twice');
  }
  check('a pit cuts the floor above and the ceiling below, reserves its shaft and climbs nothing', !bad.length && drilled.length > 0, bad[0] || 'drilled for seeds ' + drilled.join(', '));
}
// a pit needs somewhere to come out: nothing below means no pit
{
  const site = { w: 20, h: 16 };
  const f = BR.FILL.generate({ filler: 'warren', seed: 7, site, connections: BR.FILL.sampleConnections(site, 2, 7), floors: false });
  const top = BR.placeElevationBlueprint(E.prepare(f, { fillId: 'top', deferCapabilities: true }), 6.5, 0, 0);
  const near = BR.placeElevationBlueprint(E.prepare(BR.FILL.generate({ filler: 'warren', seed: 8, site, connections: BR.FILL.sampleConnections(site, 2, 8), floors: false }), { fillId: 'near', deferCapabilities: true }), 5, 0, 0);
  check('a floor too close below is not worth a pit', CLAIM.pitSpot(top, near, { size: 2, fall: 3 }) === null);
  check('a pit needs room: nothing 8 m wide fits a warren', CLAIM.pitSpot(top, BR.placeElevationBlueprint(E.prepare(BR.FILL.generate({ filler: 'warren', seed: 9, site, connections: BR.FILL.sampleConnections(site, 2, 9), floors: false }), { fillId: 'low', deferCapabilities: true }), 0, 0, 0), { size: 8, fall: 3 }) === null);
  assert.throws(() => CLAIM.drill(top, null, null, 'pit'), /a spot and an id/);
}

// ---- the same answer every time, whatever was asked first
{
  const house = () => BR.TPL.generate({ archetype: 'two_storey', seed: 9, site: { w: 30, h: 24 }, wrongness: 0 });
  const one = CLAIM.raiseStair(house(), { z: 6.5, side: CLAIM.stairTop(house()).sides[0], reach: 2.5 });
  const two = CLAIM.raiseStair(house(), { z: 6.5, side: CLAIM.stairTop(house()).sides[0], reach: 2.5 });
  check('carrying the same stair up twice gives the same landing', JSON.stringify(one) === JSON.stringify(two));
  const src = house(), before = JSON.stringify(src);
  CLAIM.raiseStair(src, { z: 6.5, side: CLAIM.stairTop(src).sides[0], reach: 2.5 });
  check('the template it was carried up from is untouched', JSON.stringify(src) === before);
}

finish();
