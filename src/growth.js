/*
 * growth.js - recursive growth between bands (growth design, step 3).
 *
 * The climb from one band to the next is not a plot any more: it is grown.
 * A growth starts at a pillar in one cell (its origin), spreads a branch of
 * its biome at the pillar's floor, and climbs on from that branch by short
 * legs, a floor at each, until it stops or reaches the next band's floor.
 *
 *   origins    a cell is an origin when a house in it seeds growth (biomes.js:
 *              its stairwell carried on up, claims.js), or when it is its
 *              block's stair cell: every block of 4 x 4 cells has one cell,
 *              by the seed, that grows from a plain ground site whose filler
 *              takes a stair up (a stair pillar). At most one growth per cell.
 *   ownership  a growth spreads over its own cell and the cells round it that
 *              have no origin of their own and whose top-priority origin
 *              neighbour it is. Cells, and so regions, are no border to it.
 *   levels     the pillar's floor, then floors at 3-6.5 m steps, the last low
 *              enough to keep a storey under the band's ceiling and within
 *              one leg of the next band's floor. Each leg is a stair, ramp or
 *              ladder with an exact rise (connections.js), in a site of the
 *              level below; its landing opens onto the next level's first
 *              site, which stands over that site less the climb. Higher levels
 *              grow over the level below and over plain ground beside it.
 *   arrival    the last leg climbs from the top level to the next band's
 *              floor and lands in one of that band's landing sites (a share of
 *              plain sites no growth ever stands over), which is rebuilt round
 *              the climb with a door onto the landing. Nothing else marks it.
 *   steering   every block's stair cell, and a share of the houses, are
 *              steered: they always climb on and try to arrive. The rest climb
 *              each further level by chance. So ways up are spread over the
 *              world, at least one tried per block, and many more grow.
 *
 * Everything is planned from cell plans and raw builds alone (never a cached,
 * finished build), so a growth is a pure function of (seed, band, origin)
 * and the same in any order. Planning a growth needs the cell plans two cells
 * round its origin, and the next band's cell plans under its top level.
 *
 *   GROWTH.candidate(W, n, i, j)   is cell (i, j) of band n an origin? { houses, stair, p } or null
 *   GROWTH.owner(W, n, i, j)       the origin whose growth may use the cell, or null
 *   GROWTH.plan(W, n, i, j)        the growth from origin (i, j), or null (band-world.js caches it)
 *   GROWTH.landingSite(W, n, s)    is a ground site kept for arrivals from below?
 *   GROWTH.schedule(z1, rng, steered)   the levels a growth climbs through
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG;
  const EPS = 1e-7, clone = (v) => JSON.parse(JSON.stringify(v)), round = (n) => Math.round(n * 1000) / 1000;
  const CFG = {
    block: 4,              // cells a side of a block, each with one steered stair cell
    steer: 0.5,            // share of house growths steered as well
    carry: 0.5,            // chance an unsteered growth climbs on, each level
    landings: 0.4,         // share of plain ground sites kept for arrivals from below
    rise: [3, 6.5],        // a leg climbs this much
    room: 2.75,            // clear height every level keeps under the one above (or the band's ceiling)
    stair: [4.5, 6.5],     // a stair pillar's first floor
    tries: 4               // sites tried for a leg or an arrival, per level
  };
  const GROWTH = BR.GROWTH = { CFG };
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const shift = (q, o) => [q[0] + o[0], q[1] + o[1], q[2] + o[0], q[3] + o[1]];
  const unshift = (q, o) => [q[0] - o[0], q[1] - o[1], q[2] - o[0], q[3] - o[1]];
  const inAny = (rects, r) => rects.some((q) => TG.rcontains(q, r));
  const subtract = (rects, box) => rects.flatMap((q) => TG.rsub(q, box)).map((q) => q.map(round));
  const area = (rects) => rects.reduce((a, q) => a + TG.rarea(q), 0);
  const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const B = () => BR.BAND_CFG;

  // ------------------------------------------------------------ origins and ownership
  /** the seed of band n's own world (band-world.js uses the same) */
  const bandSeed = (W, n) => (n === 0 ? W.seed : BR.hash4(W.seed, n, 0, 0xba01));
  const floorDiv = (a, b) => Math.floor(a / b);
  /** the stair cell of block (bi, bj) in band n */
  GROWTH.stairCell = (W, n, bi, bj) => {
    const h = BR.hash4(bandSeed(W, n), bi, bj, 0xb10c), k = CFG.block;
    return [bi * k + (h % k), bj * k + ((h >>> 8) % k)];
  };
  /** a plain ground site: a filler with nothing in it, big enough to grow over */
  const plainGround = (s) => s.kind === 'filler' && !s.pois.length && !s.lots.length && s.area >= B().branch.minArea;
  /** a band's landing sites: a share of its plain sites, kept for arrivals from the band below */
  GROWTH.landingSite = (W, n, s) => plainGround(s) && BR.hash4(s.seed >>> 0, n, 0xa441, 0) / 4294967296 < CFG.landings;
  /** may a growth stand over this ground site? */
  const growable = (W, n, s) => plainGround(s) && !GROWTH.landingSite(W, n, s);

  /** is cell (i, j) of band n an origin? Its seeding houses (lot ids), whether it is its block's stair cell, and its priority */
  GROWTH.candidate = function candidate(W, n, i, j) {
    const v = BR.World.lru(W.candidates, n + '|' + i + ',' + j, W.limits.claims, () => {
      const BN = B().branch, houses = [], cell = W.cell(i, j, n);
      for (const L of cell.lots.filter((x) => x.kind === 'yard' && x.b && !x.b.error).sort((a, b) => a.pois[0].id.localeCompare(b.pois[0].id))) {
        const P = L.pois[0];
        if (!BR.BIOME.anchorOf(BR.TPL.archetypes[P.archetype]) || !W.seedsGrowth(n, i, j, P)) continue;
        const z = BR.CLAIM.pillarFloor(L.b, BN.rise);
        if (z === null || z > B().ceilingLimit - BN.headroom + EPS) continue;
        houses.push(P.id);
      }
      const sc = GROWTH.stairCell(W, n, floorDiv(i, CFG.block), floorDiv(j, CFG.block)), stair = sc[0] === i && sc[1] === j;
      if (!houses.length && !stair) return false;
      return { i, j, houses, stair, p: BR.hash4(bandSeed(W, n), i, j, 0xb10b) / 4294967296 };
    });
    return v || null;
  };
  const better = (a, b) => !b || a.p > b.p || (a.p === b.p && (a.i < b.i || (a.i === b.i && a.j < b.j)));
  /** the origin whose growth may use cell (i, j): its own when it is one, else its top-priority origin neighbour */
  GROWTH.owner = function owner(W, n, i, j) {
    const own = GROWTH.candidate(W, n, i, j);
    if (own) return [i, j];
    let best = null;
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      const c = (a !== i || b !== j) && GROWTH.candidate(W, n, a, b);
      if (c && better(c, best)) best = c;
    }
    return best ? [best.i, best.j] : null;
  };
  /** the cells a growth from (i, j) may use, its own first */
  GROWTH.cells = function cells(W, n, i, j) {
    const out = [[i, j]];
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      if (a === i && b === j) continue;
      const o = GROWTH.owner(W, n, a, b);
      if (o && o[0] === i && o[1] === j) out.push([a, b]);
    }
    return out;
  };
  /** is the growth from origin c steered (it always climbs on and tries to arrive)? */
  GROWTH.steered = (W, n, c) => c.stair || BR.hash4(bandSeed(W, n), c.i, c.j, 0xb10d) / 4294967296 < CFG.steer;

  /**
   * The levels a growth climbs through from its first floor z1 (metres over its
   * band): each the next leg's rise above the last, on the half metre, the
   * last low enough to keep `room` under the band's ceiling and within one leg
   * of the next band's floor. { zs, arrive } - an unsteered growth stops at
   * each level, and short of arriving, by chance.
   */
  GROWTH.schedule = function schedule(z1, rng, steered) {
    const top = B().ceilingLimit - CFG.room, R = CFG.rise, next = B().spacing, zs = [z1];
    for (let guard = 0; guard < 8; guard++) {
      const z = zs[zs.length - 1];
      if (next - z <= R[1] + EPS && z <= top + EPS && next - z >= R[0] - EPS) break;
      const lo = z + R[0], hi = Math.min(top, z + R[1]);
      if (hi < lo - EPS) return { zs, arrive: false };
      // within one leg of the next band if it can be, else as high as one leg goes
      const a = Math.max(lo, next - R[1]), from = a <= hi + EPS ? a : lo;
      const steps = Math.floor((hi - from) * 2 + EPS);
      zs.push(Math.ceil(from * 2 - EPS) / 2 + rng.int(0, Math.max(0, steps)) / 2);
      if (zs[zs.length - 1] > hi + EPS) zs[zs.length - 1] = Math.floor(hi * 2 + EPS) / 2;
    }
    if (steered) return { zs, arrive: true };
    let k = 1;
    while (k < zs.length && rng.f() < CFG.carry) k++;
    return { zs: zs.slice(0, k), arrive: k === zs.length && rng.f() < CFG.carry };
  };

  // ------------------------------------------------------------ a leg
  /** the climb a variant added: its connector, landing room, and footprint (its frame) */
  function legOf(v) {
    const c = v.connectors.find((x) => String(x.id).startsWith('elev:')), landing = v.rooms.find((r) => String(r.id).startsWith('elev:landing:'));
    const rects = BR.ELEV.reservationsOf(c).flatMap((x) => x.rects);
    return { c, landing, L: landing.rects[0], rects, box: TG.bbox(rects.concat([landing.rects[0]])).map(round) };
  }
  /** does rect r lie just outside side `side` of q, touching it along that side? */
  function against(q, side, r) {
    if (side === 'N') return Math.abs(r[3] - q[1]) < EPS && r[0] < q[2] - EPS && r[2] > q[0] + EPS;
    if (side === 'S') return Math.abs(r[1] - q[3]) < EPS && r[0] < q[2] - EPS && r[2] > q[0] + EPS;
    if (side === 'W') return Math.abs(r[2] - q[0]) < EPS && r[1] < q[3] - EPS && r[3] > q[1] + EPS;
    return Math.abs(r[0] - q[2]) < EPS && r[1] < q[3] - EPS && r[3] > q[1] + EPS;
  }
  const edgeOf = (q, side) => (side === 'N' ? [[q[0], q[1]], [q[2], q[1]]] : side === 'S' ? [[q[0], q[3]], [q[2], q[3]]] : side === 'W' ? [[q[0], q[1]], [q[0], q[3]]] : [[q[2], q[1]], [q[2], q[3]]]);
  /** the 1 m strip just beyond a side of the landing */
  const outStrip = (L, side) => (side === 'N' ? [L[0], L[1] - 1, L[2], L[1]] : side === 'S' ? [L[0], L[3], L[2], L[3] + 1] : side === 'W' ? [L[0] - 1, L[1], L[0], L[3]] : [L[2], L[1], L[2] + 1, L[3]]);
  /** a doorway in the landing's wall on that side, with a portal onto `conn` */
  function openLanding(v, leg, side, conn) {
    const [a, b] = edgeOf(leg.L, side);
    const w = v.walls.find((x) => (x.rooms || []).includes(leg.landing.id) && [x.a, x.b].every((p) => [a, b].some((q) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS)));
    if (!w) return null;
    const op = { id: 'elev:o:exit', wall: w.id, kind: 'opening', a: a.slice(), b: b.slice(), width: round(Math.hypot(b[0] - a[0], b[1] - a[1])), rooms: [leg.landing.id, null], height: 2.2, floorZ: leg.landing.floorZ, portal: 'elev:p:exit', tags: ['growth'] };
    v.openings.push(op);
    v.portals.push({ id: 'elev:p:exit', opening: op.id, room: leg.landing.id, role: 'exit', kind: 'opening', side, width: op.width, clear: op.width, main: false, connection: conn, tags: ['growth'] });
    BR.ELEV.refresh(v, { deferCapabilities: true, zones: v.connectionZones });
    return op;
  }
  /**
   * A climb up from blueprint f (a template, its own frame): a stair, ramp or
   * ladder rising exactly `rise`, inside `within` when given, whose landing
   * opens on a free side onto `next` (the rects of the floor it arrives on,
   * same frame) and leaves at least `minArea` of it round the climb.
   * { v (prepared, the landing's doorway bound to `conn`), leg, side, type } or null.
   */
  function climb(f, o) {
    const E = BR.ELEV, types = [...new Set(E.preferenceOf(f).concat('ladder'))].filter((t) => !o.types || o.types.includes(t));
    for (const type of types) {
      let v;
      try { v = E.connectionVariant(f, { direction: 'up', type, rise: o.rise, fillId: o.fillId, deferCapabilities: true, within: o.within || undefined }); } catch (err) { continue; }
      const leg = legOf(v);
      const rest = subtract(o.next, leg.box);
      if (area(rest) < o.minArea - EPS) continue;
      // a free side: not where the flight arrives, the floor above just beyond it
      const sides = ['N', 'E', 'S', 'W'].filter((sd) => !leg.rects.some((q) => against(leg.L, sd, q)) && inAny(rest, outStrip(leg.L, sd)));
      if (!sides.length) continue;
      const side = sides[(o.seed >>> 0) % sides.length];
      if (!openLanding(v, leg, side, o.conn)) continue;
      return { v, leg, side, type };
    }
    return null;
  }
  /** how high a climb reaches in a placed blueprint: its landing's ceiling, or its reservations' top */
  function climbTop(b) {
    const E = BR.ELEV, c = b.connectors.find((x) => String(x.id).startsWith('elev:'));
    return round(Math.max(...b.surfaces.filter((v) => String(v.room).startsWith('elev:landing:')).map((v) => v.ceilingZ), ...E.reservationsOf(c).map((v) => v.z1)));
  }
  /** the connection a landing's doorway makes onto the floor beside it (world metres) */
  function legConn(id, Lw, side, from, to, floorZ, cells) {
    const [a, b] = edgeOf(Lw, side), horiz = side === 'N' || side === 'S', lowFrom = side === 'E' || side === 'S';
    return { id, o: horiz ? 'h' : 'v', c: horiz ? a[1] : a[0], s0: horiz ? a[0] : a[1], s1: horiz ? b[0] : b[1], floorZ,
      a: lowFrom ? from : to, b: lowFrom ? to : from, route: true, cross: false, cells };
  }

  // ------------------------------------------------------------ a raised floor
  /** a connection as the site on one side of it sees it (that site's frame) */
  const connView = (cn, siteId, origin) => {
    const low = cn.a === siteId;
    return { id: cn.id, side: cn.o === 'v' ? (low ? 'E' : 'W') : (low ? 'S' : 'N'),
      at: cn.s0 - (cn.o === 'h' ? origin[0] : origin[1]), width: cn.s1 - cn.s0, line: cn.c - (cn.o === 'h' ? origin[1] : origin[0]), kind: 'opening', route: cn.route };
  };
  GROWTH.connView = connView;
  /**
   * A raised site's floor, of its growth's biome: a biome filler with the
   * biome's rooms standing inside it (BIOME.furnish, LOT.build), every ceiling
   * under `rs.clear`, placed at its floor. With `leg`, its filler also takes
   * the climb to the floor above: { rise, within, next (world rects), conn,
   * band (the band the landing is in) }. The pool's picks, then every biome
   * filler in turn; a site too tight for its rooms is a district hallway with
   * none. Every door it was given is honoured.
   * { b, fillerOrigin, buildings, leg: { box, L, side, type, rise } (world) } or null.
   */
  GROWTH.raisedSite = function raisedSite(rs, leg) {
    const E = BR.ELEV, D = BR.BIOME.DEFS[rs.biome], room = rs.clear;
    const rects = rs.rects.map((q) => unshift(q, rs.origin));
    const conns = rs.conns.map((cn) => connView(cn, rs.id, rs.origin));
    const range = D.rooms[Math.min(rs.hop, D.rooms.length - 1)], count = new BR.Rng(BR.hash4(rs.seed, 0xba0a, 0, 0)).int(range[0], range[1]);
    const rooms = BR.BIOME.furnish({ biome: rs.biome, site: { rects }, conns, count, seed: rs.seed });
    const weights = BR.BIOME.fillerWeights(rs.biome), pool = BR.BIOME.fillers(rs.biome).map((F) => F.id);
    // (FILL.pick falls back to a passage when nothing weighted fits: only the biome's own are tried)
    const ids = [...new Set([0, 1, 2, 3].map((t) => BR.FILL.pick({ seed: BR.hash4(rs.seed, t, 0, 0xba07), site: { rects }, weights })).concat(pool))].filter((f) => pool.includes(f));
    const isLanding = (v) => String(v.room).startsWith('elev:landing:');
    const fits = (a) => a.surfaces.every((v) => isLanding(v) || (v.floorZ >= -EPS && v.ceilingZ <= room + EPS));
    // (with a climb: a stair or ramp anywhere it fits before a ladder anywhere)
    for (const types of leg ? [['stair', 'ramp'], ['ladder']] : [null]) for (const list of rooms.length ? [rooms, []] : [[]]) for (const [t, filler] of ids.entries()) {
      const r = BR.LOT.build({ seed: BR.hash4(rs.seed, t, list.length, 0xba07), site: { rects }, filler, connections: clone(conns), buildings: list, floors: false });
      // (LOT falls back to a warren when a filler fails: not this biome's)
      if (!r.setting || r.setting.error || r.setting.filler !== filler || r.conns.length !== conns.length) continue;
      // every ceiling under the floor above
      if (!E.capCeilings(r.setting, room) || r.buildings.some((x) => !E.capCeilings(x.b, room))) continue;
      const fo = [rs.origin[0] + r.at[0], rs.origin[1] + r.at[1]];
      let a, up = null;
      if (leg) {
        up = climb(r.setting, { rise: leg.rise, fillId: rs.owner, within: leg.within && leg.within.map((q) => unshift(q, fo)), next: leg.next.map((q) => unshift(q, fo)),
          minArea: leg.minArea, conn: leg.conn.id, seed: BR.hash4(rs.seed, t, 0xba0b, 0), types });
        if (!up) continue;
        a = up.v;
      } else a = E.prepare(r.setting, { fillId: rs.owner, deferCapabilities: true });
      if (!fits(a) || conns.some((c) => !a.portals.some((p) => p.connection === c.id))) continue;
      // every room's own doors open onto the filler round it
      if (r.buildings.some((x) => Object.values(x.conns).some((id) => !a.portals.some((p) => p.connection === id)))) continue;
      const buildings = r.buildings.map((x) => ({ x, a: E.prepare(x.b, { fillId: rs.owner + '/' + x.id, deferCapabilities: true }) }));
      if (!buildings.every((y) => fits(y.a))) continue;
      const place = BR.placeElevationBlueprint, b = place(a, rs.floorZ, rs.band, leg ? leg.band : rs.band);
      return { b, fillerOrigin: fo,
        buildings: buildings.map(({ x, a: pb }) => ({ poi: { id: x.id, archetype: x.b.archetype, name: String(x.b.name).replace(/, alone$/, ''), biome: rs.biome },
          origin: [rs.origin[0] + x.origin[0], rs.origin[1] + x.origin[1]], b: place(pb, rs.floorZ, rs.band, rs.band), conns: { ...x.conns } })),
        leg: up && { box: shift(up.leg.box, fo), L: shift(up.leg.L, fo), side: up.side, type: up.type, rise: leg.rise, top: climbTop(b) } };
    }
    return null;
  };

  // ------------------------------------------------------------ pillars
  /**
   * The house pillar (growth step 2): a seeding house in the origin cell
   * carries its stairwell one flight on up to a landing at its lot edge, whose
   * door opens onto a plain ground site the growth may use.
   */
  function housePillar(W, n, c, ok) {
    const BN = B().branch, cell = W.cell(c.i, c.j, n), base = n * B().spacing;
    for (const L of cell.lots.filter((x) => x.kind === 'yard' && x.pois.length && c.houses.includes(x.pois[0].id)).sort((a, b) => a.pois[0].id.localeCompare(b.pois[0].id))) {
      const P = L.pois[0], host = cell.sites.find((s) => s.kind === 'lot' && s.lots.includes(L)), stair = BR.CLAIM.stairTop(L.b);
      if (!host || !stair) continue;
      const z = BR.CLAIM.pillarFloor(L.b, BN.rise), cap = base + z - BR.ELEV.SLAB, o = P.origin;
      for (const side of stair.sides) {
        const reach = side === 'E' ? L.rect[2] - (o[0] + stair.rect[2]) : side === 'W' ? (o[0] + stair.rect[0]) - L.rect[0]
          : side === 'S' ? L.rect[3] - (o[1] + stair.rect[3]) : (o[1] + stair.rect[1]) - L.rect[1];
        if (!(reach >= BN.reach[0] - EPS && reach <= BN.reach[1] + EPS)) continue;
        const raise = BR.CLAIM.raiseStair(L.b, { z, side, reach, width: BN.door });
        if (!raise) continue;
        // the door it opens, in world metres, and the ground site it leads onto
        const d = raise.door, horiz = d.o === 'h', line = d.c + (horiz ? o[1] : o[0]);
        const s0 = d.s0 + (horiz ? o[0] : o[1]), s1 = d.s1 + (horiz ? o[0] : o[1]);
        // a floor is built on the half metre: a door off the grid could never be met exactly
        if ([line, s0, s1].some((v) => Math.abs(v * 2 - Math.round(v * 2)) > EPS)) continue;
        const onEdge = (s) => s.rects.some((q) => horiz ? Math.abs(q[side === 'S' ? 1 : 3] - line) < EPS && q[0] <= s0 + EPS && q[2] >= s1 - EPS
          : Math.abs(q[side === 'E' ? 0 : 2] - line) < EPS && q[1] <= s0 + EPS && q[3] >= s1 - EPS);
        // (a lot keeps its margin inside its cell: the site beyond its edge is in the cell too)
        const first = cell.sites.find((s) => ok(s) && onEdge(s));
        if (!first || !W.keepsUnder(first, cap - base)) continue;
        return { kind: 'house', z, P, host, side, reach, raise, door: { o: d.o, c: line, s0, s1 }, first };
      }
    }
    return null;
  }
  /**
   * The stair pillar of a block's stair cell: a plain ground site whose own
   * filler takes a stair (or ramp, or ladder) up to a landing, the growth's
   * first floor standing over the rest of that site.
   */
  function stairPillar(W, n, c, ok) {
    const E = BR.ELEV, w = W.worldFor(n), base = n * B().spacing, cell = W.cell(c.i, c.j, n);
    const list = cell.sites.filter(ok).sort((a, b) => BR.hash4(a.seed >>> 0, 0xb10e, 0, 0) - BR.hash4(b.seed >>> 0, 0xb10e, 0, 0) || a.id.localeCompare(b.id));
    for (const G of list.slice(0, CFG.tries)) {
      const r = w.buildRaw(G);
      if (!r.filler || r.filler.error || r.buildings.length || r.issues.length) continue;
      const top = Math.max(...E.prepare(r.filler, { deferCapabilities: true }).surfaces.map((s) => s.ceilingZ));
      const z1 = Math.max(CFG.stair[0], Math.ceil((top + E.SLAB) * 2 - EPS) / 2);
      if (z1 > CFG.stair[1] + EPS) continue;
      const conn = 'b' + n + '|' + c.i + ',' + c.j + ':l1';
      const up = climb(clone(r.filler), { rise: z1, fillId: G.id, next: G.rects.map((q) => unshift(q, r.fillerOrigin)), minArea: B().branch.minArea, conn, seed: G.seed });
      if (!up) continue;
      const b = BR.placeElevationBlueprint(up.v, base, n, n);
      return { kind: 'stair', z: z1, site: G, b, fillerOrigin: r.fillerOrigin.slice(), conn,
        leg: { box: shift(up.leg.box, r.fillerOrigin), L: shift(up.leg.L, r.fillerOrigin), side: up.side, type: up.type, rise: z1, top: climbTop(b) } };
    }
    return null;
  }

  // ------------------------------------------------------------ the plan
  /**
   * The growth from origin cell (i, j) of band n, or null. See the top of the
   * file. Raw builds only, so planning never waits on a cached one.
   */
  GROWTH.plan = function plan(W, n, i, j) {
    const c = GROWTH.candidate(W, n, i, j);
    if (!c) return null;
    const E = BR.ELEV, BC = B(), BN = BC.branch, base = n * BC.spacing, SLAB = E.SLAB, ws = bandSeed(W, n);
    const id = 'growth:' + n + ':' + i + ',' + j, pre = 'b' + n + '|' + i + ',' + j + ':';
    const allowed = GROWTH.cells(W, n, i, j), mine = new Set(allowed.map((q) => q.join(',')));
    const cellOf = (s) => [s.i, s.j];
    const ok = (s) => mine.has(s.i + ',' + s.j) && growable(W, n, s);
    const steered = GROWTH.steered(W, n, c);
    const pillar = (c.houses.length && housePillar(W, n, c, ok)) || (c.stair && stairPillar(W, n, c, ok)) || null;
    if (!pillar) return null;
    const rng = new BR.Rng(BR.hash4(ws, i, j, 0xba09));
    const { zs, arrive } = GROWTH.schedule(pillar.z, rng, steered);
    // steering: where it means to arrive, the top level grows toward the next
    // band's landing sites (how much of them a floor would stand under)
    const landings = arrive ? allowed.flatMap(([a, b]) => W.cell(a, b, n + 1).sites).filter((s) => GROWTH.landingSite(W, n + 1, s)).flatMap((s) => s.rects) : [];
    const under = (rects) => rects.reduce((t, q) => t + landings.reduce((u, r) => u + overlapArea(q, r), 0), 0);
    const biome = pillar.kind === 'house' ? BR.BIOME.anchorOf(BR.TPL.archetypes[pillar.P.archetype]) : 'houseroom';
    const used = new Set(), sites = [], conns = [], legs = [];
    if (pillar.kind === 'house') used.add(pillar.first.id); else used.add(pillar.site.id);
    // ---- the door onto the first level: the house landing's, or the stair pillar's landing doorway
    let entry;
    if (pillar.kind === 'house') {
      const d = pillar.door, far = pillar.side === 'E' || pillar.side === 'S';
      entry = { door: { id: pre + 'x0', o: d.o, c: d.c, s0: d.s0, s1: d.s1, floorZ: base + zs[0], route: true, cross: false }, from: pillar.host, far };
    }
    let k = 0;                                   // raised sites so far (their ids run on across levels)
    let below = null;                            // the level under the one being grown: its sites
    let first = pillar.kind === 'house'
      ? { rects: clone(pillar.first.rects), over: pillar.first.id, ground: pillar.first, cell: cellOf(pillar.first) }
      : { rects: subtract(pillar.site.rects, pillar.leg.box), over: pillar.site.id, ground: pillar.site, cell: cellOf(pillar.site),
        arrive: { conn: pillar.conn, L: pillar.leg.L, side: pillar.leg.side, from: pillar.site.id, cell: cellOf(pillar.site) } };
    const levels = [];
    for (let lv = 0; lv < zs.length; lv++) {
      const z = zs[lv], floorZ = base + z, nextZ = lv + 1 < zs.length ? zs[lv + 1] : null;
      // the clear height every floor of the level keeps: to the next level's slab, or the band's ceiling
      const clear = round((nextZ !== null ? nextZ - SLAB : BC.ceilingLimit) - z), cap = floorZ - SLAB;
      const lrng = new BR.Rng(BR.hash4(ws, i, j, 0xba0c ^ Math.imul(lv + 1, 0x9e3779b1)));
      const aiming = arrive && lv === zs.length - 1;
      const want = Math.max(lrng.int(BN.sites[0], BN.sites[1]), aiming ? BN.sites[1] - 1 : 0);
      // the level's floors: the first, then neighbours sharing an edge: the
      // level below's floors (stacked over them), and plain ground beside it
      const pool = () => (below || []).filter((t) => !t.covered).map((t) => ({ rects: t.rects, over: t.id, ground: null, cell: [t.i, t.j], raised: t }))
        .concat(allowed.flatMap(([a, b]) => W.cell(a, b, n).sites).filter((s) => ok(s) && !used.has(s.id)).map((s) => ({ rects: s.rects, over: s.id, ground: s, cell: cellOf(s) })));
      const grown = [first], parent = [-1], hop = [0];
      let total = area(first.rects);
      if (first.raised) first.raised.covered = true;
      for (let q = 0; q < grown.length && grown.length < want; q++) {
        const next = pool().filter((x) => !grown.some((g) => g.over === x.over) && sharedEdge(grown[q].rects, x.rects, BN.minShared)).sort((a, b) => a.over.localeCompare(b.over));
        for (let t = next.length - 1; t > 0; t--) { const r = lrng.int(0, t); [next[t], next[r]] = [next[r], next[t]]; }
        if (aiming) next.sort((a, b) => under(b.rects) - under(a.rects));
        for (const x of next) {
          if (grown.length >= want || grown.some((g) => g.over === x.over) || total + area(x.rects) > BN.area) continue;
          if (x.ground && (used.has(x.ground.id) || !W.keepsUnder(x.ground, cap - base))) continue;
          grown.push(x); parent.push(q); hop.push(hop[q] + 1); total += area(x.rects);
          if (x.ground) used.add(x.ground.id);
          if (x.raised) x.raised.covered = true;
        }
      }
      const all = grown.map((g, q) => {
        const kk = k + q, bb = TG.bbox(g.rects);
        return { id: 'b' + n + '|' + g.cell[0] + ',' + g.cell[1] + ':raised' + (lv + 1) + '.' + kk, owner: id + ':' + (lv + 1) + '.' + kk, kind: 'branch', growth: id,
          band: n, i: g.cell[0], j: g.cell[1], level: lv + 1, k: kk, hop: hop[q], parent: parent[q] < 0 ? -1 : k + parent[q], biome,
          over: g.over, ground: g.ground ? g.ground.id : null, rects: clone(g.rects), bbox: bb, origin: [bb[0], bb[1]], area: area(g.rects), floorZ, clear,
          top: base + BC.ceilingLimit, openness: g.ground ? g.ground.openness : 0.5,
          seed: BR.hash4(ws, i, j, 0xba06 ^ Math.imul(kk + 1, 0x9e3779b1)), conns: [],
          // (standing over the whole of a ground site, not what a climb leaves of one)
          whole: !!g.ground && !(q === 0 && first.arrive) };
      });
      k += all.length;
      // the way in: the house landing's door (level 1), or the landing of the leg below
      const head = all[0], inbound = lv === 0 && pillar.kind === 'house'
        ? { ...entry.door, a: entry.far ? entry.from.id : head.id, b: entry.far ? head.id : entry.from.id, cells: [cellOf(entry.from), [head.i, head.j]] }
        : legConn(first.arrive.conn, first.arrive.L, first.arrive.side, first.arrive.from, head.id, floorZ, [first.arrive.cell, [head.i, head.j]]);
      const wire = (live) => {
        const out = [inbound];
        for (const rs of live) {
          rs.conns = [];
          if (rs.parent < 0) continue;
          const up = live.find((x) => x.k === rs.parent), e = sharedEdge(up.rects, rs.rects, BN.minShared);
          const width = Math.min(BN.door, e.s1 - e.s0 - 2), at = Math.round(((e.s0 + e.s1 - width) / 2) * 2) / 2;
          out.push({ id: pre + 'x' + (rs.k + 1), o: e.o, c: e.c, s0: at, s1: at + width, floorZ,
            a: e.lowFirst ? up.id : rs.id, b: e.lowFirst ? rs.id : up.id, route: true, cross: false, cells: [[up.i, up.j], [rs.i, rs.j]] });
        }
        for (const cn of out) for (const rs of live) if (cn.a === rs.id || cn.b === rs.id) rs.conns.push(cn);
        return out;
      };
      // build every floor; one that cannot be built goes with everything grown from it
      let live = all.slice(), lconns = null, failed = true;
      while (live.length) {
        lconns = wire(live);
        const bad = live.find((rs) => { const got = GROWTH.raisedSite(rs); if (got) Object.assign(rs, got, { leg: null }); return !got; });
        if (!bad) { failed = false; break; }
        if (bad.k === head.k) break;
        const gone = new Set([bad.k]);
        for (const rs of live) if (gone.has(rs.parent)) gone.add(rs.k);
        live = live.filter((rs) => !gone.has(rs.k));
      }
      if (failed || !live[0].b.portals.some((p) => p.connection === inbound.id)) {
        if (lv === 0) return null;
        // (a level that cannot be built: the growth stops at the one below, and
        // that level's leg is undone)
        undoLeg(legs.pop(), sites);
        break;
      }
      for (const g of grown) if (g.ground && !live.some((rs) => rs.ground === g.ground.id)) used.delete(g.ground.id);
      for (const rs of live) if (rs.over && !rs.ground) { const t = sites.find((x) => x.id === rs.over); if (t) t.top = floorZ - SLAB; }
      sites.push(...live); conns.push(...lconns);
      levels.push({ level: lv + 1, z, floorZ, sites: live.map((rs) => rs.id) });
      below = live;
      // ---- the leg on up: from a floor of this level, far from where it was entered
      if (nextZ === null) break;
      const leg = upLeg(W, n, live, { rise: round(nextZ - z), conn: pre + 'l' + (lv + 2), band: n, toward: arrive && lv === zs.length - 2 ? under : null });
      if (!leg) break;
      legs.push(leg);
      leg.host.top = round(base + nextZ - SLAB);
      first = { rects: subtract(leg.host.rects, leg.box), over: leg.host.id, ground: null, cell: [leg.host.i, leg.host.j], raised: leg.host,
        arrive: { conn: leg.conn.id, L: leg.L, side: leg.side, from: leg.host.id, cell: [leg.host.i, leg.host.j] } };
      if (area(first.rects) < BN.minArea) { undoLeg(legs.pop(), sites); break; }
    }
    // ---- the arrival: the last leg lands on the next band's floor
    let arrival = null;
    if (arrive && levels.length === zs.length) arrival = arriveFrom(W, n, below, { conn: pre + 'up', toward: under });
    // ---- the ground under it all: each ground site capped under the floor standing on it
    const caps = new Map();
    for (const rs of sites) if (rs.ground) caps.set(rs.ground, Math.min(caps.has(rs.ground) ? caps.get(rs.ground) : Infinity, round(rs.floorZ - SLAB)));
    const G = { id, band: n, i, j, steered, pillar: pillar.kind, biome, z: zs[0], floorZ: base + zs[0], planned: zs.slice(), arrives: !!arrival, cells: allowed,
      levels, sites, conns: conns.concat(arrival ? [arrival.conn] : []), legs: legs.map((l) => ({ level: l.level, site: l.host.id, box: l.box, L: l.L, side: l.side, type: l.type, rise: l.rise, conn: l.conn.id })),
      caps: [...caps].map(([site, cap]) => ({ site, cap })).sort((a, b) => a.site.localeCompare(b.site)), over: [...caps.keys()].sort(), arrival, pit: null };
    if (pillar.kind === 'house') Object.assign(G, { anchor: pillar.host.id, poi: pillar.P.id, archetype: pillar.P.archetype, side: pillar.side, reach: pillar.reach,
      landing: { b: pillar.raise.b, room: pillar.raise.room, portal: pillar.raise.portal, connection: pre + 'x0', rect: pillar.raise.rect.slice(), z: pillar.raise.z } });
    else Object.assign(G, { anchor: pillar.site.id, stair: { site: pillar.site.id, b: pillar.b, fillerOrigin: pillar.fillerOrigin, box: pillar.leg.box, L: pillar.leg.L, side: pillar.leg.side, type: pillar.leg.type, rise: pillar.leg.rise, conn: pillar.conn,
      top: pillar.leg.top } });
    G.pit = planPit(W, G);
    return G;
  };
  /** undo a leg that led nowhere: its host is built again without it */
  function undoLeg(leg, sites) {
    if (!leg) return;
    const rs = leg.host;
    rs.top = rs.band * B().spacing + B().ceilingLimit;
    Object.assign(rs, leg.before);
  }
  /** a leg up from one of the level's floors: the furthest from where the level was entered first */
  function upLeg(W, n, live, o) {
    const BN = B().branch;
    // (the furthest floor out first: climbing means crossing the level; the
    // variant itself keeps its climb away from the floor's doors)
    const order = live.slice().sort((a, b) => (o.toward ? o.toward(b.rects) - o.toward(a.rects) : 0) || b.hop - a.hop || a.k - b.k);
    for (const rs of order.slice(0, CFG.tries)) {
      const before = { b: rs.b, fillerOrigin: rs.fillerOrigin, buildings: rs.buildings, leg: rs.leg };
      // (a floor of its own: the leg's landing room, and the floor beyond, over this site)
      const got = GROWTH.raisedSite(rs, { rise: o.rise, next: rs.rects, minArea: BN.minArea, conn: { id: o.conn }, band: o.band });
      if (!got) continue;
      Object.assign(rs, { b: got.b, fillerOrigin: got.fillerOrigin, buildings: got.buildings });
      rs.leg = { box: got.leg.box, L: got.leg.L, side: got.leg.side, type: got.leg.type, rise: got.leg.rise, top: got.leg.top, conn: o.conn, next: 'level' };
      return { host: rs, before, level: rs.level + 1, box: got.leg.box, L: got.leg.L, side: got.leg.side, type: got.leg.type, rise: got.leg.rise,
        conn: { id: o.conn } };
    }
    return null;
  }
  /**
   * The arrival: a leg from a floor of the top level up to the next band's
   * floor, landing in one of that band's landing sites in the same cell, which
   * is built again round the climb with a door onto its landing. The leg's
   * host keeps a doorway bound to the same connection. null if none fits.
   */
  function arriveFrom(W, n, top, o) {
    const E = BR.ELEV, BC = B(), up = n + 1, upper = W.worldFor(up), uz = up * BC.spacing;
    if (!top || !top.length) return null;
    const order = top.slice().sort((a, b) => o.toward(b.rects) - o.toward(a.rects) || b.hop - a.hop || a.k - b.k);
    for (const rs of order) {
      const ground = W.cell(rs.i, rs.j, up).sites.filter((s) => GROWTH.landingSite(W, up, s) && s.rects.some((q) => rs.rects.some((r) => TG.roverlap(q, r))))
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const G of ground.slice(0, CFG.tries)) {
        // the climb stays inside both: this floor below, the landing site above, a metre in from its edge
        const within = [];
        for (const q of G.rects) for (const r of rs.rects) {
          const x = [Math.max(q[0] + 1, r[0]), Math.max(q[1] + 1, r[1]), Math.min(q[2] - 1, r[2]), Math.min(q[3] - 1, r[3])];
          if (x[2] - x[0] >= 2 && x[3] - x[1] >= 2) within.push(x);
        }
        if (!within.length) continue;
        const cn = { id: o.conn };
        const got = GROWTH.raisedSite(rs, { rise: round(uz - rs.floorZ), within, next: G.rects, minArea: BC.branch.minArea, conn: cn, band: up });
        if (!got) continue;
        // the landing site, rebuilt round the climb: its own doors and one onto the landing
        const rest = subtract(G.rects, got.leg.box), origin = [G.bbox[0], G.bbox[1]];
        const conn = legConn(o.conn, got.leg.L, got.leg.side, rs.id, G.id, uz, [[rs.i, rs.j], [G.i, G.j]]);
        Object.assign(conn, { vertical: true, bands: [n, up] });
        const doors = G.conns.map((id) => connView(upper.connection(G, id), G.id, origin)).concat([connView(conn, G.id, origin)]);
        const fillers = [...new Set([upper.fillerOf(G)].concat([0, 1, 2].map((t) => BR.FILL.pick({ seed: BR.hash4(G.seed >>> 0, t, 0xa442, 0), site: { rects: rest.map((q) => unshift(q, origin)) } }))))];
        let b = null;
        for (const [t, filler] of fillers.entries()) {
          const f = BR.FILL.generate({ filler, seed: BR.hash4(G.seed >>> 0, t, 0xa443, 0), site: { rects: rest.map((q) => unshift(q, origin)) }, connections: clone(doors) });
          if (f.error || !doors.every((d) => f.portals.some((p) => p.connection === d.id))) continue;
          const a = E.prepare(f, { fillId: G.id, deferCapabilities: true });
          if (a.surfaces.some((v) => v.floorZ < BC.floorLimit - EPS || v.ceilingZ > BC.ceilingLimit + EPS)) continue;
          b = f; break;
        }
        if (!b) continue;
        Object.assign(rs, { b: got.b, fillerOrigin: got.fillerOrigin, buildings: got.buildings });
        rs.leg = { box: got.leg.box, L: got.leg.L, side: got.leg.side, type: got.leg.type, rise: got.leg.rise, top: got.leg.top, conn: o.conn, next: 'band' };
        rs.top = round(rs.floorZ + rs.clear);
        return { band: up, site: rs.id, ground: G.id, cell: [G.i, G.j], box: got.leg.box, L: got.leg.L, side: got.leg.side, type: got.leg.type, rise: got.leg.rise,
          top: got.leg.top, conn, b, origin, conns: doors };
      }
    }
    return null;
  }
  /**
   * Where the growth's pit drills down: from a first-level floor standing
   * over a whole ground site into that site, both as they are built (a raw
   * ground build, so planning never waits on a cached one). null if nothing
   * lines up.
   */
  function planPit(W, G) {
    const E = BR.ELEV, w = W.worldFor(G.band), P = B().branch.pit;
    for (const rs of G.sites.filter((x) => x.level === 1 && x.whole && x.ground && !x.leg)) {
      const ground = w.site(rs.ground);
      if (!ground) continue;
      const r = w.buildRaw(ground);
      if (!r.filler || r.buildings.length) continue;
      if (!E.capCeilings(r.filler, rs.floorZ - G.band * B().spacing - E.SLAB)) continue;
      const under = BR.placeElevationBlueprint(E.prepare(r.filler, { fillId: ground.id, deferCapabilities: true }), ground.band * B().spacing, ground.band, ground.band);
      const spot = BR.CLAIM.pitSpot(rs.b, under, { size: P.size, fall: P.fall, topOrigin: rs.fillerOrigin, bottomOrigin: r.fillerOrigin });
      if (!spot) continue;
      return { id: 'pit:' + G.id + ':' + rs.k, ...spot, top: { site: rs.id, owner: rs.owner, ...spot.top },
        bottom: { site: ground.id, owner: ground.id, origin: r.fillerOrigin.slice(), ...spot.bottom } };
    }
    return null;
  }

  /**
   * The longest edge two rect lists share, at least `min` metres long:
   * { o, c, s0, s1, lowFirst (the first list is the west / north side) }, or null.
   */
  function sharedEdge(a, b, min) {
    let best = null;
    for (const p of a) for (const q of b) {
      for (const [o, lowFirst, c] of [['v', true, p[2]], ['v', false, q[2]], ['h', true, p[3]], ['h', false, q[3]]]) {
        const [lo, hi] = o === 'v' ? [lowFirst ? q[0] : p[0], c] : [lowFirst ? q[1] : p[1], c];
        if (Math.abs(lo - hi) > EPS) continue;
        const s0 = o === 'v' ? Math.max(p[1], q[1]) : Math.max(p[0], q[0]), s1 = o === 'v' ? Math.min(p[3], q[3]) : Math.min(p[2], q[2]);
        if (s1 - s0 < (min || 0) - EPS) continue;
        if (!best || s1 - s0 > best.s1 - best.s0) best = { o, c, s0, s1, lowFirst };
      }
    }
    // (doors are laid on the half metre)
    if (best && (Math.abs(best.c * 2 - Math.round(best.c * 2)) > EPS)) return null;
    return best;
  }
  GROWTH.sharedEdge = sharedEdge;
})(typeof window !== 'undefined' ? window : globalThis);
