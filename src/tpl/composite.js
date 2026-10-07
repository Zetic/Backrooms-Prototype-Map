/*
 * tpl/composite.js - templates inside templates.
 *
 * A composite engine does not lay out rooms itself. It cuts its site into
 * sub-sites, asks other templates to build each one (a house is built by the
 * House engine, exactly as it would be on a lot of its own), places what came
 * back, and adds its own rooms around them (a street, the front yards). This
 * file is the shared pipeline that turns all of that into one ordinary
 * building (br.building/0.2), so the world, the workbench and the renderer
 * need nothing new to use it.
 *
 *   TPL.generate(spec) hands a composite engine (one with `plan`) to
 *   TPL.compose(spec, arch, engine):
 *
 *   1. site      the same canonical site as any template (main side = bottom)
 *   2. program   engine.program(arch, rng, ctx)
 *   3. plan      engine.plan(program, ctx, rng, kit), a few candidates. The
 *                engine builds its children through kit.child(...) (each one
 *                a real TPL.generate on its own sub-site, tried on a few
 *                seeds, cached within the call) and returns:
 *                  { rooms: [{ type, rects (units), tags, ceiling }],  its own rooms
 *                    parts: [{ b, at: [x, y] (units: where the child's site
 *                              frame sits), label, spec }],             the children
 *                    portals: [{ room, o, c, s0, s1 (units, on the room's
 *                                exterior wall), kind, role, main, clear, tags }],
 *                    open: true | [[i, j]] (own room pairs with no wall),
 *                    terms: { penalty: points }, meta, summary }
 *   4. merge     one raster of every room (own + children). Walls come from
 *                it: a child's own walls keep their kind, a child's outer
 *                wall against the composite's rooms is a `facade`, anything
 *                against the solid is `exterior`. Every child opening is put
 *                back on its wall; a child's portals (its front door, its
 *                garage door) become doors onto the room in front of them.
 *                The composite's portals are its own.
 *   5. validate  rooms inside the site, no overlaps, every child door opens
 *                onto a room (never onto solid), an entrance, every room
 *                reachable from the outside
 *   6. output    metres, turned to face the main side. `parts[]` lists the
 *                children; each room names its part.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL;
  const { Rng, hash4, mix32 } = BR;
  const G = TG.GRID, U = (m) => Math.round(m / G), OUT = -1;
  const SALT = { PROGRAM: 1, MUT: 2, LAYOUT: 10 };
  const THICK = { exterior: 0.3, facade: 0.3, interior: 0.15, open: 0, partition: 0.1 };
  const PASS = { door: 1, double: 1, opening: 1, slider: 1, vehicle: 1, open: 1, stair: 1, elevator: 1, ladder: 1 };
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const why = (ctx, k) => { ctx.why[k] = (ctx.why[k] || 0) + 1; return null; };
  const round3 = (v) => Math.round(v * 1000) / 1000;

  // ------------------------------------------------------------ children
  /**
   * The kit an engine's plan gets. kit.child(req) builds one child template:
   *   req { archetype (id), override (recipe fields laid over it), seed,
   *         rect (units, canonical: the child's site), approach (the side the
   *         child faces, canonical), wrongness?, tries? (default 3) }
   * Returns the child's br.building in its own site frame (axes the same as
   * the composite's canonical frame), or { error }. The exact spec that built
   * it is on b.spec, so anyone can build the same child on its own.
   */
  function makeKit(ctx) {
    const cache = new Map();
    function child(req) {
      const base = TPL.archetypes[req.archetype];
      if (!base) return { error: 'unknown archetype ' + req.archetype };
      const recipe = req.override ? Object.assign({}, base, req.override) : base;
      const w = (req.rect[2] - req.rect[0]) * G, h = (req.rect[3] - req.rect[1]) * G;
      const key = [req.archetype, req.seed >>> 0, w, h, req.approach, req.wrongness, JSON.stringify(req.override || null)].join('|');
      if (cache.has(key)) return cache.get(key);
      let b = null;
      const tries = req.tries || 3;
      for (let t = 0; t < tries; t++) {
        const spec = { archetype: req.archetype, override: req.override || null, seed: (t ? mix32((req.seed >>> 0) + t) : req.seed) >>> 0, site: { w, h }, approach: req.approach };
        if (req.wrongness !== undefined && req.wrongness !== null) spec.wrongness = req.wrongness;
        b = TPL.generate(Object.assign({}, spec, { archetype: recipe }));
        if (!b.error) { b.spec = spec; break; }
      }
      cache.set(key, b);
      return b;
    }
    /** a child's built cells per level, placed at `at` (units, canonical) */
    const footprint = (b, at, lv) => (b.footprint[lv || 0] || { rects: [] }).rects.map((q) => [U(q[0]) + at[0], U(q[1]) + at[1], U(q[2]) + at[0], U(q[3]) + at[1]]);
    return { child, footprint, U, G };
  }

  // ------------------------------------------------------------ merge
  /**
   * Own rooms + children -> rooms, walls, openings, portals, links (units,
   * canonical). Hard problems go to res.issues.
   */
  function merge(ctx, plan) {
    const S = ctx.site, W = S.W, H = S.H, E = ctx.engine, T = E.types || {};
    const res = { W, H, rooms: [], walls: [], openings: [], portals: [], links: [], verticals: [], issues: [], dropped: 0, R: [] };
    const hard = (msg) => res.issues.push({ hard: true, msg });
    // ---- rooms: the composite's own, then each child's in order
    for (const rm of plan.rooms) {
      const ty = T[rm.type] || {};
      res.rooms.push({ part: -1, type: rm.type, zone: rm.zone || ty.zone || null, level: rm.level || 0, rects: rm.rects.filter(TG.rvalid), ceiling: rm.ceiling || 2.5, tags: (ty.tags || []).concat(rm.tags || []), name: rm.name || null, parent: null });
    }
    const idMap = plan.parts.map(() => new Map()), opMap = plan.parts.map(() => new Map());
    plan.parts.forEach((P, k) => {
      const at = P.at;
      for (const rm of P.b.rooms) {
        idMap[k].set(rm.id, res.rooms.length);
        res.rooms.push({ part: k, type: rm.type, zone: rm.zone, level: rm.level || 0, rects: rm.rects.map((q) => [U(q[0]) + at[0], U(q[1]) + at[1], U(q[2]) + at[0], U(q[3]) + at[1]]),
          ceiling: rm.ceiling, tags: rm.tags.slice(), name: rm.name, parent: rm.parent, area: rm.area });
      }
      for (const rm of res.rooms) if (rm.part === k && typeof rm.parent === 'string') rm.parent = idMap[k].has(rm.parent) ? idMap[k].get(rm.parent) : null;
    });
    let L = 1;
    for (const P of plan.parts) L = Math.max(L, P.b.levels.length);
    for (const rm of res.rooms) L = Math.max(L, rm.level + 1);
    res.L = L;
    // ---- one raster per level
    let overlap = 0, offsite = 0;
    for (let lv = 0; lv < L; lv++) res.R.push(new TG.Raster(W, H, OUT));
    res.rooms.forEach((rm, i) => {
      const R = res.R[rm.level];
      for (const r of rm.rects) for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || S.mask.get(x, y) !== 1) { offsite++; continue; }
        if (R.get(x, y) >= 0) overlap++;
        R.set(x, y, i);
      }
    });
    if (overlap) hard(overlap + ' cells claimed by two rooms');
    if (offsite) hard(offsite + ' cells outside the site');
    // ---- walls. A child's own walls keep their kind (interior / open)
    const childWalls = new Map();
    plan.parts.forEach((P, k) => {
      for (const w of P.b.walls) {
        const horiz = w.a[1] === w.b[1], c = U(horiz ? w.a[1] : w.a[0]) + (horiz ? P.at[1] : P.at[0]);
        const s0 = U(Math.min(horiz ? w.a[0] : w.a[1], horiz ? w.b[0] : w.b[1])) + (horiz ? P.at[0] : P.at[1]);
        const s1 = U(Math.max(horiz ? w.a[0] : w.a[1], horiz ? w.b[0] : w.b[1])) + (horiz ? P.at[0] : P.at[1]);
        const key = w.level + (horiz ? 'h' : 'v') + c;
        if (!childWalls.has(key)) childWalls.set(key, []);
        childWalls.get(key).push({ s0, s1, kind: w.kind, rooms: w.rooms.map((id) => (id ? idMap[k].get(id) : OUT)) });
      }
    });
    const openOwn = new Set();
    const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    if (Array.isArray(plan.open)) for (const [a, b] of plan.open) openOwn.add(pairKey(a, b));
    const byLine = new Map();
    for (let lv = 0; lv < L; lv++) {
      for (const s of TG.boundaries(res.R[lv], OUT)) {
        let kind;
        if (s.a < 0 || s.b < 0) kind = 'exterior';
        else {
          const A = res.rooms[s.a], B = res.rooms[s.b];
          if (A.part >= 0 && A.part === B.part) {
            kind = 'interior';
            for (const cw of childWalls.get(lv + s.o + s.c) || []) {
              if (cw.s0 <= s.s0 && s.s1 <= cw.s1 && cw.rooms.indexOf(s.a) >= 0 && cw.rooms.indexOf(s.b) >= 0) { kind = cw.kind; break; }
            }
          } else if (A.part >= 0 || B.part >= 0) kind = 'facade';
          else kind = plan.open === true || openOwn.has(pairKey(s.a, s.b)) ? 'open' : 'interior';
        }
        const w = { id: res.walls.length, level: lv, kind, o: s.o, c: s.c, s0: s.s0, s1: s.s1, lo: s.a, hi: s.b };
        res.walls.push(w);
        const lk = lv + s.o + s.c;
        if (!byLine.has(lk)) byLine.set(lk, []);
        byLine.get(lk).push(w);
      }
    }
    const findWall = (lv, o, c, s0, s1) => (byLine.get(lv + o + c) || []).find((w) => w.s0 <= s0 && s1 <= w.s1) || null;
    // ---- the composite's own open boundaries are links
    const linked = new Set();
    for (const w of res.walls) {
      if (w.kind !== 'open' || w.lo < 0 || w.hi < 0) continue;
      const A = res.rooms[w.lo], B = res.rooms[w.hi];
      if (A.part >= 0 && A.part === B.part) continue;              // a child's own open plan comes with its graph
      const k = pairKey(w.lo, w.hi);
      if (!linked.has(k)) { linked.add(k); res.links.push({ a: w.lo, b: w.hi, kind: 'open', opening: null }); }
    }
    // ---- every child opening back on its wall; its portals open onto the composite
    plan.parts.forEach((P, k) => {
      const at = P.at, portals = new Map(P.b.portals.map((p) => [p.opening, p]));
      for (const op of P.b.openings) {
        const horiz = op.a[1] === op.b[1];
        const c = U(horiz ? op.a[1] : op.a[0]) + (horiz ? at[1] : at[0]);
        const s0 = U(Math.min(horiz ? op.a[0] : op.a[1], horiz ? op.b[0] : op.b[1])) + (horiz ? at[0] : at[1]);
        const s1 = U(Math.max(horiz ? op.a[0] : op.a[1], horiz ? op.b[0] : op.b[1])) + (horiz ? at[0] : at[1]);
        const w = findWall(op.level, horiz ? 'h' : 'v', c, s0, s1);
        const p = portals.get(op.id);
        if (!w) {
          // a window astride two walls (yard on one part, solid on the other) is left out
          if (op.kind === 'window') { res.dropped++; continue; }
          hard('part ' + k + ': ' + op.kind + ' ' + op.id + ' is not on one wall');
          continue;
        }
        const mine = op.rooms.filter(Boolean).map((id) => idMap[k].get(id));
        if (!mine.every((i) => i === w.lo || i === w.hi)) { hard('part ' + k + ': ' + op.id + ' lost its room'); continue; }
        const rec = { id: res.openings.length, wall: w.id, level: op.level, kind: op.kind, s0, s1, into: op.swingInto ? idMap[k].get(op.swingInto) : null, hinge: null, part: k, tags: (op.tags || []).slice() };
        if (op.hinge) rec.hinge = [U(op.hinge[0]) + at[0], U(op.hinge[1]) + at[1]];
        if (op.kind === 'window') { rec.sill = op.sill; rec.head = op.head; } else rec.height = op.height;
        if (p) {
          // the child's door onto 'the backrooms' now opens onto whatever room
          // the composite put in front of it
          const inner = idMap[k].get(p.room), other = w.lo === inner ? w.hi : w.lo;
          if (other < 0) { hard('part ' + k + ': ' + (p.tags[0] || p.kind) + ' opens onto solid'); continue; }
          if (res.rooms[other].part === k) { hard('part ' + k + ': ' + op.id + ' opens back into its own building'); continue; }
          rec.tags = rec.tags.concat(p.tags || []);
          rec.wasPortal = { part: k, id: p.id };
          res.links.push({ a: inner, b: other, kind: op.kind, opening: rec.id });
        }
        opMap[k].set(op.id, rec.id);
        res.openings.push(rec);
      }
      // the child's own room graph, renumbered (its portals were linked above)
      for (const [a, b, kind, oid] of P.b.graph.edges) {
        if (a === 'outside' || b === 'outside') continue;
        if (!oid && kind !== 'open') continue;                        // stairs and lifts come back as verticals
        const opening = oid ? opMap[k].get(oid) : null;
        if (oid && opening === undefined) continue;
        res.links.push({ a: idMap[k].get(a), b: idMap[k].get(b), kind, opening: opening === undefined ? null : opening, child: true });
      }
      for (const v of P.b.verticals || []) res.verticals.push({ kind: v.kind, rooms: v.rooms.map((id) => idMap[k].get(id)), dead: v.dead, tags: v.tags || [], part: k });
    });
    // ---- the composite's own portals
    for (const pt of plan.portals || []) {
      const w = findWall(0, pt.o, pt.c, pt.s0, pt.s1);
      if (!w || w.kind !== 'exterior' || (w.lo !== pt.room && w.hi !== pt.room)) { hard('could not place ' + pt.kind + ' ' + (pt.tags || [])[0]); continue; }
      const side = w.o === 'h' ? (w.lo === pt.room ? 'S' : 'N') : (w.lo === pt.room ? 'E' : 'W');
      const rec = { id: res.openings.length, wall: w.id, level: 0, kind: pt.kind, s0: pt.s0, s1: pt.s1, into: pt.kind === 'door' || pt.kind === 'double' ? pt.room : null, hinge: null, part: -1, tags: (pt.tags || []).slice() };
      if (rec.into !== null) rec.hinge = w.o === 'h' ? [pt.s0, w.c] : [w.c, pt.s0];
      rec.height = pt.kind === 'vehicle' ? 2.25 : pt.kind === 'opening' ? (pt.height || 2.2) : 2.1;
      rec.portal = res.portals.length;
      res.openings.push(rec);
      res.portals.push({ opening: rec.id, room: pt.room, level: 0, role: pt.role || 'both', kind: pt.kind, side, clear: pt.clear !== undefined ? pt.clear : 1.5, main: !!pt.main, tags: pt.tags || [] });
      res.links.push({ a: pt.room, b: OUT, kind: pt.kind, opening: rec.id });
    }
    // ---- no two openings on a line overlap
    const lines = new Map();
    for (const op of res.openings) { const w = res.walls[op.wall], k = w.level + w.o + w.c; if (!lines.has(k)) lines.set(k, []); lines.get(k).push(op); }
    for (const list of lines.values()) {
      list.sort((a, b) => a.s0 - b.s0);
      for (let i = 1; i < list.length; i++) if (list[i].s0 < list[i - 1].s1) hard('overlapping openings');
    }
    // ---- checks
    res.rooms.forEach((rm) => {
      if (!rm.rects.length) { hard(rm.type + ' has no floor'); return; }
      const ty = rm.part < 0 ? T[rm.type] : null;
      if (rm.part < 0 && !ty) hard('unknown room type ' + rm.type);
      const big = rm.rects.reduce((b, r) => (TG.rarea(r) > TG.rarea(b) ? r : b), rm.rects[0]);
      if (ty && ty.minW && TG.rshort(big) < ty.minW) hard(rm.type + ' narrower than ' + ty.minW * G + ' m');
    });
    if (!res.portals.some((p) => p.role === 'entrance' || p.role === 'both')) hard('no entrance');
    const N = res.rooms.length, adj = res.rooms.map(() => []);
    adj.push([]);
    for (const Lk of res.links) if (PASS[Lk.kind]) { const x = Lk.a < 0 ? N : Lk.a, y = Lk.b < 0 ? N : Lk.b; adj[x].push(y); adj[y].push(x); }
    for (const v of res.verticals) for (let k = 1; k < v.rooms.length; k++) { adj[v.rooms[k - 1]].push(v.rooms[k]); adj[v.rooms[k]].push(v.rooms[k - 1]); }
    const seen = new Uint8Array(N + 1), st = [N];
    seen[N] = 1;
    while (st.length) { const u = st.pop(); for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; st.push(v); } }
    const lost = res.rooms.map((_, i) => i).filter((i) => !seen[i]);
    if (lost.length) hard('unreachable: ' + lost.map((i) => res.rooms[i].type).join(', '));
    return res;
  }

  // ------------------------------------------------------------ output
  function output(res, ctx, plan, meta) {
    const spec = ctx.spec, W = res.W, H = res.H, E = ctx.engine, T = E.types || {};
    const O = TG.orient(spec.approach, W * G, H * G);
    const m = (v) => round3(v * G);
    const P = (x, y) => O.pt(m(x), m(y)).map(round3);
    const Rm = (r) => O.rect(r.map(m)).map(round3);
    const id = (i) => (i >= 0 ? 'r' + i : null);
    const counts = {};
    const levels = [];
    for (let lv = 0, elev = 0; lv < res.L; lv++) {
      let h = 3;
      for (const Pt of plan.parts) if (Pt.b.levels[lv]) h = Math.max(h, Pt.b.levels[lv].height);
      levels.push({ index: lv, elevation: Math.round(elev * 100) / 100, height: h });
      elev += h;
    }
    const rooms = res.rooms.map((rm, i) => {
      let name = rm.name;
      if (rm.part < 0) {
        counts[rm.type] = (counts[rm.type] || 0) + 1;
        const ty = T[rm.type] || {};
        name = (ty.label || rm.type.replace(/_/g, ' ')) + (counts[rm.type] > 1 ? ' ' + counts[rm.type] : '');
      }
      return {
        id: id(i), type: rm.type, name, zone: rm.zone, level: rm.level,
        rects: rm.rects.map(Rm), area: Math.round(TG.rectsArea(rm.rects) * G * G * 100) / 100,
        ceiling: rm.ceiling, tags: rm.tags, parent: rm.parent !== null && rm.parent !== undefined ? id(rm.parent) : null,
        part: rm.part >= 0 ? 'u' + rm.part : null
      };
    });
    const walls = res.walls.map((w) => ({
      id: 'w' + w.id, level: w.level, kind: w.kind,
      a: w.o === 'h' ? P(w.s0, w.c) : P(w.c, w.s0), b: w.o === 'h' ? P(w.s1, w.c) : P(w.c, w.s1),
      rooms: [id(w.lo), id(w.hi)], thickness: THICK[w.kind] || 0
    }));
    const openings = res.openings.map((op) => {
      const w = res.walls[op.wall];
      const o = {
        id: 'o' + op.id, level: op.level, wall: 'w' + w.id, kind: op.kind,
        a: w.o === 'h' ? P(op.s0, w.c) : P(w.c, op.s0), b: w.o === 'h' ? P(op.s1, w.c) : P(w.c, op.s1),
        width: m(op.s1 - op.s0), rooms: [id(w.lo), id(w.hi)]
      };
      if (op.into !== null && op.into !== undefined) { o.swingInto = id(op.into); if (op.hinge) o.hinge = P(op.hinge[0], op.hinge[1]); }
      if (op.kind === 'window') { o.sill = op.sill; o.head = op.head; } else o.height = op.height;
      if (op.portal !== undefined) o.portal = 'p' + op.portal;
      if (op.part >= 0) o.part = 'u' + op.part;
      if (op.tags && op.tags.length) o.tags = op.tags;
      return o;
    });
    const portals = res.portals.map((p, i) => ({
      id: 'p' + i, opening: 'o' + p.opening, level: p.level, room: id(p.room), role: p.role, kind: p.kind,
      side: O.side(p.side), width: m(res.openings[p.opening].s1 - res.openings[p.opening].s0), clear: p.clear, main: p.main, tags: p.tags
    }));
    const verticals = res.verticals.map((v, i) => ({ id: 'v' + i, kind: v.kind, rooms: v.rooms.map(id), dead: !!v.dead, tags: v.tags }));
    const footprint = [];
    for (let lv = 0; lv < res.L; lv++) footprint.push({ level: lv, rects: TG.rectsWhere(res.R[lv], (v) => v >= 0).map(Rm) });
    const graph = { nodes: rooms.map((r) => r.id).concat('outside'), edges: [] };
    for (const Lk of res.links) graph.edges.push([id(Lk.a) || 'outside', id(Lk.b) || 'outside', Lk.kind, Lk.opening !== null ? 'o' + Lk.opening : null]);
    for (const v of verticals) for (let k = 1; k < v.rooms.length; k++) graph.edges.push([v.rooms[k - 1], v.rooms[k], v.kind, null]);
    // the children: what built each one, where it stands, its rooms and the doors it opens onto the composite
    const parts = plan.parts.map((Pt, k) => {
      const b = Pt.b, site = [Pt.at[0], Pt.at[1], Pt.at[0] + U(b.site.w), Pt.at[1] + U(b.site.h)];
      return {
        id: 'u' + k, archetype: b.archetype, engine: b.engine, name: b.name, label: Pt.label || b.name,
        approach: O.side(b.approach), site: { rects: [Rm(site)] }, score: b.meta.score, mutations: b.meta.mutations,
        rooms: rooms.filter((r) => r.part === 'u' + k).map((r) => r.id),
        doors: res.openings.filter((op) => op.wasPortal && op.wasPortal.part === k).map((op) => 'o' + op.id),
        spec: b.spec
      };
    });
    const S = ctx.site;
    return {
      schema: TPL.SCHEMA, engine: E.id, archetype: ctx.arch.id, name: ctx.arch.name || ctx.arch.id,
      seed: spec.seed >>> 0, approach: spec.approach, grid: G,
      site: { w: S.real.w, h: S.real.h, rects: S.realRects },
      levels, footprint, rooms, walls, openings, portals, verticals, graph, parts,
      meta
    };
  }

  // ------------------------------------------------------------ compose
  /** TPL.generate for a composite engine (one with `plan`). Same spec, same contract. */
  function compose(spec, arch, engine) {
    const t0 = now();
    const seed = spec.seed >>> 0, ah = TG.hashStr(arch.id), approach = spec.approach || 'S';
    const site = TPL.makeSite(spec, arch, seed, ah, approach);
    const base = hash4(seed, ah, site.W * 4096 + site.H, site.area);
    const rs = (salt, i) => new Rng(hash4(base, salt, i | 0, 0x51));
    const mutations = TPL.pickMutations(engine, arch, spec, rs(SALT.MUT));
    const ctx = { arch, engine, site, spec: Object.assign({}, spec, { approach, seed }), mutations, mut: new Set(mutations), why: {}, base };
    const program = engine.program(arch, rs(SALT.PROGRAM), ctx);
    ctx.program = program;
    const kit = makeKit(ctx);
    const N = spec.candidates || arch.candidates || 3;
    let tried = 0, chosen = -1, best = null, bestPlan = null;
    for (let i = 0; i < N && !best; i++) {
      const plan = engine.plan(program, ctx, rs(SALT.LAYOUT, i), kit);
      if (!plan) continue;
      tried++;
      const res = merge(ctx, plan);
      const hard = res.issues.filter((x) => x.hard);
      if (hard.length) { why(ctx, 'invalid: ' + hard[0].msg.replace(/^[0-9]+ /, '').replace(/^part [0-9]+: /, 'a part: ')); continue; }
      best = res; bestPlan = plan; chosen = i;
    }
    if (!best) {
      return { schema: TPL.SCHEMA, error: 'no valid layout', engine: engine.id, archetype: arch.id, name: arch.name || arch.id, seed, approach,
        site: { w: site.real.w, h: site.real.h, rects: site.realRects }, meta: { candidates: N, tried, mutations, layoutFailures: ctx.why, ms: Math.round((now() - t0) * 10) / 10 } };
    }
    // score: the children's own scores, plus what the engine charges its plan
    const terms = {};
    const add = (k, v) => { if (v) terms[k] = Math.round(((terms[k] || 0) + v) * 10) / 10; };
    const kids = bestPlan.parts.map((P) => P.b.meta.penalty || 0);
    if (kids.length) add('parts', kids.reduce((a, b) => a + b, 0) / kids.length);
    for (const k in bestPlan.terms || {}) add(k, bestPlan.terms[k]);
    let penalty = 0;
    for (const k in terms) penalty += terms[k];
    penalty = Math.round(penalty * 10) / 10;
    const meta = {
      plan: bestPlan.meta || {}, score: Math.max(0, Math.round((100 - penalty) * 10) / 10), penalty, terms,
      candidates: N, resolved: tried, valid: 1, chosen, mutations, layoutFailures: ctx.why,
      program: (bestPlan.summary || program.summary || []).slice(),
      issues: best.issues.map((x) => (x.hard ? 'ERROR ' : '') + x.msg).concat(best.dropped ? [best.dropped + ' window(s) astride a yard edge left out'] : []),
      autoDoors: [], parts: bestPlan.parts.length, ms: 0
    };
    const b = output(best, ctx, bestPlan, meta);
    meta.ms = Math.round((now() - t0) * 10) / 10;
    Object.defineProperty(b, '_debug', { value: { res: best, ctx, plan: bestPlan }, enumerable: false });
    return b;
  }

  TPL.compose = compose;
  TPL.composite = { merge, makeKit };
})(typeof window !== 'undefined' ? window : globalThis);
