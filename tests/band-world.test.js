// Real geometry, authoritative portal matches, and stateless world ownership.
const assert = require('node:assert/strict');
const { BR, components, MODE } = require('./helpers');
const C = BR.WORLD_CFG.cell, E = BR.ELEV;
const same = (a, b) => assert.deepEqual(a, b);
const inside = (r, q) => q[0] >= r[0] - 1e-7 && q[1] >= r[1] - 1e-7 && q[2] <= r[2] + 1e-7 && q[3] <= r[3] + 1e-7;
function walk(g, start) {
  const adj = new Map([...g.nodes].map((n) => [n, []]));
  for (const e of g.navigation.edges) {
    if (e.direction !== 'reverse') adj.get(e.from).push(e.to);
    if (e.direction !== 'forward') adj.get(e.to).push(e.from);
  }
  const seen = new Set([start]), todo = [start];
  while (todo.length) for (const v of adj.get(todo.pop())) if (!seen.has(v)) { seen.add(v); todo.push(v); }
  return seen;
}
function tile(c) {
  const own = new Uint8Array(C * C), x0 = c.i * C, y0 = c.j * C;
  for (const s of c.sites) for (const r of s.rects) {
    assert(r.every(Number.isInteger));
    assert(inside(c.rect, r));
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) own[(y - y0) * C + x - x0]++;
  }
  assert(own.every((v) => v === 1), 'band ownership tiles the cell exactly');
}

// Every band is a horizontal network of its own: its cells tile exactly,
// nothing is reserved between bands any more (no journey plots), and every
// floor keeps to the envelope of the band it is in.
const envelope = (node) => { const n = +String(node.band).split(':')[1]; return [n * 16 + BR.BAND_CFG.floorLimit, n * 16 + BR.BAND_CFG.ceilingLimit]; };
const groundNode = (id) => !/^growth:/.test(id) && !/:raised/.test(id);
for (const seed of MODE.size([31337], [7, 99, 31337])) {
  const w = new BR.BandWorld(seed);
  assert.equal(w.journeyPlan, undefined, 'no journey plots');
  for (const n of [-1, 0, 1]) {
    const c = w.cell(0, 0, n); tile(c);
    assert(c.sites.every((s) => ['filler', 'lot', 'flush'].includes(s.kind)), 'a cell holds fillers and lots only');
    const g = w.graph(0, 0, 0, 0, [n]);
    same(g.issues, []); same(g.unresolved, []);
    // the ground is one network; a growth's floors join it, or lead out of the cell
    const comp = components(g.nodes, g.edges);
    assert.equal(new Set([...g.nodes].filter(groundNode).map((id) => comp.labels.get(id))).size, 1, seed + ' band ' + n + ': one ground network');
    assert(g.navigation.nodes.some((s) => s.floorZ === n * 16));
    for (const s of g.navigation.nodes) { const [lo, hi] = envelope(s); assert(s.floorZ >= lo - 1e-7 && s.ceilingZ <= hi + 1e-7, s.id); }
  }
}
console.log('ok   every band cell tiles exactly and its ground is one network; no journey plots; every floor inside its band\'s envelope');

// A corrupted height, clearance, side or missing endpoint cannot accidentally
// become a connection merely because two XY territories touch.
// (one world: each fault is made on its cached blueprint, checked, and undone;
// the graph is worked out afresh from the blueprints on every call)
{
  const w = new BR.BandWorld(7), p = {i:0,j:0}, s = w.cell(0,0,0).sites.find((s) => w.spatial(s).filler?.portals.some((p)=>p.connection)), b = w.spatial(s).filler;
  const portal = b.portals.find((p) => p.connection), opening = b.openings.find((o) => o.id === portal.opening), keep = { ...portal }, height = opening.height;
  same(w.graph(p.i, p.j, p.i, p.j, [0, 1]).issues, []);
  for (const fault of ['height', 'width', 'side', 'clearance', 'missing']) {
    if (fault === 'height') portal.floorZ += 0.5;
    if (fault === 'width') portal.width += 0.5;
    if (fault === 'side') portal.side = BR.TG.opposite(portal.side);
    if (fault === 'clearance') opening.height = 1;
    if (fault === 'missing') delete portal.connection;
    assert(w.graph(p.i, p.j, p.i, p.j, [0, 1]).issues.length, fault);
    Object.assign(portal, keep); if (height === undefined) delete opening.height; else opening.height = height;
    same(w.graph(p.i, p.j, p.i, p.j, [0, 1]).issues, [], 'undone: ' + fault);
  }
}
assert.throws(() => new BR.BandWorld(7, { band: 0.5 }), /integer/);
assert.throws(() => new BR.BandWorld(7).exportRegion(0, 0, 8, 8, [0]), /64/);
assert.equal(E.generate,undefined);
console.log('ok   invalid portal matching, region sizes and band indices rejected');

