/*
 * Experimental elevation contract and exploration-fill generator.
 * Bands are reference elevations; levels are display slices.
 * All geometry is in metres, Z up. See docs/elevation.md.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG;
  const E = BR.ELEV = { SCHEMA: 'br.elevation/0.1', SLAB: 0.25 };
  const EPS = 1e-7, clone = (v) => JSON.parse(JSON.stringify(v));
  const snap = (n) => Math.round(n * 2) / 2;
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
  function capabilities(b) {
    const out = { up: { supported: true, selected: false, candidates: [] }, down: { supported: true, selected: false, candidates: [] } };
    for (const dir of ['up', 'down']) {
      const order = b.surfaces.slice().sort((a, c) => (dir === 'up' ? c.floorZ - a.floorZ : a.floorZ - c.floorZ) || a.id.localeCompare(c.id));
      for (const s of order) {
        if (s.ceilingZ - s.floorZ < 1.8 - EPS) continue;
        let best = null, score = -Infinity;
        const doors = b.openings.filter((o) => (o.rooms || []).includes(s.room) && o.kind !== 'window' && o.kind !== 'false').map((o) => center([o.a[0], o.a[1], o.b[0], o.b[1]]));
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
    return out;
  }

  function refresh(b, options) {
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
    b.volumes = b.surfaces.map((s) => prism(s.rects, s.floorZ - s.slab, s.ceilingZ, 'room', 'volume:' + s.id))
      .concat(b.connectors.map((c) => clone(c.reservation)), clone(b.voids || []));
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
    b.capabilities = options && options.deferCapabilities
      ? { up: { supported: true, selected: false, candidates: [], deferred: true }, down: { supported: true, selected: false, candidates: [], deferred: true } }
      : capabilities(b);
    return b;
  }

  /** Adapter used on demand by the lab. The original blueprint is never mutated.
   * Existing compact stories belong to the home band, independent of their Z. */
  function prepare(source, options) {
    if (!source || source.error) throw new Error((source && source.error) || 'missing blueprint');
    const o = options || {};
    if (source.schema === E.SCHEMA) {
      const b = clone(source);
      if (!o.deferCapabilities && b.capabilities.up.deferred) b.capabilities = capabilities(b);
      return b;
    }
    const b = clone(source), base = o.elevation || 0;
    b.source = { schema: source.schema, archetype: source.archetype || source.filler, engine: source.engine, seed: source.seed };
    b.schema = E.SCHEMA; b.kind = 'adapter';
    b.fillId = o.fillId || 'fill:' + (source.archetype || source.filler) + ':' + source.seed;
    b.bands = [{ id: 'ground', elevation: base }];
    const old = source.levels || [{ index: 0, elevation: 0 }], z = (level) => round(base + (old.find((l) => l.index === (level || 0)) || old[0]).elevation);
    for (const r of b.rooms) { r.floorZ = z(r.level); r.ceilingZ = round(r.floorZ + r.ceiling); r.band = 'ground'; }
    for (const q of b.walls.concat(b.openings, b.zones || [], b.columns || [], b.curves || [], b.outline || [])) q.floorZ = z(q.level);
    for (const w of b.walls) { const rm = b.rooms.find((r) => (w.rooms || []).includes(r.id)); w.ceilingZ = rm ? rm.ceilingZ : round(w.floorZ + 2.5); }
    b.connectors = []; b.holes = []; b.voids = []; b.route = [];
    // Legacy abstract links are preserved, explicitly unresolved in navigation.
    return refresh(b, o);
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
      reservation: prism([landing], Math.min(a.floorZ, c.floorZ) - E.SLAB, Math.max(a.floorZ, c.floorZ) + 1.8, 'connector', 'volume:' + id) };
  }

  /** A compact real variant of ANY source template. Destination geometry and
   * its shaft are planned together, not an opening into an unknown world. */
  function ladderVariant(source, options) {
    const o = options || {}, dir = o.direction || 'up';
    if (!['up', 'down'].includes(dir)) throw new Error('connection direction must be up or down');
    const delta = o.rise === undefined ? 8 : o.rise;
    if (!Number.isFinite(delta) || delta < 3) throw new Error('ladder landing separation must be at least 3 m');
    const b = prepare(source, o), candidates = b.capabilities[dir].candidates;
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
      trial.connectors.push(c); trial.graph.nodes.push(target.id); trial.graph.edges.push([host.id, target.id, 'ladder', c.id]);
      addHoles(trial, c.id, 's:' + (host.floorZ < targetZ ? host.id : target.id), 's:' + (host.floorZ > targetZ ? host.id : target.id), p.hatch);
      // Physical shaft cannot tunnel through another pre-existing room.
      if (trial.surfaces.some((s) => s.room !== host.id && volumeOverlap(c.reservation, prism(s.rects, s.floorZ - s.slab, s.ceilingZ, 'room', s.id)))) continue;
      addRoomWalls(trial, target);
      trial.kind = 'ladder-variant';
      trial.route = c.path.map((v) => v.slice());
      refresh(trial);
      trial.capabilities[dir].selected = true;
      trial.capabilities[dir].connection = c.id;
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
  function buildWalls(b) {
    b.walls = [];
    for (const level of b.levels) {
      const R = new TG.Raster(Math.round(b.site.w * 2), Math.round(b.site.h * 2), -1);
      b.rooms.forEach((r, i) => { if (r.level === level.index) for (const q of r.rects) R.fill(q.map((v) => Math.round(v * 2)), i); });
      for (const w of TG.boundaries(R, -1)) {
        const ids = [w.a, w.b].map((i) => i < 0 ? null : b.rooms[i].id), owners = ids.filter(Boolean).map((id) => b.rooms.find((r) => r.id === id));
        b.walls.push({ id: 'w' + b.walls.length, level: level.index, floorZ: level.elevation, ceilingZ: Math.max(...owners.map((r) => r.ceilingZ)), kind: ids.every(Boolean) ? 'interior' : 'exterior',
          a: w.o === 'h' ? [w.s0 / 2, w.c / 2] : [w.c / 2, w.s0 / 2], b: w.o === 'h' ? [w.s1 / 2, w.c / 2] : [w.c / 2, w.s1 / 2], rooms: ids, thickness: ids.every(Boolean) ? 0.15 : 0.3 });
      }
    }
  }
  function opening(b, room, side, at, width, other, kind) {
    const r = b.rooms.find((q) => q.id === room), bb = TG.bbox(r.rects), horizontal = side === 'N' || side === 'S', line = side === 'N' ? bb[1] : side === 'S' ? bb[3] : side === 'W' ? bb[0] : bb[2];
    const wall = b.walls.find((w) => w.rooms.includes(room) && w.floorZ === r.floorZ && (horizontal ? w.a[1] === line && w.b[1] === line : w.a[0] === line && w.b[0] === line) && at >= Math.min(horizontal ? w.a[0] : w.a[1], horizontal ? w.b[0] : w.b[1]) - EPS && at + width <= Math.max(horizontal ? w.a[0] : w.a[1], horizontal ? w.b[0] : w.b[1]) + EPS);
    if (!wall) throw new Error('missing wall for ' + room + ' ' + side);
    const op = { id: 'o' + b.openings.length, wall: wall.id, level: r.level, floorZ: r.floorZ, kind: kind || 'opening', a: horizontal ? [at, line] : [line, at], b: horizontal ? [at + width, line] : [line, at + width], width, height: 2.2, rooms: [room, other || null] };
    if (kind === 'window') { delete op.height; op.sill = 1.1; op.head = 2.2; }
    b.openings.push(op);
    if (other) b.graph.edges.push([room, other, 'opening', op.id]);
    return op;
  }

  /** Populate the shared owner's spare space at a reference elevation. The
   * existing filler pipeline supplies enclosed rooms and 1 m walkable joins;
   * only volumes intersecting this floor's slab/headroom are excluded. */
  function populateBand(b, band, seed, attachments) {
    const z = b.bands.find((v) => v.id === band).elevation, ceiling = 2.4;
    const mask = new TG.Raster(Math.round(b.site.w * 2), Math.round(b.site.h * 2), 1);
    for (const v of b.volumes) if (v.z0 < z + ceiling - EPS && z - E.SLAB < v.z1 - EPS)
      for (const q of v.rects) mask.fill(q.map((n) => Math.round(n * 2)), 0);
    const rects = TG.rectsWhere(mask, (v) => v === 1).map((q) => q.map((n) => n / 2));
    const bb = TG.bbox(rects), site = { rects }, prefix = 'infill:' + band + ':';
    const connections = attachments.map((a, i) => {
      const q = TG.bbox(b.rooms.find((r) => r.id === a.room).rects), horizontal = a.side === 'N' || a.side === 'S';
      const line = a.side === 'N' ? q[1] : a.side === 'S' ? q[3] : a.side === 'W' ? q[0] : q[2];
      return { id: String(i), side: TG.opposite(a.side), at: a.at - bb[horizontal ? 0 : 1],
        line: line - bb[horizontal ? 1 : 0], width: a.width, kind: 'opening', route: true };
    });
    const f = BR.FILL.generate({ filler: 'warren', seed, site, connections });
    if (f.error || f.meta.issues.length) throw new Error('terraced infill: ' + (f.error || f.meta.issues.join('; ')));
    const id = (v) => v == null ? null : prefix + v;
    const pt = (p) => { p[0] += bb[0]; p[1] += bb[1]; };
    const rr = (q) => { q[0] += bb[0]; q[2] += bb[0]; q[1] += bb[1]; q[3] += bb[1]; };
    for (const r of f.rooms) {
      r.id = id(r.id); r.rects.forEach(rr); r.floorZ = z; r.ceiling = ceiling; r.ceilingZ = round(z + ceiling); r.band = band;
      r.tags.push('vertical-infill'); b.rooms.push(r); b.graph.nodes.push(r.id);
    }
    for (const w of f.walls) {
      w.id = id(w.id); w.rooms = w.rooms.map(id); pt(w.a); pt(w.b); w.floorZ = z; w.ceilingZ = round(z + ceiling); b.walls.push(w);
    }
    for (const o of f.openings) {
      o.id = id(o.id); o.wall = id(o.wall); o.rooms = o.rooms.map(id); pt(o.a); pt(o.b); o.floorZ = z;
      if (o.swingInto) o.swingInto = id(o.swingInto);
      // Filler portals become internal doors to the authored core, never new
      // world entrances. Their coincident core opening cuts both wall faces.
      delete o.portal; b.openings.push(o);
    }
    b.columns = b.columns || [];
    for (const c of f.columns) { c.id = id(c.id); c.room = id(c.room); rr(c.rect); c.floorZ = z; b.columns.push(c); }
    for (const [a, c, kind, op] of f.graph.edges) if (a !== 'outside' && c !== 'outside') b.graph.edges.push([id(a), id(c), kind, id(op)]);
    for (const p of f.portals) {
      const a = attachments[Number(p.connection)], other = id(p.room);
      const op = b.openings.find((o) => o.id === id(p.opening));
      op.rooms = op.rooms.map((r) => r || a.room);
      opening(b, a.room, a.side, a.at, a.width, other);
    }
  }

  /** A shared multi-band fill. Four ramps and intervening rooms wrap an atrium;
   * the last ramp passes above/below the ground gallery. A compact side pocket
   * in the upward example crosses the neighboring band's elevation WITHOUT a
   * portal into that band. Clear height extends upward in both directions. */
  function generate(spec) {
    spec = spec || {};
    const seed = spec.seed >>> 0, sign = spec.direction === 'down' ? -1 : 1;
    const rise = spec.rise === undefined ? 8 : spec.rise, factor = rise / 8;
    if (!Number.isFinite(rise) || rise < 8) throw new Error('terraced fill rise must be at least 8 m');
    if (spec.direction !== undefined && !['up', 'down'].includes(spec.direction)) throw new Error('connection direction must be up or down');
    const W = spec.site ? spec.site.w : 40, H = spec.site ? spec.site.h : 36;
    if (![W, H].every(Number.isFinite) || W < 40 || H < 36 || W * 2 % 1 || H * 2 % 1) throw new Error('terraced fill needs a rectangular site at least 40 × 36 m, on the 0.5 m grid');
    const x = (v) => snap(v * W / 40), y = (v) => snap(v * H / 36), rect = (r) => [x(r[0]), y(r[1]), x(r[2]), y(r[3])], point = (p) => [x(p[0]), y(p[1]), p[2] * sign * factor];
    const rng = new BR.Rng(BR.hash4(seed, 0xe1e7, 0, 0)), dest = sign > 0 ? 'upper' : 'lower';
    const b = { schema: E.SCHEMA, kind: 'exploration-fill', engine: 'elevation', archetype: 'terraced_atrium', name: 'Terraced atrium', seed, approach: 'S', grid: 0.5,
      fillId: spec.fillId || 'fill:terraced_atrium:' + seed, site: { w: W, h: H, rects: [[0, 0, W, H]] },
      bands: [{ id: 'ground', elevation: 0 }, { id: dest, elevation: rise * sign }], rooms: [], walls: [], openings: [], portals: [], verticals: [], holes: [], connectors: [], voids: [], route: [],
      graph: { nodes: ['outside'], edges: [] }, meta: { plan: { type: 'terraced_atrium' }, score: 100, terms: {}, mutations: [], issues: [], autoDoors: [], program: ['vertical exploration', 'reserved atrium', 'compact stacked pocket'] } };
    const room = (id, name, q, z, ceiling, band) => { const r = { id, type: 'room', name, zone: 'circulation', rects: [rect(q)], floorZ: z * sign * factor, ceiling, ceilingZ: round(z * sign * factor + ceiling), band: band || 'ground', tags: ['backrooms', 'vertical-exploration'], area: round((x(q[2]) - x(q[0])) * (y(q[3]) - y(q[1]))) }; b.rooms.push(r); b.graph.nodes.push(id); return r; };
    room('entry', 'Ground entrance', [0, 24, 8, 36], 0, 2.8);
    room('gallery', 'Ground gallery', [0, 16, 8, 24], 0, 2.8);
    room('middle', 'Intermediate hall', [20, 16, 28, 24], 2, 2.6);
    room('side', 'Side rooms', [28, 16, 28 + rng.int(5, 8), 24], 2, 2.6);
    room('turn', 'Turning gallery', [20, 0, 28, 4], 4, 2.3);
    const pocket = room('pocket', 'Compact pocket', [28, 0, 28 + rng.int(5, 8), 4], 4, 2.25);
    room('overlook', 'Atrium overlook', [0, 0, 8, 12], 6, 2.8);
    room('arrival', (sign > 0 ? 'Upper' : 'Lower') + ' band arrival', [0, 24, 8, 36], 8, 2.8, dest);
    const stack = room('stack', 'Stacked pocket', [28, 0, pocket.rects[0][2] / (W / 40), 4], 7, 2.25);
    // Exactly matching masks, including non-integral scaling at larger sites.
    stack.rects = clone(pocket.rects); stack.area = pocket.area;
    function ramp(id, from, to, A, B, footprint) {
      const pa = point(A), pb = point(B), a = b.rooms.find((r) => r.id === from), c = b.rooms.find((r) => r.id === to);
      const q = rect(footprint), width = Math.min(q[2] - q[0], q[3] - q[1]);
      // A snapped footprint can have a quarter-metre center. Derive it from
      // the edges so the full ramp width still fits its openings/reservation.
      if (pa[0] !== pb[0]) pa[1] = pb[1] = (q[1] + q[3]) / 2;
      else pa[0] = pb[0] = (q[0] + q[2]) / 2;
      b.connectors.push({ id, kind: 'ramp', from: 's:' + from, to: 's:' + to, state: 'connected', direction: 'both', width, clearance: 2.2,
        architecture: { slab: E.SLAB, sideWalls: { height: 2.2, thickness: 0.15 }, ceiling: true }, landings: [pa.slice(), pb.slice()], path: [pa, pb],
        reservation: prism([q], Math.min(a.floorZ, c.floorZ) - E.SLAB, Math.max(a.floorZ, c.floorZ) + 2.2, 'connector', 'volume:' + id) });
      b.graph.edges.push([from, to, 'ramp', id]);
    }
    ramp('ramp:1', 'gallery', 'middle', [8, 19, 0], [20, 19, 2], [8, 18, 20, 20]);
    ramp('ramp:2', 'middle', 'turn', [23, 16, 2], [23, 4, 4], [22, 4, 24, 16]);
    ramp('ramp:3', 'turn', 'overlook', [20, 2, 4], [8, 2, 6], [8, 1, 20, 3]);
    ramp('ramp:4', 'overlook', 'arrival', [4, 12, 6], [4, 24, 8], [3, 12, 5, 24]);
    const q = pocket.rects[0], landing = [q[2] - 1.5, q[1] + 0.5, q[2] - 0.5, q[1] + 1.5], hatch = [landing[0] + 0.5, landing[1], landing[2], landing[1] + 0.5];
    const ladder = ladderConnector('pocket:ladder', pocket, stack, landing, hatch);
    b.connectors.push(ladder); b.graph.edges.push([pocket.id, stack.id, 'ladder', ladder.id]);
    addHoles(b, ladder.id, 's:' + (sign > 0 ? pocket.id : stack.id), 's:' + (sign > 0 ? stack.id : pocket.id), hatch);
    b.voids.push(prism([rect([8, 4, 20, 16])], Math.min(0, rise * sign) - E.SLAB, Math.max(0, rise * sign) + 3, 'void', 'atrium'));
    refresh(b); buildWalls(b);
    opening(b, 'entry', 'N', x(3), x(5) - x(3), 'gallery');
    opening(b, 'middle', 'E', y(18), y(20) - y(18), 'side');
    opening(b, 'turn', 'E', y(1), y(3) - y(1), 'pocket');
    for (const [rid, side, at, wide] of [['gallery', 'E', y(18), y(20) - y(18)], ['middle', 'W', y(18), y(20) - y(18)], ['middle', 'N', x(22), x(24) - x(22)], ['turn', 'S', x(22), x(24) - x(22)], ['turn', 'W', y(1), y(3) - y(1)], ['overlook', 'E', y(1), y(3) - y(1)], ['overlook', 'S', x(3), x(5) - x(3)], ['arrival', 'N', x(3), x(5) - x(3)]]) opening(b, rid, side, at, wide);
    opening(b, 'overlook', 'E', y(5), y(10) - y(5), null, 'window');
    for (const [rid, side, at, wide, main] of [['entry', 'S', x(3), x(5) - x(3), true], ['arrival', 'W', y(28), y(30) - y(28), false]]) {
      const op = opening(b, rid, side, at, wide), r = b.rooms.find((q) => q.id === rid), id = 'p' + b.portals.length;
      op.portal = id;
      b.portals.push({ id, opening: op.id, room: rid, role: 'both', kind: 'opening', side, width: wide, clear: 1.2, main, state: 'landing', band: r.band, tags: ['band-landing'] });
      b.graph.edges.push([rid, 'outside', 'opening', op.id]);
    }
    const ramps = b.connectors.filter((c) => c.kind === 'ramp');
    b.route = [point([4, 36, 0]), point([4, 19, 0]), ...clone(ramps[0].path), point([23, 19, 2]), ...clone(ramps[1].path), point([23, 2, 4]), ...clone(ramps[2].path), point([4, 2, 6]), ...clone(ramps[3].path), point([4, 29, 8]), point([0, 29, 8])];
    if (spec.infill) {
      const east = (rid) => ({ room: rid, side: 'E', at: y(28), width: y(30) - y(28) });
      populateBand(b, 'ground', BR.hash4(seed, 0xe1f1, 0, 0), [east('entry'), { room: 'gallery', side: 'N', at: x(3), width: x(5) - x(3) }]);
      populateBand(b, dest, BR.hash4(seed, 0xe1f1, 1, 0), [east('arrival')]);
      b.meta.program.push('connected reference-floor infill');
    }
    if (rng.f() < 0.5) {
      const rp = (p) => { p[0] = round(W - p[0]); }, rr = (r) => { const a = r[0]; r[0] = round(W - r[2]); r[2] = round(W - a); };
      for (const r of b.rooms) r.rects.forEach(rr);
      for (const c of b.columns || []) rr(c.rect);
      for (const w of b.walls.concat(b.openings)) { rp(w.a); rp(w.b); }
      for (const p of b.portals) if (p.side === 'W' || p.side === 'E') p.side = TG.opposite(p.side);
      for (const c of b.connectors) { c.path.forEach(rp); c.landings.forEach(rp); c.reservation.rects.forEach(rr); }
      for (const h of b.holes) rr(h.rect);
      for (const v of b.voids) v.rects.forEach(rr);
      b.route.forEach(rp);
    }
    refresh(b);
    const selectedDirection = sign > 0 ? 'up' : 'down';
    b.capabilities[selectedDirection].selected = true;
    b.capabilities[selectedDirection].connections = b.connectors.filter((c) => c.kind === 'ramp').map((c) => c.id);
    const check = validate(b);
    b.meta.issues = check.errors.map((e) => 'ERROR ' + e).concat(check.warnings);
    if (check.errors.length) throw new Error(check.errors.join('; '));
    if (spec.reservations) { const claim = spec.reservations.reserve(b.fillId, b.volumes); if (!claim.ok) throw new Error('fill reservation conflicts with ' + claim.conflicts[0].owner); }
    return b;
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
      const a = surfaces.get(c.from), d = surfaces.get(c.to);
      if (!a || !d) { bad(c.id + ' has no destination surface'); continue; }
      if (c.state !== 'connected' || !['both', 'forward', 'reverse'].includes(c.direction)) bad(c.id + ' has invalid connection state or direction');
      if (!Number.isFinite(c.width) || c.width < 0.5 || !Number.isFinite(c.clearance) || c.clearance < 1.8) bad(c.id + ' has invalid width or clearance');
      if (!Array.isArray(c.path) || c.path.length < 2 || !c.path.every((p) => p.length === 3 && p.every(Number.isFinite))) { bad(c.id + ' has invalid XYZ path'); continue; }
      if (!Array.isArray(c.landings) || c.landings.length !== 2) { bad(c.id + ' has no two landings'); continue; }
      for (const [s, p, end] of [[a, c.landings[0], c.path[0]], [d, c.landings[1], c.path[c.path.length - 1]]]) {
        if (!p || p.length !== 3 || !p.every(Number.isFinite) || Math.abs(p[2] - s.floorZ) > EPS || !floorPoint(b, s, p)) bad(c.id + ' landing does not meet ' + s.id + ' floor');
        if (p && p.some((v, i) => Math.abs(v - end[i]) > EPS)) bad(c.id + ' path does not meet its landing');
        if (s.ceilingZ - s.floorZ < c.clearance - EPS) bad(c.id + ' landing lacks headroom');
        if (c.kind === 'ramp' && !b.openings.some((op) => op.rooms.includes(s.room) && !['window', 'false'].includes(op.kind) && op.floorZ === s.floorZ && op.width >= c.width - EPS && op.height >= c.clearance - EPS && onSegment(p, op.a, op.b))) bad(c.id + ' landing has no matching physical opening');
      }
      if (c.kind === 'ramp') for (let k = 1; k < c.path.length; k++) {
        const p = c.path[k - 1], q = c.path[k], run = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (!run || Math.abs(q[2] - p[2]) / run > 0.25 + EPS) bad(c.id + ' ramp is too steep');
        if (run) {
          const nx = -(q[1] - p[1]) / run * c.width / 2, ny = (q[0] - p[0]) / run * c.width / 2;
          for (const end of [p, q]) for (const side of [-1, 1]) if (!inside(c.reservation.rects, [end[0] + side * nx, end[1] + side * ny])) bad(c.id + ' full width outside reservation');
        }
      }
      if (!validVolume(c.reservation) || !b.volumes.some((v) => v.id === c.reservation.id)) bad(c.id + ' has no spatial reservation');
      for (const p of c.path) if (!inside(c.reservation.rects, p) || p[2] < c.reservation.z0 - EPS || p[2] + c.clearance > c.reservation.z1 + EPS) bad(c.id + ' path/headroom outside reservation');
      for (const s of b.surfaces) if (s.id !== c.from && s.id !== c.to && volumeOverlap(c.reservation, prism(s.rects, s.floorZ - s.slab, s.ceilingZ))) bad(c.id + ' crosses occupied room ' + s.id);
    }
    for (const h of b.holes) {
      const s = surfaces.get(h.surface);
      if (!s || !['floor', 'ceiling'].includes(h.face) || !b.connectors.some((c) => c.id === h.connector)) { bad(h.id + ' has invalid ownership'); continue; }
      for (const p of [[h.rect[0], h.rect[1]], [h.rect[2], h.rect[3]]]) if (!inside(s.rects, p)) bad(h.id + ' cutout outside surface');
    }
    for (const c of b.connectors.filter((c) => c.kind === 'ladder')) if (!b.holes.some((h) => h.connector === c.id && h.face === 'floor') || !b.holes.some((h) => h.connector === c.id && h.face === 'ceiling')) bad(c.id + ' lacks explicit floor/ceiling cutouts');
    for (const e of b.navigation.edges) {
      if (!surfaces.has(e.from) || !surfaces.has(e.to)) bad('navigation references a missing surface');
      if (e.status === 'legacy-unresolved') warnings.push('Legacy ' + e.kind + ' needs an authored XYZ path');
      if (e.connected && !e.connector && surfaces.has(e.from) && surfaces.has(e.to) && surfaces.get(e.from).floorZ !== surfaces.get(e.to).floorZ) bad('ordinary opening joins different elevations');
    }
    if (b.navigation.complete) {
      const entrance = b.portals.find((p) => p.main) || b.portals[0], start = entrance ? ['s:' + entrance.room] : [];
      const seen = reachable(b, start);
      for (const s of b.surfaces) if (!seen.has(s.id)) bad(s.id + ' is unreachable from the main entrance');
    }
    for (const dir of ['up', 'down']) if (!b.capabilities[dir].supported || !b.capabilities[dir].candidates.length) bad('no physical ' + dir + ' capability');
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }

  Object.assign(E, { prepare, generate, ladderVariant, refresh, capabilities, validate, reachable, ReservationIndex, volumeOverlap });
})(typeof window !== 'undefined' ? window : globalThis);
