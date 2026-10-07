/*
 * poi.js - the POI plan layer: where points of interest are, which template
 * each one is, and the site it is given.
 *
 * Like the territory plan it is cheap and lazy. Every planning cell decides
 * its own POIs from (seed, i, j) alone, and a site never leaves its cell, so
 * any part of the infinite map can be asked for in any order and the answer
 * never changes.
 *
 *   cells     CFG.cell metres square; sites stay CFG.margin inside their cell
 *             and CFG.gap apart from each other, so neighbouring cells never
 *             conflict and the fill always has room to pass between sites
 *   tiers     tiny / small / medium / large / huge - a template's size class
 *             (TPL.sizeClass). Each tier has a density per hectare; tiers with
 *             no templates in the catalogue are skipped
 *   rhythm    a slow noise field scales density between busy and quiet
 *             stretches, and a few cells are left almost empty on purpose
 *   clusters  small POIs often sit right beside a bigger one
 *   sites     sized from the template's own site ranges (whole metres), turned
 *             to face a main side; larger ones are sometimes irregular - a
 *             ragged L / U / notched band behind the template's own rectangle,
 *             so the main side and the room the template asked for stay whole
 *
 * Data hooks (all optional):
 *   archetype.weight          relative frequency within its tier (default 1)
 *   archetype.areas           { areaId: weight, '*': weight } - which semantic
 *                             areas a template appears in (default: all)
 *   AREAS[id].poi.density     density multiplier inside that area
 *   AREAS[id].poi.tiers       { tier: multiplier }
 *
 * Buildings are the detail layer: W.poiBuilding(P) runs the template on its
 * site on demand (cached by the world). Sites are not yet carved out of the
 * fill; that is the next step (see docs/POI_PLACEMENT.md).
 */