// ---- growth (growth.js): pillars, floors stacked over floors, legs, arrivals
// in the next band. A column of the world holds several claims, stacked.
const GROWTH = BR.GROWTH, CL = BR.BAND_CFG.ceilingLimit, EPS = 1e-7;
const KNOWN = { seed: 7, i: 0, j: 2 };             // band 0: a townhouse's growth, 6 floors at +9.5 m over two cells, a pit, and a climb to band 1
const MULTI = { seed: 7, i: 0, j: 1 };             // band 0: a two-storey house's growth: floors at +6.5 m, a leg up to +9.5 m, and a climb to band 1
const CROSS = { seed: 31337, i: -1, j: 1 };        // band 0: a growth whose floors spread over two cells
const w7 = new BR.BandWorld(7);
const at = (rects, p) => rects.some((q) => p[0] >= q[0] && p[0] < q[2] && p[1] >= q[1] && p[1] < q[3]);
const span = (cells) => [Math.min(...cells.map((c) => c[0])), Math.min(...cells.map((c) => c[1])), Math.max(...cells.map((c) => c[0])), Math.max(...cells.map((c) => c[1]))];
const within = (outer, rects) => rects.every((q) => { let rest = [q]; for (const r of outer) rest = rest.flatMap((x) => BR.TG.rsub(x, r)); return !rest.length; });
/** a growth that reaches band 1: walk from its pillar's ground floor to its landing site's floor 16 m up, and back */
function climbsToBand1(w, G) {
  const [i0, j0, i1, j1] = span(G.cells.concat([G.arrival.cell]));
  const g = w.graph(i0, j0, i1, j1, [0, 1]);
  same(g.issues, []); same(g.unresolved, []);
  const start = g.navigation.nodes.find((n) => n.floorZ === 0 && n.id.startsWith(G.anchor + '/'));
  const top = g.navigation.nodes.find((n) => n.floorZ === 16 && n.id.startsWith(G.arrival.ground + '/'));
  assert(start && top, G.id + ': its ground floor and its landing site');
  assert(walk(g, start.id).has(top.id), G.id + ': up to band 1');
  assert(walk(g, top.id).has(start.id), G.id + ': and back down');
  // the last climb is matched portal to portal on band 1's floor
  const m = g.matches.find((x) => x.id === G.arrival.conn.id);
  assert(m && m.a.at[2] === 16 && m.b.at[2] === 16, G.id + ': the climb meets the landing site at 16 m');
  return g;
}
/** every claim over the growth's cells, in both bands, reserved together: none overlaps another */
function claimsOf(w, G) {
  const index = new E.ReservationIndex(), all = [];
  for (const [i, j] of G.cells.concat(G.arrival ? [G.arrival.cell] : [])) for (const r of w.reservationPlan(i, j, 0, 1)) {
    if (all.some((x) => x.owner === r.owner)) continue;
    assert(index.reserve(r.owner, r.volumes).ok, r.owner + ' overlaps another claim');
    all.push(r);
  }
  return all;
}

