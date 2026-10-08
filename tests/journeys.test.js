// Vertical journeys (journeys.js): a stack of different templates climbing
// from one band's floor to the next band's, 16 m up.
// run: node tests/journeys.test.js
const assert = require('node:assert/strict');
const { BR } = require('./helpers');
const E = BR.ELEV, J = BR.JOURNEY, TG = BR.TG, EPS = 1e-7;
const ok = (name) => console.log('ok   ' + name);
const gen = (spec) => J.generate(Object.assign({ id: 'journey:test' }, spec));
const legsOf = (b) => b.connectors.filter((c) => /^k\d+\.elev:/.test(c.id)).sort((p, q) => p.landings[0][2] - q.landings[0][2]);

/** walkable surfaces from `start`, following each edge's direction */
function reach(b, start) {
  const adj = new Map(b.surfaces.map((s) => [s.id, []]));
  for (const e of b.navigation.edges) if (e.connected) {
    if (e.direction !== 'reverse') adj.get(e.from).push(e.to);
    if (e.direction !== 'forward') adj.get(e.to).push(e.from);
  }
  const seen = new Set([start]), todo = [start];
  while (todo.length) for (const v of adj.get(todo.pop())) if (!seen.has(v)) { seen.add(v); todo.push(v); }
  return seen;
}

// ---- 1. a batch over every style and the world's territory sizes
const batch = [];
for (const style of Object.keys(J.STYLES)) for (let k = 0; k < 6; k++) {
  const spec = { seed: 1000 + k * 7919 + style.length, w: 40 + (k * 5) % 17, h: 32 + (k * 7) % 17, lower: k % 3 - 1, style };
  batch.push({ spec, b: gen(spec) });
}
{
  for (const { spec, b } of batch) {
    const base = spec.lower * 16, what = spec.style + ' ' + spec.seed;
    assert.equal(b.kind, 'journey'); assert.equal(b.schema, E.SCHEMA); assert.equal(b.source.style, spec.style);
    // every floor and climb is checked as one blueprint (capabilities are left to the export)
    assert.deepEqual(E.validate(b).errors.filter((e) => !/^no physical/.test(e)), [], what);
    // 16 m in about 3-4.5 m climbs, each landing exactly on the next stage's floor
    const { rises, stages } = b.source, legs = legsOf(b);
    assert(Math.abs(rises.reduce((a, r) => a + r, 0) - 16) < EPS, what + ': rises sum to the band spacing');
    // (drawn from 3.4-4.6 m, 2.9-3.5 m for ramps, then scaled to sum to 16)
    assert(rises.every((r) => r >= 2.7 && r <= 5), what + ': ' + rises);
    assert.equal(legs.length, rises.length); assert.equal(stages.length, rises.length + 1);
    stages.forEach((st, k) => { if (k) assert(Math.abs(st.z - stages[k - 1].z - rises[k - 1]) < EPS); });
    assert.equal(stages[stages.length - 1].z, 16);
    legs.forEach((c, k) => {
      assert(['stair', 'ramp', 'ladder'].includes(c.kind) && c.kind === stages[k].leg);
      assert(Math.abs(c.landings[0][2] - (base + stages[k].z)) < EPS && Math.abs(c.landings[1][2] - (base + stages[k + 1].z)) < EPS, what + ': leg ' + k + ' climbs exactly');
    });
    // a stack of different templates, never one filler repeated, never one big box
    assert.equal(new Set(stages.map((st) => st.filler)).size, stages.length, what + ': ' + stages.map((st) => st.filler));
    for (const st of stages.slice(1, -1)) assert(TG.rarea(st.rect) <= 0.5 * spec.w * spec.h, what + ': an intermediate stage is a floor of its own, not the territory');
    // never a shaft: no climb over another's footprint, no two starting together
    for (let p = 0; p < legs.length; p++) for (let q = p + 1; q < legs.length; q++) {
      const a = TG.bbox(E.reservationsOf(legs[p]).flatMap((v) => v.rects)), c = TG.bbox(E.reservationsOf(legs[q]).flatMap((v) => v.rects));
      assert(!TG.roverlap(a, c), what + ': legs ' + p + ' and ' + q + ' share XY');
      assert(Math.hypot(legs[p].path[0][0] - legs[q].path[0][0], legs[p].path[0][1] - legs[q].path[0][1]) >= J.CFG.apart - EPS);
    }
    // each intermediate floor is crossed: where you arrive is well away from where the next climb leaves
    for (let k = 1; k < legs.length; k++) {
      const exit = b.openings.find((o) => o.id === 'k' + (k - 1) + '.elev:o:exit'), at = [(exit.a[0] + exit.b[0]) / 2, (exit.a[1] + exit.b[1]) / 2];
      const r = stages[k].rect, side = Math.max(r[2] - r[0], r[3] - r[1]);
      assert(Math.hypot(legs[k].path[0][0] - at[0], legs[k].path[0][1] - at[1]) >= Math.max(J.CFG.explore, 0.35 * side) - 0.5, what + ': stage ' + k + ' is crossed');
    }
    // and the bottom floor: the first climb is well inside, away from every door in; the last landing keeps clear of the doors out
    const mid = (d) => (d.o === 'h' ? [(d.s0 + d.s1) / 2, d.c] : [d.c, (d.s0 + d.s1) / 2]);
    for (const d of J.doorsAt(b, base)) assert(Math.hypot(legs[0].path[0][0] - mid(d)[0], legs[0].path[0][1] - mid(d)[1]) >= Math.max(J.CFG.explore, J.CFG.exploreBottom * Math.max(spec.w, spec.h)) - EPS, what + ': the first climb is not at a door');
    const lastExit = b.openings.find((o) => o.id === 'k' + (legs.length - 1) + '.elev:o:exit'), lx = [(lastExit.a[0] + lastExit.b[0]) / 2, (lastExit.a[1] + lastExit.b[1]) / 2];
    for (const d of J.doorsAt(b, base + 16)) assert(Math.hypot(lx[0] - mid(d)[0], lx[1] - mid(d)[1]) >= J.CFG.explore - EPS, what + ': the last landing is not at a door');
    // doors onto both bands, on the territory's edge, and every floor walkable from either band, both ways
    const low = J.doorsAt(b, base), high = J.doorsAt(b, base + 16), plan = J.plan(spec), span = (d) => [d.o, d.c, d.s0, d.s1];
    // the world plans its cells round the doors before building: every planned door is built, exactly there
    assert.deepEqual(low.map(span).sort(), J.doors(plan.low).map(span).sort(), what + ': lower doors as planned');
    assert.deepEqual(high.map(span).sort(), J.doors(plan.high).map(span).sort(), what + ': upper doors as planned');
    assert(low.length >= 1 && high.length >= 1, what + ': doors on both bands');
    for (const d of low.concat(high)) assert(d.c === 0 || d.c === (d.o === 'h' ? spec.h : spec.w), 'a door sits on the territory edge');
    for (const p of b.portals) assert.equal(p.band, 'band:' + (Math.abs(p.floorZ - base) < EPS ? spec.lower : spec.lower + 1));
    for (const p of b.portals) assert.equal(p.at[2], p.floorZ, 'a portal is placed at its floor height');
    const down = 's:' + b.portals.find((p) => p.floorZ === base).room, up = 's:' + b.portals.find((p) => p.floorZ === base + 16).room;
    assert.equal(reach(b, down).size, b.surfaces.length, what + ': every floor reached from the lower band');
    assert(reach(b, up).has(down), what + ': and back down from the upper band');
    // a room belongs to the band its floor is in; everything stays inside the two bands' envelopes
    for (const r of b.rooms) assert.equal(r.band, 'band:' + (r.floorZ >= base + 16 + BR.BAND_CFG.floorLimit - EPS ? spec.lower + 1 : spec.lower));
    for (const s of b.surfaces) assert(s.floorZ >= base - EPS && s.ceilingZ <= base + 16 + BR.BAND_CFG.ceilingLimit + EPS);
    // the route for profiles: a door on the lower band, every climb, a door on the upper band
    assert.equal(b.route[0][2], base); assert.equal(b.route[b.route.length - 1][2], base + 16);
    for (let k = 1; k < b.route.length; k++) assert(b.route[k][2] >= b.route[k - 1][2] - EPS, 'the route only climbs');
  }
  ok(batch.length + ' journeys: exact 16 m in 4-5 climbs, different templates, no shafts, each floor crossed, the planned doors, walks both ways');
}

