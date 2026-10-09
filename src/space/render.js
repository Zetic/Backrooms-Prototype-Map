/*
 * space/render.js - draws one floor of a house from the reserved-floor
 * generator (space/space.js, space/route.js) on a 2D canvas, from its output
 * alone.
 *
 *   BR.SPACE.draw(ctx, house, { floor, scale, ox, oy, labels, sizes, kinds, lot, route })
 *
 * floor: which floor (0 the ground floor). scale: pixels per metre. ox, oy:
 * where the lot's top-left goes. labels / sizes: room names and their clear
 * floor size. kinds: interior walls in their own shade. lot: the lot outline.
 * route: the way through the house, front door to exit, as a dotted line.
 */
(function (root) {
  'use strict';
  const SP = root.BR.SPACE;

  SP.COLORS = {
    ground: '#3a3f33', lot: 'rgba(255,255,255,0.18)',
    public: '#d9c9a8', private: '#c4cfd8', service: '#cfc6b9', circulation: '#e6dfcf', garage: '#b9b6ae',
    wall: '#2b2724', interior: '#5b524a', pocket: '#7d7268', open: '#e6dfcf',
    door: '#8a5a32', front: '#c8553d', exit: '#8b5bd6', route: '#c8553d', tread: '#a99f8f', text: '#2b2724', size: '#5f574f'
  };

  const mid = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

  SP.draw = function draw(ctx, h, o) {
    o = Object.assign({ floor: 0, scale: 30, ox: 0, oy: 0, labels: true, sizes: true, kinds: true, lot: true, route: true }, o || {});
    const C = SP.COLORS, s = o.scale, X = (x) => o.ox + x * s, Y = (y) => o.oy + y * s, F = o.floor;
    const on = (x) => (x.floor || 0) === F;
    const level = (h.levels || []).find((l) => l.floor === F) || { solids: { walls: [], pockets: [] } };
    const rect = (r, fill) => { ctx.fillStyle = fill; ctx.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * s, (r[3] - r[1]) * s); };
    const spaces = h.spaces.filter(on), openings = h.openings.filter(on);
    ctx.save();
    if (o.lot) {
      rect([0, 0, h.site.w, h.site.h], C.ground);
      ctx.strokeStyle = C.lot; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.strokeRect(X(0) + 0.5, Y(0) + 0.5, h.site.w * s - 1, h.site.h * s - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      if (F === 0) ctx.fillText('street', X(h.site.w / 2), Y(h.site.h) - 4);
    }
    // floors, then the solid parts, then the openings through them
    for (const sp of spaces) for (const r of sp.floorRects || [sp.rect]) rect(r, sp.type === 'garage' ? C.garage : C[sp.zone]);
    for (const r of level.solids.walls) rect(r, C.wall);
    if (o.kinds) for (const w of h.walls) if (on(w) && w.kind === 'interior') rect(w.rect, C.interior);
    for (const r of level.solids.pockets) rect(r, C.pocket);
    for (const op of openings) rect(op.rect, op.kind === 'portal' ? C.exit : op.kind === 'open' ? C.open : C.circulation);
    // stairs: treads across the run, the way up marked
    ctx.lineWidth = 1;
    for (const v of h.verticals || []) {
      if (v.floors[0] !== F && v.floors[1] !== F) continue;
      const r = v.rect, along = v.up === 'N' || v.up === 'S';
      ctx.strokeStyle = C.tread; ctx.beginPath();
      if (along) for (let y = r[1] + 0.25; y < r[3] - 0.1; y += 0.25) { ctx.moveTo(X(r[0]), Y(y)); ctx.lineTo(X(r[2]), Y(y)); }
      else for (let x = r[0] + 0.25; x < r[2] - 0.1; x += 0.25) { ctx.moveTo(X(x), Y(r[1])); ctx.lineTo(X(x), Y(r[3])); }
      ctx.stroke();
    }
    // a door: its leaf swung open into the second room, or into the house for the front door
    ctx.lineWidth = Math.max(1, s / 30);
    for (const op of openings) {
      if (op.kind === 'open' || op.kind === 'opening' || op.kind === 'portal') continue;
      const r = op.rect, hz = op.o === 'h';
      ctx.strokeStyle = ['front door','primary connection'].includes(op.role) ? C.front : C.door;
      if (op.kind === 'vehicle') {
        ctx.setLineDash([3, 3]); ctx.beginPath();
        if (hz) { ctx.moveTo(X(r[0]), Y((r[1] + r[3]) / 2)); ctx.lineTo(X(r[2]), Y((r[1] + r[3]) / 2)); } else { ctx.moveTo(X((r[0] + r[2]) / 2), Y(r[1])); ctx.lineTo(X((r[0] + r[2]) / 2), Y(r[3])); }
        ctx.stroke(); ctx.setLineDash([]); continue;
      }
      if (op.kind === 'slider') { ctx.strokeRect(X(r[0]), Y((r[1] + r[3]) / 2) - 1, (r[2] - r[0]) * s, 2); continue; }
      const w = op.width;
      ctx.beginPath();
      if (hz) {
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
    // the way through: front door, each room of the route and the doors between, the exit
    if (o.route && h.route && h.meta.routeOverlay !== false) {
      const byId = new Map(h.spaces.map((x) => [x.id, x]));
      const front = h.openings.find((x) => ['front door','primary connection'].includes(x.role)), exit = h.openings.find((x) => ['exit','secondary connection'].includes(x.role));
      const runs = [];
      let run = [];
      if (front && on(front)) run.push(mid(front.rect));
      h.route.forEach((id, k) => {
        const sp = byId.get(id);
        if (!on(sp)) { if (run.length) runs.push(run); run = []; return; }
        run.push(mid(sp.rect));
        const next = h.route[k + 1], op = next && openings.find((x) => x.rooms.includes(id) && x.rooms.includes(next));
        if (op) run.push(mid(op.rect));
      });
      if (exit && on(exit)) run.push(mid(exit.rect));
      if (run.length) runs.push(run);
      ctx.strokeStyle = C.route; ctx.lineWidth = Math.max(1.5, s / 18); ctx.setLineDash([2, 4]); ctx.globalAlpha = 0.85;
      for (const r of runs) { ctx.beginPath(); r.forEach((p, k) => (k ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // names and clear sizes
    if (o.labels || o.sizes) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const sp of spaces) {
        const r = sp.floorRects ? sp.floorRects.reduce((a,b)=>(a[2]-a[0])*(a[3]-a[1])>(b[2]-b[0])*(b[3]-b[1])?a:b) : sp.rect, cx = X((r[0] + r[2]) / 2), cy = Y((r[1] + r[3]) / 2), wpx = (r[2] - r[0]) * s;
        const big = Math.max(8, Math.min(13, s * 0.38)), small = Math.max(7, Math.min(11, s * 0.3));
        const vertical = wpx < 60 && (r[3] - r[1]) * s > wpx * 1.5;
        ctx.save(); ctx.translate(cx, cy); if (vertical) ctx.rotate(-Math.PI / 2);
        if (o.labels) { ctx.fillStyle = C.text; ctx.font = '600 ' + big + 'px system-ui, sans-serif'; ctx.fillText(sp.name, 0, o.sizes ? -small * 0.7 : 0, Math.max(8,(vertical?(r[3]-r[1])*s:wpx)-6)); }
        if (o.sizes) { ctx.fillStyle = C.size; ctx.font = small + 'px system-ui, sans-serif'; ctx.fillText(sp.floorRects ? sp.shape + ' · ' + sp.area.toFixed(1) + ' m²' : sp.size[0].toFixed(2) + ' × ' + sp.size[1].toFixed(2), 0, o.labels ? big * 0.75 : 0); }
        ctx.restore();
      }
      const ports=openings.filter(x=>['primary connection','secondary connection','exit','front door'].includes(x.role));
      let secondary=0;
      for(const op of ports){
        const primary=['primary connection','front door'].includes(op.role),[ex,ey]=mid(op.rect),d={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]}[op.side];
        ctx.fillStyle=primary?C.front:C.exit;ctx.font='600 '+Math.max(9,Math.min(12,s*0.36))+'px system-ui, sans-serif';
        ctx.fillText(primary?'P':'S'+(++secondary),X(ex+d[0]*0.9),Y(ey+d[1]*0.7));
      }
    }
    ctx.restore();
  };
})(typeof window !== 'undefined' ? window : globalThis);