{
  const w = w7, G = w.growth(0, KNOWN.i, KNOWN.j);
  assert(G, 'the known growth');
  assert.equal(G.pillar, 'house'); assert.equal(G.archetype, 'townhouse'); assert.equal(G.biome, 'houseroom');
  assert.equal(G.floorZ, 9.5); assert(G.steered && G.arrival, 'steered, and it arrives');
  assert(G.cells.length >= 2, 'it may grow into a neighbouring cell');
  assert.equal(w.cell(KNOWN.i, KNOWN.j, 0).sites.find((s) => s.id === G.anchor).kind, 'lot', 'its anchor is a house on its own lot');
  // (its plan placed a two-storey house for it, whose landing found no ground to open onto: another house of the cell that seeds growth carries on up)
  assert(w.cell(KNOWN.i, KNOWN.j, 0).pois.some((P) => P.grows) && BR.TPL.archetypes[G.archetype].grows, 'a house that seeds growth, in the cell its plan placed one');
  // the landing: the house's own stair carried on up, and a door into the growth
  const host = w.spatial(w.site(G.anchor)), house = host.buildings.find((x) => x.poi.id === G.poi);
  const landing = house.b.rooms.find((r) => r.id === G.landing.room);
  assert(landing && landing.floorZ === G.floorZ, 'the landing stands at the first floor');
  assert(house.b.connectors.some((c) => c.to === 's:' + landing.id), 'the house own stair climbs to it');
  assert.equal(house.conns[G.landing.portal], G.landing.connection, 'its door is the growth\'s connection');
  // only the ceilings under it change: capped under its slab
  for (const c of G.caps) assert(w.spatial(w.site(c.site)).filler.surfaces.every((s) => s.ceilingZ <= c.cap + EPS), c.site + ' is capped');
  // claims: none overlaps; three owners stacked in one column (the ground,
  // the floor over it, and band 1's landing site over that)
  const all = claimsOf(w, G), A = G.arrival, from = G.sites.find((rs) => rs.id === A.site), up = w.site(A.ground);
  let p = null;
  for (const q of from.rects) for (let y = q[1] + 0.5; y < q[3] && !p; y++) for (let x = q[0] + 0.5; x < q[2] && !p; x++)
    if (at(up.rects, [x, y]) && !at([A.box], [x, y]) && at(w.site(from.ground || from.over).rects || [], [x, y])) p = [x, y];
  assert(p, 'a column under the landing site, over the arrival floor');
  const column = all.flatMap((r) => r.volumes.filter((v) => at(v.rects, p)).map((v) => ({ owner: r.owner, z0: v.z0, z1: v.z1 }))).sort((a, b) => a.z0 - b.z0);
  assert(column.length >= 3 && new Set(column.map((v) => v.owner)).size >= 3, 'three owners in one column: ' + column.map((v) => v.owner).join(', '));
  for (let k = 1; k < column.length; k++) assert(column[k].z0 >= column[k - 1].z1 - EPS, 'stacked, never overlapping');
  assert(column.some((v) => v.owner === from.owner && v.z0 === from.floorZ - E.SLAB), 'the raised floor\'s claim starts at its own slab');
  // the climb lands exactly on band 1's floor, inside the landing site, which is built round it
  const climb = w.raisedBuild(from).filler.connectors.find((c) => c.id.startsWith('elev:'));
  assert(Math.abs(climb.landings[0][2] - from.floorZ) < EPS && Math.abs(climb.landings[1][2] - 16) < EPS, 'an exact rise to 16 m');
  assert.equal(A.rise, 16 - from.floorZ); assert(GROWTH.landingSite(w, 1, up), 'it lands in one of the sites band 1 keeps for it');
  assert(GROWTH.kept(w, 0, KNOWN.i, KNOWN.j).some((s) => s.id === up.id));
  const ub = w.spatial(up);
  assert(ub.filler.surfaces.every((s) => s.rects.every((q) => !BR.TG.roverlap([q[0] + ub.fillerOrigin[0], q[1] + ub.fillerOrigin[1], q[2] + ub.fillerOrigin[0], q[3] + ub.fillerOrigin[1]], A.box))), 'the landing site leaves the climb its opening');
  same(ub.filler.portals.filter((q) => q.connection).map((q) => q.connection).sort(), up.conns.concat([A.conn.id]).sort());
  // you can walk from the house up through the growth to band 1, and back
  const g = climbsToBand1(w, G);
  // the pit: one way down, from the first floor into the ground site below
  assert(G.pit, 'the growth has a pit');
  const pit = g.pits.find((q) => q.id === G.pit.id);
  assert(pit && pit.fall >= 3, 'a pit is a drop');
  assert(g.navigation.edges.some((e) => e.kind === 'pit' && e.drop === G.pit.id && e.direction === 'forward'));
  assert(!g.edges.some((e) => e.includes(pit.from) && e.includes(pit.to)), 'a pit is never a two-way edge');
  const top = w.raisedBuild(G.sites.find((rs) => rs.id === G.pit.top.site)).filler, low = w.spatial(w.site(G.pit.bottom.site)).filler;
  for (const [b, role, face] of [[top, 'top', 'floor'], [low, 'bottom', 'ceiling']]) {
    const d = b.drops.filter((x) => x.id === G.pit.id);
    assert.equal(d.length, 1, role + ' names the pit once');
    assert(b.holes.some((h) => h.connector === G.pit.id && h.face === face), role + ' cuts its ' + face);
    same(E.validate(b).errors.filter((e) => !/^no physical/.test(e)), []);
  }
  assert(low.voids.some((v) => v.id === 'void:' + G.pit.id), 'the lower claim keeps the shaft clear');
}
console.log('ok   a house growth: its stair carried up, floors over capped ground, three claims stacked in a column, a pit, and a walk to band 1 and back');

// A district is not kept inside its cell (or its block): a growth spreads
// into the cells round its origin that are nearer to it than to any other,
// and its doors across cell borders are matched like any other.
{
  const w = new BR.BandWorld(CROSS.seed), G = w.growth(0, CROSS.i, CROSS.j);
  const cells = [...new Set(G.sites.map((rs) => rs.i + ',' + rs.j))];
  assert(cells.length >= 2, 'its floors stand in several cells: ' + cells.join(' '));
  for (const c of cells) same(GROWTH.owner(w, 0, ...c.split(',').map(Number)), [CROSS.i, CROSS.j]);
  const across = G.conns.filter((cn) => cn.cells[0].join() !== cn.cells[1].join());
  assert(across.length >= 1, 'doors between its floors across cell borders');
  const g = w.graph(...span(G.cells), [0]);
  same(g.issues, []);
  for (const cn of across) assert(g.matches.some((m) => m.id === cn.id), cn.id + ' is matched across the border');
}
console.log('ok   a growth crosses cell borders: floors in several cells, doors across them matched');

