// Floors at their own heights (milestone 3): houses of two and three storeys
// joined by a real stair, sunken floors with steps down into them, galleries
// over an undercroft, and the template's own stairs (`verticals`) built by the
// elevation layer in place of abstract links. run: node tests/floors.test.js
const assert = require('node:assert/strict');
const { BR } = require('./helpers');
require('../src/tpl/render2d'); require('../src/tpl/elevation-view');
const E = BR.ELEV, T = BR.TPL, F = BR.FILL, EPS = 1e-6;
const ok = (name) => console.log('ok   ' + name);
const errors = (p) => E.validate(p).errors;
const area = (rs) => rs.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0);
const SIDES = ['S', 'E', 'N', 'W'];
const filler = (id, seed) => {
  const A = F.fillers[id], site = { w: Math.round(A.site.w[0] + A.site.w[1]) / 2, h: Math.round(A.site.h[0] + A.site.h[1]) / 2 };
  return F.generate({ filler: id, seed, site, connections: F.sampleConnections(site, 2, seed) });
};
const internal = (p) => p.connectors.filter((c) => c.internal);
const surf = (p, id) => p.surfaces.find((s) => s.id === id);

// ---- 1. storeys: a stairwell up one side, a real stair in it, every floor reached on foot
{
  let houses = 0, links = 0, smaller = 0;
  for (const [id, n] of [['two_storey', 2], ['townhouse', 3]]) for (let s = 1; s <= 24; s++) {
    const b = T.generate({ archetype: id, seed: s * 31, approach: SIDES[s % 4] });
    assert(!b.error, id + '#' + s + ' builds');
    assert.equal(b.levels.length, n, id + ' has ' + n + ' storeys');
    // the stairwell stands in the same place on every floor
    const v = b.verticals.find((x) => !x.dead);
    assert.equal(v.rooms.length, n);
    const wells = v.rooms.map((r) => b.rooms.find((x) => x.id === r));
    assert(wells.every((w, k) => w.type === 'stairwell' && w.level === k && JSON.stringify(w.rects) === JSON.stringify(wells[0].rects)), 'one stairwell, stacked');
    // the ground floor has the front door; upstairs are bedrooms, not a second kitchen
    assert(b.portals.every((p) => !p.level), 'every way in is on the ground floor');
    assert(b.rooms.filter((r) => r.level > 0).every((r) => ['stairwell', 'hall', 'bedroom', 'master', 'bath', 'ensuite', 'closet', 'wic', 'linen', 'office'].includes(r.type)), 'upper floors are private rooms off a landing hallway');
    assert(b.rooms.some((r) => r.level === n - 1 && (r.type === 'master' || r.type === 'bedroom')), 'someone sleeps upstairs');
    if (n === 3 && area(b.footprint[2].rects) < area(b.footprint[1].rects) - EPS) smaller++;
    // the elevation layer builds the stair: exactly one flight between each pair of storeys
    const p = E.prepare(b);
    assert.deepEqual(errors(p), [], id + '#' + s);
    assert(p.navigation.complete && !E.validate(p).warnings.length, 'no abstract link is left');
    const st = internal(p).filter((c) => c.vertical === v.id);
    assert.equal(st.length, n - 1);
    for (const c of st) {
      const a = surf(p, c.from), d = surf(p, c.to);
      assert(c.kind === 'stair' && c.shape === 'switchback' && Math.abs(c.rise - (d.floorZ - a.floorZ)) < EPS, 'a switchback climbs exactly one storey');
      assert(c.slope >= 0.45 && c.slope <= 0.84);
      // it passes through the floor above, which is cut for it, and nowhere else
      assert(p.holes.some((h) => h.connector === c.id && h.surface === d.id && h.face === 'floor'), 'the floor above is cut');
      assert(p.holes.filter((h) => h.connector === c.id).every((h) => h.surface === a.id || h.surface === d.id));
    }
    // a ceiling under an upper floor keeps below its slab
    for (const r of p.rooms) for (const q of p.rooms) if (q.floorZ > r.floorZ + EPS && r.rects.some((x) => q.rects.some((y) => E.overlap(x, y)))) assert(r.ceilingZ <= q.floorZ - E.SLAB + EPS, r.id + ' under ' + q.id);
    houses++; links += st.length;
  }
  assert(smaller >= 18, 'a townhouse\'s top floor is smaller than the one below (' + smaller + ' of 24)');
  ok(houses + ' houses of two and three storeys: one stacked stairwell, ' + links + ' real switchbacks, every floor reached, slabs kept, top floors smaller');
}