(function (root) {
  'use strict';
  const BR = root.BR;
  const { hash4, hashf, mix32, Rng, fbm, contrast } = BR;

  const CFG = {
    cell: 128, margin: 3, gap: 4, attempts: 16,
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

  function areaWeight(arch, area) {
    if (!arch.areas) return 1;
    const w = arch.areas[area];
    return w !== undefined ? w : arch.areas['*'] !== undefined ? arch.areas['*'] : 0;
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
   * POIs of planning cell (i, j):
   * { i, j, density, rect, pois: [{ id, i, j, k, tier, archetype, name, engine,
   *   area, approach, shape, w, h, bbox, rects, cx, cy, seed, cluster }] }
   * bbox / rects are world metres (whole metres). w x h is the canonical size
   * (w along the main side).
   */
  function buildPOICell(W, i, j) {
    const seed = W.seed, C = CFG.cell, cat = catalogue();
    const rng = new Rng(hash4(seed, i, j, S.CELL));
    const ux0 = i * C + CFG.margin, uy0 = j * C + CFG.margin, ux1 = (i + 1) * C - CFG.margin, uy1 = (j + 1) * C - CFG.margin;
    const density = cellDensity(seed, i, j);
    const centreArea = BR.areaAt(W, (i + 0.5) * C, (j + 0.5) * C).area;
    const AP = (BR.AREAS[centreArea] && BR.AREAS[centreArea].poi) || {};
    const ha = ((ux1 - ux0) * (uy1 - uy0)) / 10000;
    const placed = [];
    const clash = (b) => {
      const g = CFG.gap;
      for (const p of placed) {
        const q = p.bbox;
        if (b[0] < q[2] + g && q[0] < b[2] + g && b[1] < q[3] + g && q[1] < b[3] + g) return true;
      }
      return false;
    };

    for (const tier of TIERS) {
      const list = cat[tier];
      if (!list.length) continue;
      const T = CFG.tiers[tier];
      const e = T.perHa * ha * density * (AP.density === undefined ? 1 : AP.density) * ((AP.tiers && AP.tiers[tier]) === undefined ? 1 : AP.tiers[tier]);
      const n = Math.floor(e) + (rng.f() < e - Math.floor(e) ? 1 : 0);
      for (let m = 0; m < n; m++) {
        for (let at = 0; at < CFG.attempts; at++) {
          // where: beside a bigger POI (a cluster) or anywhere in the cell
          const anchors = T.cluster ? placed.filter((p) => RANK[p.tier] > RANK[tier]) : [];
          const near = anchors.length && rng.f() < T.cluster ? anchors[rng.int(0, anchors.length - 1)] : null;
          let px = rng.range(ux0, ux1), py = rng.range(uy0, uy1);
          const side = rng.int(0, 3), along = rng.f(), dist = CFG.gap + rng.int(0, 6);
          if (near) {
            const q = near.bbox;
            px = side & 1 ? (side === 1 ? q[2] + dist : q[0] - dist) : q[0] + along * (q[2] - q[0]);
            py = side & 1 ? q[1] + along * (q[3] - q[1]) : (side === 0 ? q[3] + dist : q[1] - dist);
          }
          // which template: weighted by its frequency and the area it is in
          const area = BR.areaAt(W, px, py).area;
          const w8 = {};
          let any = false;
          for (const a of list) { const v = (a.weight || 1) * areaWeight(a, area); if (v > 0) { w8[a.id] = v; any = true; } }
          if (!any) continue;
          const arch = BR.TPL.archetypes[rng.weighted(w8)];
          const site = arch.site || { w: [10, 20], h: [10, 20] };
          const cw = sizeIn(rng, site.w), ch = sizeIn(rng, site.h);
          const approach = SIDES[rng.int(0, 3)];
          const shape = Math.min(cw, ch) >= CFG.shapeMin ? rng.weighted(CFG.shapes) : 'rect';
          const canon = siteOutline(cw, ch, shape, rng), cd = canon.depth;
          const EW = approach === 'E' || approach === 'W', rw = EW ? cd : cw, rh = EW ? cw : cd;
          // the site's bbox: centred on the point, or flush beside its anchor
          let x0 = Math.round(px - rw / 2), y0 = Math.round(py - rh / 2);
          if (near) {
            if (side === 1) x0 = Math.round(px); else if (side === 3) x0 = Math.round(px - rw);
            if (side === 0) y0 = Math.round(py); else if (side === 2) y0 = Math.round(py - rh);
          }
          if (x0 < ux0 || y0 < uy0 || x0 + rw > ux1 || y0 + rh > uy1) continue;
          const bbox = [x0, y0, x0 + rw, y0 + rh];
          if (clash(bbox)) continue;
          const k = placed.length;
          const O = BR.TG.orient(approach, cw, cd), local = canon.rects.map((q) => O.rect(q));
          placed.push({
            id: i + ',' + j + ':' + k, i, j, k, tier, archetype: arch.id, name: arch.name, engine: arch.engine, area,
            approach, shape, w: cw, h: ch, bbox, rects: local.map((q) => [q[0] + x0, q[1] + y0, q[2] + x0, q[3] + y0]),
            cx: x0 + rw / 2, cy: y0 + rh / 2, seed: hash4(seed, i, j, (k << 8) ^ S.TPL), cluster: near ? near.id : null
          });
          break;
        }
      }
    }
    return { i, j, density, area: centreArea, rect: [i * C, j * C, (i + 1) * C, (j + 1) * C], pois: placed };
  }

  // ------------------------------------------------------------- building
  /**
   * The template on its site: a br.building in the site frame (origin at the
   * POI's bbox corner), or { error } if no template seed fit.
   */
  function buildPOI(W, P) {
    const TPL = BR.TPL, ox = P.bbox[0], oy = P.bbox[1];
    const site = { rects: P.rects.map((q) => [q[0] - ox, q[1] - oy, q[2] - ox, q[3] - oy]) };
    let b = null;
    for (let t = 0; t < CFG.buildTries; t++) {
      b = TPL.generate({ archetype: P.archetype, seed: t ? mix32(P.seed + t) : P.seed, site, approach: P.approach });
      if (!b.error) { b.poi = { id: P.id, origin: [ox, oy], try: t }; return b; }
    }
    return { error: b && b.error, poi: { id: P.id, origin: [ox, oy] } };
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
