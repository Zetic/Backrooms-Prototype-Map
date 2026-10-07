/*
 * render.js - the map: every site's blueprint, drawn into cached tiles.
 * Presentation only; all geometry comes from world.js.
 *
 *   detail  (>= 1 px/m)   each site's blueprints (its filler or yard and any
 *                         POI buildings), every floor first, then every wall, so
 *                         neighbours never paint over each other's walls
 *   plan    (0.12-1 px/m) the cell plans alone, nothing built: each site a
 *                         flat tone, lots and POIs picked out
 *   far     (< 0.12 px/m) a raster of the biome (openness) and POI density
 *
 * Cells a filler leaves unbuilt stay the dark background: the solid mass
 * between rooms.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TPL = BR.TPL;

  const BG = '#3b3934';
  const LOD = { detail: 1, plan: 0.12, labels: 7 };
  const PLAN = { site: [138, 128, 104], lot: [152, 132, 96], poi: [196, 160, 104], line: 'rgba(30,27,24,0.55)' };
  const COL = { route: '#e8913a', loop: '#3fb6bf', cross: '#e0609a', portal: '#3fbf6f', hover: 'rgba(255,255,255,0.95)', outline: 'rgba(255,255,255,0.35)' };
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const css = (c) => 'rgb(' + c.map((v) => Math.round(v)).join(',') + ')';

  /** a plan-view tone for a site: a little darker the more enclosed its biome, a touch of noise per site */
  function planTone(s) {
    const base = s.kind !== 'filler' ? PLAN.lot : PLAN.site, k = 0.86 + 0.18 * s.openness + ((s.seed & 255) / 255 - 0.5) * 0.06;
    return css(base.map((v) => Math.min(255, v * k)));
  }

  // --------------------------------------------------------------- tile painters
  /** detail: blueprints of every site meeting the tile; false if some were not built in time */
  function paintDetail(g, W, x0, y0, S, tz, deadline, opts) {
    const sites = W.sitesIn(x0 - 0.5, y0 - 0.5, x0 + S + 0.5, y0 + S + 0.5), ready = [];
    let complete = true;
    g.fillStyle = BG; g.fillRect(0, 0, S * tz, S * tz);
    for (const s of sites) {
      if (W.hasBuild(s) || now() < deadline) ready.push(W.build(s));
      else { complete = false; paintPlanSite(g, s, x0, y0, tz); }
    }
    const at = (origin, layer, labels) => ({ scale: tz, ox: (origin[0] - x0) * tz, oy: (origin[1] - y0) * tz, site: false, portals: false, labels, layer });
    const lab = opts.labels !== false && tz >= LOD.labels;
    for (const layer of ['floors', 'walls']) for (const r of ready) {
      if (r.filler) TPL.drawBuilding(g, r.filler, at(r.origin, layer, false));
      for (const B of r.buildings) TPL.drawBuilding(g, B.b, at(B.origin, layer, lab));
    }
    return complete;
  }

  function paintPlanSite(g, s, x0, y0, tz) {
    g.fillStyle = planTone(s);
    for (const q of s.rects) g.fillRect((q[0] - x0) * tz, (q[1] - y0) * tz, (q[2] - q[0]) * tz, (q[3] - q[1]) * tz);
    if (s.pois.length) {
      g.fillStyle = css(PLAN.poi);
      for (const P of s.pois) for (const q of P.rects) g.fillRect((q[0] - x0) * tz, (q[1] - y0) * tz, (q[2] - q[0]) * tz, (q[3] - q[1]) * tz);
    }
  }

  /** plan: the cell plans, flat tones, thin lines between sites */
  function paintPlan(g, W, x0, y0, S, tz, deadline) {
    const C = BR.WORLD_CFG.cell;
    g.fillStyle = BG; g.fillRect(0, 0, S * tz, S * tz);
    let complete = true;
    const sites = [];
    for (let i = Math.floor(x0 / C); i <= Math.floor((x0 + S) / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor((y0 + S) / C); j++) {
      if (!W.cells.has(i + ',' + j) && now() > deadline) { complete = false; continue; }
      for (const s of W.cell(i, j).sites) sites.push(s);
    }
    for (const s of sites) paintPlanSite(g, s, x0, y0, tz);
    if (tz >= 0.3) {
      g.strokeStyle = PLAN.line; g.lineWidth = 1;
      g.beginPath();
      for (const s of sites) for (const q of s.rects) g.rect((q[0] - x0) * tz + 0.5, (q[1] - y0) * tz + 0.5, (q[2] - q[0]) * tz - 1, (q[3] - q[1]) * tz - 1);
      g.stroke();
    }
    return complete;
  }

  /** far: biome and POI density, one sample per 4 device px */
  function paintFar(g, W, x0, y0, S, tz) {
    const n = 64, step = S / n, C = BR.WORLD_CFG.cell;
    for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
      const x = x0 + (u + 0.5) * step, y = y0 + (v + 0.5) * step;
      const o = W.biomeAt(x, y).openness, d = Math.min(1.6, BR.poiCellDensity(W.seed, Math.floor(x / C), Math.floor(y / C))) / 1.6;
      const k = 0.62 + 0.3 * o;
      g.fillStyle = css([PLAN.site[0] * k + 18 * d, PLAN.site[1] * k + 10 * d, PLAN.site[2] * k]);
      g.fillRect(u * step * tz, v * step * tz, Math.ceil(step * tz), Math.ceil(step * tz));
    }
    return true;
  }

  // --------------------------------------------------------------- tiles
  /**
   * The map is drawn into cached 256 px tiles at zoom levels 2^(k/2) (the
   * level at or above the view zoom, so tiles are only ever scaled down);
   * each frame blits them and spends a time budget on the missing ones,
   * nearest first. A tile drawn before all its sites were built is a draft
   * and is redrawn. Hover and the debug overlays are drawn per frame.
   */
  const TILE = 256, MAX_TILES = 260;
  function tileCache(W) { if (!W._tiles) W._tiles = { map: new Map(), pool: [] }; return W._tiles; }
  function getCanvas(TC) {
    const c = TC.pool.pop();
    if (c) return c;
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(TILE, TILE);
    const e = document.createElement('canvas'); e.width = TILE; e.height = TILE;
    return e;
  }
  function levelFor(zoom, dpr) {
    const lv = Math.ceil(2 * Math.log2(zoom * dpr) - 1e-9) / 2;
    return { lv, tz: Math.pow(2, lv) };                 // device px per metre
  }
  function modeFor(zl) { return zl >= LOD.detail ? 'detail' : zl >= LOD.plan ? 'plan' : 'far'; }

  /**
   * view: { cx, cy, zoom (css px per metre), w, h (css px), dpr }
   * opts: { labels, outlines, graph, hover (site id) }
   * Returns { done, tiles, built, mode }.
   */
  function draw(ctx, W, view, opts, budgetMs) {
    const t0 = now(), deadline = t0 + budgetMs;
    const { cx, cy, zoom, w, h, dpr } = view;
    const { lv, tz } = levelFor(zoom, dpr), zl = tz / dpr, S = TILE / tz, mode = modeFor(zl);
    const flags = mode + (mode === 'detail' && opts.labels !== false ? 'L' : '');
    const TC = tileCache(W);
    const hw = w / 2 / zoom, hh = h / 2 / zoom;
    const tx0 = Math.floor((cx - hw) / S), tx1 = Math.floor((cx + hw) / S), ty0 = Math.floor((cy - hh) / S), ty1 = Math.floor((cy + hh) / S);
    const list = [];
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      const dx = (tx + 0.5) * S - cx, dy = (ty + 0.5) * S - cy;
      list.push({ tx, ty, d: dx * dx + dy * dy });
    }
    list.sort((a, b) => a.d - b.d || a.tx - b.tx || a.ty - b.ty);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, Math.round(w * dpr), Math.round(h * dpr));
    ctx.imageSmoothingEnabled = true;
    const m = zoom * dpr, X = (x) => Math.round((x - cx) * m + w * dpr / 2), Y = (y) => Math.round((y - cy) * m + h * dpr / 2);
    const blit = (c, wx0, wy0, wx1, wy1, sx, sy, sw, sh) => { const a = X(wx0), b = Y(wy0); ctx.drawImage(c, sx, sy, sw, sh, a, b, X(wx1) - a, Y(wy1) - b); };
    let done = true, built = 0;
    for (const t of list) {
      const key = lv + '|' + t.tx + '|' + t.ty + '|' + flags;
      let e = TC.map.get(key);
      if (e) { TC.map.delete(key); TC.map.set(key, e); }
      if ((!e || !e.complete) && now() < deadline) {
        const c = e ? e.canvas : getCanvas(TC), g = c.getContext('2d'), x0 = t.tx * S, y0 = t.ty * S;
        g.setTransform(1, 0, 0, 1, 0, 0);
        const complete = mode === 'detail' ? paintDetail(g, W, x0, y0, S, tz, deadline, opts) : mode === 'plan' ? paintPlan(g, W, x0, y0, S, tz, deadline) : paintFar(g, W, x0, y0, S, tz);
        if (!e) { e = { canvas: c }; TC.map.set(key, e); }
        e.complete = complete;
        built++;
        while (TC.map.size > MAX_TILES) { const k0 = TC.map.keys().next().value; TC.pool.push(TC.map.get(k0).canvas); TC.map.delete(k0); }
      }
      const wx0 = t.tx * S, wy0 = t.ty * S;
      if (e) { blit(e.canvas, wx0, wy0, wx0 + S, wy0 + S, 0, 0, TILE, TILE); if (!e.complete) done = false; continue; }
      done = false;
      // not drawn yet: borrow from a coarser cached level (same mode) if there is one
      for (let up = 1; up <= 6; up++) {
        const L = lv - up / 2, f = Math.pow(2, up / 2), Sp = S * f;
        if (Math.abs(f - Math.round(f)) > 1e-9) continue;
        const ptx = Math.floor(t.tx / f), pty = Math.floor(t.ty / f), pm = modeFor(Math.pow(2, L) / dpr), base = L + '|' + ptx + '|' + pty + '|';
        const pe = TC.map.get(base + pm + 'L') || TC.map.get(base + pm);
        if (!pe) continue;
        blit(pe.canvas, wx0, wy0, wx0 + S, wy0 + S, ((wx0 - ptx * Sp) / Sp) * TILE, ((wy0 - pty * Sp) / Sp) * TILE, TILE / f, TILE / f);
        break;
      }
    }

    // ---- per frame: overlays in world units
    ctx.setTransform(m, 0, 0, m, 0, 0);
    const ox = cx - w / 2 / zoom, oy = cy - h / 2 / zoom, P = (x) => x - ox, Q = (y) => y - oy, px = 1 / m;
    if (zl >= 0.3 && (opts.outlines || opts.graph)) {
      const vis = W.sitesIn(cx - hw, cy - hh, cx + hw, cy + hh);
      if (opts.outlines) {
        ctx.strokeStyle = COL.outline; ctx.lineWidth = px * 1.5;
        ctx.beginPath();
        for (const s of vis) for (const q of s.rects) ctx.rect(P(q[0]), Q(q[1]), q[2] - q[0], q[3] - q[1]);
        ctx.stroke();
      }
      if (opts.graph) drawGraph(ctx, W, vis, P, Q, px);
    }
    if (opts.hover && zl >= 0.3) {
      const s = W.site(opts.hover);
      if (s) {
        ctx.strokeStyle = COL.hover; ctx.lineWidth = px * 2.5;
        ctx.beginPath();
        for (const q of s.rects) ctx.rect(P(q[0]), Q(q[1]), q[2] - q[0], q[3] - q[1]);
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return { done, tiles: list.length, built, mode, level: zl };
  }

  /** the connection graph: a dot per site, a line through each opening (orange tree, cyan loop, pink across a cell border, green into a POI) */
  function drawGraph(ctx, W, vis, P, Q, px) {
    const centre = (s) => { const b = s.rects.reduce((p, q) => ((q[2] - q[0]) * (q[3] - q[1]) > (p[2] - p[0]) * (p[3] - p[1]) ? q : p)); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
    ctx.lineWidth = px * 2;
    const done = new Set();
    for (const s of vis) {
      const cell = W.cell(s.i, s.j), a = centre(s);
      for (const id of s.conns) {
        if (done.has(id)) continue;
        done.add(id);
        const cn = cell.connById.get(id), mid = cn.o === 'h' ? [(cn.s0 + cn.s1) / 2, cn.c] : [cn.c, (cn.s0 + cn.s1) / 2];
        const other = W.peer(s, cn), b = other ? centre(other) : mid;
        ctx.strokeStyle = cn.cross ? COL.cross : cn.route ? COL.route : COL.loop;
        ctx.beginPath(); ctx.moveTo(P(a[0]), Q(a[1])); ctx.lineTo(P(mid[0]), Q(mid[1])); ctx.lineTo(P(b[0]), Q(b[1])); ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(P(mid[0]) - px * 3, Q(mid[1]) - px * 3, px * 6, px * 6);
      }
      if (W.hasBuild(s)) for (const B of W.build(s).buildings) for (const p of B.b.portals) {
        if (!B.conns[p.id]) continue;
        const op = B.b.openings.find((x) => x.id === p.opening), mid = [B.origin[0] + (op.a[0] + op.b[0]) / 2, B.origin[1] + (op.a[1] + op.b[1]) / 2];
        ctx.strokeStyle = COL.portal;
        ctx.beginPath(); ctx.moveTo(P(a[0]), Q(a[1])); ctx.lineTo(P(mid[0]), Q(mid[1])); ctx.stroke();
      }
      ctx.fillStyle = s.kind !== 'filler' ? COL.portal : '#ffffff';
      ctx.beginPath(); ctx.arc(P(a[0]), Q(a[1]), px * 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  BR.draw = draw;
  BR.RENDER = { BG, LOD, COL, modeFor, levelFor, planTone };
})(typeof window !== 'undefined' ? window : globalThis);