// The ground plan is identical with and without growth, but for the house an
// origin cell places: a cell the growth spreads into keeps its sites, their
// floors and their rooms; only ceilings and the sites climbs land in change.
{
  const [i, j] = w7.growth(0, KNOWN.i, KNOWN.j).cells.find(([a, b]) => !GROWTH.isOrigin(w7, 0, a, b));
  const groundPlan = (W) => JSON.stringify(W.cell(i, j, 0).sites.map((s) => [s.id, s.kind, s.rects, s.conns, s.pois.map((P) => P.id)]));
  const built = (W, s) => { const r = W.build(s), f = r.filler; return JSON.stringify([f && f.filler, f && f.rooms.filter((q) => !String(q.id).startsWith('elev:')).map((q) => [q.id, q.rects, q.level || 0, q.floor || 0]), r.buildings.map((x) => [x.poi.id, x.b.footprint[0].rects])]); };
  const keep = GROWTH, without = {};
  let bare;
  BR.GROWTH = null;
  try {
    const W = new BR.BandWorld(KNOWN.seed);
    assert.equal(W.growth(0, i, j), null, 'without growth.js there is no growth');
    bare = groundPlan(W);
    for (const s of W.cell(i, j, 0).sites) without[s.id] = built(W, s);
  } finally { BR.GROWTH = keep; }
  same(groundPlan(w7), bare);
  for (const s of w7.cell(i, j, 0).sites) if (!w7.arrivalInto(s)) assert.equal(built(w7, s), without[s.id], s.id + ': the floors below a growth are the same with and without it');
}
console.log('ok   the ground plan and its floors are the same with and without growth, but for the house an origin cell places');

// A two-storey house's growth climbs on from its first level: the leg leaves
// from a floor far from the house, and its landing opens onto the next level,
// which stands over the rest of that floor and beyond; no climb stands over
// another (no shafts).
{
  const w = w7, G = w.growth(0, MULTI.i, MULTI.j);
  assert(G && G.archetype === 'two_storey', 'the known two-storey growth');
  same(G.levels.map((l) => l.floorZ), [6.5, 9.5]);
  assert(G.legs.length === 1 && G.arrival, 'a leg between its floors, and a climb to band 1');
  const host = G.sites.find((rs) => rs.leg && rs.level === 1), next = G.sites.find((rs) => rs.level === 2 && rs.over === host.id);
  assert(next && within(host.rects, next.rects) && next.rects.every((q) => !BR.TG.roverlap(q, host.leg.box)), 'the next level stands over the rest of the floor its leg climbs from');
  const boxes = G.sites.filter((rs) => rs.leg).map((rs) => rs.leg.box);
  assert.equal(boxes.length, 2);
  for (let p = 0; p < boxes.length; p++) for (let q = p + 1; q < boxes.length; q++) assert(!BR.TG.roverlap(boxes[p], boxes[q]), 'no climb stands over another');
  claimsOf(w, G);
  climbsToBand1(w, G);
}
console.log('ok   a two-storey growth: a leg up from its first level, no shafts, and a walk to band 1 and back');

