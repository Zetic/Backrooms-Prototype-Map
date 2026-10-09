/*
 * space/render.js - draws a house from the reserved-floor generator
 * (space/space.js) on a 2D canvas, from its output alone.
 *
 *   BR.SPACE.draw(ctx, house, { scale, ox, oy, labels, sizes, kinds, lot })
 *
 * scale: pixels per metre. ox, oy: where the lot's top-left goes. labels /
 * sizes: room names and their clear floor size. kinds: interior walls in
 * their own shade. lot: the lot outline.
 */
(function (root) {
  'use strict';
  const SP = root.BR.SPACE;

  SP.COLORS = {
    ground: '#3a3f33', lot: 'rgba(255,255,255,0.18)',
    public: '#d9c9a8', private: '#c4cfd8', service: '#cfc6b9', circulation: '#e6dfcf', garage: '#b9b6ae',
    wall: '#2b2724', interior: '#5b524a', pocket: '#7d7268', open: '#e6dfcf',
    door: '#8a5a32', front: '#c8553d', text: '#2b2724', size: '#5f574f'
  };

  SP.draw = function draw(ctx, h, o) {
    o = Object.assign({ scale: 30, ox: 0, oy: 0, labels: true, sizes: true, kinds: true, lot: true }, o || {});
    const C = SP.COLORS, s = o.scale, X = (x) => o.ox + x * s, Y = (y) => o.oy + y * s;
    const rect = (r, fill) => { ctx.fillStyle = fill; ctx.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * s, (r[3] - r[1]) * s); };
    ctx.save();
    if (o.lot) {
      rect([0, 0, h.site.w, h.site.h], C.ground);
      ctx.strokeStyle = C.lot; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.strokeRect(X(0) + 0.5, Y(0) + 0.5, h.site.w * s - 1, h.site.h * s - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('street', X(h.site.w / 2), Y(h.site.h) - 4);
    }
    // floors, then the solid parts, then the openings through them
    for (const sp of h.spaces) rect(sp.rect, sp.type === 'garage' ? C.garage : C[sp.zone]);
    for (const r of h.solids.walls) rect(r, C.wall);
    if (o.kinds) for (const w of h.walls) if (w.kind === 'interior') rect(w.rect, C.interior);
    for (const r of h.solids.pockets) rect(r, C.pocket);
    for (const op of h.openings) rect(op.rect, op.kind === 'open' ? C.open : C.circulation);
    // a door: its leaf swung open into the second room, or outwards for exits
    ctx.lineWidth = Math.max(1, s / 30);
    for (const op of h.openings) {
      if (op.kind === 'open' || op.kind === 'opening') continue;
      const r = op.rect, hz = op.o === 'h';
      ctx.strokeStyle = op.role === 'front door' ? C.front : C.door;
      if (op.kind === 'vehicle') { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(r[0]), Y((r[1] + r[3]) / 2)); ctx.lineTo(X(r[2]), Y((r[1] + r[3]) / 2)); ctx.stroke(); ctx.setLineDash([]); continue; }
      if (op.kind === 'slider') { ctx.strokeRect(X(r[0]), Y((r[1] + r[3]) / 2) - 1, (r[2] - r[0]) * s, 2); continue; }
      const w = op.width;
      ctx.beginPath();
      if (hz) {
        // leaf hinged at the left jamb, swung into the room below it (the
        // room above for a front door)
        const down = op.side !== 'S', y0 = down ? r[3] : r[1], dir = down ? 1 : -1;
        ctx.moveTo(X(r[0]), Y(y0)); ctx.lineTo(X(r[0]), Y(y0 + dir * w));
        ctx.arc(X(r[0]), Y(y0), w * s, down ? Math.PI / 2 : -Math.PI / 2, 0, down);
      } else {
        const x0 = r[2];
        ctx.moveTo(X(x0), Y(r[1])); ctx.lineTo(X(x0 + w), Y(r[1]));
        ctx.arc(X(x0), Y(r[1]), w * s, 0, Math.PI / 2);
      }
      ctx.stroke();
    }
    // names and clear sizes
    if (o.labels || o.sizes) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const sp of h.spaces) {
        const r = sp.rect, cx = X((r[0] + r[2]) / 2), cy = Y((r[1] + r[3]) / 2), wpx = (r[2] - r[0]) * s;
        const big = Math.max(8, Math.min(13, s * 0.38)), small = Math.max(7, Math.min(11, s * 0.3));
        const vertical = wpx < 60 && (r[3] - r[1]) * s > wpx * 1.5;
        ctx.save(); ctx.translate(cx, cy); if (vertical) ctx.rotate(-Math.PI / 2);
        if (o.labels) { ctx.fillStyle = C.text; ctx.font = '600 ' + big + 'px system-ui, sans-serif'; ctx.fillText(sp.name, 0, o.sizes ? -small * 0.7 : 0); }
        if (o.sizes) { ctx.fillStyle = C.size; ctx.font = small + 'px system-ui, sans-serif'; ctx.fillText(sp.size[0].toFixed(2) + ' × ' + sp.size[1].toFixed(2), 0, o.labels ? big * 0.75 : 0); }
        ctx.restore();
      }
    }
    ctx.restore();
  };
})(typeof window !== 'undefined' ? window : globalThis);
