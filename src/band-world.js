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
    limits: { bands: 4, journeys: 64, claims: 256 } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const bandId = (n) => 'band:' + n;
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
    for (const v of b.volumes.concat(b.voids || [])) { v.z0 += base; v.z1 += base; }
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
      this.worlds = new Map(); this.journeys = new Map(); this.claims = new Map();
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
        plannedLots: (i, j) => this.plannedLots(n, i, j), buildTransition: (s) => this.buildTransition(s) });
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
    site(id) { return this.worldFor(this.bandOf(id)).site(id); }
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
      const w = this.worldFor(s.band), r = w.build(s);
      // a journey's blueprint is already spatial: absolute heights, both bands
      if (s.kind === 'transition') return r;
      if (!r.spatial) {
        const adapt = (b, id) => {
          const a = E.prepare(b, { fillId: id, deferCapabilities: true });
          if (a.surfaces.some((v) => v.floorZ < CFG.floorLimit - 1e-9 || v.ceilingZ > CFG.ceilingLimit)) throw new Error(id + ' exceeds its planned band envelope');
          return placeBlueprint(a, s.band * CFG.spacing, s.band, s.band);
        };
        const t = clock();
        r.spatial = { ...r, filler: r.filler && adapt(r.filler, s.id),
          buildings: r.buildings.map((B) => ({ ...B, b: adapt(B.b, s.id + '/' + B.poi.id) })) };
        w.stats.buildMs += clock() - t;
      }
      return r.spatial;
    }
    connection(s, id) { return this.worldFor(s.band).connection(s, id); }
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
      for (let n = bandMin; n <= bandMax; n++) for (const s of this.cell(i, j, n).sites) {
        const owner = s.owner || s.id;
        if (owners.has(owner)) continue; owners.add(owner);
        // a journey owns its territory through both bands' envelopes
        const p = s.transition, v = p ? { id: owner + ':envelope', kind: 'journey-envelope', rects: [p.rect], z0: p.lower * CFG.spacing + CFG.floorLimit - E.SLAB, z1: p.upper * CFG.spacing + CFG.ceilingLimit }
          : { id: owner + ':envelope', kind: 'site-envelope', rects: s.rects, z0: n * CFG.spacing + CFG.floorLimit - E.SLAB, z1: n * CFG.spacing + CFG.ceilingLimit };
        const r = index.reserve(owner, [v]);
        if (!r.ok) throw new Error(owner + ' reservation overlaps ' + r.conflicts[0].owner);
      }
      return index.snapshot();
    }
    /** Authoritative spatial graph: matching requires exact world XYZ, width,
     * and opposite sides. Shared fill nodes are emitted once across slices. */
    graph(i0, j0, i1, j1, bands) {
      bands = bands || [this.band];
      const nodes = new Set(), edges = [], directed = [], ends = new Map(), records = new Map(), issues = [], unresolved = [], verticalFrontier = new Map(), expected = new Set();
      const add = (site, b, origin, pre, bindings) => {
        for (const s of b.surfaces) { const id = pre + '/' + s.id; nodes.add(id); records.set(id, { id, owner: b.fillId, band: s.band, floorZ: s.floorZ, ceilingZ: s.ceilingZ }); }
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
          const cell = this.cell(i, j, n);
          for (const cn of cell.conns) if (!cn.cross || (cn.peerCell[0] >= i0 && cn.peerCell[0] <= i1 && cn.peerCell[1] >= j0 && cn.peerCell[1] <= j1)) expected.add(cn.id);
          for (const s of cell.sites) {
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
          const site = this.site(list[0].site), cn = this.connection(site, id);
          if (!cn || !cn.cross || (cn.peerCell[0] >= i0 && cn.peerCell[0] <= i1 && cn.peerCell[1] >= j0 && cn.peerCell[1] <= j1)) issues.push(id + ' is missing an internal portal endpoint');
          continue;
        }
        if (list.length !== 2) { issues.push(id + ' has ' + list.length + ' portal endpoints'); continue; }
        const [a, b] = list;
        if (a.at.some((v, k) => Math.abs(v - b.at[k]) > 1e-7) || Math.abs(a.width - b.width) > 1e-7 || BR.TG.opposite(a.side) !== b.side || Math.min(a.clearance, b.clearance) < 1.8 - 1e-7) { issues.push(id + ' portals disagree in XYZ, width, side or headroom'); continue; }
        edges.push([a.node, b.node]); directed.push({ from: a.node, to: b.node, direction: 'both', kind: 'portal', connection: id });
        matches.push({ id, a, b });
      }
      // Canonical ordering and deduplication makes exports independent of query order.
      const unique = (list, key) => [...new Map(list.map((e) => [key(e), e])).values()];
      return { nodes, edges: unique(edges, (e) => e.slice().sort().join('|')), navigation: { nodes: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)),
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
        const c = this.cell(i, j, n);
        slices.push({ band: bandId(n), i, j, sites: c.sites.map((s) => ({ id: s.id, owner: s.owner || s.id, kind: s.kind, rects: clone(s.rects), connections: s.conns.slice() })),
          connections: c.conns.map((v) => ({ ...clone(v), floorZ: n * CFG.spacing })) });
        for (const s of c.sites) {
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
      return { schema: 'br.world-elevation/0.1', units: 'metres', axes: 'XY horizontal, Z up', seed: this.seed, policy: { spacing: CFG.spacing, verticalJourneys: 'composed', journeysPerRegion: 1, regionCells: CFG.regionCells }, journeys,
        region: [i0, j0, i1, j1], bands: bands.map((n) => ({ id: bandId(n), elevation: n * CFG.spacing })), slices,
        layouts: [...layouts.values()].sort((a, b) => a.owner.localeCompare(b.owner)), reservations: [...reservations.values()].sort((a, b) => a.owner.localeCompare(b.owner)),
        navigation: g.navigation, portalMatches: g.matches, frontier: g.dangling, verticalFrontier: g.verticalFrontier, issues: g.issues, unresolved: g.unresolved };
    }
  }
  BR.placeElevationBlueprint = placeBlueprint; BR.BAND_CFG = CFG; BR.BandWorld = BandWorld;
})(typeof window !== 'undefined' ? window : globalThis);