// The growth is a function of (seed, band, origin cell): fresh worlds agree,
// caches may be evicted, and the export says the same thing in any order.
{
  const i = KNOWN.i, j = KNOWN.j, G = w7.growth(0, i, j);
  const expected = w7.exportRegion(i, j, i, j, [0]);
  assert.equal(expected.schema, 'br.world-elevation/0.3');
  assert.equal(expected.policy.verticalJourneys, 'grown'); assert.equal(expected.policy.layeredOwnership, 'stacked-claims');
  same(expected.policy.growth.biomes, ['houseroom']); same(expected.policy.growth.pillars, ['house']);
  assert.equal(expected.journeys, undefined, 'no journeys');
  const summary = expected.growths.find((x) => x.id === G.id);
  assert(summary && summary.arrival && summary.arrival.band === 'band:1' && summary.levels[0].floorZ === 9.5, 'the export lists the growth and where it arrives');
  const slice = expected.slices[0];
  assert.equal(slice.raised.length, G.sites.filter((rs) => rs.i === i && rs.j === j).length);
  for (const rs of slice.raised) {
    assert.equal(rs.biome, 'houseroom'); assert.equal(rs.level, 1);
    const under = slice.sites.find((s) => s.id === rs.over);
    assert(under && under.ceilingZ === rs.floorZ - E.SLAB, 'every slice says where one claim stops and the next begins');
  }
  // every layout's geometry fits the claim it was given
  for (const item of expected.layouts) {
    const r = expected.reservations.find((q) => q.owner === item.reservationOwner);
    assert(r, item.owner + ' has a claim');
    for (const v of item.blueprint.volumes) for (const q of v.rects) {
      const world = [q[0] + item.origin[0], q[1] + item.origin[1], q[2] + item.origin[0], q[3] + item.origin[1]];
      assert(r.volumes.some((e) => e.z0 <= v.z0 + 1e-7 && e.z1 >= v.z1 - 1e-7 && within(e.rects, [world])), item.owner + ': ' + v.id + ' fits its claim');
    }
  }
  // a climb whose other band is outside the export leaves its door there as a vertical frontier
  assert(expected.verticalFrontier.some((f) => f.band === 'band:1' && f.at[2] === 16), 'the climb to band 1 is a vertical frontier');
  const b = new BR.BandWorld(KNOWN.seed, { limits: { cells: 12, builds: 4 }, elevationLimits: { bands: 2, claims: 32, branches: 2, raised: 2 } });
  // asked for in another order, with everything evicted in between
  for (const s of b.cell(i, j, 1).sites.slice(0, 3)) b.build(s);
  for (const s of b.cell(i, j, 0).sites.slice().reverse()) b.build(s);
  for (const n of [4, -4]) for (const s of b.cell(i + 7, j - 5, n).sites.slice(0, 2)) b.build(s);
  same(b.exportRegion(i, j, i, j, [0]), expected);
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'ms' ? undefined : v)));   // (build times are diagnostics, not plan)
  same(strip(b.growth(0, i, j)), strip(G));
  assert(b.growths.size <= 2 && b.raisedBuilds.size <= 2 && b.worlds.size <= 2, 'growth caches stay bounded');
}
console.log('ok   growths, their claims and their exports are the same in fresh and evicting worlds, in any order');

// Across the bands too. The site a climb lands in is rebuilt from the band
// below's plan: built first, before anything of that band, in an evicting
// world, it still gives the same two-band export. And nothing built or
// exported afterwards writes into a planned growth or a cell plan (frozen,
// a write would throw).
{
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'ms' ? undefined : v)));
  const G = w7.growth(0, MULTI.i, MULTI.j), [ci, cj] = G.arrival.cell;
  const want = strip(w7.exportRegion(ci, cj, ci, cj, [0, 1]));
  const b = new BR.BandWorld(MULTI.seed, { limits: { cells: 12, builds: 4 }, elevationLimits: { bands: 2, claims: 32, branches: 2, raised: 2 } });
  b.setBand(1);
  b.spatial(b.site(G.arrival.ground));
  for (const s of b.cell(ci, cj, 1).sites) b.build(s);
  same(strip(b.exportRegion(ci, cj, ci, cj, [0, 1])), want);
  const freeze = (o, seen = new Set()) => { if (!o || typeof o !== 'object' || seen.has(o)) return; seen.add(o); Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k], seen); };
  const f = new BR.BandWorld(MULTI.seed), F = f.growth(0, MULTI.i, MULTI.j);
  for (const [i, j] of F.cells.concat([F.arrival.cell])) for (const n of [0, 1]) { const c = f.cell(i, j, n); for (const s of c.sites) f.fillerOf(s); freeze(c); }
  freeze(F);
  const [i0, j0, i1, j1] = span(F.cells.concat([F.arrival.cell]));
  same(f.exportRegion(i0, j0, i1, j1, [0, 1]).issues, []);
}
console.log('ok   a climb from the band below lands the same whichever band is built first, and building never writes into a plan');

