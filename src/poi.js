/*
 * poi.js - the POI plan layer: where points of interest are, which template
 * each one is, and how it sits in the world.
 *
 * It is cheap and lazy, like the world plan. Every planning cell decides
 * its own POIs from (seed, i, j) alone, and a POI never leaves its cell, so
 * any part of the infinite map can be asked for in any order and the answer
 * never changes.
 *
 *   cells     CFG.cell metres square, the same grid as the world's cells
 *   tiers     tiny / small / medium / large / huge - a template's size class
 *             (TPL.sizeClass). Each tier has a density per hectare; tiers with
 *             no templates in the catalogue are skipped
 *   rhythm    a slow noise field scales density between busy and quiet
 *             stretches, and a few cells are left almost empty on purpose
 *   settings  how each POI sits in the world (src/tpl/lot.js):
 *               yard    a house on its own lot, built now so the lot fits it:
 *                       solid round its back and sides, a front yard sized
 *                       by the biome, passages from its other doors to the
 *                       lot edge
 *               flush   a template at least a block (8 m) across on its own
 *                       lot, its door on the lot edge
 *               inside  a smaller template inside a filler's site; small
 *                       ones often sit beside a bigger one (clusters)
 *   sites     sized from the template's own site ranges (whole metres), turned
 *             to face a main side; larger ones are sometimes irregular - a
 *             ragged L / U / notched band behind the template's own rectangle,
 *             so the main side and the room the template asked for stay whole
 *
 * Lots keep a block's width from the cell edge and from each other, so the
 * world can cut every lot out as a site of its own (world.js).
 *
 * Data hook (optional): archetype.weight, its relative frequency within its
 * tier (default 1), scaled by its pool (archetype.pool: 'expected', the
 * default, or 'weird': CFG.pools). archetype.poi === false keeps a template
 * off the map.
 * archetype.setting overrides its setting (LOT.setting).
 */
