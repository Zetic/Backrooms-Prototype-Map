/*
 * Experimental elevation contract and compact connection variants.
 * Bands are reference elevations; levels group actual floor elevations.
 * All geometry is in metres, Z up. See docs/elevation.md.
 *
 * br.elevation/0.2: a connector reserves a list of prisms (`reservations`)
 * that follow its path, so a ramp claims its slope and headroom rather than
 * its whole bounding box. A ladder's list holds its one shaft prism. 0.1
 * blueprints (one `reservation`) are read and upgraded by prepare().
 * Connection zones (connections.js) describe where ladders, stairs and ramps
 * fit; an unselected zone cuts nothing, reserves nothing and adds no edge.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG;
  // STOREY: floors within this of each other count as one storey (a sunken
  // floor or a raised platform beside the main floor)
  const E = BR.ELEV = { SCHEMA: 'br.elevation/0.2', LEGACY: ['br.elevation/0.1'], SLAB: 0.25, STOREY: 1.5 };
  /** a connector's reserved prisms, whichever schema wrote it */
  const reservationsOf = (c) => c.reservations || (c.reservation ? [c.reservation] : []);
  const EPS = 1e-7, clone = (v) => JSON.parse(JSON.stringify(v));
  const round = (n) => Math.round(n * 1000) / 1000;
  const overlap = (a, b) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;
  const inside = (rs, p) => rs.some((r) => p[0] >= r[0] - EPS && p[0] <= r[2] + EPS && p[1] >= r[1] - EPS && p[1] <= r[3] + EPS);
  const center = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  const onSegment = (p, a, b) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) < EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
  const prism = (rects, z0, z1, kind, id) => ({ id, kind, rects: clone(rects), z0: round(z0), z1: round(z1) });
  const volumeOverlap = (a, b) => a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS && a.rects.some((r) => b.rects.some((q) => overlap(r, q)));
  const validVolume = (v) => v && Number.isFinite(v.z0) && Number.isFinite(v.z1) && v.z1 > v.z0 && Array.isArray(v.rects) && v.rects.length && v.rects.every((r) => r.length === 4 && r.every(Number.isFinite) && r[2] > r[0] && r[3] > r[1]);

  /** Atomic owner-level reservations. Touching boundaries are legal. A failed
   * replacement leaves the original reservation intact. */
  class ReservationIndex {
    constructor() { this.claims = new Map(); }
    reserve(owner, volumes) {
      if (!owner || !Array.isArray(volumes) || !volumes.length || !volumes.every(validVolume)) throw new Error('invalid spatial reservation');
      const conflicts = [];
      for (const [other, vs] of this.claims) {
        if (other === owner) continue;
        for (const v of volumes) for (const q of vs) if (volumeOverlap(v, q)) conflicts.push({ owner: other, requested: v.id, existing: q.id });
      }
      if (conflicts.length) return { ok: false, conflicts };
      this.claims.set(owner, clone(volumes));
      return { ok: true, conflicts: [] };
    }
    release(owner) { return this.claims.delete(owner); }
    snapshot() { return [...this.claims].map(([owner, volumes]) => ({ owner, volumes: clone(volumes) })); }
  }

  function floorPoint(b, surface, p) {
    return inside(surface.rects, p) && !(b.holes || []).some((h) => h.surface === surface.id && h.face === 'floor' && inside([h.rect], p));
  }
  /**
   * The surfaces an exit up or down may leave from, best first: the top (or
   * bottom) storey - floors within 1.5 m of the extreme one - its main floor
   * before a sunken floor or raised platform beside it, then the rest.
   */
  function exitOrder(b, dir) {
    const zs = b.surfaces.map((s) => s.floorZ), ext = dir === 'up' ? Math.max(...zs) : Math.min(...zs);
    const near = (s) => (Math.abs(s.floorZ - ext) <= E.STOREY + EPS ? 1 : 0), main = mainFloor(b);
    return b.surfaces.slice().sort((a, c) => (near(c) - near(a)) || (near(a) ? main(c) - main(a) : (dir === 'up' ? c.floorZ - a.floorZ : a.floorZ - c.floorZ)) || a.id.localeCompare(c.id));
  }
  /**
   * How much floor a surface's height has in all: the main floor of a storey
   * is the height with the most (a sunken floor or raised platform beside it
   * has less). Returns a function of a surface.
   */
  function mainFloor(b) {
    const by = new Map();
    for (const s of b.surfaces) { const k = round(s.floorZ); by.set(k, (by.get(k) || 0) + TG.rectsArea(s.rects)); }
    return (s) => by.get(round(s.floorZ)) || 0;
  }
  /** where the template's own stairs arrive on this surface's floor: exits keep away from them */
  const arrivalsOn = (b, s) => b.connectors.filter((c) => c.internal).flatMap((c) => c.landings).filter((p) => Math.abs(p[2] - s.floorZ) < EPS).map((p) => [p[0], p[1]]);
  function capabilities(b, opts) {
    const out = { up: { supported: true, selected: false, candidates: [] }, down: { supported: true, selected: false, candidates: [] } };
    for (const dir of ['up', 'down']) {
      const order = exitOrder(b, dir);
      for (const s of order) {
        if (s.ceilingZ - s.floorZ < 1.8 - EPS) continue;
        let best = null, score = -Infinity;
        const doors = b.openings.filter((o) => (o.rooms || []).includes(s.room) && o.kind !== 'window' && o.kind !== 'false').map((o) => center([o.a[0], o.a[1], o.b[0], o.b[1]])).concat(arrivalsOn(b, s));
        for (const r of s.rects) for (let y = r[1]; y + 1 <= r[3] + EPS; y += 0.5) for (let x = r[0]; x + 1 <= r[2] + EPS; x += 0.5) {
          const landing = [x, y, x + 1, y + 1];
          if ((b.columns || []).some((c) => c.room === s.room && overlap(landing, c.rect))) continue;
          const hatch = [x + 0.5, y, x + 1, y + 0.5];
          if ((b.holes || []).some((h) => h.surface === s.id && overlap(landing, h.rect) && h.rect.some((v, i) => Math.abs(v - hatch[i]) > EPS))) continue;
          if (b.walls.some((w) => w.kind === 'partition' && (w.rooms || []).includes(s.room) && Math.min(w.a[0], w.b[0]) < x + 1 && Math.max(w.a[0], w.b[0]) > x && Math.min(w.a[1], w.b[1]) < y + 1 && Math.max(w.a[1], w.b[1]) > y)) continue;
          const c = center(landing), d = doors.length ? Math.min(...doors.map((p) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2)) : 0;
          if (d > score) { score = d; best = landing; }
        }
        if (!best) continue;
        // A closed hatch retains the landing's floor when the connection is
        // unused. Activation below explicitly cuts the higher floor/lower roof.
        const hatch = [best[0] + 0.5, best[1], best[2], best[1] + 0.5];
        out[dir].candidates.push({ id: dir + ':' + s.id, kind: 'ladder', surface: s.id, landing: best, hatch, at: [best[0] + 0.25, best[1] + 0.5, s.floorZ], state: 'supported', variant: 'ladder-hatch' });
        // One concrete option is sufficient; favor the extreme floor so a
        // compact fallback does not tunnel through this template's other floors.
        break;
      }
    }
    // Stair and ramp opportunities (connections.js). Every direction keeps
    // its ladder candidate as the compact fallback.
    if (E.findZones) {
      const zones = opts && opts.zones ? opts.zones : E.findZones(b, out);
      for (const dir of ['up', 'down']) {
        out[dir].zones = zones.filter((z) => z.direction === dir).map((z) => z.id);
        out[dir].types = [...new Set(zones.filter((z) => z.direction === dir).map((z) => z.type))];
        out[dir].prefer = E.preferenceOf(b);
      }
      b.connectionZones = zones;
    }
    return out;
  }

  function refresh(b, options) {
    if (E.invalidateView) E.invalidateView(b);
    const elevations = [...new Set(b.rooms.map((r) => r.floorZ))].sort((a, c) => a - c);
    b.levels = elevations.map((z, index) => ({ index, elevation: z, height: Math.max(...b.rooms.filter((r) => r.floorZ === z).map((r) => r.ceiling)), band: (b.rooms.find((r) => r.floorZ === z) || {}).band }));
    const lv = (z) => elevations.indexOf(z), rooms = new Map(b.rooms.map((r) => [r.id, r]));
    for (const r of b.rooms) r.level = lv(r.floorZ);
    for (const w of b.walls) w.level = lv(w.floorZ);
    for (const o of b.openings) o.level = lv(o.floorZ);
    for (const p of b.portals) {
      const r = rooms.get(p.room), op = b.openings.find((o) => o.id === p.opening);
      p.floorZ = r.floorZ; p.level = r.level; p.band = r.band; p.state = p.state || 'landing';
      if (op) p.at = [round((op.a[0] + op.b[0]) / 2), round((op.a[1] + op.b[1]) / 2), r.floorZ];
    }
    for (const q of (b.zones || []).concat(b.columns || [], b.curves || [], b.outline || [])) q.level = lv(q.floorZ);
    b.footprint = b.levels.map((l) => ({ level: l.index, rects: b.rooms.filter((r) => r.level === l.index).flatMap((r) => clone(r.rects)) }));
    b.surfaces = b.rooms.map((r) => ({ id: 's:' + r.id, room: r.id, owner: b.fillId, band: r.band, rects: clone(r.rects), floorZ: r.floorZ, ceilingZ: r.ceilingZ, slab: E.SLAB }));
    for (const c of b.connectors) if (!c.reservations) { c.reservations = reservationsOf(c).map(clone); delete c.reservation; }
    b.volumes = b.surfaces.map((s) => prism(s.rects, s.floorZ - s.slab, s.ceilingZ, 'room', 'volume:' + s.id))
      .concat(...b.connectors.map((c) => clone(c.reservations)), clone(b.voids || []));
    b.bandTerritories = b.bands.map((band) => ({ band: band.id, elevation: band.elevation, owner: b.fillId,
      rects: b.volumes.filter((v) => v.z0 <= band.elevation + EPS && v.z1 > band.elevation + EPS).flatMap((v) => clone(v.rects)) }));
    const physical = new Map(b.connectors.map((c) => [c.id, c]));
    const edges = [];
    for (const [a, c, kind, oid] of b.graph.edges) {
      if (!rooms.has(a) || !rooms.has(c) || physical.has(oid)) continue;
      if (['window', 'false'].includes(kind)) continue;
      const same = rooms.get(a).floorZ === rooms.get(c).floorZ;
      edges.push({ from: 's:' + a, to: 's:' + c, kind, opening: oid, direction: 'both', connected: same, status: same ? 'connected' : 'legacy-unresolved' });
    }
    for (const c of b.connectors) edges.push({ from: c.from, to: c.to, kind: c.kind, connector: c.id, direction: c.direction, connected: c.state === 'connected', status: c.state });
    b.navigation = { nodes: b.surfaces.map((s) => s.id), edges, complete: !edges.some((e) => e.status === 'legacy-unresolved') };
    const keep = b.capabilities, deferred = options && options.deferCapabilities;
    if (!deferred) b.connectionZones = [];
    // a variant keeps the zones its template offered (options.zones) rather
    // than searching again round its own new landing
    b.capabilities = deferred
      ? { up: { supported: true, selected: false, candidates: [], deferred: true }, down: { supported: true, selected: false, candidates: [], deferred: true } }
      : capabilities(b, { zones: options && options.zones });
    // a selected connection survives a refresh
    if (keep) for (const dir of ['up', 'down']) if (keep[dir] && keep[dir].selected) { b.capabilities[dir].selected = true; b.capabilities[dir].connection = keep[dir].connection; b.capabilities[dir].type = keep[dir].type; }
    if (b.connectionZones) for (const z of b.connectionZones) { const c = b.connectors.find((k) => k.zone === z.id); if (c) { z.state = 'connected'; z.connector = c.id; } }
    return b;
  }

  /** Adapter used on demand by the lab. The original blueprint is never mutated.
   * Existing compact stories belong to the home band, independent of their Z. */
  function prepare(source, options) {
    if (!source || source.error) throw new Error((source && source.error) || 'missing blueprint');
    const o = options || {};
    if (source.schema === E.SCHEMA || E.LEGACY.includes(source.schema)) {
      const b = clone(source);
      if (b.schema !== E.SCHEMA) { b.schema = E.SCHEMA; return refresh(b, o); }
      if (!o.deferCapabilities && b.capabilities.up.deferred) b.capabilities = capabilities(b);
      return b;
    }
    const b = clone(source), base = o.elevation || 0;
    delete b.stairs;                     // kept stairs become connectors below
    b.source = { schema: source.schema, archetype: source.archetype || source.filler, engine: source.engine, seed: source.seed };
    b.schema = E.SCHEMA; b.kind = 'adapter';
    b.fillId = o.fillId || 'fill:' + (source.archetype || source.filler) + ':' + source.seed;
    b.bands = [{ id: 'ground', elevation: base }];
    const old = source.levels || [{ index: 0, elevation: 0 }], z = (level) => round(base + (old.find((l) => l.index === (level || 0)) || old[0]).elevation);
    // a room's `floor` is its offset from its level: a sunken floor below it
    const rz = new Map();
    for (const r of b.rooms) { r.floorZ = round(z(r.level) + (r.floor || 0)); r.ceilingZ = round(r.floorZ + r.ceiling); r.band = 'ground'; rz.set(r.id, r.floorZ); }
    for (const q of b.walls.concat(b.openings, b.zones || [], b.columns || [], b.curves || [], b.outline || [])) q.floorZ = z(q.level);
    // zones and columns stand on their own room's floor
    for (const q of (b.zones || []).concat(b.columns || [])) if (rz.has(q.room)) q.floorZ = rz.get(q.room);
    for (const w of b.walls) { const rm = b.rooms.find((r) => (w.rooms || []).includes(r.id)); w.ceilingZ = rm ? rm.ceilingZ : round(w.floorZ + 2.5); }
    b.connectors = []; b.holes = []; b.voids = []; b.route = [];
    // The template's own stairs (`verticals`) become physical connections
    // where they fit; any that cannot stay unresolved in navigation.
    if (resolvable(source).length) { refresh(b, { deferCapabilities: true }); resolveVerticals(b, source, base); }
    return refresh(b, o);
  }

  // ------------------------------------------------------------ a template's own stairs, kept
  /**
   * What a blueprint's stairs are laid out against: its floors, rooms, walls,
   * openings, columns, zones and verticals. A kept stair stands only while
   * this still matches.
   */
  function stairsKey(b) {
    return TG.hashStr(JSON.stringify([(b.levels || []).map((l) => [l.index, l.elevation]),
      b.rooms.map((r) => [r.id, r.rects, r.level || 0, r.floor || 0, r.ceiling]),
      b.walls.map((w) => [w.a, w.b, w.level || 0, w.kind || '', w.rooms || []]),
      b.openings.map((o) => [o.a, o.b, o.level || 0]),
      (b.columns || []).map((c) => [c.rect, c.level || 0, c.room]), (b.zones || []).map((z) => [z.room, z.rects]),
      resolvable(b).map((v) => [v.id, v.rooms, v.types, v.kind, v.shape, v.walled])]));
  }
  /** a connector moved up by dz (its path, landings and reserved prisms) */
  function liftConnector(c, dz) {
    const k = clone(c);
    if (!dz) return k;
    for (const p of k.path.concat(k.landings)) p[2] = round(p[2] + dz);
    for (const v of reservationsOf(k)) { v.z0 = round(v.z0 + dz); v.z1 = round(v.z1 + dz); }
    return k;
  }
  const keptCache = new WeakMap();
  /** a template's kept stairs (b.stairs.links), or null if it has none or its geometry has changed since */
  function keptStairs(b) {
    if (!b || !b.stairs || b.schema === E.SCHEMA) return null;
    if (!keptCache.has(b)) keptCache.set(b, b.stairs.key === stairsKey(b) ? b.stairs.links : null);
    return keptCache.get(b);
  }
  /**
   * Lay a template's own stairs out once, where it is generated, and keep them
   * on it: b.stairs = { key, links: [{ vertical, link, connector, holes }] },
   * in its own frame (heights from its ground floor). prepare() takes them as
   * they are instead of laying them out again, and the map draws them without
   * adapting the blueprint. `prepared`: an adaptation of this very blueprint
   * already made (a floor pattern's proof), so nothing is laid out twice.
   */
  function bakeStairs(b, prepared) {
    if (!b || b.error || b.schema === E.SCHEMA) return b;
    delete b.stairs; keptCache.delete(b);
    if (!resolvable(b).length || !E.linkFloors) return b;
    let p = prepared;
    if (!p) { try { p = prepare(b, { deferCapabilities: true }); } catch (err) { return b; } }
    const links = p.connectors.filter((c) => c.internal && c.vertical && c.link)
      .map((c) => ({ vertical: c.vertical, link: c.link, connector: liftConnector(c, -(p.bands[0].elevation || 0)), holes: clone(p.holes.filter((h) => h.connector === c.id)) }));
    if (links.length) b.stairs = { key: stairsKey(b), links };
    return b;
  }

  /**
   * Keep a template under a cap: every room's ceiling at most `cap` metres
   * above the template's ground floor (something else owns the space above,
   * band-world.js). Floors stay where they are; only ceilings come down, and
   * the template's own stairs are laid out again under them. Changes `b` in
   * place. false if a room would be left under 2.2 m, or a stair it had no
   * longer fits: the caller builds it again without its extra floors.
   */
  function capCeilings(b, cap) {
    if (!b || b.error || b.schema === E.SCHEMA) return !b || !b.error;
    const level = (lv) => (b.levels.find((l) => l.index === (lv || 0)) || b.levels[0]).elevation;
    let changed = false;
    for (const r of b.rooms) {
      const z = level(r.level) + (r.floor || 0), room = Math.floor((cap - z) * 20 + EPS) / 20;
      if ((r.ceiling || 2.5) <= room + EPS) continue;
      if (room < 2.2 - EPS) return false;
      r.ceiling = round(room); changed = true;
    }
    if (!changed) return true;
    for (const l of b.levels) if (l.height !== undefined) l.height = round(Math.min(l.height, cap - l.elevation));
    const had = b.stairs ? b.stairs.links.length : 0;
    if (had) { bakeStairs(b); if (!b.stairs || b.stairs.links.length < had) return false; }
    return true;
  }

  const resolvable = (source) => (source.verticals || []).filter((v) => !v.dead && Array.isArray(v.rooms) && v.rooms.length >= 2);
  /**
   * Each pair of rooms a source vertical joins (consecutive storeys of a
   * stairwell, a floor and the sunken floor beside it, a hall and its
   * gallery) gets a real stair or ramp between their actual floors, with its
   * cutouts and reservation, in place of the abstract link.
   */
  function resolveVerticals(b, source, base) {
    if (!E.linkFloors) return;
    // stairs kept on the template where it was generated are taken as they are
    const kept = new Map((keptStairs(source) || []).map((l) => [l.vertical + ':' + l.link, l]));
    for (const v of resolvable(source)) for (let k = 1; k < v.rooms.length; k++) {
      const ra = b.rooms.find((r) => r.id === v.rooms[k - 1]), rc = b.rooms.find((r) => r.id === v.rooms[k]);
      if (!ra || !rc || Math.abs(ra.floorZ - rc.floorZ) < EPS) continue;
      const [lo, hi] = ra.floorZ < rc.floorZ ? [ra, rc] : [rc, ra];
      const types = v.types || (v.kind === 'ramp' ? ['ramp', 'stair'] : ['stair', 'ramp']);
      const s = kept.get(v.id + ':' + k);
      const got = s && s.connector.from === 's:' + lo.id && s.connector.to === 's:' + hi.id ? { connector: liftConnector(s.connector, base || 0), holes: clone(s.holes) }
        : E.linkFloors(b, 's:' + lo.id, 's:' + hi.id, { types, shape: v.shape, walled: v.walled, id: 'link:' + (v.id || 'v') + ':' + k });
      if (!got) continue;
      got.connector.vertical = v.id; got.connector.link = k;
      b.connectors.push(got.connector); b.holes.push(...got.holes);
      // a stair arriving over a rail (a gallery's open edge): the rail keeps a gap for it
      const arr = got.connector.arrival, h = arr && Math.abs(arr[0][1] - arr[1][1]) < EPS;
      if (arr) for (const w of b.walls) {
        if (w.kind !== 'open' || !(w.tags || []).includes('rail') || Math.abs(w.floorZ - hi.floorZ) > EPS || (Math.abs(w.a[1] - w.b[1]) < EPS) !== h) continue;
        const k = h ? 1 : 0, along = h ? 0 : 1;
        if (Math.abs(w.a[k] - arr[0][k]) > EPS) continue;
        const lo2 = Math.max(Math.min(w.a[along], w.b[along]), Math.min(arr[0][along], arr[1][along])), hi2 = Math.min(Math.max(w.a[along], w.b[along]), Math.max(arr[0][along], arr[1][along]));
        if (hi2 - lo2 > EPS) (w.gaps = w.gaps || []).push({ from: lo2, to: hi2, connector: got.connector.id });
      }
      const e = b.graph.edges.find((x) => !x[3] && ((x[0] === ra.id && x[1] === rc.id) || (x[0] === rc.id && x[1] === ra.id)));
      if (e) e[3] = got.connector.id; else b.graph.edges.push([lo.id, hi.id, got.connector.kind, got.connector.id]);
      // the next link sees this one's cutouts and space
      refresh(b, { deferCapabilities: true });
    }
  }

  function addHoles(b, connector, lower, upper, rect) {
    b.holes.push({ id: connector + ':ceiling', connector, surface: lower, face: 'ceiling', rect: rect.slice() });
    b.holes.push({ id: connector + ':floor', connector, surface: upper, face: 'floor', rect: rect.slice() });
  }
  function ladderConnector(id, a, c, landing, hatch) {
    const p = [landing[0] + 0.25, landing[1] + 0.5], q = center(hatch);
    return { id, kind: 'ladder', from: 's:' + a.id, to: 's:' + c.id, state: 'connected', direction: 'both', width: 0.5, clearance: 1.8,
      landings: [[p[0], p[1], a.floorZ], [p[0], p[1], c.floorZ]],
      path: [[p[0], p[1], a.floorZ], [q[0], q[1], a.floorZ], [q[0], q[1], c.floorZ], [p[0], p[1], c.floorZ]],
      reservations: [prism([landing], Math.min(a.floorZ, c.floorZ) - E.SLAB, Math.max(a.floorZ, c.floorZ) + 1.8, 'connector', 'volume:' + id)] };
  }

  /** A compact real variant of ANY source template. Destination geometry and
   * its shaft are planned together, not an opening into an unknown world. */
  function ladderVariant(source, options) {
    const o = options || {}, dir = o.direction || 'up';
    if (!['up', 'down'].includes(dir)) throw new Error('connection direction must be up or down');
    const delta = o.rise === undefined ? 8 : o.rise;
    if (!Number.isFinite(delta) || delta < 3) throw new Error('ladder landing separation must be at least 3 m');
    const b = prepare(source, o);
    // a lean caller (deferCapabilities) still needs the ladder's own candidates, not every zone
    if (b.capabilities[dir].deferred) b.capabilities = capabilities(b, { zones: [] });
    const candidates = b.capabilities[dir].candidates;
    const rooms = new Map(b.rooms.map((r) => [r.id, r]));
    for (const p of candidates) {
      const trial = clone(b), host = rooms.get(trial.surfaces.find((s) => s.id === p.surface).room);
      // Tall halls need a landing above their roof. An explicit requested rise
      // remains exact and can be rejected; the standalone default adapts to fit.
      const separation = dir === 'up' && o.rise === undefined ? Math.max(delta, host.ceiling + E.SLAB + 0.25) : delta;
      const targetZ = round(host.floorZ + (dir === 'up' ? separation : -separation));
      const target = { id: 'elev:landing:' + dir, type: 'landing', name: (dir === 'up' ? 'Upper' : 'Lower') + ' landing', zone: 'circulation', floorZ: targetZ, ceiling: 2.2, ceilingZ: round(targetZ + 2.2), band: dir, rects: [p.landing.slice()], area: 1, tags: ['vertical-landing'] };
      trial.rooms.push(target); trial.bands.push({ id: dir, elevation: targetZ });
      const c = ladderConnector('elev:ladder:' + dir, host, target, p.landing, p.hatch);
      c.zone = 'zone:' + dir + ':ladder:' + p.surface;
      trial.connectors.push(c); trial.graph.nodes.push(target.id); trial.graph.edges.push([host.id, target.id, 'ladder', c.id]);
      addHoles(trial, c.id, 's:' + (host.floorZ < targetZ ? host.id : target.id), 's:' + (host.floorZ > targetZ ? host.id : target.id), p.hatch);
      // Physical shaft cannot tunnel through another pre-existing room.
      if (trial.surfaces.some((s) => s.room !== host.id && c.reservations.some((v) => volumeOverlap(v, prism(s.rects, s.floorZ - s.slab, s.ceilingZ, 'room', s.id))))) continue;
      addRoomWalls(trial, target);
      trial.kind = 'ladder-variant';
      trial.route = c.path.map((v) => v.slice());
      refresh(trial, { zones: b.connectionZones });
      trial.capabilities[dir].selected = true;
      trial.capabilities[dir].connection = c.id;
      trial.capabilities[dir].type = 'ladder';
      const check = validate(trial);
      if (check.errors.length) throw new Error(check.errors.join('; '));
      if (o.reservations) {
        const claim = o.reservations.reserve(trial.fillId, trial.volumes);
        if (!claim.ok) throw new Error('vertical connection reservation conflicts with ' + claim.conflicts[0].owner);
      }
      return trial;
    }
    throw new Error('no clear ' + dir + ' ladder variant fits this instance; another layout or territory is required');
  }

  function addRoomWalls(b, r) {
    const q = r.rects[0], pts = [[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]];
    for (let k = 0; k < 4; k++) b.walls.push({ id: 'elev:w:' + r.id + ':' + k, kind: 'exterior', a: pts[k].slice(), b: pts[(k + 1) % 4].slice(), rooms: [r.id, null], thickness: 0.3, floorZ: r.floorZ, ceilingZ: r.ceilingZ });
  }
  function reachable(b, start) {
    const adj = new Map(b.navigation.nodes.map((n) => [n, []]));
    for (const e of b.navigation.edges) {
      if (!e.connected || !adj.has(e.from) || !adj.has(e.to)) continue;
      if (e.direction !== 'reverse') adj.get(e.from).push(e.to);
      if (e.direction !== 'forward') adj.get(e.to).push(e.from);
    }
    const seen = new Set(start), todo = [...start];
    while (todo.length) for (const n of adj.get(todo.pop()) || []) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    return seen;
  }
  function validate(b) {
    const errors = [], warnings = [], bad = (s) => errors.push(s), surfaces = new Map(b.surfaces.map((s) => [s.id, s]));
    for (const [name, list] of [['room', b.rooms], ['surface', b.surfaces], ['connector', b.connectors], ['band', b.bands], ['wall', b.walls], ['opening', b.openings], ['hole', b.holes], ['volume', b.volumes]]) {
      if (new Set(list.map((v) => v.id)).size !== list.length) bad('duplicate ' + name + ' identity');
    }
    for (const s of b.surfaces) {
      if (!Number.isFinite(s.floorZ) || !Number.isFinite(s.ceilingZ) || s.ceilingZ - s.floorZ < 1.8 - EPS) bad(s.id + ' has invalid elevation or headroom');
      if (!b.bands.some((band) => band.id === s.band)) bad(s.id + ' has no home band');
      if (!validVolume(prism(s.rects, s.floorZ - s.slab, s.ceilingZ, 'room', s.id))) bad(s.id + ' has invalid footprint');
      if (s.rects.some((r) => r[0] < 0 || r[1] < 0 || r[2] > b.site.w + EPS || r[3] > b.site.h + EPS)) bad(s.id + ' outside its territory');
    }
    for (let i = 0; i < b.surfaces.length; i++) for (let j = i + 1; j < b.surfaces.length; j++) {
      const a = b.surfaces[i], c = b.surfaces[j];
      if (volumeOverlap(prism(a.rects, a.floorZ - a.slab, a.ceilingZ), prism(c.rects, c.floorZ - c.slab, c.ceilingZ))) bad(a.id + ' overlaps ' + c.id + ' in 3D');
    }
    for (const v of b.volumes) if (!validVolume(v)) bad(v.id + ' has invalid reservation');
    const walls = new Map(b.walls.map((w) => [w.id, w]));
    for (const op of b.openings) {
      const wall = walls.get(op.wall);
      if (!wall || wall.floorZ !== op.floorZ || !onSegment(op.a, wall.a, wall.b) || !onSegment(op.b, wall.a, wall.b)) bad(op.id + ' opening does not meet its wall');
    }
    for (const v of b.voids || []) for (const s of b.surfaces) if (volumeOverlap(v, prism(s.rects, s.floorZ - s.slab, s.ceilingZ))) bad(s.id + ' occupies protected void ' + v.id);
    for (const c of b.connectors) {
      const a = surfaces.get(c.from), d = surfaces.get(c.to), rule = (BR.TPL.CAT && BR.TPL.CAT.CONNECTIONS || {})[c.kind] || {};
      if (!a || !d) { bad(c.id + ' has no destination surface'); continue; }
      if (c.state !== 'connected' || !['both', 'forward', 'reverse'].includes(c.direction)) bad(c.id + ' has invalid connection state or direction');
      if (!Number.isFinite(c.width) || c.width < Math.max(0.5, rule.minWidth || 0) - EPS || !Number.isFinite(c.clearance) || c.clearance < Math.max(1.8, rule.clearance || 0) - EPS) bad(c.id + ' has invalid width or clearance');
      if (!Array.isArray(c.path) || c.path.length < 2 || !c.path.every((p) => p.length === 3 && p.every(Number.isFinite))) { bad(c.id + ' has invalid XYZ path'); continue; }
      if (!Array.isArray(c.landings) || c.landings.length !== 2) { bad(c.id + ' has no two landings'); continue; }
      const res = reservationsOf(c);
      for (const [s, p, end] of [[a, c.landings[0], c.path[0]], [d, c.landings[1], c.path[c.path.length - 1]]]) {
        if (!p || p.length !== 3 || !p.every(Number.isFinite) || Math.abs(p[2] - s.floorZ) > EPS || !floorPoint(b, s, p)) bad(c.id + ' landing does not meet ' + s.id + ' floor');
        if (p && p.some((v, i) => Math.abs(v - end[i]) > EPS)) bad(c.id + ' path does not meet its landing');
        if (s.ceilingZ - s.floorZ < c.clearance - EPS) bad(c.id + ' landing lacks headroom');
        // a sloped route that lands on a wall needs a real opening there; one
        // that lands inside a room's floor does not
        const onWall = b.walls.some((w) => w.floorZ === s.floorZ && (w.rooms || []).includes(s.room) && onSegment(p, w.a, w.b));
        if (c.kind !== 'ladder' && onWall && !b.openings.some((op) => op.rooms.includes(s.room) && !['window', 'false'].includes(op.kind) && op.floorZ === s.floorZ && op.width >= c.width - EPS && op.height >= c.clearance - EPS && onSegment(p, op.a, op.b))) bad(c.id + ' landing has no matching physical opening');
      }
      if (c.kind !== 'ladder') for (let k = 1; k < c.path.length; k++) {
        const p = c.path[k - 1], q = c.path[k], run = Math.hypot(q[0] - p[0], q[1] - p[1]), slope = run ? Math.abs(q[2] - p[2]) / run : Infinity;
        if (!run) { bad(c.id + ' has a vertical segment; only ladders climb straight up'); continue; }
        if (slope > EPS) {
          if (slope > (rule.slope ? rule.slope[1] : 0.25) + EPS) bad(c.id + ' ' + c.kind + ' is too steep');
          if (rule.slope && slope < rule.slope[0] - EPS) bad(c.id + ' ' + c.kind + ' is too shallow for its type');
        }
        const nx = -(q[1] - p[1]) / run * c.width / 2, ny = (q[0] - p[0]) / run * c.width / 2;
        for (const end of [p, q]) for (const side of [-1, 1]) if (!res.some((v) => inside(v.rects, [end[0] + side * nx, end[1] + side * ny]))) bad(c.id + ' full width outside reservation');
      }
      if (!res.length || !res.every((v) => validVolume(v) && b.volumes.some((u) => u.id === v.id))) bad(c.id + ' has no spatial reservation');
      // every point along the route, with its headroom, lies in a reserved prism
      for (let k = 0; k < c.path.length; k++) {
        const p = c.path[k], q = c.path[Math.min(k + 1, c.path.length - 1)], run = Math.hypot(q[0] - p[0], q[1] - p[1]), n = k === c.path.length - 1 ? 1 : Math.max(1, Math.ceil(run / 0.25));
        for (let t = 0; t < n; t++) {
          const f = k === c.path.length - 1 ? 0 : t / n, at = p.map((v, i) => v + (q[i] - v) * f);
          if (!res.some((v) => inside(v.rects, at) && at[2] >= v.z0 - EPS && at[2] + c.clearance <= v.z1 + EPS)) { bad(c.id + ' path/headroom outside reservation'); break; }
        }
      }
      for (const s of b.surfaces) if (s.id !== c.from && s.id !== c.to && res.some((v) => volumeOverlap(v, prism(s.rects, s.floorZ - s.slab, s.ceilingZ)))) bad(c.id + ' crosses occupied room ' + s.id);
      // where its reserved space passes through an endpoint's floor slab or
      // ceiling, that surface is explicitly cut
      if (c.kind !== 'ladder') for (const s of [a, d]) for (const v of res) for (const r of s.rects) {
        const q = [Math.max(r[0], v.rects[0][0]), Math.max(r[1], v.rects[0][1]), Math.min(r[2], v.rects[0][2]), Math.min(r[3], v.rects[0][3])];
        if (q[2] - q[0] < EPS || q[3] - q[1] < EPS) continue;
        const faces = [];
        if (v.z0 < s.floorZ - EPS && v.z1 > s.floorZ - s.slab + EPS) faces.push('floor');
        if (v.z0 < s.ceilingZ - EPS && v.z1 > s.ceilingZ + EPS) faces.push('ceiling');
        for (const face of faces) for (let y = q[1] + 0.125; y < q[3]; y += 0.25) for (let x = q[0] + 0.125; x < q[2]; x += 0.25) {
          if (!(b.holes || []).some((h) => h.connector === c.id && h.surface === s.id && h.face === face && inside([h.rect], [x, y]))) { bad(c.id + ' passes through the ' + face + ' of ' + s.id + ' without a cutout'); x = Infinity; y = Infinity; }
        }
      }
    }
    // a pit (band-world.js) drills through two blueprints: each lists it in
    // `drops` and owns its own cutout
    const drops = new Set((b.drops || []).map((d) => d.id));
    for (const h of b.holes) {
      const s = surfaces.get(h.surface), drilled = drops.has(h.connector);
      if (!s || !['floor', 'ceiling'].includes(h.face) || (!drilled && !b.connectors.some((c) => c.id === h.connector))) { bad(h.id + ' has invalid ownership'); continue; }
      for (const p of [[h.rect[0], h.rect[1]], [h.rect[2], h.rect[3]]]) if (!inside(s.rects, p)) bad(h.id + ' cutout outside surface');
      // an unselected zone cuts nothing: every cutout belongs to a selected connector
      if (!drilled && !b.connectors.some((c) => c.id === h.connector && c.state === 'connected')) bad(h.id + ' cut by an unselected connection');
    }
    for (const d of b.drops || []) {
      const s = surfaces.get(d.surface), face = d.role === 'top' ? 'floor' : 'ceiling';
      if (!s || !['top', 'bottom'].includes(d.role) || !b.holes.some((h) => h.connector === d.id && h.surface === d.surface && h.face === face)) bad(d.id + ' drop has no ' + face + ' cutout');
    }
    for (const c of b.connectors.filter((c) => c.kind === 'ladder')) if (!b.holes.some((h) => h.connector === c.id && h.face === 'floor') || !b.holes.some((h) => h.connector === c.id && h.face === 'ceiling')) bad(c.id + ' lacks explicit floor/ceiling cutouts');
    for (const e of b.navigation.edges) {
      if (!surfaces.has(e.from) || !surfaces.has(e.to)) bad('navigation references a missing surface');
      if (e.status === 'legacy-unresolved') warnings.push('Legacy ' + e.kind + ' needs an authored XYZ path');
      if (e.connected && !e.connector && surfaces.has(e.from) && surfaces.has(e.to) && surfaces.get(e.from).floorZ !== surfaces.get(e.to).floorZ) bad('ordinary opening joins different elevations');
    }
    if (b.navigation.complete) {
      // Every portal is a way in from the world, not only the main entrance:
      // a house wing behind its garage door, or a yard lot built in pieces
      // (its front yard and each door's passage), is reached through its own
      // door. A blueprint with no portals is walked from its first surface.
      const start = b.portals.length ? [...new Set(b.portals.map((p) => 's:' + p.room))] : b.surfaces.slice(0, 1).map((s) => s.id);
      const seen = reachable(b, start);
      for (const s of b.surfaces) if (!seen.has(s.id)) bad(s.id + ' is unreachable from every way in');
    }
    for (const dir of ['up', 'down']) if (!b.capabilities[dir].supported || !b.capabilities[dir].candidates.length) bad('no physical ' + dir + ' capability');
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }

  Object.assign(E, { stairsKey, bakeStairs, keptStairs, liftConnector, capCeilings, exitOrder, mainFloor, arrivalsOn, prepare, ladderVariant, refresh, capabilities, validate, reachable, ReservationIndex, volumeOverlap, reservationsOf, prism, addRoomWalls, addHoles, floorPoint, inside, overlap });
})(typeof window !== 'undefined' ? window : globalThis);