// A level that cannot be built after the leg up to it was laid: the growth
// stops at the level below, that level's leg is undone (its floor rebuilt
// without the climb, its claim back to the band's ceiling), and what is left
// is as sound as any growth.
{
  const real = GROWTH.raisedSite;
  GROWTH.raisedSite = (rs, leg) => (!leg && rs.level === 2 ? null : real(rs, leg));
  try {
    const w = new BR.BandWorld(MULTI.seed), G = w.growth(0, MULTI.i, MULTI.j);
    assert(G && G.planned.length >= 2, 'it planned more than one level');
    assert.equal(G.levels.length, 1, 'it stops at its first level');
    same(G.legs, []); assert.equal(G.arrival, null, 'and does not arrive');
    for (const rs of G.sites) {
      assert.equal(rs.leg, null, rs.id + ' carries no leg');
      assert.equal(rs.top, CL, rs.id + ' claims up to the band\'s ceiling again');
      assert(!rs.b.portals.some((p) => p.connection === 'b0|' + MULTI.i + ',' + MULTI.j + ':l2'), rs.id + ' has no door onto the undone leg');
    }
    assert(!G.conns.some((cn) => /:l2$/.test(cn.id)), 'the undone leg is not a connection');
    const [i0, j0, i1, j1] = span(G.cells), g = w.graph(i0, j0, i1, j1, [0]);
    same(g.issues, []); same(g.unresolved, []);
    claimsOf(w, G);
    const start = g.navigation.nodes.find((n) => n.floorZ === 0 && n.id.startsWith(G.anchor + '/'));
    assert(G.sites.every((rs) => [...walk(g, start.id)].some((id) => id.startsWith(rs.owner + '/') || id.startsWith(rs.id + '/'))), 'every floor left is reached from the ground');
  } finally { GROWTH.raisedSite = real; }
}
console.log('ok   a level that cannot be built undoes the leg up to it');

// The levels a growth climbs through: from its first floor, legs of 3-6.5 m
// on the half metre, the last floor a storey under the band's ceiling and one
// leg under the next band. A steered growth always plans to arrive.
{
  const R = GROWTH.CFG.rise, top = CL - GROWTH.CFG.room;
  for (const z1 of [4.5, 5, 6.5, 9.5, 11.5]) for (let t = 0; t < 12; t++) {
    const plan = GROWTH.schedule(z1, new BR.Rng(BR.hash4(t, z1 * 2, 0x5c, 0)), true), zs = plan.zs;
    assert(plan.arrive && zs[0] === z1, 'steered: ' + zs);
    for (let k = 1; k < zs.length; k++) assert(zs[k] - zs[k - 1] >= R[0] - EPS && zs[k] - zs[k - 1] <= R[1] + EPS && Math.abs(zs[k] * 2 - Math.round(zs[k] * 2)) < EPS, String(zs));
    const last = zs[zs.length - 1];
    assert(last <= top + EPS && 16 - last <= R[1] + EPS && 16 - last >= R[0] - EPS, 'the last floor is within a leg of the next band: ' + zs);
  }
  same(GROWTH.schedule(9.5, new BR.Rng(1), true).zs, [9.5]);
  let short = 0;
  for (let t = 0; t < 40; t++) { const p = GROWTH.schedule(4.5, new BR.Rng(BR.hash4(t, 9, 0x5d, 0)), false); if (p.zs.length < 2 || !p.arrive) short++; }
  assert(short > 5 && short < 40, 'an unsteered growth stops short by chance: ' + short + ' of 40');
}
console.log('ok   the level schedule: exact legs on the half metre, a storey under the ceiling, the last within a leg of the next band');

