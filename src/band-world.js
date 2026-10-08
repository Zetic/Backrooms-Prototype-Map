/* Deterministic horizontal bands, joined by what grows between them
 * (growth.js).
 *
 * Every band is its own world (world.js): the same 128 m cells, planned from
 * the band's own seed, at its own floor 16 m apart. Nothing is reserved
 * between bands any more. A column of the world holds several owners stacked
 * (claims.js): a ground site keeps its floor and has its ceiling capped where
 * a growth's floor stands over it. A growth starts at a pillar (a house's
 * stairwell carried on up, or a block's stair cell), spreads branches of its
 * biome and climbs on by short legs; where it reaches the next band's floor
 * it lands in one of that band's landing sites, rebuilt round the climb. The
 * plan of every growth is a pure function of (seed, band, origin cell), so
 * whichever band or cell is asked for first, every band agrees.
 * See docs/elevation-world.md and docs/growth.md. */
(function (root) {
  'use strict';
  const BR = root.BR, E = BR.ELEV, C = BR.WORLD_CFG.cell;
  // a site's envelope: from its lowest allowed floor (a sunken floor, floorLimit)
  // less its slab, to ceilingLimit - one band spacing in all, so bands never overlap
  const CFG = { spacing: 16, floorLimit: -1.25, ceilingLimit: 14.5,
    // a branch (growth steps 2-3): a house that seeds growth carries its
    // stairwell one flight on up (its pillar, `rise` at least), and a district
    // of its biome (biomes.js) grows at each of its floors over 1-4 sites,
    // `area` m² at most a level. A `share` of the houses that could seed do.
    branch: { rise: 3.3, headroom: 3, share: 0.75, sites: [1, 4], area: 1200, reach: [1, 8], door: 2, minArea: 70, minShared: 5, pit: { size: 2, fall: 3 } },
    limits: { bands: 4, claims: 256, branches: 64, raised: 64 } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const EPS = 1e-7;
  const bandId = (n) => 'band:' + n;
  const assertBand = (n) => { if (!Number.isInteger(n) || Math.abs(n) > 10000) throw new Error('band must be an integer between -10000 and 10000'); return n; };
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
    // (a climb that stays in its home band: its landing's band is the home band, listed once)
    b.bands = b.bands.filter((a, k) => b.bands.findIndex((x) => x.id === a.id) === k);
    const terr = new Map();
    for (const t of b.bandTerritories) { if (terr.has(t.band)) terr.get(t.band).rects.push(...t.rects); else terr.set(t.band, t); }
    b.bandTerritories = [...terr.values()];
    return b;
  }

  class BandWorld {
    constructor(seed, options) {
      this.seed = seed >>> 0; this.options = options || {}; this.band = 0;
      this.limits = Object.assign({}, CFG.limits, this.options.elevationLimits);
      if (Object.values(this.limits).some((n) => !Number.isInteger(n) || n < 1)) throw new Error('elevation cache limits must be positive integers');
      this.worlds = new Map(); this.candidates = new Map(); this.growths = new Map(); this.raisedBuilds = new Map();
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
      const w = new BR.World(seed, { band: n, floorZ: n * CFG.spacing, limits: this.options.limits, afterBuild: (s, r) => this.afterBuild(s, r) });
      this.worlds.set(n, w);
      while (this.worlds.size > this.limits.bands) {
        const first = this.worlds.keys().next().value, old = this.worlds.get(first);
        for (const k of Object.keys(this.totals)) this.totals[k] += old.stats[k];
        this.worlds.delete(first);
      }
      return w;
    }
    // --------------------------------------------------------- growth
    /**
     * The growth from origin cell (i, j) of band n, or null (growth.js): its
     * pillar, its levels of raised sites, the legs between them, its arrival on
     * the next band's floor, the ground caps under it and its pit. Cached and
     * pure: the same for any seed, band and cell, in any order.
     */
    growth(n, i, j) {
      assertBand(n);
      if (!BR.CLAIM || !BR.BIOME || !BR.GROWTH) return null;
      const v = BR.World.lru(this.growths, n + '|' + i + ',' + j, this.limits.branches, () => BR.GROWTH.plan(this, n, i, j) || false);
      return v || null;
    }
    /** the growth that may use cell (i, j) of band n (its owner's), or null */
    growthAt(n, i, j) {
      if (!BR.CLAIM || !BR.BIOME || !BR.GROWTH || Math.abs(n) > 10000) return null;
      const o = BR.GROWTH.owner(this, n, i, j);
      return o ? this.growth(n, o[0], o[1]) : null;
    }
    /** a raised site's growth */
    growthOf(rs) { const m = /^growth:(-?\d+):(-?\d+),(-?\d+)$/.exec(rs.growth); return m ? this.growth(+m[1], +m[2], +m[3]) : null; }
    /** the raised sites standing in cell (i, j) of band n (of whichever growth owns it) */
    raisedSites(n, i, j) { const G = this.growthAt(n, i, j); return G ? G.sites.filter((rs) => rs.i === i && rs.j === j) : []; }
    /** the growths already planned (none is planned for this): what the plan view draws */
    plannedGrowths(n) { return [...this.growths.values()].filter((G) => G && G.band === n); }
    /** every raised site whose rects meet [x0, y0, x1, y1] in the active band (`planned`: only of growths already planned) */
    raisedIn(x0, y0, x1, y1, planned) {
      const meets = (rs) => rs.rects.some((q) => q[0] < x1 && q[2] > x0 && q[1] < y1 && q[3] > y0);
      if (planned) return this.plannedGrowths(this.band).flatMap((G) => G.sites).filter(meets);
      const out = [];
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++)
        for (const rs of this.raisedSites(this.band, i, j)) if (meets(rs)) out.push(rs);
      return out;
    }
    /** the raised site at (x, y) in the active band, or null (the highest, where floors stand over floors) */
    raisedAt(x, y) {
      const hit = this.raisedSites(this.band, Math.floor(x / C), Math.floor(y / C)).filter((rs) => rs.rects.some((q) => x >= q[0] && x < q[2] && y >= q[1] && y < q[3]));
      return hit.sort((a, b) => b.floorZ - a.floorZ)[0] || null;
    }
    /** the climbs arriving in the active band from the band below whose landing meets [x0, y0, x1, y1]: [{ growth, arrival, site }] */
    arrivalsIn(x0, y0, x1, y1, planned) {
      const n = this.band - 1, out = [], meets = (A) => A.box[0] < x1 && A.box[2] > x0 && A.box[1] < y1 && A.box[3] > y0;
      if (n < -10000) return out;
      const list = planned ? this.plannedGrowths(n) : [];
      if (!planned) for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++) {
        const G = this.growthAt(n, i, j);
        if (G && !list.includes(G)) list.push(G);
      }
      for (const G of list) if (G.arrival && meets(G.arrival)) out.push({ growth: G, arrival: G.arrival, site: G.sites.find((rs) => rs.id === G.arrival.site) });
      return out;
    }
    /** a raised site's blueprints, in the shape of any other site's build (spatial already): its biome filler and the rooms inside it */
    raisedBuild(rs) {
      return BR.World.lru(this.raisedBuilds, rs.id, this.limits.raised, () => {
        const t0 = clock(), G = this.growthOf(rs), b = clone(rs.b);
        // the pit's own floor cutout: the ground site below cuts its ceiling (`spatial`)
        if (G && G.pit && G.pit.top.site === rs.id) BR.CLAIM.drill(b, null, G.pit, G.pit.id);
        return { site: rs, owner: rs.owner, origin: rs.origin.slice(), fillerOrigin: rs.fillerOrigin.slice(), filler: b,
          buildings: rs.buildings.map((x) => ({ poi: { ...x.poi }, origin: x.origin.slice(), b: clone(x.b), conns: { ...x.conns } })),
          conns: rs.conns.map((cn) => BR.GROWTH.connView(cn, rs.id, rs.origin)), issues: [], ms: clock() - t0 };
      });
    }
    /** the arrival from the band below that lands in this ground site, or null */
    arrivalInto(site) {
      if (!BR.GROWTH || !BR.GROWTH.landingSite(this, site.band, site)) return null;
      const G = this.growthAt(site.band - 1, site.i, site.j);
      return G && G.arrival && G.arrival.ground === site.id ? G.arrival : null;
    }
    /** the absolute height a ground site's claim stops at: a growth's floor slab, or its band's ceiling */
    ceilingOf(site) {
      const G = this.growthAt(site.band, site.i, site.j), cap = G && G.caps.find((c) => c.site === site.id);
      return cap ? cap.cap : site.band * CFG.spacing + CFG.ceilingLimit;
    }
    /** a ground site's claim: its column from under its floor to its ceiling (less a climb from below that lands in it), and a stair pillar's climb */
    claimOf(site) {
      const owner = site.owner || site.id, z0 = site.band * CFG.spacing + CFG.floorLimit - E.SLAB, A = this.arrivalInto(site);
      const rects = A ? site.rects.flatMap((q) => BR.TG.rsub(q, A.box)) : clone(site.rects);
      const out = [{ id: owner + ':envelope', kind: 'site-envelope', rects, z0, z1: this.ceilingOf(site) }];
      const G = this.growthAt(site.band, site.i, site.j);
      if (G && G.stair && G.stair.site === site.id) out.push({ id: owner + ':climb', kind: 'pillar-climb', rects: [G.stair.box.slice()], z0, z1: G.stair.top });
      return out;
    }
    /** a raised site's claim: from its own floor slab to its top (the next floor's slab, or the band's ceiling), and the climb it carries */
    raisedClaim(rs) {
      const out = [{ id: rs.owner + ':envelope', kind: 'branch-envelope', rects: clone(rs.rects), z0: rs.floorZ - E.SLAB, z1: rs.top }];
      if (rs.leg) out.push({ id: rs.owner + ':climb', kind: 'leg-climb', rects: [rs.leg.box.slice()], z0: rs.floorZ - E.SLAB, z1: rs.leg.top });
      return out;
    }
    /** the last word on a ground build: ceilings capped under a floor above, a stair carried up, a climb from below landing in it */
    afterBuild(site, r) {
      if (!BR.CLAIM || !BR.GROWTH) return;
      const G = this.growthAt(site.band, site.i, site.j);
      if (G) {
        if (G.stair && G.stair.site === site.id) {
          // the stair pillar: its own filler, taking the stair up (already spatial)
          r.filler = clone(G.stair.b); r.fillerOrigin = G.stair.fillerOrigin.slice();
        } else {
          const cap = G.caps.find((c) => c.site === site.id);
          if (cap) for (const b of [r.filler].concat(r.buildings.map((x) => x.b))) {
            if (b && !E.capCeilings(b, cap.cap - site.band * CFG.spacing)) r.issues.push(site.id + ' cannot keep under ' + G.id);
          }
        }
        // the lower half of the pit, named on the ground build so the map
        // draws it; its cutout and shaft come with spatial adaptation
        if (G.pit && G.pit.bottom.site === site.id && r.filler) BR.CLAIM.markDrop(r.filler, G.pit, G.pit.id, 'bottom');
        if (G.landing && site.id === G.anchor) {
          const host = r.buildings.find((x) => x.poi.id === G.poi);
          if (host) { host.b = clone(G.landing.b); host.conns[G.landing.portal] = G.landing.connection; }
        }
      }
      const A = this.arrivalInto(site);
      if (A) { r.filler = clone(A.b); r.fillerOrigin = A.origin.slice(); r.conns = clone(A.conns); r.buildings = []; }
    }
    /** does this POI of cell (i, j) of band n seed growth? A share of those that could (`branch.share`), by the seed alone */
    seedsGrowth(n, i, j, P) {
      if (!BR.BIOME || !BR.BIOME.anchorOf(BR.TPL.archetypes[P.archetype])) return false;
      const seed = n === 0 ? this.seed : BR.hash4(this.seed, n, 0, 0xba01);
      return BR.hash4(seed, i, j, 0xba08 ^ BR.TG.hashStr(P.id)) / 4294967296 < CFG.branch.share;
    }
    /** can a ground site keep everything it builds under a cap `rel` metres over its band (a raw build)? */
    keepsUnder(site, rel) {
      const r = this.worldFor(site.band).buildRaw(site);
      return !r.issues.length && [r.filler].concat(r.buildings.map((x) => x.b)).every((b) => !b || E.capCeilings(b, rel));
    }
    /**
     * The nearest way up (a growth from the active band that reaches the next
     * one: where it starts) or down (a climb from the band below that arrives
     * in the active band: where it lands) from (x, y), searched outward ring
     * by ring of cells. { growth, at: [x, y], band (the band it leads to) } or null.
     */
    nearestWay(direction, x, y, rings) {
      if (!['up', 'down'].includes(direction)) throw new Error('direction must be up or down');
      const n = direction === 'up' ? this.band : this.band - 1, ci = Math.floor(x / C), cj = Math.floor(y / C), seen = new Set();
      for (let r = 0; r <= (rings === undefined ? 3 : rings); r++) {
        const found = [];
        for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          const G = this.growthAt(n, i, j);
          if (!G || !G.arrival || seen.has(G.id)) continue;
          seen.add(G.id);
          const box = direction === 'down' ? G.arrival.box : G.stair ? G.stair.box : this.site(G.anchor).bbox;
          found.push({ growth: G, at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], band: direction === 'up' ? n + 1 : n });
        }
        if (found.length) return found.sort((a, b) => Math.hypot(a.at[0] - x, a.at[1] - y) - Math.hypot(b.at[0] - x, b.at[1] - y) || a.growth.id.localeCompare(b.growth.id))[0];
      }
      return null;
    }
    bandOf(siteOrId) { const id = typeof siteOrId === 'string' ? siteOrId : siteOrId.id; const m = /^b(-?\d+)\|/.exec(id); if (!m) throw new Error('missing band in site id'); return +m[1]; }
    cell(i, j, band) { return this.worldFor(band === undefined ? this.band : band).cell(i, j); }
    cellAt(x, y) { return this.active.cellAt(x, y); }
    site(id) {
      const m = /^b(-?\d+)\|(-?\d+),(-?\d+):raised\d+\.\d+$/.exec(id);
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
      if (!r.spatial) {
        const top = this.ceilingOf(s) - s.band * CFG.spacing;
        const adapt = (b, id) => {
          // (a stair pillar's filler is spatial already: it takes its stair up out of the claim)
          if (b.schema === E.SCHEMA) return b;
          const a = E.prepare(b, { fillId: id, deferCapabilities: true });
          if (a.surfaces.some((v) => v.floorZ < CFG.floorLimit - 1e-9 || v.ceilingZ > top + 1e-9)) throw new Error(id + ' exceeds its planned claim');
          return placeBlueprint(a, s.band * CFG.spacing, s.band, s.band);
        };
        const t = clock();
        r.spatial = { ...r, filler: r.filler && adapt(r.filler, s.id),
          buildings: r.buildings.map((B) => ({ ...B, b: adapt(B.b, s.id + '/' + B.poi.id) })) };
        // the lower half of a pit: its own ceiling cutout, where the floor above drilled down
        const G = BR.CLAIM && this.growthAt(s.band, s.i, s.j), pit = G && G.pit;
        if (pit && pit.bottom.site === s.id && r.spatial.filler) BR.CLAIM.drill(null, r.spatial.filler, pit, pit.id);
        w.stats.buildMs += clock() - t;
      }
      return r.spatial;
    }
    connection(s, id) {
      if (s.kind === 'branch') {
        const own = s.conns.find((cn) => cn.id === id), G = !own && this.growthOf(s);
        return own || (G && G.conns.find((cn) => cn.id === id)) || null;
      }
      const G = this.growthAt(s.band, s.i, s.j), own = G && G.conns.find((cn) => cn.id === id);
      if (own) return own;
      const A = /:up$/.test(id) && this.arrivalInto(s);
      if (A && A.conn.id === id) return A.conn;
      return this.worldFor(s.band).connection(s, id);
    }
    peer(s, cn) { return this.worldFor(s.band).peer(s, cn); }
    neighbours(s) { return this.worldFor(s.band).neighbours(s); }
    seamsBetween(a, b) {
      if (a.band !== b.band) return [];
      // (a stair pillar's filler is spatial already: no seam is rolled on it)
      if ([this.build(a), this.build(b)].some((r) => r.filler && r.filler.schema === E.SCHEMA)) return [];
      return this.worldFor(a.band).seamsBetween(a, b);
    }
    biomeAt(x, y) { return this.active.biomeAt(x, y); }
    /** Conservative planned ownership, including protected unused space.
     * This index is local to a query. Cache eviction cannot release ownership. */
    reservationPlan(i, j, bandMin, bandMax) {
      assertBand(bandMin); assertBand(bandMax);
      if (bandMax < bandMin) throw new Error('reservation band range is reversed');
      const index = new E.ReservationIndex(), owners = new Set();
      const claim = (owner, vs) => {
        if (owners.has(owner)) return; owners.add(owner);
        const r = index.reserve(owner, vs);
        if (!r.ok) throw new Error(owner + ' reservation overlaps ' + r.conflicts[0].owner);
      };
      for (let n = bandMin; n <= bandMax; n++) {
        // a ground site owns its column up to its claim's ceiling, which a
        // floor standing over it caps at that floor's own slab
        for (const s of this.cell(i, j, n).sites) claim(s.owner || s.id, this.claimOf(s));
        // the floors stacked over them: from their own floor slab up
        for (const rs of this.raisedSites(n, i, j)) claim(rs.owner, this.raisedClaim(rs));
      }
      return index.snapshot();
    }
    /** Authoritative spatial graph: matching requires exact world XYZ, width,
     * and opposite sides. Shared fill nodes are emitted once across slices. */
    graph(i0, j0, i1, j1, bands) {
      bands = bands || [this.band];
      const nodes = new Set(), edges = [], directed = [], ends = new Map(), records = new Map(), issues = [], unresolved = [], verticalFrontier = new Map(), expected = new Set(), falls = new Map();
      const inR = (q) => q[0] >= i0 && q[0] <= i1 && q[1] >= j0 && q[1] <= j1;
      // a climb between bands is matched only when both its bands are asked for
      const crossing = (raw) => { const m = /^b(-?\d+)\|-?\d+,-?\d+:up$/.exec(raw || ''); return m ? [+m[1], +m[1] + 1] : null; };
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
          const raw = bindings ? bindings[p.id] : p.connection, across = crossing(raw);
          const opening = b.openings.find((o) => o.id === p.opening);
          if (!raw || (across && !across.every((n) => bands.includes(n)))) {
            if (raw || !bands.includes(Number(p.band.split(':')[1]))) verticalFrontier.set(pre + '/' + p.id,
              { owner: pre, portal: p.id, band: p.band, state: 'outside-region', at: [p.at[0] + origin[0], p.at[1] + origin[1], p.floorZ], width: p.width });
            continue;
          }
          // LOT's POI-door IDs are site-local; only planned cell/border and
          // growth IDs already carry their globally unique band prefix.
          const id = /^b-?\d+\|/.test(raw) ? raw : site.id + '#' + raw;
          if (!ends.has(id)) ends.set(id, []);
          const surface = b.surfaces.find((s) => s.room === p.room);
          const height = Math.min(opening.height || 2.2, surface.ceilingZ - surface.floorZ);
          ends.get(id).push({ node: pre + '/s:' + p.room, at: [p.at[0] + origin[0], p.at[1] + origin[1], p.floorZ], width: p.width, clearance: height, side: p.side, site: site.id, opening: opening.id });
        }
      };
      for (const n of [...new Set(bands)].sort((a, b) => a - b)) {
        assertBand(n);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const cell = this.cell(i, j, n), raised = this.raisedSites(n, i, j), G = this.growthAt(n, i, j);
          for (const cn of cell.conns) if (!cn.cross || inR(cn.peerCell)) expected.add(cn.id);
          // a growth's own doors and climbs, both ends asked for
          for (const cn of G ? G.conns : []) {
            const across = crossing(cn.id);
            if (cn.cells.every(inR) && cn.cells.some((q) => q[0] === i && q[1] === j) && (!across || across.every((m) => bands.includes(m)))) expected.add(cn.id);
          }
          for (const s of cell.sites.concat(raised)) {
            const r = this.spatial(s);
            if (r.filler) add(s, r.filler, r.fillerOrigin, s.owner || s.id);
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
          const leaves = cn && (cn.cells ? !cn.cells.every(inR) : cn.cross && !inR(cn.peerCell));
          if (!leaves) issues.push(id + ' is missing an internal portal endpoint');
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
    /** a growth as the export lists it */
    growthSummary(G) {
      return { id: G.id, band: bandId(G.band), origin: [G.i, G.j], pillar: G.pillar, biome: G.biome, steered: G.steered, cells: clone(G.cells),
        levels: G.levels.map((l) => ({ level: l.level, floorZ: l.floorZ, sites: l.sites.slice() })),
        legs: G.legs.map((l) => ({ level: l.level, site: l.site, type: l.type, rise: l.rise, connection: l.conn })),
        arrival: G.arrival ? { band: bandId(G.arrival.band), site: G.arrival.site, ground: G.arrival.ground, type: G.arrival.type, rise: G.arrival.rise, connection: G.arrival.conn.id } : null,
        pit: G.pit ? G.pit.id : null };
    }
    exportRegion(i0, j0, i1, j1, bands) {
      bands = [...new Set(bands || [this.band])].sort((a, b) => a - b);
      if (!bands.length) throw new Error('export needs at least one band');
      if (![i0, j0, i1, j1].every(Number.isInteger) || i1 < i0 || j1 < j0 || (i1 - i0 + 1) * (j1 - j0 + 1) * bands.length > 64) throw new Error('export needs an integer region of at most 64 band cells');
      const layouts = new Map(), slices = [], reservations = new Map(), growths = new Map();
      for (const n of bands) for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const c = this.cell(i, j, n), G = this.growthAt(n, i, j), below = n > -10000 ? this.growthAt(n - 1, i, j) : null, raised = this.raisedSites(n, i, j);
        if (G) growths.set(G.id, this.growthSummary(G));
        // the growth connections with an end in this cell of this band
        const here = (id) => id && id.startsWith('b' + n + '|' + i + ',' + j + ':');
        const extra = (G ? G.conns : []).concat(below && below.arrival ? [below.arrival.conn] : []).filter((cn) => here(cn.a) || here(cn.b));
        slices.push({ band: bandId(n), i, j,
          sites: c.sites.map((s) => ({ id: s.id, owner: s.owner || s.id, kind: s.kind, rects: clone(s.rects), connections: s.conns.slice(), floorZ: n * CFG.spacing, ceilingZ: this.ceilingOf(s) })),
          // the floors stacked over this cell's ground, each with its own floor and top
          raised: raised.map((rs) => ({ id: rs.id, owner: rs.owner, kind: rs.kind, growth: rs.growth, biome: rs.biome, level: rs.level, hop: rs.hop, over: rs.over, rects: clone(rs.rects),
            connections: rs.conns.map((cn) => cn.id).concat(rs.leg ? [rs.leg.conn] : []), floorZ: rs.floorZ, ceilingZ: rs.top })),
          connections: c.conns.map((v) => ({ ...clone(v), floorZ: n * CFG.spacing })).concat([...new Map(extra.map((v) => [v.id, clone(v)])).values()]) });
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
      const GC = BR.GROWTH ? BR.GROWTH.CFG : {};
      return { schema: 'br.world-elevation/0.3', units: 'metres', axes: 'XY horizontal, Z up', seed: this.seed,
        policy: { spacing: CFG.spacing, verticalJourneys: 'grown', layeredOwnership: 'stacked-claims',
          growth: { pillars: ['house', 'stair'], block: GC.block, steer: GC.steer, carry: GC.carry, landings: GC.landings, rise: (GC.rise || []).slice(),
            share: CFG.branch.share, sites: CFG.branch.sites.slice(), biomes: Object.keys((BR.BIOME && BR.BIOME.DEFS) || {}) } },
        growths: [...growths.values()].sort((a, b) => a.id.localeCompare(b.id)),
        region: [i0, j0, i1, j1], bands: bands.map((n) => ({ id: bandId(n), elevation: n * CFG.spacing })), slices,
        layouts: [...layouts.values()].sort((a, b) => a.owner.localeCompare(b.owner)), reservations: [...reservations.values()].sort((a, b) => a.owner.localeCompare(b.owner)),
        navigation: g.navigation, portalMatches: g.matches, pits: g.pits, frontier: g.dangling, verticalFrontier: g.verticalFrontier, issues: g.issues, unresolved: g.unresolved };
    }
  }
  BR.placeElevationBlueprint = placeBlueprint; BR.BAND_CFG = CFG; BR.BandWorld = BandWorld;
})(typeof window !== 'undefined' ? window : globalThis);
