/*
 * tpl/neighborhood.js - the Neighborhood engine: a street down the middle of
 * a big hall, houses lined up along both sides of it, every house built by
 * the House engine. It is the first composite template (tpl/composite.js):
 * a template made of other templates.
 *
 * In the canonical frame (main side at the bottom), the street runs from the
 * entrance at the bottom to the far end at the top:
 *
 *        far end (maybe a way out)
 *   ┌──────┬────────┬──────┐
 *   │ ▓▓▓  │        │  ▓▓▓ │   ▓ a house, built by its own template on its
 *   │ ▓▓▓ ·│        │· ▓▓▓ │     own sub-site, facing the street, its back
 *   │      │ street │      │     against the hall wall
 *   │ ▓▓▓▓·│        │·▓▓▓▓ │   · its front yard: from the street up to the
 *   │ ▓▓▓▓ │        │ ▓▓▓▓ │     house, into any recess, so every door the
 *   │      │        │      │     house chose opens onto it
 *   └──────┴───┬┬───┴──────┘
 *          entrance (main)
 *
 *   street   8-12 m wide, end to end, a tall hall ceiling
 *   rows     lots packed along each side from the far end; the entrance end
 *            is kept clear. Each lot's house template comes from the recipe's
 *            `houses` weights, its frontage from that template's own site
 *            range. Houses are built with the recipe's `child` overrides (no
 *            back or side doors: every door of a house opens onto the street
 *            side), then pushed back against the hall wall, leaving a front
 *            yard of at most `yard[1]` m
 *   yards    one per lot, open to the street and to the next yard (fences are
 *            for a furnishing pass); the rest of a row is solid
 *   portals  the entrance (a wide opening or double doors) and, sometimes, a
 *            way out at the far end
 *
 * A house that will not build on its lot is tried on more seeds, then as the
 * recipe's smallest house; if nothing fits, the lot stands empty.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL, { hash4 } = BR;
  const U = (m) => Math.round(m / TG.GRID), G = TG.GRID;
  const rr = (rng, r) => (Array.isArray(r) ? rng.range(r[0], r[1]) : r);
  const why = (ctx, k) => { ctx.why[k] = (ctx.why[k] || 0) + 1; return null; };
  const SALT = { HOUSE: 0x4e48 };
  const EMPTY = -1, HOUSE = -2;

  // the composite's own rooms (the houses bring theirs), from the catalogue
  const T = TPL.CAT.types(['street', 'front_yard', 'vacant_lot']);
  const MUTATIONS = {
    twins: { weight: 1, label: 'every house is the same house' },
    vacant: { weight: 0.8, label: 'one lot stands empty' }
  };

  /** the house templates a recipe lines its street with: [{ id, a, w }] */
  function houseList(arch) {
    const out = [];
    for (const id of Object.keys(arch.houses || {})) {
      const a = TPL.archetypes[id];
      if (a && a.engine === 'house' && arch.houses[id] > 0) out.push({ id, a, w: arch.houses[id] });
    }
    return out;
  }
  function program(arch) {
    const list = houseList(arch);
    return { houses: list, summary: ['houses from ' + (list.map((h) => h.a.name).join(', ') || 'nothing')] };
  }
  const pickHouse = (rng, list) => { const w = {}; for (const h of list) w[h.id] = h.w; const id = rng.weighted(w); return list.find((h) => h.id === id); };

  // ------------------------------------------------------------ one lot
  /**
   * Build the house of one lot, place it and paint its front yard into M.
   * row: { face, x0, x1, street (the street's edge on this row) }; lot:
   * { y0, y1 (the house's frontage), s0, s1 (the yard's span along the
   * street, gaps included) }. Returns { b, at, id } or null (nothing painted).
   */
  function placeLot(M, row, lot, house, seed, P, ctx, kit, yardId, depth) {
    const A = ctx.arch, west = row.face === 'E';
    const rect = west ? [row.x0, lot.y0, row.x0 + depth, lot.y1] : [row.x1 - depth, lot.y0, row.x1, lot.y1];
    const wrongness = ctx.spec.wrongness !== undefined && ctx.spec.wrongness !== null ? ctx.spec.wrongness : undefined;
    const b = kit.child({ archetype: house.id, override: A.child || null, seed, rect, approach: row.face, wrongness, tries: A.tries || 3 });
    if (b.error) return null;
    // push the house back against the hall wall, but keep the yard in front of
    // it no deeper than the recipe wants
    const fp = kit.footprint(b, [rect[0], rect[1]]), fb = TG.bbox(fp);
    const back = west ? fb[0] - row.x0 : row.x1 - fb[2], front = west ? row.street - fb[2] : fb[0] - row.street;
    const maxYard = U(A.yardMax || 8), shift = Math.max(0, Math.min(back, maxYard - front));
    const at = [rect[0] + (west ? -shift : shift), rect[1]];
    const cells = kit.footprint(b, at), hb = TG.bbox(cells);
    // the yard: every row of the lot from the street to the house (into any
    // recess); beside the house, from the street to its front
    const paint = [];
    const isHouse = (x, y) => cells.some((q) => x >= q[0] && x < q[2] && y >= q[1] && y < q[3]);
    for (let y = lot.s0; y < lot.s1; y++) {
      const beside = y < hb[1] || y >= hb[3];
      if (west) {
        for (let x = row.street - 1; x >= row.x0; x--) { if (beside ? x < hb[2] : isHouse(x, y)) break; paint.push(x, y); }
      } else {
        for (let x = row.street; x < row.x1; x++) { if (beside ? x >= hb[0] : isHouse(x, y)) break; paint.push(x, y); }
      }
    }
    // every door the house chose must open onto its yard
    const yard = new Set();
    for (let k = 0; k < paint.length; k += 2) yard.add(paint[k] + ',' + paint[k + 1]);
    for (const p of b.portals) {
      if (p.level) return why(ctx, 'house:upperPortal');
      const op = b.openings.find((o) => o.id === p.opening), horiz = op.a[1] === op.b[1];
      const c = U(horiz ? op.a[1] : op.a[0]) + (horiz ? at[1] : at[0]);
      const s0 = U(Math.min(horiz ? op.a[0] : op.a[1], horiz ? op.b[0] : op.b[1])) + (horiz ? at[0] : at[1]);
      for (let s = s0; s < s0 + U(op.width); s++) {
        const cell = p.side === 'N' ? [s, c - 1] : p.side === 'S' ? [s, c] : p.side === 'W' ? [c - 1, s] : [c, s];
        if (!yard.has(cell[0] + ',' + cell[1])) return why(ctx, 'house:doorNotOnYard');
      }
    }
    for (const q of cells) M.fill(q, HOUSE);
    for (let k = 0; k < paint.length; k += 2) M.set(paint[k], paint[k + 1], yardId);
    return { b, at };
  }

  // ------------------------------------------------------------ plan
  function plan(P, ctx, rng, kit) {
    const A = ctx.arch, S = ctx.site, r = S.inner, twins = ctx.mut.has('twins');
    if (!P.houses.length) return why(ctx, 'no house templates');
    const iw = r[2] - r[0];
    // ---- across: two rows of lots either side of the street
    const sMin = U((A.street || [8, 12])[0]), sMax = U((A.street || [8, 12])[1]);
    const rowW = U(rr(rng, A.row || [15, 20]));
    const rowMin = U(A.rowMin || 9);
    let sw = Math.max(sMin, Math.min(sMax, iw - 2 * rowW));
    if (twins && (iw - sw) % 2) sw += sw < sMax ? 1 : -1;           // twin houses need two rows the same depth
    if (iw - sw < 2 * rowMin) return why(ctx, 'site:narrow');
    let dW = Math.floor((iw - sw) / 2);
    if (!twins) dW = Math.max(rowMin, Math.min(iw - sw - rowMin, dW + rng.int(-2, 2)));
    const xs0 = r[0] + dW, xs1 = xs0 + sw;
    const hall = Math.round(rr(rng, A.ceiling || [9, 14]) * 10) / 10;
    const rows = [
      { name: 'left', face: 'E', x0: r[0], x1: xs0, street: xs0, lots: [] },      // houses facing east, on the left as you walk in
      { name: 'right', face: 'W', x0: xs1, x1: r[2], street: xs1, lots: [] }
    ];
    // ---- along: lots packed from the far end; the entrance end is kept clear
    const yStart = r[1] + U(rr(rng, A.farEnd || [0, 1.5])), yEnd = r[3] - U(rr(rng, A.mouth || [2, 6]));
    const perSide = A.perSide || 4;
    // twins: one house repeated down both sides, so one that fits at least twice
    const repeats = P.houses.filter((h) => 2 * U(h.a.site.w[0]) + U((A.gap || [1, 2.5])[1]) <= yEnd - yStart);
    const twin = twins ? pickHouse(rng, repeats.length ? repeats : P.houses) : null;
    const twinF = twin ? rng.int(U(twin.a.site.w[0]), U(twin.a.site.w[1])) : 0;
    const twinApron = U(rr(rng, A.apron || [2, 4]));
    for (const row of rows) {
      row.apron = twins ? twinApron : U(rr(rng, A.apron || [2, 4]));
      row.depth = row.x1 - row.x0 - row.apron;
      let y = yStart;
      while (row.lots.length < perSide) {
        const rem = yEnd - y;
        const fits = P.houses.filter((h) => U(h.a.site.w[0]) <= rem);
        if (!fits.length) break;
        const h = twin || pickHouse(rng, fits);
        if (U(h.a.site.w[0]) > rem) break;
        const f = twin ? twinF : rng.int(U(h.a.site.w[0]), Math.min(U(h.a.site.w[1]), rem));
        if (f > rem) break;
        row.lots.push({ house: h, y0: y, y1: y + f });
        y += f + U(rr(rng, A.gap || [1, 2.5]));
      }
      // each yard reaches half way into the gaps either side of its lot
      row.lots.forEach((L, k) => {
        L.s0 = k === 0 ? yStart : Math.round((row.lots[k - 1].y1 + L.y0) / 2);
        L.s1 = k === row.lots.length - 1 ? L.y1 : Math.round((L.y1 + row.lots[k + 1].y0) / 2);
      });
    }
    if (rows.some((row) => !row.lots.length)) return why(ctx, 'site:short');
    // ---- wrongness: one lot left empty
    const all = rows.flatMap((row, ri) => row.lots.map((L, k) => ({ row, ri, L, k })));
    const spare = all.filter((x) => x.row.lots.length > 1);
    if (ctx.mut.has('vacant') && spare.length) spare[rng.int(0, spare.length - 1)].L.vacant = 'wrong';
    // ---- build every house on its lot, then its front yard
    const M = new TG.Raster(S.W, S.H, EMPTY);
    const rooms = [{ type: 'street', rects: [[xs0, r[1], xs1, r[3]]], ceiling: hall }];
    const parts = [], terms = {}, built = { left: [], right: [] };
    const smallest = P.houses.slice().sort((p, q) => p.a.site.w[0] - q.a.site.w[0])[0];
    for (const { row, ri, L, k } of all) {
      const yardId = rooms.length;
      let got = null;
      if (!L.vacant) {
        const seed = hash4(ctx.base, SALT.HOUSE, twins ? 0 : ri * 64 + k, 0);
        got = placeLot(M, row, L, L.house, seed, P, ctx, kit, yardId, row.depth);
        if (!got && !twins && smallest !== L.house && U(smallest.a.site.w[0]) <= L.y1 - L.y0) {
          got = placeLot(M, row, L, smallest, hash4(ctx.base, SALT.HOUSE, ri * 64 + k, 1), P, ctx, kit, yardId, row.depth);
          if (got) terms.fallback = (terms.fallback || 0) + 2;
        }
        if (!got) { L.vacant = 'failed'; terms.vacant = (terms.vacant || 0) + 6; }
      }
      if (got) {
        const n = row.lots.length - k;                                     // numbered from the entrance
        parts.push({ b: got.b, at: got.at, label: row.name + ' ' + n + ' · ' + got.b.name });
        built[row.name].push(got.b.name);
        rooms.push({ type: 'front_yard', rects: null, ceiling: hall, lot: { row: row.name, n } });
      } else {
        // an empty lot: from the street back to the hall wall
        for (let y = L.s0; y < L.s1; y++) for (let x = row.x0; x < row.x1; x++) M.set(x, y, yardId);
        rooms.push({ type: 'vacant_lot', rects: null, ceiling: hall, tags: L.vacant === 'wrong' ? ['wrong:vacant'] : [] });
      }
    }
    const houses = parts.length;
    if (houses < 2 || !built.left.length || !built.right.length) return why(ctx, 'few houses');
    rooms.forEach((rm, i) => { if (!rm.rects) rm.rects = TG.rectsWhere(M, (v) => v === i); });
    // ---- the way in, and maybe a way out at the far end
    const portals = [];
    const gw = Math.max(U(2), Math.min(sw - 2, U(rr(rng, A.gate || [3, 5]))));
    const g0 = Math.max(xs0 + 1, Math.min(xs1 - 1 - gw, xs0 + Math.floor((sw - gw) / 2) + rng.int(-2, 2)));
    portals.push({ room: 0, o: 'h', c: r[3], s0: g0, s1: g0 + gw, kind: rng.weighted(A.gateKind || { opening: 0.7, double: 0.3 }), height: 3, role: 'both', main: true, clear: 2, tags: ['street', 'entrance'] });
    if (rng.f() < (A.farExit === undefined ? 0.5 : A.farExit)) {
      const fw = U(rr(rng, A.farWidth || [1.5, 2.5])), f0 = xs0 + 1 + rng.int(0, Math.max(0, sw - 2 - fw));
      portals.push({ room: 0, o: 'h', c: r[1], s0: f0, s1: f0 + fw, kind: rng.weighted(A.farKind || { door: 0.5, opening: 0.5 }), role: 'exit', clear: 1.5, tags: ['street', 'far end'] });
    }
    // ---- what the plan costs: street frontage with no house on it
    const run = (yEnd - yStart) * 2, used = rows.reduce((s, row) => s + row.lots.filter((L) => !L.vacant).reduce((t, L) => t + L.y1 - L.y0, 0), 0);
    terms.frontage = Math.round(Math.max(0, 1 - used / Math.max(1, run)) * 15 * 10) / 10;
    const summary = [
      'street ' + sw * G + ' m wide, hall ceiling ' + hall + ' m',
      'left: ' + (built.left.slice().reverse().join(', ') || 'none'),
      'right: ' + (built.right.slice().reverse().join(', ') || 'none'),
      'houses built by their own templates, back and side doors off: every door opens onto a front yard',
      portals.length > 1 ? 'a way out at the far end' : 'a dead end'
    ];
    return {
      rooms: rooms.map((rm) => ({ type: rm.type, rects: rm.rects, ceiling: rm.ceiling, tags: rm.tags })),
      parts, portals, open: true, terms,
      meta: { type: built.left.length + ' + ' + built.right.length + ' houses', street: sw * G, hall, houses },
      summary
    };
  }

  TPL.registerEngine({
    id: 'neighborhood', name: 'Neighborhood (houses in a hall)', types: T, mutations: MUTATIONS, composite: true,
    program, plan
  });
})(typeof window !== 'undefined' ? window : globalThis);