// ---- 2. exits up leave from the top storey, away from where the stair arrives
{
  let away = 0, n = 0;
  for (let s = 1; s <= 12; s++) {
    const b = T.generate({ archetype: 'two_storey', seed: s * 7 }), p = E.prepare(b);
    const top = Math.max(...p.surfaces.map((x) => x.floorZ)), arrive = internal(p).find((c) => c.shape === 'switchback').landings[1];
    const lad = p.capabilities.up.candidates[0];
    assert.equal(surf(p, lad.surface).floorZ, top, 'the ladder up is on the top floor');
    const zone = p.connectionZones.find((z) => z.direction === 'up' && z.type === 'stair');
    for (const z of [lad.at].concat(zone ? [zone.entry] : [])) { n++; if (Math.hypot(z[0] - arrive[0], z[1] - arrive[1]) >= 3) away++; }
    // and the template's own stair stays put when a connection is chosen
    const v = E.connectionVariant(b, { direction: 'up' });
    assert.deepEqual(errors(v), []);
    assert.equal(internal(v).length, internal(p).length);
  }
  assert(away >= n * 0.8, 'exits up keep at least 3 m from the stair arrival (' + away + ' of ' + n + ')');
  ok('exits up leave from the top storey, ' + away + ' of ' + n + ' at least 3 m from where the stair arrives; variants keep the house\'s own stair');
}

// ---- 3. sunken floors: open all round, the same ceiling, steps down that fit inside
{
  const found = {};
  const check = (b, what) => {
    for (const f of (b.meta.floors || []).filter((x) => x.pattern === 'sunken')) {
      const pit = b.rooms.find((r) => r.id === f.sunken), parent = b.rooms.find((r) => r.id === f.room);
      assert(pit.floor < 0 && pit.floor >= BR.BAND_CFG.floorLimit && pit.level === parent.level, what + ' sinks below its level, within the band envelope');
      assert(Math.abs(pit.ceiling + pit.floor - parent.ceiling) < EPS, 'the ceiling stays where it was');
      assert(!parent.rects.some((r) => pit.rects.some((q) => E.overlap(r, q))), 'the floor it was cut from no longer covers it');
      assert.equal(b.walls.filter((w) => w.rooms.includes(pit.id)).filter((w) => w.kind !== 'open').length, 0, 'its edge is open: a step, no wall');
      const p = E.prepare(b);
      assert.deepEqual(errors(p), [], what);
      const c = internal(p).find((x) => x.from === 's:' + pit.id);
      assert(c && c.to === 's:' + parent.id && c.kind === 'stair' && Math.abs(c.rise + pit.floor) < EPS, 'steps climb exactly its depth');
      assert(c.slope >= 0.45 - EPS && c.slope <= 0.84 + EPS);
      // they start on the sunken floor and arrive on the floor round it
      assert(E.inside(pit.rects, c.landings[0]) && E.inside(parent.rects, c.landings[1]));
      assert(!p.holes.some((h) => h.connector === c.id), 'steps cut nothing');
      // exits up and down leave from the main floor, not the sunken one beside it
      for (const dir of ['up', 'down']) assert.notEqual(surf(p, p.capabilities[dir].candidates[0].surface).room, pit.id, what + ': the ' + dir + ' exit is on the main floor');
      assert(b.meta.ms > 0, 'the build time is kept');
      found[what.split('#')[0]] = (found[what.split('#')[0]] || 0) + 1;
    }
  };
  for (let s = 1; s <= 60; s++) {
    for (const id of ['suburban', 'two_storey']) check(T.generate({ archetype: id, seed: s }), id + '#' + s);
    if (s <= 30) check(T.generate({ archetype: 'park', seed: s, wrongness: 1 }), 'park#' + s);
    if (s <= 30) for (const id of ['ragged_hall', 'scattered_pillars', 'office', 'pillar_hall']) check(filler(id, s), id + '#' + s);
  }
  assert(found.suburban && found.two_storey && found.ragged_hall && found.park >= 20, JSON.stringify(found));
  // the park's pit is the real thing: its zone moves to the sunken room, and every pit gets one
  let pits = 0;
  for (let s = 1; s <= 30; s++) {
    const b = T.generate({ archetype: 'park', seed: s, wrongness: 1 }), z = (b.zones || []).find((x) => x.type === 'pit');
    if (!z) continue;
    pits++;
    assert.equal(b.rooms.find((r) => r.id === z.room).type, 'sunken', 'the pit zone is its own sunken floor');
  }
  assert.equal(pits, found.park, 'every pit is sunk');
  ok('sunken floors: ' + Object.entries(found).map(([k, v]) => v + ' ' + k).join(', ') + '; open edges, the same ceiling, steps of exactly their depth, nothing cut, exits from the main floor');
}

