/*
 * tpl/render2d.js - blueprint drawing of a building (the output contract,
 * metres, site frame). Presentation only: it reads nothing but the JSON, so
 * it doubles as a check that the contract carries everything a client needs.
 *
 *   BR.TPL.drawBuilding(ctx, building, { scale, ox, oy, level, theme: 'plan' | 'blueprint',
 *                       labels, dims, tags, graph, portals, highlight, site, layer })
 * (ox, oy) is where the site's (0, 0) lands in canvas pixels; scale is px/m.
 * layer 'floors' draws only the site and floors, 'walls' everything else, so
 * a map can draw every site's floors before any walls.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TPL = BR.TPL = BR.TPL || {};

  const THEMES = {
    plan: {
      site: '#3b3934', siteLine: 'rgba(255,255,255,0.16)', wall: '#2c2925', thin: '#3d3934', open: 'rgba(60,50,40,0.3)',
      label: 'rgba(50,42,34,0.85)', sub: 'rgba(50,42,34,0.55)', door: '#4f463c', arc: 'rgba(79,70,60,0.55)', window: '#6fb3d2',
      floor: { public: '#ecd9b4', private: '#e8d1ca', service: '#d8dbd0', circulation: '#ece2cc', wet: '#cfe2e6', storage: '#dcd3c3', _: '#e2dccf' }
    },
    blueprint: {
      site: '#123250', siteLine: 'rgba(170,210,255,0.25)', wall: '#eaf3ff', thin: '#c9def5', open: 'rgba(200,225,255,0.35)',
      label: 'rgba(225,238,255,0.92)', sub: 'rgba(200,222,250,0.65)', door: '#eaf3ff', arc: 'rgba(220,235,255,0.5)', window: '#7fd0ff',
      floor: { public: '#1b4a75', private: '#1b4a75', service: '#1b4a75', circulation: '#1f527f', wet: '#1d5582', storage: '#194468', _: '#1b4a75' }
    }
  };
  const ROLE = { entrance: '#3fbf6f', exit: '#e8913a', both: '#3fb6bf' };
  const WRONG = '#e0503f';

  const inRects = (rs, x, y) => rs.some((r) => x > r[0] && x < r[2] && y > r[1] && y < r[3]);
  const bigRect = (rs) => rs.reduce((p, q) => ((q[2] - q[0]) * (q[3] - q[1]) > (p[2] - p[0]) * (p[3] - p[1]) ? q : p));
  function floorKey(rm) {
    const t = rm.tags || [];
    if (t.indexOf('wet') >= 0 && t.indexOf('kitchen') < 0) return 'wet';
    if (t.indexOf('closet') >= 0 || (t.indexOf('storage') >= 0 && rm.zone !== 'public')) return 'storage';
    return rm.zone || '_';
  }

  function drawBuilding(g, b, o) {
    o = o || {};
    const S = o.scale || 20, ox = o.ox || 0, oy = o.oy || 0, lv = o.level || 0;
    const TH = THEMES[o.theme] || THEMES.plan;
    const X = (x) => ox + x * S, Y = (y) => oy + y * S;
    const rooms = new Map(b.rooms.map((r) => [r.id, r]));
    const onLv = (x) => (x.level || 0) === lv;
    const floors = o.layer !== 'walls', walls = o.layer !== 'floors';
    g.save();
    // ---- the site: what the world allotted (the backrooms fills the rest)
    if (floors && o.site !== false && b.site) {
      g.fillStyle = TH.site;
      g.beginPath();
      for (const r of b.site.rects) g.rect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S);
      g.fill();
      g.strokeStyle = TH.siteLine; g.lineWidth = 1; g.setLineDash([4, 4]);
      g.stroke(); g.setLineDash([]);
    }
    // ---- floors
    if (floors) for (const rm of b.rooms) {
      if (!onLv(rm)) continue;
      g.fillStyle = TH.floor[floorKey(rm)] || TH.floor._;
      g.beginPath();
      for (const r of rm.rects) g.rect(Math.round(X(r[0])), Math.round(Y(r[1])), Math.round(X(r[2])) - Math.round(X(r[0])), Math.round(Y(r[3])) - Math.round(Y(r[1])));
      g.fill();
      if (o.highlight === rm.id) { g.fillStyle = o.theme === 'blueprint' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.4)'; g.fill(); }
    }
    if (!walls) { g.restore(); return; }
    // ---- verticals (stairs / lifts): a tread pattern in the room
    for (const v of b.verticals || []) for (const rid of v.rooms) {
      const rm = rooms.get(rid);
      if (!rm || !onLv(rm)) continue;
      const r = bigRect(rm.rects), cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
      const horiz = r[2] - r[0] >= r[3] - r[1], len = Math.min(3, (horiz ? r[2] - r[0] : r[3] - r[1]) - 0.5), wid = Math.min(1, (horiz ? r[3] - r[1] : r[2] - r[0]) - 0.4);
      g.strokeStyle = v.dead ? WRONG : TH.thin; g.lineWidth = Math.max(1, S * 0.04);
      g.beginPath();
      for (let k = 0; k <= 10; k++) {
        const t = -len / 2 + (len * k) / 10;
        if (horiz) { g.moveTo(X(cx + t), Y(cy - wid / 2)); g.lineTo(X(cx + t), Y(cy + wid / 2)); }
        else { g.moveTo(X(cx - wid / 2), Y(cy + t)); g.lineTo(X(cx + wid / 2), Y(cy + t)); }
      }
      g.stroke();
    }
    // ---- columns (fillers): solid, drawn like walls
    g.fillStyle = TH.wall;
    for (const c of b.columns || []) if (onLv(c)) g.fillRect(X(c.rect[0]), Y(c.rect[1]), (c.rect[2] - c.rect[0]) * S, (c.rect[3] - c.rect[1]) * S);
    // ---- open boundaries (no wall; floor change only)
    g.setLineDash([Math.max(1, S * 0.12), Math.max(2, S * 0.2)]);
    g.strokeStyle = TH.open; g.lineWidth = Math.max(0.6, S * 0.03);
    for (const w of b.walls) if (onLv(w) && w.kind === 'open') { g.beginPath(); g.moveTo(X(w.a[0]), Y(w.a[1])); g.lineTo(X(w.b[0]), Y(w.b[1])); g.stroke(); }
    g.setLineDash([]);
    // ---- walls minus openings
    const runs = wallRuns(b, lv);
    g.lineCap = 'square';
    for (const kind of ['interior', 'exterior']) {
      g.strokeStyle = kind === 'exterior' ? TH.wall : TH.thin;
      g.lineWidth = Math.max(kind === 'exterior' ? 2 : 1, (kind === 'exterior' ? 0.3 : 0.15) * S);
      g.beginPath();
      for (const q of runs[kind]) { g.moveTo(X(q[0]), Y(q[1])); g.lineTo(X(q[2]), Y(q[3])); }
      g.stroke();
    }
    g.lineCap = 'butt';
    // ---- openings
    for (const op of b.openings) if (onLv(op)) drawOpening(g, op, rooms, X, Y, S, TH);
    // ---- portals: entrances / exits onto the backrooms
    if (o.portals !== false) for (const p of b.portals || []) if (onLv(p)) drawPortal(g, p, b, X, Y, S);
    // ---- graph
    if (o.graph) {
      const cen = new Map();
      for (const rm of b.rooms) { const r = bigRect(rm.rects); cen.set(rm.id, [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2, rm.level || 0]); }
      const opMid = new Map(b.openings.map((op) => [op.id, [(op.a[0] + op.b[0]) / 2, (op.a[1] + op.b[1]) / 2]]));
      g.lineWidth = Math.max(1, S * 0.07);
      for (const [a, bb, kind, oid] of b.graph.edges) {
        const A = cen.get(a), B2 = cen.get(bb), M = oid && opMid.get(oid);
        const Ap = A || (M ? [M[0], M[1]] : null), Bp = B2 || (M ? [M[0], M[1]] : null);
        if (!Ap || !Bp || (A && A[2] !== lv) || (B2 && B2[2] !== lv)) continue;
        g.strokeStyle = kind === 'open' ? 'rgba(40,140,220,0.45)' : (!A || !B2) ? 'rgba(232,145,58,0.95)' : 'rgba(40,140,220,0.9)';
        g.beginPath(); g.moveTo(X(Ap[0]), Y(Ap[1]));
        if (M) g.lineTo(X(M[0]), Y(M[1]));
        g.lineTo(X(Bp[0]), Y(Bp[1])); g.stroke();
      }
      g.fillStyle = 'rgba(40,140,220,0.95)';
      for (const rm of b.rooms) { if (!onLv(rm)) continue; const c = cen.get(rm.id); g.beginPath(); g.arc(X(c[0]), Y(c[1]), Math.max(2, S * 0.14), 0, Math.PI * 2); g.fill(); }
    }
    // ---- labels
    if (o.labels !== false && S >= 6) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const rm of b.rooms) {
        if (!onLv(rm)) continue;
        const r = bigRect(rm.rects), w = (r[2] - r[0]) * S, h = (r[3] - r[1]) * S;
        const name = (rm.name || rm.type).replace(/ \d+$/, '');
        const fs = Math.max(8, Math.min(13, S * 0.42));
        g.font = '600 ' + fs + 'px ui-sans-serif, system-ui, sans-serif';
        if (g.measureText(name).width > w - 8 || h < fs * 1.2) continue;
        const cx = X((r[0] + r[2]) / 2), cy = Y((r[1] + r[3]) / 2);
        const wrong = (rm.tags || []).some((t) => t.indexOf('wrong:') === 0);
        const lines = [];
        if (o.dims) lines.push(rm.area.toFixed(1) + ' m²' + (rm.ceiling ? ' · ' + rm.ceiling + ' m' : ''));
        if (o.tags) { const tg = (rm.tags || []).filter((t) => t.indexOf('wrong:') !== 0).join(' · '); if (tg) lines.push(tg); }
        const fit = lines.filter((_, k) => h > fs * (2.3 + 1.1 * k));
        const y0 = cy - (fit.length * fs * 0.55);
        g.fillStyle = wrong ? WRONG : TH.label;
        g.fillText(name, cx, y0);
        g.font = (fs * 0.82) + 'px ui-sans-serif, system-ui, sans-serif';
        g.fillStyle = TH.sub;
        fit.forEach((t, k) => { if (g.measureText(t).width <= w - 3) g.fillText(t, cx, y0 + fs * 1.1 * (k + 1)); });
      }
    }
    g.restore();
  }

  /**
   * Wall runs of one level with their openings cut out (windows included; a
   * 'false' door is drawn on a wall, so it leaves no gap):
   * { exterior: [[x0, y0, x1, y1]], interior: [...] } in site metres.
   */
  function wallRuns(b, lv) {
    lv = lv || 0;
    const out = { exterior: [], interior: [] }, byWall = new Map();
    for (const op of b.openings) { if (!byWall.has(op.wall)) byWall.set(op.wall, []); byWall.get(op.wall).push(op); }
    for (const w of b.walls) {
      if ((w.level || 0) !== lv || w.kind === 'open') continue;
      const horiz = w.a[1] === w.b[1], list = out[w.kind === 'exterior' ? 'exterior' : 'interior'];
      const s0 = horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), s1 = horiz ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
      const c = horiz ? w.a[1] : w.a[0];
      const gaps = (byWall.get(w.id) || []).filter((op) => op.kind !== 'false').map((op) => {
        const a = horiz ? op.a[0] : op.a[1], bb = horiz ? op.b[0] : op.b[1];
        return [Math.min(a, bb), Math.max(a, bb)];
      }).sort((p, q) => p[0] - q[0]);
      const seg = (p, q) => { if (q - p > 1e-6) list.push(horiz ? [p, c, q, c] : [c, p, c, q]); };
      let t = s0;
      for (const gp of gaps) { seg(t, gp[0]); t = Math.max(t, gp[1]); }
      seg(t, s1);
    }
    return out;
  }

  function drawOpening(g, op, rooms, X, Y, S, TH) {
    const horiz = op.a[1] === op.b[1], a = op.a, bb = op.b, len = op.width;
    if (op.kind === 'window') {
      g.strokeStyle = TH.window; g.lineWidth = Math.max(1, S * 0.06);
      for (const d of [-0.08, 0.08]) {
        g.beginPath();
        if (horiz) { g.moveTo(X(a[0]), Y(a[1] + d)); g.lineTo(X(bb[0]), Y(bb[1] + d)); } else { g.moveTo(X(a[0] + d), Y(a[1])); g.lineTo(X(bb[0] + d), Y(bb[1])); }
        g.stroke();
      }
      return;
    }
    if (op.kind === 'opening') return;
    if (op.kind === 'vehicle') {
      g.strokeStyle = TH.door; g.lineWidth = Math.max(1, S * 0.05); g.setLineDash([Math.max(2, S * 0.25), Math.max(2, S * 0.15)]);
      g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(bb[0]), Y(bb[1])); g.stroke(); g.setLineDash([]);
      return;
    }
    if (op.kind === 'slider') {
      g.strokeStyle = TH.door; g.lineWidth = Math.max(1, S * 0.05);
      const m = horiz ? (a[0] + bb[0]) / 2 : (a[1] + bb[1]) / 2, d = 0.07;
      g.beginPath();
      if (horiz) { g.moveTo(X(a[0]), Y(a[1] - d)); g.lineTo(X(m + 0.1), Y(a[1] - d)); g.moveTo(X(m - 0.1), Y(a[1] + d)); g.lineTo(X(bb[0]), Y(a[1] + d)); }
      else { g.moveTo(X(a[0] - d), Y(a[1])); g.lineTo(X(a[0] - d), Y(m + 0.1)); g.moveTo(X(a[0] + d), Y(m - 0.1)); g.lineTo(X(a[0] + d), Y(bb[1])); }
      g.stroke();
      return;
    }
    // swinging doors: leaf + arc into swingInto (a double door: two leaves)
    const into = op.swingInto && rooms.get(op.swingInto);
    const mid = [(a[0] + bb[0]) / 2, (a[1] + bb[1]) / 2];
    let n = 1;
    if (into) { const p = horiz ? [mid[0], mid[1] + 0.2] : [mid[0] + 0.2, mid[1]]; n = inRects(into.rects, p[0], p[1]) ? 1 : -1; }
    if (op.kind === 'false') {
      g.strokeStyle = WRONG; g.lineWidth = Math.max(1.2, S * 0.08);
      const d = 0.12 * n;
      g.beginPath();
      if (horiz) { g.moveTo(X(a[0]), Y(a[1] + d)); g.lineTo(X(bb[0]), Y(bb[1] + d)); } else { g.moveTo(X(a[0] + d), Y(a[1])); g.lineTo(X(bb[0] + d), Y(bb[1])); }
      g.stroke();
      return;
    }
    const leaves = op.kind === 'double' ? [[a, mid, len / 2], [bb, mid, len / 2]] : [[op.hinge && op.hinge[0] === bb[0] && op.hinge[1] === bb[1] ? bb : a, null, len]];
    for (const [h, , l] of leaves) {
      const other = h === a ? bb : a;
      const leaf = horiz ? [h[0], h[1] + n * l] : [h[0] + n * l, h[1]];
      g.strokeStyle = TH.door; g.lineWidth = Math.max(1, S * 0.05);
      g.beginPath(); g.moveTo(X(h[0]), Y(h[1])); g.lineTo(X(leaf[0]), Y(leaf[1])); g.stroke();
      g.lineWidth = Math.max(0.6, S * 0.025); g.strokeStyle = TH.arc;
      const ang0 = Math.atan2(leaf[1] - h[1], leaf[0] - h[0]), ang1 = Math.atan2(other[1] - h[1], other[0] - h[0]);
      let d = ang1 - ang0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.beginPath(); g.arc(X(h[0]), Y(h[1]), l * S, ang0, ang0 + d, d < 0); g.stroke();
    }
  }

  /** a marker just outside the portal: arrow in (entrance), out (exit) or both; clearance as a faint box */
  function drawPortal(g, p, b, X, Y, S) {
    const op = b.openings.find((x) => x.id === p.opening);
    if (!op) return;
    const out = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[p.side];
    const mid = [(op.a[0] + op.b[0]) / 2, (op.a[1] + op.b[1]) / 2], col = ROLE[p.role] || ROLE.both;
    // clearance
    const half = op.width / 2, cl = p.clear || 1;
    const r = out[0] === 0 ? [mid[0] - half, Math.min(mid[1], mid[1] + out[1] * cl), mid[0] + half, Math.max(mid[1], mid[1] + out[1] * cl)]
      : [Math.min(mid[0], mid[0] + out[0] * cl), mid[1] - half, Math.max(mid[0], mid[0] + out[0] * cl), mid[1] + half];
    g.fillStyle = col + '22'; g.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S);
    // arrow
    const L = Math.max(0.9, Math.min(1.6, op.width * 0.8)), k = p.main ? 1.25 : 1;
    const base = [mid[0] + out[0] * 0.35, mid[1] + out[1] * 0.35], tip = [mid[0] + out[0] * (0.35 + L * k), mid[1] + out[1] * (0.35 + L * k)];
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = Math.max(1.5, S * (p.main ? 0.12 : 0.08));
    g.beginPath(); g.moveTo(X(base[0]), Y(base[1])); g.lineTo(X(tip[0]), Y(tip[1])); g.stroke();
    const head = (at, dir) => {
      const hs = 0.35 * k, px = -dir[1], py = dir[0];
      g.beginPath();
      g.moveTo(X(at[0] + dir[0] * hs), Y(at[1] + dir[1] * hs));
      g.lineTo(X(at[0] + px * hs * 0.8), Y(at[1] + py * hs * 0.8));
      g.lineTo(X(at[0] - px * hs * 0.8), Y(at[1] - py * hs * 0.8));
      g.closePath(); g.fill();
    };
    if (p.role === 'entrance' || p.role === 'both') head(base, [-out[0], -out[1]]);
    if (p.role === 'exit' || p.role === 'both') head(tip, out);
  }

  TPL.drawBuilding = drawBuilding;
  TPL.wallRuns = wallRuns;
  TPL.floorKey = floorKey;
  TPL.THEMES = THEMES;
  TPL.ROLE_COLORS = ROLE;
})(typeof window !== 'undefined' ? window : globalThis);
