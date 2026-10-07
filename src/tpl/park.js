/*
 * tpl/park.js - the Park engine: a park indoors, after the pitfalls
 * reference. One big hall under a low ceiling, its floor tiled exactly by
 * zones (marked areas a later pass reads to place props): lawns crossed by
 * tiled paths, a playground, pillars standing on tile pads, benches by the
 * paths, and sometimes a small building, built by its own template (a
 * restroom, a storage room, a bungalow) and placed in the park
 * (tpl/composite.js).
 *
 * Canonical frame, main side at the bottom:
 *
 *   ┌──────────╥─────────────┐
 *   │  lawn    ║   lawn  ▪   │   ║ ═ paths: one from the entrance to the far
 *   │ ┌──────┐ ║  ┌─────┐    │       wall, often a cross path wall to wall
 *   │ │ play │ ║  │bldg │    │   ▪ a pillar on its tile pad (plaza)
 *   │ └──────┘ ║  └─────┘    │   play: the playground
 *   ╞══════════╬═════════════╡   bldg: a child template, 1 m of plaza
 *   │  lawn  ▪ ║ b  lawn     │     round it, facing the main path
 *   └──────────╨─────────────┘   b: seating, a bench spot on a path's edge
 *        entrance (main)
 *
 *   zones   lawn, path, plaza (pillar pads, the apron round the building),
 *           playground, seating, pit (wrongness). Every floor cell of the
 *           hall is in exactly one zone; a zone is one connected patch
 *   portals the entrance at the bottom of the main path; by chance a way out
 *           at its far end and at either end of the cross path
 *   pillars columns on a loose grid, off the paths, the playground and the
 *           building, each on a plaza pad
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL, { hash4 } = BR;
  const U = (m) => Math.round(m / TG.GRID), G = TG.GRID;
  const rr = (rng, r) => (Array.isArray(r) ? rng.range(r[0], r[1]) : r);
  const why = (ctx, k) => { ctx.why[k] = (ctx.why[k] || 0) + 1; return null; };
  const SALT = { BUILDING: 0x7061 };

  // its room and its zones, from the catalogue (zone types are not rooms: what a prop pass reads)
  const T = Object.assign(TPL.CAT.types(['park']), TPL.CAT.zones(['lawn', 'path', 'plaza', 'playground', 'seating', 'pit']));
  // when two zones claim a cell, the higher one keeps it
  const RANK = { lawn: 0, path: 1, seating: 2, plaza: 3, playground: 4, pit: 5 };
  const TYPES = Object.keys(RANK);
  const MUTATIONS = {
    pit: { weight: 1, label: 'a pit in the lawn' },
    crowded: { weight: 0.8, label: 'pillars everywhere' }
  };

  function program(arch) {
    const B = arch.building || {};
    return { summary: ['a building ' + Math.round((B.p || 0) * 100) + '% of the time, from ' + Object.keys(B.templates || {}).join(', ')] };
  }

  /** a child building in quadrant Q (units), facing `face`, or null */
  function building(Q, face, ctx, rng, kit) {
    const A = ctx.arch, B = A.building || {}, m = U(rr(rng, B.margin || [2, 3]));
    const R = [Q[0] + m, Q[1] + m, Q[2] - m, Q[3] - m];
    if (!TG.rvalid(R)) return null;
    const w8 = {};
    for (const id of Object.keys(B.templates || {})) if (TPL.archetypes[id]) w8[id] = B.templates[id];
    const ids = Object.keys(w8);
    for (let t = 0; t < 3 && ids.length; t++) {
      const id = rng.weighted(w8), a = TPL.archetypes[id], s = a.site || { w: [4, 8], h: [4, 8] };
      // facing E or W the template's front runs along y, its depth along x
      const along = TG.rh(R), across = TG.rw(R);
      const fw = Math.min(along, U(rr(rng, s.w))), fd = Math.min(across, U(rr(rng, s.h)));
      if (fw < U(s.w[0]) || fd < U(s.h[0])) { delete w8[id]; ids.splice(ids.indexOf(id), 1); continue; }
      const y0 = R[1] + rng.int(0, along - fw);
      const rect = face === 'E' ? [R[2] - fd, y0, R[2], y0 + fw] : [R[0], y0, R[0] + fd, y0 + fw];
      const b = kit.child({ archetype: id, seed: hash4(ctx.base, SALT.BUILDING, t, 0), rect, approach: face, wrongness: ctx.spec.wrongness });
      if (!b.error) return { b, at: [rect[0], rect[1]], label: b.name };
    }
    return null;
  }

  function plan(P, ctx, rng, kit) {
    const A = ctx.arch, S = ctx.site, r = S.inner, W = TG.rw(r), H = TG.rh(r);
    if (Math.min(W, H) < U(16)) return why(ctx, 'site:small');
    const pw = U(rr(rng, A.path || [2, 3])), half = Math.floor(pw / 2);
    // ---- paths: the main one from the entrance to the far wall, maybe a cross path
    const mx = r[0] + Math.round(W * rng.range(0.38, 0.62)) - half;
    const main = [mx, r[1], mx + pw, r[3]];
    const cross = rng.f() < (A.cross === undefined ? 0.7 : A.cross) ? (() => { const cy = r[1] + Math.round(H * rng.range(0.3, 0.55)) - half; return [r[0], cy, r[2], cy + pw]; })() : null;
    const paths = [main].concat(cross ? [cross] : []);
    // ---- the blocks the paths leave (the playground and the building each take one)
    const xs = [[r[0], main[0]], [main[2], r[2]]], ys = cross ? [[r[1], cross[1]], [cross[3], r[3]]] : [[r[1], r[3]]];
    const blocks = [];
    for (const [x0, x1] of xs) for (const [y0, y1] of ys) if (x1 - x0 >= U(5) && y1 - y0 >= U(5)) blocks.push({ r: [x0, y0, x1, y1], west: x1 === main[0] });
    if (!blocks.length) return why(ctx, 'site:noBlocks');
    blocks.sort((p, q) => TG.rarea(q.r) - TG.rarea(p.r));
    // ---- the playground: a clear rectangle in one block, a metre of lawn round it
    const PG = A.playground || { w: [7, 11], d: [6, 10] };
    let play = null, playBlock = null;
    for (const bl of blocks) {
      const R = [bl.r[0] + 2, bl.r[1] + 2, bl.r[2] - 2, bl.r[3] - 2];
      const pwid = Math.min(TG.rw(R), U(rr(rng, PG.w))), pdep = Math.min(TG.rh(R), U(rr(rng, PG.d)));
      if (pwid < U(PG.w[0]) * 0.8 || pdep < U(PG.d[0]) * 0.8) continue;
      // next to a path, so it opens off one
      const x0 = bl.west ? R[2] - pwid : R[0], y0 = R[1] + rng.int(0, TG.rh(R) - pdep);
      play = [x0, y0, x0 + pwid, y0 + pdep]; playBlock = bl;
      break;
    }
    if (!play) return why(ctx, 'site:noPlayground');
    // ---- sometimes a small building, built by its own template, in another block
    const parts = [];
    let bld = null;
    if (rng.f() < ((A.building || {}).p || 0)) {
      for (const bl of blocks) {
        if (bl === playBlock) continue;
        bld = building(bl.r, bl.west ? 'E' : 'W', ctx, rng, kit);
        if (bld) { parts.push(bld); break; }
      }
      if (!bld) why(ctx, 'building:none fit');
    }
    // ---- the hall: the whole site but the building's footprint
    const HALL = 0, M = new TG.Raster(S.W, S.H, -1);
    M.fill(r, HALL);
    const fp = bld ? kit.footprint(bld.b, bld.at) : [];
    for (const q of fp) M.fill(q, -1);
    const hall = Math.round(rr(rng, A.ceiling || [4.5, 7]) * 10) / 10;
    // ---- zones, painted by rank on the hall's cells
    const Z = new TG.Raster(S.W, S.H, -1), paint = (q, t) => { for (let y = Math.max(q[1], r[1]); y < Math.min(q[3], r[3]); y++) for (let x = Math.max(q[0], r[0]); x < Math.min(q[2], r[2]); x++) if (M.get(x, y) === HALL && RANK[t] >= (Z.get(x, y) < 0 ? -1 : Z.get(x, y))) Z.set(x, y, RANK[t]); };
    paint(r, 'lawn');
    for (const q of paths) paint(q, 'path');
    // the building's apron: a metre of tile round it
    if (bld) { const hb = TG.bbox(fp); paint([hb[0] - 2, hb[1] - 2, hb[2] + 2, hb[3] + 2], 'plaza'); }
    // the portals, so pillars and benches keep clear of them
    const portals = [], landings = [];
    const gate = (o, c, s0, w, kind, role, main, tags) => {
      const p = { room: HALL, o, c, s0, s1: s0 + w, kind, role, main, clear: 2, height: 3, tags };
      portals.push(p);
      landings.push(o === 'h' ? [s0 - 2, c - 4, s0 + w + 2, c + 4] : [c - 4, s0 - 2, c + 4, s0 + w + 2]);
    };
    const gw = Math.max(U(1.5), Math.min(pw, U(rr(rng, A.gate || [2, 3.5])))), gx = main[0] + Math.floor((pw - gw) / 2);
    gate('h', r[3], gx, gw, 'opening', 'both', true, ['park', 'entrance']);
    const ex = A.exits || {};
    if (rng.f() < (ex.far || 0)) gate('h', r[1], gx, gw, 'opening', 'both', false, ['park', 'far end']);
    if (cross) for (const [c, tag] of [[r[0], 'west'], [r[2], 'east']]) if (rng.f() < (ex.side || 0)) gate('v', c, cross[1] + Math.floor((pw - gw) / 2), gw, 'opening', 'both', false, ['park', tag]);
    // ---- wrongness: a pit somewhere in the lawn
    let pitAt = null;
    if (ctx.mut.has('pit')) {
      for (let t = 0; t < 30; t++) {
        const n = U(rng.range(2, 4)), x = r[0] + rng.int(2, W - n - 2), y = r[1] + rng.int(2, H - n - 2), q = [x, y, x + n, y + n];
        let ok = true;
        for (let yy = y - 2; yy < y + n + 2 && ok; yy++) for (let xx = x - 2; xx < x + n + 2; xx++) if (M.get(xx, yy) !== HALL || Z.get(xx, yy) !== RANK.lawn || TG.roverlap(play, [xx, yy, xx + 1, yy + 1]) || landings.some((l) => TG.roverlap(l, [xx, yy, xx + 1, yy + 1]))) { ok = false; break; }
        if (ok) { paint(q, 'pit'); pitAt = [x - 2, y - 2, x + n + 2, y + n + 2]; break; }
      }
    }
    // ---- pillars on a loose grid, each on a tile pad
    const PI = A.pillars || {}, columns = [];
    if (rng.f() < (PI.p === undefined ? 0.75 : PI.p) || ctx.mut.has('crowded')) {
      const every = U(rr(rng, PI.every || [8, 11]) * (ctx.mut.has('crowded') ? 0.5 : 1)), size = Math.max(2, U(rr(rng, PI.size || [0.8, 1.5]))), pad = Math.max(size + 2, U(rr(rng, PI.pad || [2.5, 3.5])));
      const keep = [play].concat(bld ? [[TG.bbox(fp)[0] - 4, TG.bbox(fp)[1] - 4, TG.bbox(fp)[2] + 4, TG.bbox(fp)[3] + 4]] : [], landings, pitAt ? [pitAt] : []);
      const ox = r[0] + rng.int(every >> 1, every), oy = r[1] + rng.int(every >> 1, every);
      for (let cy = oy; cy + pad < r[3]; cy += every) for (let cx = ox; cx + pad < r[2]; cx += every) {
        const col = [cx - (size >> 1), cy - (size >> 1), cx - (size >> 1) + size, cy - (size >> 1) + size];
        const pd = [cx - (pad >> 1), cy - (pad >> 1), cx - (pad >> 1) + pad, cy - (pad >> 1) + pad];
        if (pd[0] < r[0] + 2 || pd[1] < r[1] + 2 || pd[2] > r[2] - 2 || pd[3] > r[3] - 2) continue;
        if (keep.some((q) => TG.roverlap(q, pd)) || paths.some((q) => TG.roverlap(q, [col[0] - 2, col[1] - 2, col[2] + 2, col[3] + 2]))) continue;
        columns.push({ room: HALL, rect: col });
        paint(pd, 'plaza');
      }
    }
    // ---- benches: short seating strips on a path's edge, on the lawn side
    const SEAT = A.seats || [1, 4], want = rng.int(SEAT[0], SEAT[1]);
    let seats = 0;
    for (let t = 0; t < want * 8 && seats < want; t++) {
      const p = paths[rng.int(0, paths.length - 1)], vert = TG.rh(p) > TG.rw(p), len = U(rng.range(2, 3)), side = rng.f() < 0.5 ? -1 : 1;
      const s0 = (vert ? p[1] : p[0]) + rng.int(2, Math.max(2, (vert ? TG.rh(p) : TG.rw(p)) - len - 2));
      const q = vert ? (side < 0 ? [p[0] - 2, s0, p[0], s0 + len] : [p[2], s0, p[2] + 2, s0 + len]) : (side < 0 ? [s0, p[1] - 2, s0 + len, p[1]] : [s0, p[3], s0 + len, p[3] + 2]);
      if (!TG.rcontains(r, q) || landings.some((l) => TG.roverlap(l, q))) continue;
      let lawn = true;
      for (let y = q[1]; y < q[3] && lawn; y++) for (let x = q[0]; x < q[2]; x++) if (M.get(x, y) !== HALL || Z.get(x, y) !== RANK.lawn) { lawn = false; break; }
      if (!lawn) continue;
      paint(q, 'seating'); seats++;
    }
    paint(play, 'playground');
    // ---- zones: one per connected patch of a type; a crumb under 1 m² joins
    // the zone round it, so no zone is a sliver
    const comps = [];
    for (const t of TYPES) for (const c of TG.components(Z, (v) => v === RANK[t])) comps.push({ t, cells: c });
    for (const c of comps) if (c.cells.length < 4 && c.t !== 'pit') {
      const near = {};
      for (const i of c.cells) { const x = i % S.W, y = (i - x) / S.W; for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const v = Z.get(nx, ny); if (v >= 0 && v !== RANK[c.t]) near[v] = (near[v] || 0) + 1; } }
      const to = Object.keys(near).sort((p, q) => near[q] - near[p])[0];
      if (to !== undefined) for (const i of c.cells) Z.a[i] = +to;
    }
    const zones = [];
    for (const t of TYPES) for (const c of TG.components(Z, (v) => v === RANK[t])) {
      const mask = new TG.Raster(S.W, S.H, 0);
      for (const i of c) mask.a[i] = 1;
      zones.push({ type: t, room: HALL, rects: TG.rectsWhere(mask, (v) => v === 1), tags: (T[t].tags || []).slice() });
    }
    const hallRects = TG.rectsWhere(M, (v) => v === HALL);
    const kinds = {};
    for (const z of zones) kinds[z.type] = (kinds[z.type] || 0) + 1;
    return {
      rooms: [{ type: 'park', rects: hallRects, ceiling: hall }], parts, portals, open: true, zones, columns, terms: {},
      meta: { type: bld ? 'park with ' + bld.b.name.toLowerCase() : 'open park', paths: paths.length, pillars: columns.length, zones: zones.length },
      summary: [
        'hall ceiling ' + hall + ' m, ' + (cross ? 'two paths crossing' : 'one path') + ', ' + portals.length + ' way(s) in',
        bld ? 'a ' + bld.b.name.toLowerCase() + ', built by its own template' : 'no building',
        columns.length + ' pillar(s), ' + seats + ' bench spot(s)',
        'zones: ' + Object.entries(kinds).map(([k, v]) => k + ' ' + v).join(', ')
      ]
    };
  }

  TPL.registerEngine({ id: 'park', name: 'Park (zoned hall)', types: T, mutations: MUTATIONS, composite: true, program, plan });
})(typeof window !== 'undefined' ? window : globalThis);