// ---- 4. galleries: a raised floor along a wall, an undercroft beneath, a stair up a side wall
{
  let n = 0;
  for (const id of ['pillar_hall', 'loop_hall', 'ragged_hall', 'office']) for (let s = 1; s <= 30; s++) {
    const b = filler(id, s), f = (b.meta.floors || []).find((x) => x.pattern === 'gallery');
    if (!f) continue;
    n++;
    const hall = b.rooms.find((r) => r.id === f.room), gal = b.rooms.find((r) => r.id === f.gallery), und = b.rooms.find((r) => r.id === f.undercroft);
    const lv = b.levels.find((l) => l.index === gal.level);
    assert(Math.abs(lv.elevation - f.at) < EPS && gal.level > 0 && und.level === 0, 'the gallery has a floor of its own');
    assert.equal(JSON.stringify(gal.rects), JSON.stringify(und.rects));
    assert(Math.abs(und.ceiling - (f.at - E.SLAB)) < EPS && und.ceiling >= 2.2, 'the undercroft has headroom under the gallery slab');
    assert(gal.ceiling >= 2.4 && Math.abs(hall.ceiling - (f.at + gal.ceiling)) < EPS, 'the hall rises to the gallery\'s ceiling');
    // the gallery's edge to the hall is a rail; its other sides stand on the hall's walls
    assert(b.walls.some((w) => w.level === gal.level && w.kind === 'open' && w.rooms[0] === gal.id), 'a rail on the open edge');
    const p = E.prepare(b);
    assert.deepEqual(errors(p), [], id + '#' + s);
    const c = internal(p).find((x) => x.to === 's:' + gal.id);
    assert(c && c.from === 's:' + hall.id && c.shape === 'straight' && Math.abs(c.rise - f.at) < EPS, 'a straight stair from the hall floor to the gallery');
    assert(!p.holes.some((h) => h.connector === c.id), 'it climbs in the open hall: nothing is cut');
    // the rail keeps a gap where the stair arrives, the stair's width
    const gaps = p.walls.filter((w) => (w.tags || []).includes('rail')).flatMap((w) => (w.gaps || []).filter((g) => g.connector === c.id));
    assert(gaps.length === 1 && Math.abs(gaps[0].to - gaps[0].from - c.width) < EPS, 'a gap in the rail for the stair');
    // the top floor here is the gallery: exits up leave from it
    assert.equal(surf(p, p.capabilities.up.candidates[0].surface).room, gal.id);
  }
  assert(n >= 25, 'galleries built: ' + n);
  ok(n + ' galleries: their own floor over an undercroft with headroom, a double-height hall, a rail on the open edge with a gap for the stair up a side wall, exits up from the gallery');
}

// ---- 5. every applied pattern is buildable; children built inside a composite keep their floor
{
  let n = 0;
  for (const id of ['suburban', 'two_storey', 'townhouse']) for (let s = 1; s <= 20; s++) {
    const b = T.generate({ archetype: id, seed: s * 13 }), p = E.prepare(b);
    const need = b.verticals.filter((v) => !v.dead).reduce((t, v) => t + v.rooms.length - 1, 0);
    assert.equal(internal(p).length, need, id + '#' + s + ': every stair of the template is built');
    n += need;
  }
  // the same spec builds the same floors
  const same = (x) => JSON.stringify(x, (k, v) => (k === 'ms' ? undefined : v));   // build times differ
  assert.equal(same(T.generate({ archetype: 'suburban', seed: 9 })), same(T.generate({ archetype: 'suburban', seed: 9 })));
  assert.equal(same(filler('pillar_hall', 3)), same(filler('pillar_hall', 3)));
  // a neighborhood's houses keep to the street's floor: their spec turns patterns off, and builds the same alone
  let kids = 0;
  for (let s = 1; s <= 6; s++) {
    const nb = T.generate({ archetype: 'neighborhood', seed: s * 104729 });
    if (nb.error) continue;
    for (const part of nb.parts || []) {
      if (!part.spec || part.spec.archetype !== 'suburban') continue;
      kids++;
      assert(part.spec.override && part.spec.override.floors === null, 'a suburban house in a neighborhood has its floor patterns off');
    }
    assert(!nb.rooms.some((r) => r.floor), 'no sunken floor inside a neighborhood');
  }
  ok(n + ' house stairs all built; the same spec gives the same floors; ' + kids + ' houses inside neighborhoods keep the street\'s floor');
}