// ---- 2. styles tilt the climbs; mixed follows each stage's own preference
{
  const count = (style, kind) => batch.filter((x) => x.spec.style === style).flatMap((x) => x.b.source.stages).filter((st) => st.leg === kind).length;
  const total = (style) => batch.filter((x) => x.spec.style === style).flatMap((x) => x.b.source.stages).filter((st) => st.leg).length;
  for (const [style, kind] of [['stairs', 'stair'], ['ramps', 'ramp'], ['ladders', 'ladder']]) assert(count(style, kind) >= 0.6 * total(style), style + ': ' + count(style, kind) + '/' + total(style));
  assert(count('ramps', 'ramp') > count('mixed', 'ramp') && count('ladders', 'ladder') > count('mixed', 'ladder'));
  assert.equal(batch.filter((x) => x.spec.style === 'ramps')[0].b.source.rises.length, 5, 'ramps take more, lower climbs');
  // the style otherwise comes from the seed, all of them in use
  const drawn = new Set();
  for (let s = 0; s < 40; s++) drawn.add(J.styleOf({ seed: s, w: 48, h: 40 }));
  assert.equal(drawn.size, 4);
  for (const seed of [5, 6]) assert.equal(gen({ seed, w: 48, h: 40 }).source.style, J.styleOf({ seed, w: 48, h: 40 }));
  assert.throws(() => gen({ seed: 1, w: 48, h: 40, style: 'escalators' }), /unknown journey style/);
  ok('stair-, ramp- and ladder-heavy styles each mostly climb their own way; the seed picks among all four');
}

// ---- 3. deterministic, and the same journey at any pair of bands, only higher or lower
{
  const spec = { seed: 4242, w: 52, h: 44 }, a = gen({ ...spec, lower: 0 });
  assert.equal(JSON.stringify(a), JSON.stringify(gen({ ...spec, lower: 0 })));
  const b = gen({ ...spec, lower: -3 });
  assert.deepEqual(b.rooms.map((r) => r.rects), a.rooms.map((r) => r.rects));
  assert(b.rooms.every((r, k) => Math.abs(r.floorZ + 48 - a.rooms[k].floorZ) < EPS));
  assert.deepEqual(b.bands.map((x) => x.id), ['band:-3', 'band:-2']);
  ok('a journey is a pure function of its spec; moving it between bands only moves it in Z');
}
console.log('All journey checks passed.');