// Every growth anywhere obeys the same rules. Origins: one cell a block of
// 2 x 2, by the seed, whose plan places the house that seeds it; ownership
// never shared. Floors over plain ground or the floor below (never a site a
// climb from below lands in, never a room cut down), from the biome's pool,
// inside their claims; legs exact, never stacked; arrivals into the sites kept
// for them only. Most growths are steered, and most blocks have a way up.
{
  const pool = new Set(BR.BIOME.templates('houseroom').map((a) => a.id)), fillers = new Set(BR.BIOME.fillers('houseroom').map((F) => F.id));
  const K = GROWTH.CFG.block;
  let origins = 0, growths = 0, steered = 0, arrived = 0, levels2 = 0, blocks = 0, reached = 0, plain = 0, kept = 0;
  for (const seed of MODE.size([7], [7, 31337, 99])) {
    const w = seed === 7 ? w7 : new BR.BandWorld(seed), owner = new Map(), byBlock = new Map();
    for (let i = -4; i <= 3; i++) for (let j = -4; j <= 3; j++) {
      const c = GROWTH.candidate(w, 0, i, j), key = Math.floor(i / K) + ',' + Math.floor(j / K);
      if (!byBlock.has(key)) byBlock.set(key, { origins: 0, way: false });
      // a house that seeds growth stands in an origin cell only, placed there by its plan
      const planted = w.cell(i, j, 0).pois.filter((P) => P.grows);
      assert(planted.length <= (c ? 1 : 0), i + ',' + j + ': a growth house only where the cell is its block\'s origin');
      // the sites band 1 keeps for arrivals: a few, round the houses below
      for (const s of w.cell(i, j, 1).sites) if (s.kind === 'filler' && !s.pois.length && !s.lots.length && s.area >= BR.BAND_CFG.branch.minArea) { plain++; if (GROWTH.landingSite(w, 1, s)) kept++; }
      if (!c) continue;
      origins++; byBlock.get(key).origins++;
      same(GROWTH.owner(w, 0, i, j), [i, j]);
      const G = w.growth(0, i, j);
      if (!G) continue;
      growths++; if (G.steered) steered++; if (G.arrival) { arrived++; byBlock.get(key).way = true; }
      if (G.levels.length > 1) levels2++;
      // ownership: its cells are its own, and its floors stand in them
      for (const cl of G.cells) { const k = cl.join(); assert(!owner.has(k), k + ' is owned twice'); owner.set(k, G.id); same(GROWTH.owner(w, 0, ...cl), [i, j]); }
      same(G.cells[0], [i, j]);
      for (const rs of G.sites) assert(G.cells.some((cl) => cl[0] === rs.i && cl[1] === rs.j), rs.id + ' stands in its growth\'s cells');
      // levels: on the half metre, each a leg above the last, the top one a storey under the band's ceiling
      const zs = G.levels.map((l) => l.floorZ);
      for (let k = 0; k < zs.length; k++) {
        assert(Math.abs(zs[k] * 2 - Math.round(zs[k] * 2)) < EPS && zs[k] <= CL - GROWTH.CFG.room + EPS, G.id + ': ' + zs);
        if (k) assert(zs[k] - zs[k - 1] >= GROWTH.CFG.rise[0] - EPS && zs[k] - zs[k - 1] <= GROWTH.CFG.rise[1] + EPS, G.id + ': ' + zs);
      }
      for (const rs of G.sites) {
        const below = G.sites.find((x) => x.id === rs.over), ground = below ? null : w.site(rs.over);
        if (below) assert(below.level === rs.level - 1 && within(below.rects, rs.rects) && below.top <= rs.floorZ - E.SLAB + EPS, rs.id + ' stands over the floor below');
        else {
          assert(ground && ground.kind === 'filler' && !ground.pois.length && !GROWTH.landingSite(w, 0, ground) && within(ground.rects, rs.rects), rs.id + ' stands over plain ground');
          // the ground keeps all its height: not one ceiling cut to fit under the floor
          const raw = w.worldFor(0).buildRaw(ground).filler;
          assert(BR.CLAIM.topOf(raw) <= rs.floorZ - E.SLAB + EPS, rs.id + ' stands over ' + ground.id + ' (' + raw.filler + ', ' + BR.CLAIM.topOf(raw) + ' m) without cutting it down');
        }
        const r = w.raisedBuild(rs), b = r.filler;
        assert(fillers.has(b.filler), rs.id + ': a ' + b.filler + ' is not a houseroom filler');
        const kinds = r.buildings.map((x) => x.poi.archetype);
        assert(kinds.every((a) => pool.has(a)) && new Set(kinds).size === kinds.length, rs.id + ': rooms from the pool, none twice: ' + kinds);
        for (const x of [b].concat(r.buildings.map((y) => y.b))) for (const s of x.surfaces) {
          if (String(s.room).startsWith('elev:landing:')) continue;
          assert(s.floorZ >= rs.floorZ - EPS && s.ceilingZ <= rs.top + EPS, rs.id + ' keeps inside its claim');
        }
        assert(rs.conns.every((cn) => b.portals.some((p) => p.connection === cn.id)), rs.id + ' built every connection it was given');
        if (rs.leg) {
          const c = b.connectors.find((x) => x.id.startsWith('elev:'));
          assert(Math.abs(c.landings[1][2] - c.landings[0][2] - rs.leg.rise) < EPS && Math.abs(c.landings[0][2] - rs.floorZ) < EPS, rs.id + ': an exact rise');
          assert(b.portals.some((p) => p.connection === rs.leg.conn), rs.id + ': its landing opens onto the next floor');
          same(E.validate(b).errors.filter((e) => !/^no physical/.test(e)), [], rs.id + ' with its climb is a valid blueprint');
        }
      }
      // legs never stand over one another
      const boxes = G.sites.filter((rs) => rs.leg).map((rs) => rs.leg.box);
      for (let p = 0; p < boxes.length; p++) for (let q = p + 1; q < boxes.length; q++) assert(!BR.TG.roverlap(boxes[p], boxes[q]), G.id + ': no shafts');
      for (const cp of G.caps) assert(!GROWTH.landingSite(w, 0, w.site(cp.site)), 'a landing site never has a growth over it');
      if (G.arrival) {
        const up = w.site(G.arrival.ground), from = G.sites.find((rs) => rs.id === G.arrival.site);
        assert(GROWTH.landingSite(w, 1, up) && GROWTH.kept(w, 0, i, j).includes(up) && from.level === G.levels.length, G.id + ' arrives from its top floor into a site kept for it');
        assert(G.arrival.rise >= GROWTH.CFG.rise[0] - EPS && G.arrival.rise <= GROWTH.CFG.rise[1] + EPS && Math.abs(from.floorZ + G.arrival.rise - 16) < EPS);
      }
    }
    for (const B of byBlock.values()) { assert.equal(B.origins, 1, 'every block has one origin'); blocks++; if (B.way) reached++; }
  }
  assert(growths >= 0.75 * origins && levels2 >= 2, 'most origins grow: ' + growths + ' of ' + origins + ', ' + levels2 + ' climbing to a second floor');
  assert(steered >= 0.5 * growths && arrived >= 0.6 * steered, 'steered growths mostly arrive: ' + arrived + ' of ' + steered);
  assert(reached >= 0.6 * blocks, 'most blocks have a way up: ' + reached + ' of ' + blocks);
  assert(kept > 0 && kept < 0.3 * plain, 'band 1 keeps a few plain sites for arrivals, not a share of them all: ' + kept + ' of ' + plain);
  console.log('ok   every growth: its own cells, floors over plain ground (cut down nowhere) or the floor below, its biome only, inside its claims, exact legs, no shafts (' +
    growths + ' growths from ' + origins + ' origins, ' + arrived + ' reach band 1, ' + reached + ' of ' + blocks + ' blocks with a way up; ' + kept + ' of ' + plain + ' plain sites kept for arrivals)');
}