// ---- 6. old abstract stair notes: built where a stair fits, left unresolved (and said so) where none does
{
  const Tt = { stair: { zone: 'circulation', minW: 2, tags: ['stair'] }, corridor: { zone: 'circulation', minW: 2, tags: ['circulation'] }, office: { zone: 'private', minW: 4, tags: ['work'] }, lobby: { zone: 'public', minW: 4, tags: ['entry'] } };
  const engine = (core) => ({
    id: 'floors_tower_' + core[1], name: 'tower', types: Tt, program: () => ({}),
    layout: (P, ctx, rng) => {
      const r = ctx.site.inner, rooms = [], conns = [], stairs = [];
      if (r[2] - r[0] < core[0] + 10 || r[3] - r[1] < core[1] + 6) return null;
      for (let lv = 0; lv < 3; lv++) {
        const add = (type, q) => { rooms.push({ type, level: lv, rects: [q] }); return rooms.length - 1; };
        const st = add('stair', [r[0], r[1], r[0] + core[0], r[1] + core[1]]), cor = add('corridor', [r[0] + core[0], r[1], r[0] + core[0] + 3, r[3]]);
        const front = add(lv ? 'office' : 'lobby', [r[0], r[1] + core[1], r[0] + core[0], r[3]]);
        const o = add('office', [r[0] + core[0] + 3, r[1], r[2], r[3]]);
        // the core opens at its end, onto the room in front of it, as a stair core does
        conns.push({ a: front, b: st, kind: 'opening', w: 2, prio: 5, required: true }, { a: cor, b: o, kind: 'door', prio: 5, required: true }, { a: cor, b: cor + 1, kind: 'door', prio: 5, required: true });
        if (!lv) conns.push({ a: cor, b: T.OUTSIDE, kind: 'double', role: 'entrance', side: 'S', w: 3, main: true, prio: 10, required: true });
        stairs.push(st);
      }
      return { W: ctx.site.W, H: ctx.site.H, levels: 3, levelHeights: [3, 3, 3], rooms, conns, verticals: [{ kind: 'stair', rooms: stairs }], meta: { type: 'tower' } };
    }
  });
  const run = (core) => {
    const e = engine(core);
    T.registerEngine(e); T.registerArchetype({ id: e.id, engine: e.id, name: 'tower', site: { w: [14, 16], h: [12, 14] }, windows: 0 });
    const b = T.generate({ archetype: e.id, seed: 3 });
    delete T.archetypes[e.id];
    assert(!b.error, b.error);
    return E.prepare(b);
  };
  const tight = run([4, 5]), roomy = run([4, 9]);
  assert.equal(internal(tight).length, 0, 'a 2 × 2.5 m core cannot hold a stair for 3 m');
  assert(!tight.navigation.complete && E.validate(tight).warnings.some((w) => /needs an authored XYZ path/.test(w)), 'so the link stays abstract, and says so');
  assert.equal(internal(roomy).length, 2, 'a 2 × 4.5 m core holds a switchback on each floor');
  assert(roomy.navigation.complete && !E.validate(roomy).warnings.length);
  assert.deepEqual(errors(roomy), []);
  ok('an old abstract stair becomes two real switchbacks in a 2 × 4.5 m core; in a 2 × 2.5 m core it stays abstract, with a warning, never faked');
}

// ---- 7. in the world and on screen
{
  // the world places houses of several storeys; their floors stay inside the band envelope
  const w = new BR.BandWorld(31337), seen = new Set();
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) for (const s of w.cell(i, j, 0).sites) for (const p of (s.pois || []).concat(...(s.lots || []).map((l) => l.pois || []))) seen.add(p.archetype);
  assert(seen.has('two_storey') || seen.has('townhouse'), 'the world builds houses of several storeys: ' + [...seen].join(', '));
  const x = w.exportRegion(-1, -1, 1, 1, [0]);
  assert(x.layouts.every((l) => l.blueprint.surfaces.every((s) => s.floorZ >= BR.BAND_CFG.floorLimit - EPS && s.ceilingZ <= BR.BAND_CFG.ceilingLimit + EPS)));
  // the workbench draws the real stair: solid where it starts, an outline where it arrives
  const log = [], g = new Proxy({ measureText: (s) => ({ width: String(s).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : (...a) => log.push([k, ...a])), set: (o, k, v) => { o[k] = v; log.push(['set', k, v]); return true; } });
  const b = T.generate({ archetype: 'two_storey', seed: 3 });
  T.drawBuilding(g, b, { scale: 20, level: 0, stairs: true });
  assert(log.some((l) => l[0] === 'set' && l[1] === 'fillStyle' && l[2] === '#b99f78'), 'the flight is drawn on the floor it starts from');
  log.length = 0; T.drawBuilding(g, b, { scale: 20, level: 1, stairs: true });
  assert(log.some((l) => l[0] === 'set' && l[1] === 'strokeStyle' && l[2] === '#86acd0'), 'and outlined where it arrives');
  log.length = 0; T.drawBuilding(g, b, { scale: 20, level: 0 });
  assert(!log.some((l) => l[0] === 'set' && l[1] === 'fillStyle' && l[2] === '#b99f78'), 'map painting does not build stairs');
  ok('the world builds houses of several storeys within the band envelope; the workbench draws their real stairs, map painting does not');
}
console.log('All floor checks passed.');