(function (root) {
  'use strict';
  const BR = root.BR;
  const { hash4, hashf, mix32, Rng, fbm, contrast } = BR;

  const CFG = {
    cell: 128, margin: 3, gap: 4, attempts: 16,
    lotMargin: 8, lotGap: 8,          // lots keep a block's width (8 m) from the cell edge and from each other,
    lotClear: 10,                     // and a block's width plus 2 m from a POI inside a filler, so the world can cut them out
    flushMin: 8,                      // a template at least this big both ways may be its own (flush) lot
    // POIs per hectare at density 1; cluster = chance it sits beside a bigger POI
    tiers: {
      huge:   { perHa: 0.004 },
      large:  { perHa: 0.04 },
      medium: { perHa: 0.9 },
      small:  { perHa: 1.8, cluster: 0.45 },
      tiny:   { perHa: 2.0, cluster: 0.55 }
    },
    density: { scale: 420, lo: 0.3, hi: 1.7, quiet: 0.12, quietK: 0.15 },
    shapes: { rect: 0.5, L: 0.22, notched: 0.16, U: 0.12 },
    shapeMin: 12,                     // metres: smaller sites stay rectangular
    // each template's weight within its tier is scaled by its pool: what the
    // backrooms are made of, and the out-of-place rarities (a lone kitchen,
    // a stall, a playground)
    pools: { expected: 1, weird: 0.05 },
    buildTries: 3                     // template seeds tried before a POI is dropped
  };
  const TIERS = ['huge', 'large', 'medium', 'small', 'tiny'];     // placement order: big first
  const RANK = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4 };
  const SIDES = ['S', 'E', 'N', 'W'];
  const S = { CELL: 0x9017, DENS: 0x9018, QUIET: 0x9019, TPL: 0x901a };

  // ------------------------------------------------------------- catalogue
  // Template lists per tier, sorted by id so registration order never matters.
  // Rebuilt when the catalogue changes size (the workbench can add recipes).
  let CAT = null, CAT_N = -1;
  function catalogue() {
    const TPL = BR.TPL;
    const list = TPL && TPL.listArchetypes ? TPL.listArchetypes() : [];
    if (CAT && CAT_N === list.length) return CAT;
    CAT = {};
    for (const t of TIERS) CAT[t] = [];
    for (const a of list.slice().sort((p, q) => (p.id < q.id ? -1 : 1))) {
      if (a.poi === false || !TPL.engines[a.engine]) continue;
      const t = TPL.sizeClass(a);
      if (CAT[t]) CAT[t].push(a);
    }
    CAT_N = list.length;
    return CAT;
  }

  // --------------------------------------------------------------- density
  /** The rhythm: density multiplier of planning cell (i, j). */
  function cellDensity(seed, i, j) {
    const C = CFG.cell, D = CFG.density, x = (i + 0.5) * C, y = (j + 0.5) * C;
    const n = contrast(fbm(seed ^ S.DENS, x / D.scale, y / D.scale, 2), 1.8);
    let d = D.lo + (D.hi - D.lo) * n;
    if (hashf(seed, i, j, S.QUIET) < D.quiet) d *= D.quietK;
    return d;
  }

  /**
   * A site outline, canonical (main side at the bottom, y = depth). The
   * template's own cw x ch always stays whole along the main side; an
   * irregular site adds a ragged band behind it (an L, a U or notches), so a
   * template never loses the room it asked for. Returns { rects, depth }.
   */
  function siteOutline(cw, ch, shape, rng) {
    if (shape === 'rect') return { rects: [[0, 0, cw, ch]], depth: ch };
    const e = Math.max(2, Math.round(ch * rng.range(0.25, 0.6))), core = [0, e, cw, e + ch], band = [];
    if (shape === 'L') {
      const kw = Math.max(2, Math.round(cw * rng.range(0.35, 0.6)));
      band.push(rng.f() < 0.5 ? [0, 0, kw, e] : [cw - kw, 0, cw, e]);
    } else if (shape === 'U') {
      const lw = Math.max(2, Math.round(cw * rng.range(0.2, 0.35))), rw = Math.max(2, Math.round(cw * rng.range(0.2, 0.35)));
      band.push([0, 0, lw, e], [cw - rw, 0, cw, e]);
    } else {
      // notched: the band with one to three bites out of its back edge
      let parts = [[0, 0, cw, e]];
      for (let n = rng.int(1, 3); n > 0; n--) {
        const nw = Math.max(1, Math.round(cw * rng.range(0.1, 0.25))), nh = Math.max(1, Math.round(e * rng.range(0.4, 1)));
        const x = rng.int(0, Math.max(0, cw - nw)), cut = [x, 0, x + nw, nh], next = [];
        for (const q of parts) for (const r of BR.TG.rsub(q, cut)) next.push(r);
        parts = next;
      }
      band.push(...parts);
    }
    return { rects: [core].concat(band.filter((q) => q[2] > q[0] && q[3] > q[1])), depth: e + ch };
  }

  /** a whole-metre size inside a template's site range */
  const sizeIn = (r, range) => { const lo = Math.max(1, Math.ceil(range[0])); return r.int(lo, Math.max(lo, Math.floor(range[1]))); };

  // ------------------------------------------------------------- one cell
  /**
   * POIs of planning cell (i, j), and the lots they sit on:
   * { i, j, density, rect, pois: [P], lots: [L] }
   * P: { id, i, j, k, tier, archetype, name, engine, approach, shape, w, h,
   *      bbox, rects, cx, cy, seed, cluster, mode, lot, origin? }
   * L: { id, kind ('yard' | 'flush'), rect, approach, pois: [P],
   *      yard?, doors? (a yard lot: its front yard rects and the doors that
   *      are connections on its edge, LOT.yard), b (the built house, not
   *      enumerable) }
   * bbox / rects / rect are world metres (lots whole metres). w x h is the
   * canonical size of the template's site (w along the main side). A yard
   * POI's rects are the footprint its house was built with, and origin is
   * where that building's site frame sits.
   * mode: 'yard' (a house on its own lot, behind a front yard), 'flush' (its
   * own lot, door on the edge) or 'inside' (inside a filler's site).
   */
  function buildPOICell(W, i, j) {
    const seed = W.seed, C = CFG.cell, cat = catalogue(), LOT = BR.LOT;
    const rng = new Rng(hash4(seed, i, j, S.CELL));
    const ux0 = i * C + CFG.margin, uy0 = j * C + CFG.margin, ux1 = (i + 1) * C - CFG.margin, uy1 = (j + 1) * C - CFG.margin;
    const lm = CFG.lotMargin - CFG.margin;
    const density = cellDensity(seed, i, j);
    const ha = ((ux1 - ux0) * (uy1 - uy0)) / 10000;
    const placed = [], lots = [];
    const claims = W.plannedLots ? W.plannedLots(i, j) : [];
    const near = (a, b, g) => a[0] < b[2] + g && b[0] < a[2] + g && a[1] < b[3] + g && b[1] < a[3] + g;
    /** can a lot (lot = true) or a POI inside a filler go here? */
    const free = (b, lot) => {
      if (lot ? b[0] < ux0 + lm || b[1] < uy0 + lm || b[2] > ux1 - lm || b[3] > uy1 - lm : b[0] < ux0 || b[1] < uy0 || b[2] > ux1 || b[3] > uy1) return false;
      for (const L of claims) {
        if (near(b, L.rect, lot ? CFG.lotGap : CFG.lotClear)) return false;
        const axis = L.transition.split === 'h' ? 1 : 0;
        const clear = lot ? CFG.lotGap : CFG.lotClear;
        if ([L.rect[axis], L.rect[axis + 2]].some((c) => b[axis] < c + clear && b[axis + 2] > c - clear)) return false;
      }
      for (const L of lots) if (near(b, L.rect, lot ? CFG.lotGap : CFG.lotClear)) return false;
      for (const p of placed) if (p.mode === 'inside' && near(b, p.bbox, lot ? CFG.lotClear : CFG.gap)) return false;
      return true;
    };
    const pickArch = (list) => {
      const w8 = {};
      for (const a of list) w8[a.id] = (a.weight || 1) * (CFG.pools[a.pool || 'expected'] !== undefined ? CFG.pools[a.pool || 'expected'] : 1);
      return BR.TPL.archetypes[rng.weighted(w8)];
    };
    const add = (P) => {
      const k = placed.length;
      P.id = i + ',' + j + ':' + k; P.i = i; P.j = j; P.k = k;
      P.seed = hash4(seed, i, j, (k << 8) ^ S.TPL);
      P.bbox = BR.TG.bbox(P.rects);
      P.cx = (P.bbox[0] + P.bbox[2]) / 2; P.cy = (P.bbox[1] + P.bbox[3]) / 2;
      placed.push(P);
      return P;
    };
    const poi = (arch, tier, approach, shape, cw, ch, rects, mode, cluster) =>
      ({ tier, archetype: arch.id, name: arch.name, engine: arch.engine, approach, shape, w: cw, h: ch, rects, cluster: cluster || null, mode, lot: null });

    for (const tier of TIERS) {
      const list = cat[tier];
      if (!list.length) continue;
      const T = CFG.tiers[tier];
      const e = T.perHa * ha * density;
      const n = Math.floor(e) + (rng.f() < e - Math.floor(e) ? 1 : 0);
      for (let m = 0; m < n; m++) {
        for (let at = 0; at < CFG.attempts; at++) {
          const arch = pickArch(list);
          const site = arch.site || { w: [10, 20], h: [10, 20] };
          const cw = sizeIn(rng, site.w), ch = sizeIn(rng, site.h);
          const approach = SIDES[rng.int(0, 3)];
          const kind = LOT.setting(arch).kind === 'yard' ? 'yard' : Math.min(cw, ch) >= CFG.flushMin ? 'flush' : 'inside';
          const shape = kind !== 'flush' && Math.min(cw, ch) >= CFG.shapeMin ? rng.weighted(CFG.shapes) : 'rect';
          const canon = siteOutline(cw, ch, shape, rng), cd = canon.depth;
          let px = rng.range(ux0, ux1), py = rng.range(uy0, uy1);

          if (kind === 'yard') {
            // the house is built now: its lot is sized round what was built,
            // and its doors decide where the lot meets the world (LOT.yard)
            const k = placed.length, O = BR.TG.orient(approach, cw, cd), site = canon.rects.map((q) => O.rect(q));
            const b = LOT.template({ archetype: arch.id, seed: hash4(seed, i, j, (k << 8) ^ S.TPL), approach, rects: site, tries: CFG.buildTries });
            if (b.error) continue;
            const Y = LOT.yard(b, approach, LOT.margins(arch, rng, BR.openness ? BR.openness(seed, px, py) : 0.5));
            let rect = null;
            for (let t = 0; t < CFG.attempts && !rect; t++) {
              if (t) { px = rng.range(ux0, ux1); py = rng.range(uy0, uy1); }
              const x0 = Math.round(px - Y.w / 2), y0 = Math.round(py - Y.h / 2);
              if (free([x0, y0, x0 + Y.w, y0 + Y.h], true)) rect = [x0, y0, x0 + Y.w, y0 + Y.h];
            }
            if (!rect) continue;
            const hx = rect[0] + Y.origin[0], hy = rect[1] + Y.origin[1], mv = (q) => [q[0] + hx, q[1] + hy, q[2] + hx, q[3] + hy];
            const P = add(poi(arch, tier, approach, shape, cw, ch, b.footprint[0].rects.map(mv), kind, null));
            P.origin = [hx, hy];
            const L = { id: i + ',' + j + ':L' + lots.length, kind, rect, approach, pois: [P],
              yard: Y.yard.map((q) => [q[0] + rect[0], q[1] + rect[1], q[2] + rect[0], q[3] + rect[1]]),
              doors: Y.doors.map((d) => Object.assign({}, d, { c: d.c + (d.o === 'h' ? rect[1] : rect[0]), s0: d.s0 + (d.o === 'h' ? rect[0] : rect[1]), s1: d.s1 + (d.o === 'h' ? rect[0] : rect[1]),
                adapter: d.adapter && [d.adapter[0] + rect[0], d.adapter[1] + rect[1], d.adapter[2] + rect[0], d.adapter[3] + rect[1]] })) };
            Object.defineProperty(L, 'b', { value: b, enumerable: false });
            P.lot = L.id;
            lots.push(L);
            break;
          }

          // a flush lot, or inside a filler: centred on the point, or (inside)
          // flush beside a bigger POI that is not in a yard
          const anchors = kind === 'inside' && T.cluster ? placed.filter((p) => RANK[p.tier] > RANK[tier] && (p.mode === 'inside' || p.mode === 'flush')) : [];
          const nearP = anchors.length && rng.f() < T.cluster ? anchors[rng.int(0, anchors.length - 1)] : null;
          const side = rng.int(0, 3), along = rng.f(), dist = CFG.gap + rng.int(0, 6);
          if (nearP) {
            const q = nearP.bbox;
            px = side & 1 ? (side === 1 ? q[2] + dist : q[0] - dist) : q[0] + along * (q[2] - q[0]);
            py = side & 1 ? q[1] + along * (q[3] - q[1]) : (side === 0 ? q[3] + dist : q[1] - dist);
          }
          const EW = approach === 'E' || approach === 'W', rw = EW ? cd : cw, rh = EW ? cw : cd;
          let x0 = Math.round(px - rw / 2), y0 = Math.round(py - rh / 2);
          if (nearP) {
            if (side === 1) x0 = Math.round(px); else if (side === 3) x0 = Math.round(px - rw);
            if (side === 0) y0 = Math.round(py); else if (side === 2) y0 = Math.round(py - rh);
          }
          const bbox = [x0, y0, x0 + rw, y0 + rh];
          if (!free(bbox, kind === 'flush')) continue;
          const O = BR.TG.orient(approach, cw, cd);
          const P = add(poi(arch, tier, approach, shape, cw, ch, canon.rects.map((q) => O.rect(q)).map((q) => [q[0] + x0, q[1] + y0, q[2] + x0, q[3] + y0]), kind, nearP ? nearP.id : null));
          if (kind === 'flush') { const L = { id: i + ',' + j + ':L' + lots.length, kind, rect: bbox, approach, pois: [P] }; P.lot = L.id; lots.push(L); }
          break;
        }
      }
    }
    return { i, j, density, rect: [i * C, j * C, (i + 1) * C, (j + 1) * C], pois: placed, lots };
  }

  // ------------------------------------------------------------- building
  /**
   * The template on its site: a br.building in the site frame (origin at the
   * POI's bbox corner), or { error } if no template seed fit. A flush POI is
   * built with its rooms out to the edge of its lot.
   */
  function buildPOI(W, P) {
    const ox = P.bbox[0], oy = P.bbox[1];
    const b = BR.LOT.template({ archetype: P.archetype, seed: P.seed, approach: P.approach, rects: P.rects.map((q) => [q[0] - ox, q[1] - oy, q[2] - ox, q[3] - oy]), flush: P.mode === 'flush', tries: CFG.buildTries });
    b.poi = { id: P.id, origin: [ox, oy], try: b.try };
    return b;
  }

  /** Summary numbers for a set of POIs over `ha` hectares. */
  function poiStats(list, ha) {
    const by = {};
    for (const t of TIERS) by[t] = 0;
    for (const P of list) by[P.tier]++;
    return { count: list.length, perHa: ha > 0 ? list.length / ha : 0, byTier: by };
  }

  Object.assign(BR, { POI_CFG: CFG, POI_TIERS: TIERS, poiCatalogue: catalogue, poiCellDensity: cellDensity, buildPOICell, buildPOI, poiStats });
})(typeof window !== 'undefined' ? window : globalThis);