// A tall room is never grown over unless it fits under the floor as it is:
// a filler that can be tall (a hall with a gallery) is tagged so, and every
// other filler stays low enough that no floor of a growth ever reaches it.
{
  const tagged = BR.FILL.list().filter((F) => F.tall).map((F) => F.id).sort();
  same(tagged, BR.FILL.list().filter((F) => F.floors && F.floors.gallery).map((F) => F.id).sort(), 'every filler with a gallery is tagged tall');
  const w = new BR.BandWorld(31337);
  let tops = 0;
  for (let i = -2; i <= 1; i++) for (let j = -2; j <= 1; j++) for (const s of w.cell(i, j, 0).sites) {
    if (s.kind !== 'filler' || GROWTH.tall(w, s)) continue;
    const r = w.worldFor(0).buildRaw(s);
    if (r.filler && !r.filler.error) { tops++; assert(BR.CLAIM.topOf(r.filler) <= 4.5, s.id + ': a ' + r.filler.filler + ' reaches ' + BR.CLAIM.topOf(r.filler) + ' m'); }
  }
  assert(tops > 100);
  // the check itself: a site that would have to lose height is refused
  const hall = (h) => ({ rooms: [{ id: 'r0', ceiling: h, rects: [[0, 0, 4, 4]] }], levels: [{ index: 0, elevation: 0 }] });
  assert.equal(BR.CLAIM.topOf(hall(6.1)), 6.1);
  assert.equal(BR.CLAIM.topOf({ rooms: [{ id: 'g', level: 1, ceiling: 2.6, rects: [] }], levels: [{ index: 0, elevation: 0 }, { index: 1, elevation: 3.5 }] }), 6.1);
  console.log('ok   tall fillers are tagged, every other filler stays under 4.5 m, and a site that would lose height is never grown over');
}

// A raised floor that cannot be built is dropped with everything grown from
// it, the rest wired and built again.
{
  const full = w7.growth(0, KNOWN.i, KNOWN.j), first = full.sites.filter((rs) => rs.level === 1);
  const victim = first.find((rs) => rs.parent >= 0 && first.some((c) => c.parent === rs.k)) || first.find((rs) => rs.parent >= 0);
  const lost = new Set([victim.k]);
  for (const rs of first) if (lost.has(rs.parent)) lost.add(rs.k);
  const real = GROWTH.raisedSite;
  GROWTH.raisedSite = (rs, leg) => (rs.k === victim.k && !leg ? null : real(rs, leg));
  try {
    const f = new BR.BandWorld(KNOWN.seed), G = f.growth(0, KNOWN.i, KNOWN.j), kept = G.sites.filter((rs) => rs.level === 1);
    same(kept.map((rs) => rs.k), first.filter((rs) => !lost.has(rs.k)).map((rs) => rs.k), 'the failed floor and its subtree are gone, the rest stand');
    for (const cn of G.conns) assert(G.sites.some((rs) => cn.a === rs.id || cn.b === rs.id), cn.id + ' joins a floor that stands');
    for (const rs of G.sites) assert(rs.conns.every((cn) => G.conns.includes(cn)) && rs.conns.every((cn) => rs.b.portals.some((p) => p.connection === cn.id)), rs.id + ' builds exactly its doors');
    same(G.over.slice().sort(), [...new Set(G.sites.filter((rs) => rs.ground).map((rs) => rs.ground))].sort());
  } finally { GROWTH.raisedSite = real; }
  console.log('ok   a raised floor that cannot be built goes with its subtree, the rest rewired');
}
console.log('All band-world checks passed.');
