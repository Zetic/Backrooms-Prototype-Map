/* Deterministic horizontal bands, joined by vertical journeys (journeys.js).
 *
 * Every 512 x 512 m region holds one journey per pair of neighbouring bands:
 * a territory reserved in both bands' cell plans (the same rectangle, a site
 * of kind 'transition' in each), owned by the journey and filled by it. The
 * plan, doors included, comes from (seed, region, band pair) alone, so
 * whichever band or cell is asked for first, every band agrees where it is,
 * and planning a cell never waits for a journey to be built. Even and odd
 * pairs use opposite halves of a region, so a band's journey down and its
 * journey up never claim the same ground. Each band's slice of a journey binds
 * only the doors at its own floor to that band's network; the blueprint, and
 * the climb between them, is one. A journey that cannot be built (no seed of
 * four fits) leaves an ordinary filler on its territory in each band, behind
 * the same doors. See docs/elevation-world.md. */
(function (root) {
  'use strict';
  const BR = root.BR, E = BR.ELEV, C = BR.WORLD_CFG.cell;
  // a site's envelope: from its lowest allowed floor (a sunken floor, floorLimit)
  // less its slab, to ceilingLimit - one band spacing in all, so bands never overlap
  const CFG = { spacing: 16, floorLimit: -1.25, ceilingLimit: 14.5, regionCells: 4, journey: { w: [40, 56], h: [32, 48], tries: 4 },
    // a raised branch (milestone 5): one filler floor, or two, over the ground
    // sites beside a two-storey house, entered from its stairwell carried on up
    branch: { z: 6.5, sites: 2, reach: [1, 8], door: 2, minArea: 70, minShared: 5, tries: 8, pit: { size: 2, fall: 3 } },
    limits: { bands: 4, journeys: 64, claims: 256, branches: 64, raised: 64 } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const EPS = 1e-7;
  const bandId = (n) => 'band:' + n;
  /** a connection as the site on one side of it sees it (that site's frame), as every site's build gives them */
  const connView = (cn, siteId, origin) => {
    const low = cn.a === siteId;
    return { id: cn.id, side: cn.o === 'v' ? (low ? 'E' : 'W') : (low ? 'S' : 'N'),
      at: cn.s0 - (cn.o === 'h' ? origin[0] : origin[1]), width: cn.s1 - cn.s0, line: cn.c - (cn.o === 'h' ? origin[1] : origin[0]), kind: 'opening', route: cn.route };
  };
  /**
   * The longest edge two rect lists share, at least `min` metres long:
   * { o, c, s0, s1, lowFirst (the first list is the west / north side) }, or
   * null. Rects are whole metres, so this is exact.
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
    return best;
  }
  const assertBand = (n) => { if (!Number.isInteger(n) || Math.abs(n) > 10000) throw new Error('band must be an integer between -10000 and 10000'); return n; };
  const shiftRect = (r, x, y) => [r[0] + x, r[1] + y, r[2] + x, r[3] + y];
  const clock = () => (typeof performance !== 'undefined' ? performance : Date).now();

  /** Translate all authoritative and derived Z data without changing XY,
   * clearance, slab thickness, slope, or the owning reference band. */
  function placeBlueprint(b, base, home, destination) {
    const map = (id) => id === 'ground' ? bandId(home) : bandId(destination);
    for (const r of b.rooms) { r.floorZ += base; r.ceilingZ += base; r.band = map(r.band); }
    for (const q of b.walls.concat(b.openings, b.zones || [], b.columns || [], b.curves || [], b.outline || [])) {
      q.floorZ += base; if (q.ceilingZ !== undefined) q.ceilingZ += base;
    }
    for (const s of b.surfaces) { s.floorZ += base; s.ceilingZ += base; s.band = map(s.band); }
    for (const p of b.portals) { p.floorZ += base; p.at[2] += base; p.band = map(p.band); }
    for (const l of b.levels) { l.elevation += base; l.band = map(l.band); }
    for (const v of b.volumes.concat(b.voids || [], (b.drops || []).filter((d) => d.z0 !== undefined))) { v.z0 += base; v.z1 += base; }
    for (const c of b.connectors) {
      for (const p of c.path.concat(c.landings)) p[2] += base;
      for (const v of E.reservationsOf(c)) { v.z0 += base; v.z1 += base; }
    }
    for (const z of b.connectionZones || []) {
      z.entry[2] += base; z.exit[2] += base; z.floorZ += base; z.targetZ += base;
      for (const p of z.path || []) p[2] += base;
    }
    for (const p of b.route) p[2] += base;
    for (const d of ['up', 'down']) for (const c of b.capabilities[d].candidates) c.at[2] += base;
    for (const t of b.bandTerritories) { t.band = map(t.band); t.elevation += base; }
    for (const a of b.bands) { a.id = map(a.id); a.elevation += base; }
    return b;
  }

  class BandWorld {
    constructor(seed, options) {
      this.seed = seed >>> 0; this.options = options || {}; this.band = 0;
      this.limits = Object.assign({}, CFG.limits, this.options.elevationLimits);
      if (Object.values(this.limits).some((n) => !Number.isInteger(n) || n < 1)) throw new Error('elevation cache limits must be positive integers');
      this.worlds = new Map(); this.journeys = new Map(); this.claims = new Map(); this.branches = new Map(); this.raisedBuilds = new Map();
      this.totals = { cellsPlanned: 0, sitesBuilt: 0, buildMs: 0, poisBuilt: 0, issues: 0 };
      this.setBand(this.options.band === undefined ? 0 : this.options.band);
    }
    get floorZ() { return this.band * CFG.spacing; }
    get active() { return this.worldFor(this.band); }
    get cells() { return this.active.cells; }
    get builds() { return this.active.builds; }
    get stats() {
      const out = Object.assign({}, this.totals);
      for (const w of this.worlds.values()) for (const k of Object.keys(out)) out[k] += w.stats[k];
      return out;
    }
    setBand(n) { this.band = assertBand(n); return this; }
    worldFor(n) {
      assertBand(n);
      if (this.worlds.has(n)) { const w = this.worlds.get(n); this.worlds.delete(n); this.worlds.set(n, w); return w; }
      const seed = n === 0 ? this.seed : BR.hash4(this.seed, n, 0, 0xba01);
      const w = new BR.World(seed, { band: n, floorZ: n * CFG.spacing, limits: this.options.limits,
        plannedLots: (i, j) => this.plannedLots(n, i, j), buildTransition: (s) => this.buildTransition(s), afterBuild: (s, r) => this.afterBuild(s, r) });
      this.worlds.set(n, w);
      while (this.worlds.size > this.limits.bands) {
        const first = this.worlds.keys().next().value, old = this.worlds.get(first);
        for (const k of Object.keys(this.totals)) this.totals[k] += old.stats[k];
        this.worlds.delete(first);
      }
      return w;
    }
    /**
     * Where the journey between bands `lower` and lower + 1 lies in region
     * (ri, rj): a territory in one cell of the region's half for that pair,
     * placed so the strips the cell planner cuts round it miss both bands'
     * border openings. null if no cell of the half has room.
     */
    journeyPlan(lower, ri, rj) {
      assertBand(lower);
      const R = CFG.regionCells, J = CFG.journey, rng = new BR.Rng(BR.hash4(this.seed, ri, rj, 0xba02 ^ Math.imul(lower, 0x9e3779b1)));
      const half = ((lower % 2) + 2) % 2, w = rng.int(J.w[0], J.w[1]), h = rng.int(J.h[0], J.h[1]);
      const cells = [], startX = rng.int(0, 1), startY = rng.int(0, R - 1);
      for (let a = 0; a < 2; a++) for (let b = 0; b < R; b++) cells.push([ri * R + half * 2 + (startX + a) % 2, rj * R + (startY + b) % R]);
      const seeds = [lower, lower + 1].map((n) => n === 0 ? this.seed : BR.hash4(this.seed, n, 0, 0xba01));
      for (const [i, j] of cells) for (const split of ['h', 'v']) {
        const span = split === 'h' ? h : w, candidates = [];
        const openings = seeds.flatMap((s) => [BR.borderOpenings(s, split === 'h' ? 'v' : 'h', i, j),
          BR.borderOpenings(s, split === 'h' ? 'v' : 'h', split === 'h' ? i + 1 : i, split === 'h' ? j : j + 1)]).flat();
        for (let q = 8; q <= C - span - 8; q++) if ([q, q + span].every((cut) => openings.every(([a, b]) => cut <= a - 1 || cut >= b + 1))) candidates.push(q);
        if (!candidates.length) continue;
        const q = candidates[rng.int(0, candidates.length - 1)];
        const x = i * C + (split === 'v' ? q : rng.int(8, C - w - 8)), y = j * C + (split === 'h' ? q : rng.int(8, C - h - 8));
        return { id: 'journey:' + lower + ':' + ri + ',' + rj, lower, upper: lower + 1, ri, rj, i, j, split,
          seed: BR.hash4(this.seed, ri, rj, 0xba03 ^ Math.imul(lower, 0x9e3779b1)), rect: [x, y, x + w, y + h] };
      }
      return null;
    }
    /** a journey's doors (its plan's, decided before it is built), from its territory and seed */
    journeyDoors(p) { return BR.JOURNEY.plan({ seed: p.seed, w: p.rect[2] - p.rect[0], h: p.rect[3] - p.rect[1] }); }
    /** the journey's blueprint (absolute heights), or null if none could be built there; cached */
    journey(p) {
      if (!p) return null;
      const v = BR.World.lru(this.journeys, p.id, this.limits.journeys, () => {
        const doors = this.journeyDoors(p);
        for (let t = 0; t < CFG.journey.tries; t++) {
          try { return BR.JOURNEY.generate({ id: p.id, seed: t ? BR.hash4(p.seed, t, 0xba04, 0) : p.seed, w: p.rect[2] - p.rect[0], h: p.rect[3] - p.rect[1], lower: p.lower, doors }); } catch (err) { /* another seed */ }
        }
        return false;
      });
      return v || null;
    }
    /** the journeys reserved in cell (i, j) of band n: one arriving from below, one leaving above, at most.
     * Planning needs only their plans: nothing is built here. */
    plannedLots(n, i, j) {
      if (!BR.JOURNEY) return [];
      const key = n + '|' + i + ',' + j;
      return BR.World.lru(this.claims, key, this.limits.claims, () => {
        const out = [], ri = Math.floor(i / CFG.regionCells), rj = Math.floor(j / CFG.regionCells);
        for (const lower of [n - 1, n]) {
          const p = this.journeyPlan(lower, ri, rj);
          if (!p || p.i !== i || p.j !== j) continue;
          const plan = this.journeyDoors(p), doors = BR.JOURNEY.doors(n === p.lower ? plan.low : plan.high).map((d) => d.o === 'h'
            ? { ...d, c: d.c + p.rect[1], s0: d.s0 + p.rect[0], s1: d.s1 + p.rect[0] } : { ...d, c: d.c + p.rect[0], s0: d.s0 + p.rect[1], s1: d.s1 + p.rect[1] });
          out.push({ id: p.id, kind: 'reserved', rect: p.rect.slice(), doors, pois: [], transition: p });
        }
        return out;
      }).map((l) => clone(l)); // the world sets portalConns: cached plans are never mutated
    }
    /** an ordinary filler on a journey's territory in band n, behind that band's planned doors, for a journey that could not be built */
    standIn(p, n) {
      const plan = this.journeyDoors(p), site = { w: p.rect[2] - p.rect[0], h: p.rect[3] - p.rect[1] };
      // a few picks from the pool, then every filler in turn: one of them fits a plain rectangle
      const ids = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => BR.FILL.pick({ seed: BR.hash4(p.seed, n, t, 0xba05), site })).concat(BR.FILL.list().map((F) => F.id).sort());
      for (const [t, filler] of ids.entries()) {
        const seed = BR.hash4(p.seed, n, t, 0xba05), f = BR.FILL.generate({ filler, seed, site, connections: clone(n === p.lower ? plan.low : plan.high) });
        if (!f.error) return placeBlueprint(E.prepare(f, { fillId: p.id + '@' + bandId(n), deferCapabilities: true }), n * CFG.spacing, n, n);
      }
      throw new Error(p.id + ': no filler fits its territory');
    }
    /** a band's slice of a journey: the shared blueprint, with only that band's doors bound to its network */
    buildTransition(site) {
      const t0 = clock(), p = site.transition, j = this.journey(p), b = j ? clone(j) : this.standIn(p, site.band), L = site.lots[0];
      // portals are keyed by their planned connection (low0.., high0..): each band planned only its own
      for (const portal of b.portals) { const id = L.portalConns && L.portalConns[portal.connection]; if (id) portal.connection = id; else delete portal.connection; }
      // its connections in the territory's frame, as every other site's build gives them
      const conns = site.conns.map((id) => { const cn = this.worldFor(site.band).connection(site, id), lowSide = cn.a === site.id;
        return { id: cn.id, side: cn.o === 'v' ? (lowSide ? 'E' : 'W') : (lowSide ? 'S' : 'N'), at: cn.s0 - (cn.o === 'h' ? p.rect[0] : p.rect[1]), width: cn.s1 - cn.s0,
          line: cn.c - (cn.o === 'h' ? p.rect[1] : p.rect[0]), kind: 'opening', route: cn.route }; });
      return { site, owner: p.id, origin: p.rect.slice(0, 2), fillerOrigin: p.rect.slice(0, 2), filler: b, buildings: [], conns, issues: [], ms: clock() - t0 };
    }
    // --------------------------------------------------------- raised claims
    /**
     * The raised branch over cell (i, j) of band n, or null: one floor, or
     * two, at `branch.z` over whole ground sites beside a two-storey house,
     * entered from that house's stairwell carried on up (claims.js), with a
     * pit drilled from the first of them into the ground site below. Hand
     * placed: the first house of the cell whose stairwell can carry on up
     * and whose neighbour sites are plain fillers, in the cell plan's own
     * order. Nothing grows from it, and the ground plan is untouched.
     * Cached and pure: the same for any seed, band and cell, in any order.
     */
    branch(n, i, j) {
      assertBand(n);
      if (!BR.CLAIM) return null;
      const v = BR.World.lru(this.branches, n + '|' + i + ',' + j, this.limits.branches, () => this.planBranch(n, i, j) || false);
      return v || null;
    }
    /** the branch's raised sites in cell (i, j) of band n (its own cell only) */
    raisedSites(n, i, j) { const B = this.branch(n, i, j); return B ? B.sites : []; }
    /** every raised site whose rects meet [x0, y0, x1, y1] in the active band */
    raisedIn(x0, y0, x1, y1) {
      const out = [];
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++)
        for (const rs of this.raisedSites(this.band, i, j)) if (rs.rects.some((q) => q[0] < x1 && q[2] > x0 && q[1] < y1 && q[3] > y0)) out.push(rs);
      return out;
    }
    /** the raised site at (x, y) in the active band, or null */
    raisedAt(x, y) {
      for (const rs of this.raisedSites(this.band, Math.floor(x / C), Math.floor(y / C)))
        for (const q of rs.rects) if (x >= q[0] && x < q[2] && y >= q[1] && y < q[3]) return rs;
      return null;
    }
    /** a raised site's blueprints, in the shape of any other site's build (spatial already) */
    raisedBuild(rs) {
      return BR.World.lru(this.raisedBuilds, rs.id, this.limits.raised, () => {
        const t0 = clock(), B = this.branch(rs.band, rs.i, rs.j), b = clone(rs.b);
        // the pit's own floor cutout: the ground site below cuts its ceiling (`spatial`)
        if (B && B.pit && B.pit.top.site === rs.id) BR.CLAIM.drill(b, null, B.pit, B.pit.id);
        return { site: rs, owner: rs.owner, origin: rs.origin.slice(), fillerOrigin: rs.origin.slice(), filler: b, buildings: [],
          conns: rs.conns.map((cn) => connView(cn, rs.id, rs.origin)), issues: [], ms: clock() - t0 };
      });
    }
    /** the absolute height a ground site's claim stops at: a branch's floor slab, or its band's ceiling */
    ceilingOf(site) {
      const B = this.branch(site.band, site.i, site.j), cap = B && B.caps.find((c) => c.site === site.id);
      return cap ? cap.cap : site.band * CFG.spacing + CFG.ceilingLimit;
    }
    /** the last word on a ground build: ceilings capped under a claim above, a stairwell carried up into one */
    afterBuild(site, r) {
      if (!BR.CLAIM || site.kind === 'transition') return;
      const B = this.branch(site.band, site.i, site.j);
      if (!B) return;
      const cap = B.caps.find((c) => c.site === site.id);
      if (cap) for (const b of [r.filler].concat(r.buildings.map((x) => x.b))) {
        if (b && !E.capCeilings(b, cap.cap - site.band * CFG.spacing)) r.issues.push(site.id + ' cannot keep under ' + B.id);
      }
      // the lower half of the cell's pit, named on the ground build so the map
      // draws it; its cutout and shaft come with spatial adaptation
      if (B.pit && B.pit.bottom.site === site.id && r.filler) BR.CLAIM.markDrop(r.filler, B.pit, B.pit.id, 'bottom');
      if (site.id === B.anchor) {
        const host = r.buildings.find((x) => x.poi.id === B.poi);
        if (host) { host.b = B.landing.b; host.conns[B.landing.portal] = B.landing.connection; }
      }
    }
    /** work out the cell's branch: see `branch`. Raw builds only, so planning never waits on a cached one. */
    planBranch(n, i, j) {
      const BN = CFG.branch, cell = this.cell(i, j, n), w = this.worldFor(n), base = n * CFG.spacing, floorZ = base + BN.z;
      const id = 'branch:' + n + ':' + i + ',' + j, cap = base + BN.z - E.SLAB;
      const plain = (s) => s.kind === 'filler' && !s.pois.length && !s.lots.length && s.area >= BN.minArea;
      for (const L of cell.lots.filter((x) => x.kind === 'yard' && x.b && !x.b.error).sort((a, b) => a.id.localeCompare(b.id))) {
        const host = cell.sites.find((s) => s.kind === 'lot' && s.lots.includes(L)), stair = BR.CLAIM.stairTop(L.b);
        if (!host || !stair) continue;
        const o = L.pois[0].origin;
        for (const side of stair.sides) {
          const reach = side === 'E' ? L.rect[2] - (o[0] + stair.rect[2]) : side === 'W' ? (o[0] + stair.rect[0]) - L.rect[0]
            : side === 'S' ? L.rect[3] - (o[1] + stair.rect[3]) : (o[1] + stair.rect[1]) - L.rect[1];
          if (!(reach >= BN.reach[0] - EPS && reach <= BN.reach[1] + EPS)) continue;
          const raise = BR.CLAIM.raiseStair(L.b, { z: BN.z, side, reach, width: BN.door });
          if (!raise) continue;
          // the door it opens, in world metres, and the ground sites it leads onto
          const d = raise.door, horiz = d.o === 'h', line = d.c + (horiz ? o[1] : o[0]);
          const s0 = d.s0 + (horiz ? o[0] : o[1]), s1 = d.s1 + (horiz ? o[0] : o[1]);
          // a floor is built on the half metre: a door off the grid could never be met exactly
          if ([line, s0, s1].some((v) => Math.abs(v * 2 - Math.round(v * 2)) > EPS)) continue;
          const onEdge = (s) => s.rects.some((q) => horiz ? Math.abs(q[side === 'S' ? 1 : 3] - line) < EPS && q[0] <= s0 + EPS && q[2] >= s1 - EPS
            : Math.abs(q[side === 'E' ? 0 : 2] - line) < EPS && q[1] <= s0 + EPS && q[3] >= s1 - EPS);
          const first = cell.sites.find((s) => plain(s) && onEdge(s));
          if (!first) continue;
          const ground = [first];
          // a second ground site, where one shares a long enough edge with the first
          if (BN.sites > 1) {
            const next = cell.sites.filter((s) => plain(s) && s !== first && sharedEdge(first.rects, s.rects, BN.minShared))
              .sort((a, b) => b.area - a.area || a.id.localeCompare(b.id))[0];
            if (next) ground.push(next);
          }
          const sites = ground.map((g, k) => {
            const rs = { id: 'b' + n + '|' + i + ',' + j + ':raised' + k, owner: id + ':' + k, kind: 'branch', band: n, i, j, k,
              over: g.id, rects: clone(g.rects), bbox: g.bbox.slice(), area: g.area, floorZ, openness: g.openness,
              seed: BR.hash4(w.seed, i, j, 0xba06 ^ Math.imul(k + 1, 0x9e3779b1)), conns: [] };
            rs.origin = [rs.bbox[0], rs.bbox[1]];
            return rs;
          });
          // the landing's door, from the lot to the first raised floor
          const far = side === 'E' || side === 'S';
          const conns = [{ id: 'b' + n + '|' + i + ',' + j + ':x0', o: d.o, c: line, s0, s1, floorZ,
            a: far ? host.id : sites[0].id, b: far ? sites[0].id : host.id, route: true, cross: false }];
          // the raised floors join each other where their ground sites share an edge
          if (sites.length > 1) {
            const e = sharedEdge(sites[0].rects, sites[1].rects, BN.minShared);
            const width = Math.min(BN.door, e.s1 - e.s0 - 2), at = Math.round(((e.s0 + e.s1 - width) / 2) * 2) / 2;
            conns.push({ id: 'b' + n + '|' + i + ',' + j + ':x1', o: e.o, c: e.c, s0: at, s1: at + width, floorZ,
              a: e.lowFirst ? sites[0].id : sites[1].id, b: e.lowFirst ? sites[1].id : sites[0].id, route: true, cross: false });
          }
          for (const cn of conns) for (const rs of sites) if (cn.a === rs.id || cn.b === rs.id) rs.conns.push(cn);
          // the branch's own floors, each a filler on its ground site's footprint
          let built = true;
          for (const rs of sites) {
            const b = this.raisedFiller(rs, id);
            if (!b) { built = false; break; }
            rs.b = b;
          }
          if (!built) continue;
          // the door the landing opens must be a real opening on the first floor
          const bound = sites[0].b.portals.find((p) => p.connection === conns[0].id);
          if (!bound) continue;
          const B = { id, band: n, i, j, z: BN.z, floorZ, anchor: host.id, poi: L.pois[0].id, side, reach,
            landing: { b: raise.b, room: raise.room, portal: raise.portal, connection: conns[0].id, rect: raise.rect.slice(), z: raise.z },
            caps: ground.map((g) => ({ site: g.id, cap })), over: ground.map((g) => g.id), sites, conns, pit: null };
          B.pit = this.planPit(B);
          return B;
        }
      }
      return null;
    }
    /** a filler on a raised site, placed at its floor: the pool's picks, then every filler in turn */
    raisedFiller(rs, owner) {
      const site = { rects: rs.rects.map((q) => [q[0] - rs.origin[0], q[1] - rs.origin[1], q[2] - rs.origin[0], q[3] - rs.origin[1]]) };
      const conns = rs.conns.map((cn) => connView(cn, rs.id, rs.origin));
      const ids = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => BR.FILL.pick({ seed: BR.hash4(rs.seed, t, 0, 0xba07), site }))
        .concat(BR.FILL.list().map((F) => F.id).sort());
      for (const [t, filler] of ids.entries()) {
        const f = BR.FILL.generate({ filler, seed: BR.hash4(rs.seed, t, 1, 0xba07), site, connections: clone(conns), floors: false });
        if (f.error) continue;
        const a = E.prepare(f, { fillId: rs.owner, deferCapabilities: true });
        // a raised floor keeps inside its own claim: from its floor slab to the band's ceiling
        if (a.surfaces.some((v) => v.floorZ < -EPS || v.ceilingZ > CFG.ceilingLimit - CFG.branch.z + EPS)) continue;
        if (conns.some((c) => !a.portals.some((p) => p.connection === c.id))) continue;
        return placeBlueprint(a, rs.floorZ, rs.band, rs.band);
      }
      return null;
    }
    /**
     * Where the branch's pit drills down: from the first raised floor into the
     * ground site under it, both as they are built (a raw ground build, so
     * planning never waits on a cached one). null if nothing lines up.
     */
    planPit(B) {
      const w = this.worldFor(B.band), P = CFG.branch.pit;
      for (const rs of B.sites) {
        const ground = w.site(rs.over);
        if (!ground) continue;
        const r = w.buildRaw(ground);
        if (!r.filler || r.buildings.length) continue;
        if (!E.capCeilings(r.filler, B.z - E.SLAB)) continue;
        const under = placeBlueprint(E.prepare(r.filler, { fillId: ground.id, deferCapabilities: true }), ground.band * CFG.spacing, ground.band, ground.band);
        const spot = BR.CLAIM.pitSpot(rs.b, under, { size: P.size, fall: P.fall, topOrigin: rs.origin, bottomOrigin: r.fillerOrigin });
        if (!spot) continue;
        return { id: 'pit:' + B.id + ':' + rs.k, ...spot, top: { site: rs.id, owner: rs.owner, ...spot.top },
          bottom: { site: ground.id, owner: ground.id, origin: r.fillerOrigin.slice(), ...spot.bottom } };
      }
      return null;
    }

    /** the nearest journey up or down from (x, y) in the active band (among the 3 x 3 regions round it): its plan, or null */
    nearestJourney(direction, x, y) {
      if (!['up', 'down'].includes(direction)) throw new Error('direction must be up or down');
      const lower = direction === 'up' ? this.band : this.band - 1, R = C * CFG.regionCells;
      const ri = Math.floor(x / R), rj = Math.floor(y / R), list = [];
      for (let i = ri - 1; i <= ri + 1; i++) for (let j = rj - 1; j <= rj + 1; j++) { const p = this.journeyPlan(lower, i, j); if (p) list.push(p); }
      const d = (p) => ((p.rect[0] + p.rect[2]) / 2 - x) ** 2 + ((p.rect[1] + p.rect[3]) / 2 - y) ** 2;
      list.sort((a, b) => d(a) - d(b) || a.id.localeCompare(b.id));
      // (a journey that could not be built is not one: only the nearest are built to find out)
      return list.find((p) => this.journey(p)) || null;
    }
    bandOf(siteOrId) { const id = typeof siteOrId === 'string' ? siteOrId : siteOrId.id; const m = /^b(-?\d+)\|/.exec(id); if (!m) throw new Error('missing band in site id'); return +m[1]; }
    cell(i, j, band) { return this.worldFor(band === undefined ? this.band : band).cell(i, j); }
    cellAt(x, y) { return this.active.cellAt(x, y); }
    site(id) {
      const m = /^b(-?\d+)\|(-?\d+),(-?\d+):raised\d+$/.exec(id);
      if (m) return this.raisedSites(+m[1], +m[2], +m[3]).find((rs) => rs.id === id) || null;
      return this.worldFor(this.bandOf(id)).site(id);
    }
    siteAt(x, y) { return this.active.siteAt(x, y); }
    sitesIn(...args) { return this.active.sitesIn(...args); }
    poiAt(x, y) { return this.active.poiAt(x, y); }
    poisIn(...args) { return this.active.poisIn(...args); }
    fillerOf(s) { return this.worldFor(s.band).fillerOf(s); }
    hasBuild(s) { return this.worldFor(s.band).hasBuild(s); }
    build(s) { return this.worldFor(s.band).build(s); }
    /** Spatial adaptation is needed for export/navigation, not ordinary 2D
     * painting. Keep the original blueprint and cache its spatial view beside it. */
    spatial(s) {
      if (s.kind === 'branch') return this.raisedBuild(s);
      const w = this.worldFor(s.band), r = w.build(s);
      // a journey's blueprint is already spatial: absolute heights, both bands
      if (s.kind === 'transition') return r;
      if (!r.spatial) {
        const top = this.ceilingOf(s) - s.band * CFG.spacing;
        const adapt = (b, id) => {
          const a = E.prepare(b, { fillId: id, deferCapabilities: true });
          if (a.surfaces.some((v) => v.floorZ < CFG.floorLimit - 1e-9 || v.ceilingZ > top + 1e-9)) throw new Error(id + ' exceeds its planned claim');
          return placeBlueprint(a, s.band * CFG.spacing, s.band, s.band);
        };
        const t = clock();
        r.spatial = { ...r, filler: r.filler && adapt(r.filler, s.id),
          buildings: r.buildings.map((B) => ({ ...B, b: adapt(B.b, s.id + '/' + B.poi.id) })) };
        // the lower half of a pit: its own ceiling cutout, where the claim above drilled down
        const B = BR.CLAIM && this.branch(s.band, s.i, s.j), pit = B && B.pit;
        if (pit && pit.bottom.site === s.id && r.spatial.filler) BR.CLAIM.drill(null, r.spatial.filler, pit, pit.id);
        w.stats.buildMs += clock() - t;
      }
      return r.spatial;
    }
    connection(s, id) {
      if (s.kind === 'branch') return s.conns.find((cn) => cn.id === id) || null;
      const B = BR.CLAIM && this.branch(s.band, s.i, s.j), own = B && B.conns.find((cn) => cn.id === id);
      return own || this.worldFor(s.band).connection(s, id);
    }
    peer(s, cn) { return this.worldFor(s.band).peer(s, cn); }
    neighbours(s) { return this.worldFor(s.band).neighbours(s); }
    seamsBetween(a, b) {
      if (a.band !== b.band || a.kind === 'transition' || b.kind === 'transition') return [];
      this.build(a); this.build(b);
      return this.worldFor(a.band).seamsBetween(a, b);
    }
    biomeAt(x, y) { return this.active.biomeAt(x, y); }
    /** Conservative planned ownership, including protected unused space.
     * This index is local to a query. Cache eviction cannot release ownership. */
    reservationPlan(i, j, bandMin, bandMax) {
      assertBand(bandMin); assertBand(bandMax);
      if (bandMax < bandMin) throw new Error('reservation band range is reversed');
      const index = new E.ReservationIndex(), owners = new Set();
      const claim = (owner, v) => {
        if (owners.has(owner)) return; owners.add(owner);
        const r = index.reserve(owner, [v]);
        if (!r.ok) throw new Error(owner + ' reservation overlaps ' + r.conflicts[0].owner);
      };
      for (let n = bandMin; n <= bandMax; n++) {
        for (const s of this.cell(i, j, n).sites) {
          const owner = s.owner || s.id;
          // a journey owns its territory through both bands' envelopes; a
          // ground site owns its column up to its claim's ceiling, which a
          // raised branch over it caps at the branch's own floor slab
          const p = s.transition;
          claim(owner, p ? { id: owner + ':envelope', kind: 'journey-envelope', rects: [p.rect], z0: p.lower * CFG.spacing + CFG.floorLimit - E.SLAB, z1: p.upper * CFG.spacing + CFG.ceilingLimit }
            : { id: owner + ':envelope', kind: 'site-envelope', rects: s.rects, z0: n * CFG.spacing + CFG.floorLimit - E.SLAB, z1: this.ceilingOf(s) });
        }
        // the claims stacked over them: from their own floor slab to the band's ceiling
        for (const rs of this.raisedSites(n, i, j))
          claim(rs.owner, { id: rs.owner + ':envelope', kind: 'branch-envelope', rects: clone(rs.rects), z0: rs.floorZ - E.SLAB, z1: n * CFG.spacing + CFG.ceilingLimit });
      }
      return index.snapshot();
    }
    /** Authoritative spatial graph: matching requires exact world XYZ, width,
     * and opposite sides. Shared fill nodes are emitted once across slices. */
    graph(i0, j0, i1, j1, bands) {
      bands = bands || [this.band];
      const nodes = new Set(), edges = [], directed = [], ends = new Map(), records = new Map(), issues = [], unresolved = [], verticalFrontier = new Map(), expected = new Set(), falls = new Map();
      const add = (site, b, origin, pre, bindings) => {
        for (const s of b.surfaces) { const id = pre + '/' + s.id; nodes.add(id); records.set(id, { id, owner: b.fillId, band: s.band, floorZ: s.floorZ, ceilingZ: s.ceilingZ }); }
        // a pit: half of it on each side (claims.js). The world reads the pair.
        for (const d of b.drops || []) {
          if (!falls.has(d.id)) falls.set(d.id, []);
          falls.get(d.id).push({ role: d.role, node: pre + '/' + d.surface, owner: b.fillId,
            rect: [d.rect[0] + origin[0], d.rect[1] + origin[1], d.rect[2] + origin[0], d.rect[3] + origin[1]] });
        }
        for (const e of b.navigation.edges) {
          if (!e.connected) { unresolved.push({ owner: b.fillId, ...e }); continue; }
          const from = pre + '/' + e.from, to = pre + '/' + e.to;
          directed.push({ from, to, direction: e.direction, kind: e.kind, connector: e.connector && pre + '/' + e.connector });
          if (e.direction === 'both') edges.push([from, to]);
        }
        for (const p of b.portals) {
          const raw = bindings ? bindings[p.id] : p.connection;
          const opening = b.openings.find((o) => o.id === p.opening);
          if (!raw) {
            if (!bands.includes(Number(p.band.split(':')[1]))) verticalFrontier.set(pre + '/' + p.id,
              { owner: pre, portal: p.id, band: p.band, state: 'outside-region', at: [p.at[0] + origin[0], p.at[1] + origin[1], p.floorZ], width: p.width });
            continue;
          }
          // LOT's POI-door IDs are site-local; only planned cell/border IDs
          // already carry their globally unique band prefix.
          const id = raw.startsWith('b' + site.band + '|') ? raw : site.id + '#' + raw;
          if (!ends.has(id)) ends.set(id, []);
          const surface = b.surfaces.find((s) => s.room === p.room);
          const height = Math.min(opening.height || 2.2, surface.ceilingZ - surface.floorZ);
          ends.get(id).push({ node: pre + '/s:' + p.room, at: [p.at[0] + origin[0], p.at[1] + origin[1], p.floorZ], width: p.width, clearance: height, side: p.side, site: site.id, opening: opening.id });
        }
      };
      for (const n of [...new Set(bands)].sort((a, b) => a - b)) {
        assertBand(n);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const cell = this.cell(i, j, n), raised = this.raisedSites(n, i, j);
          for (const cn of cell.conns) if (!cn.cross || (cn.peerCell[0] >= i0 && cn.peerCell[0] <= i1 && cn.peerCell[1] >= j0 && cn.peerCell[1] <= j1)) expected.add(cn.id);
          for (const cn of (this.branch(n, i, j) || { conns: [] }).conns) expected.add(cn.id);
          for (const s of cell.sites.concat(raised)) {
            const r = this.spatial(s);
            // (a journey's one blueprint is shared by both its bands; a stand-in is one per band)
            if (r.filler) add(s, r.filler, r.fillerOrigin, s.kind === 'transition' ? r.filler.fillId : s.owner || s.id);
            for (const B of r.buildings) add(s, B.b, B.origin, s.id + '/' + B.poi.id, B.conns);
          }
        }
      }
      for (const id of expected) if (!ends.has(id)) issues.push(id + ' has no physical portal endpoints');
      const dangling = [], matches = [];
      for (const [id, list] of ends) {
        if (list.length === 1) {
          dangling.push(id);
          const site = this.site(list[0].site), cn = site && this.connection(site, id);
          if (!cn || !cn.cross || (cn.peerCell[0] >= i0 && cn.peerCell[0] <= i1 && cn.peerCell[1] >= j0 && cn.peerCell[1] <= j1)) issues.push(id + ' is missing an internal portal endpoint');
          continue;
        }
        if (list.length !== 2) { issues.push(id + ' has ' + list.length + ' portal endpoints'); continue; }
        const [a, b] = list;
        if (a.at.some((v, k) => Math.abs(v - b.at[k]) > 1e-7) || Math.abs(a.width - b.width) > 1e-7 || BR.TG.opposite(a.side) !== b.side || Math.min(a.clearance, b.clearance) < 1.8 - 1e-7) { issues.push(id + ' portals disagree in XYZ, width, side or headroom'); continue; }
        edges.push([a.node, b.node]); directed.push({ from: a.node, to: b.node, direction: 'both', kind: 'portal', connection: id });
        matches.push({ id, a, b });
      }
      // a pit is one way: a directed edge down and no undirected one, so
      // nothing walks back up it
      const pits = [];
      for (const [id, list] of falls) {
        const top = list.find((d) => d.role === 'top'), low = list.find((d) => d.role === 'bottom');
        if (list.length !== 2 || !top || !low) { issues.push(id + ' is not one pit between two floors'); continue; }
        if (top.rect.some((v, k) => Math.abs(v - low.rect[k]) > 1e-7)) { issues.push(id + ' drills through different places above and below'); continue; }
        const from = records.get(top.node), to = records.get(low.node);
        if (!from || !to || from.floorZ <= to.floorZ) { issues.push(id + ' does not drop'); continue; }
        directed.push({ from: top.node, to: low.node, direction: 'forward', kind: 'pit', drop: id });
        pits.push({ id, from: top.node, to: low.node, rect: top.rect.slice(), fall: Math.round((from.floorZ - to.floorZ) * 1000) / 1000 });
      }
      // Canonical ordering and deduplication makes exports independent of query order.
      const unique = (list, key) => [...new Map(list.map((e) => [key(e), e])).values()];
      return { pits: pits.sort((a, b) => a.id.localeCompare(b.id)), nodes, edges: unique(edges, (e) => e.slice().sort().join('|')), navigation: { nodes: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)),
        edges: unique(directed, (e) => JSON.stringify(e)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) },
        dangling: dangling.sort(), verticalFrontier: [...verticalFrontier.values()].sort((a, b) => (a.owner + a.portal).localeCompare(b.owner + b.portal)),
        matches: matches.sort((a, b) => a.id.localeCompare(b.id)), issues, unresolved: unique(unresolved, (e) => JSON.stringify(e)) };
    }
    exportRegion(i0, j0, i1, j1, bands) {
      bands = [...new Set(bands || [this.band])].sort((a, b) => a - b);
      if (!bands.length) throw new Error('export needs at least one band');
      if (![i0, j0, i1, j1].every(Number.isInteger) || i1 < i0 || j1 < j0 || (i1 - i0 + 1) * (j1 - j0 + 1) * bands.length > 64) throw new Error('export needs an integer region of at most 64 band cells');
      const layouts = new Map(), slices = [], reservations = new Map();
      for (const n of bands) for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const c = this.cell(i, j, n), B = this.branch(n, i, j), raised = this.raisedSites(n, i, j);
        slices.push({ band: bandId(n), i, j,
          sites: c.sites.map((s) => ({ id: s.id, owner: s.owner || s.id, kind: s.kind, rects: clone(s.rects), connections: s.conns.slice(), floorZ: n * CFG.spacing, ceilingZ: this.ceilingOf(s) })),
          // the claims stacked over this cell's ground, each with its own floor
          raised: raised.map((rs) => ({ id: rs.id, owner: rs.owner, kind: rs.kind, over: rs.over, rects: clone(rs.rects), connections: rs.conns.map((cn) => cn.id), floorZ: rs.floorZ, ceilingZ: n * CFG.spacing + CFG.ceilingLimit })),
          connections: c.conns.map((v) => ({ ...clone(v), floorZ: n * CFG.spacing })).concat((B ? B.conns : []).map((v) => clone(v))) });
        for (const s of c.sites.concat(raised)) {
          const r = this.spatial(s), add = (b, origin) => {
            if (!layouts.has(b.fillId)) {
              // Timing diagnostics are not spatial data and cannot be part of
              // a canonical seed export. Slice bindings belong to the world.
              const a = JSON.parse(JSON.stringify(b, (key, value) => key === 'ms' ? undefined : value));
              if (a.capabilities.up.deferred) a.capabilities = E.capabilities(a);
              for (const p of a.portals) delete p.connection;
              layouts.set(b.fillId, { owner: b.fillId, reservationOwner: s.owner || s.id, origin: origin.slice(), blueprint: a });
            }
          };
          if (r.filler) add(r.filler, r.fillerOrigin);
          for (const B of r.buildings) add(B.b, B.origin);
        }
        for (const v of this.reservationPlan(i, j, n, n)) reservations.set(v.owner, v);
      }
      const g = this.graph(i0, j0, i1, j1, bands);
      if (g.issues.length) throw new Error('invalid spatial connections: ' + g.issues[0]);
      const journeys = [...layouts.values()].filter((l) => l.blueprint.kind === 'journey').map((l) => ({ id: l.owner, origin: l.origin.slice(), bands: l.blueprint.bands.map((x) => x.id), style: l.blueprint.source.style,
        stages: l.blueprint.source.stages.map((st) => ({ filler: st.filler, z: st.z, leg: st.leg })) }));
      return { schema: 'br.world-elevation/0.2', units: 'metres', axes: 'XY horizontal, Z up', seed: this.seed,
        policy: { spacing: CFG.spacing, verticalJourneys: 'composed', journeysPerRegion: 1, regionCells: CFG.regionCells, layeredOwnership: 'stacked-claims', raisedBranches: 'hand-placed', branchFloor: CFG.branch.z }, journeys,
        region: [i0, j0, i1, j1], bands: bands.map((n) => ({ id: bandId(n), elevation: n * CFG.spacing })), slices,
        layouts: [...layouts.values()].sort((a, b) => a.owner.localeCompare(b.owner)), reservations: [...reservations.values()].sort((a, b) => a.owner.localeCompare(b.owner)),
        navigation: g.navigation, portalMatches: g.matches, pits: g.pits, frontier: g.dangling, verticalFrontier: g.verticalFrontier, issues: g.issues, unresolved: g.unresolved };
    }
  }
  BR.placeElevationBlueprint = placeBlueprint; BR.BAND_CFG = CFG; BR.BandWorld = BandWorld;
})(typeof window !== 'undefined' ? window : globalThis);
