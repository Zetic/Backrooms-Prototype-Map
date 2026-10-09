/*
 * scale.js - real-sized reference objects drawn over the map, so its sizes
 * can be judged by eye: the cursor is a person, and a person, a car, a bus or
 * a football field can be dropped anywhere at their true size.
 *
 * Overlay only: nothing here touches the world, its tiles or its exports.
 * Positions are world metres; an object's length runs along x before it is
 * turned, its depth along y.
 */
(function (root) {
  'use strict';
  const BR = root.BR;

  const REFS = [
    { id: 'human', name: 'Person', w: 0.5, h: 0.5, round: true, fill: '#ff6b4a', size: '0.5 m across' },
    { id: 'door', name: 'Door', w: 0.9, h: 0.9, fill: 'rgba(240,230,210,0.25)', size: '0.9 m wide', mark: door },
    { id: 'couch', name: 'Couch', w: 2.1, h: 0.9, fill: '#8a6fb0', mark: couch },
    { id: 'bed', name: 'Queen bed', w: 1.5, h: 2.0, fill: '#f2efe8', mark: bed },
    { id: 'car', name: 'Car', w: 4.5, h: 1.8, fill: '#5b8bd9', mark: car },
    { id: 'bus', name: 'School bus', w: 12, h: 2.5, fill: '#f2b632', mark: bus },
    { id: 'container', name: 'Shipping container', w: 12.2, h: 2.4, fill: '#c0603a', mark: container },
    { id: 'basketball', name: 'Basketball court', w: 28, h: 15, fill: '#d49a5c', mark: basketball },
    { id: 'soccer', name: 'Soccer pitch', w: 105, h: 68, fill: '#5a9a4c', mark: soccer },
    { id: 'football', name: 'Football field', w: 109.7, h: 48.8, fill: '#4f8f45', mark: football }
  ];
  const byId = Object.fromEntries(REFS.map((r) => [r.id, r]));
  const sizeOf = (r) => r.size || r.w + ' × ' + r.h + ' m';
  const HANDLE = 18;                                      // px past an object's end: its turning handle

  /** a world point in an object's own frame (metres from its centre, unturned) */
  function toLocal(o, x, y) {
    const dx = x - o.x, dy = y - o.y, c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
    return [dx * c + dy * s, -dx * s + dy * c];
  }
  /** is a world point on the object (tol: extra metres around it, so tiny ones can be grabbed) */
  function contains(o, x, y, tol = 0) {
    const r = byId[o.id], [lx, ly] = toLocal(o, x, y);
    if (r.round) return Math.hypot(lx, ly) <= r.w / 2 + tol;
    return Math.abs(lx) <= r.w / 2 + tol && Math.abs(ly) <= r.h / 2 + tol;
  }
  /** the topmost object under a world point, or -1 */
  function hit(objs, x, y, tol = 0) {
    for (let k = objs.length - 1; k >= 0; k--) if (contains(objs[k], x, y, tol)) return k;
    return -1;
  }
  /** an object's turning handle, in world metres at this zoom */
  function handle(o, zoom) {
    const d = byId[o.id].w / 2 + HANDLE / zoom;
    return [o.x + Math.cos(o.rot || 0) * d, o.y + Math.sin(o.rot || 0) * d];
  }

  // ---------- each reference's markings, in its own metres (lw: one pixel)
  function line(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]); ctx.stroke(); }
  function circle(ctx, x, y, r, a0 = 0, a1 = Math.PI * 2) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke(); }
  function rect(ctx, x0, y0, x1, y1, fill) { if (fill) { ctx.fillStyle = fill; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); } else ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); }
  function mirrored(ctx, fn) { fn(); ctx.save(); ctx.scale(-1, 1); fn(); ctx.restore(); }
  function door(ctx) {
    // the opening along the bottom edge, the leaf swung open against its hinge, the arc it sweeps
    ctx.strokeStyle = '#f0e6d2';
    rect(ctx, -0.45, -0.45, -0.4, 0.45, '#f0e6d2');
    circle(ctx, -0.45, 0.45, 0.9, -Math.PI / 2, 0);
    line(ctx, [-0.45, 0.45, 0.45, 0.45]);
  }
  function couch(ctx) {
    rect(ctx, -1.05, -0.45, 1.05, -0.22, 'rgba(0,0,0,0.25)');
    rect(ctx, -1.05, -0.22, -0.85, 0.45, 'rgba(0,0,0,0.18)');
    rect(ctx, 0.85, -0.22, 1.05, 0.45, 'rgba(0,0,0,0.18)');
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    line(ctx, [-0.283, -0.22, -0.283, 0.45]); line(ctx, [0.283, -0.22, 0.283, 0.45]);
  }
  function bed(ctx) {
    rect(ctx, -0.75, -1, 0.75, -0.92, '#8a6a4a');
    rect(ctx, -0.68, -0.88, -0.06, -0.58, '#ffffff'); rect(ctx, 0.06, -0.88, 0.68, -0.58, '#ffffff');
    rect(ctx, -0.75, -0.45, 0.75, 1, '#c9d3e0');
  }
  function car(ctx) {
    rect(ctx, 0.3, -0.78, 1.0, 0.78, 'rgba(20,30,45,0.55)');   // windscreen (the front is +x)
    rect(ctx, -1.55, -0.72, -1.15, 0.72, 'rgba(20,30,45,0.55)');
    rect(ctx, -1.15, -0.8, 0.3, 0.8, 'rgba(255,255,255,0.12)');
  }
  function bus(ctx) {
    rect(ctx, 5.55, -1.15, 5.85, 1.15, 'rgba(20,20,20,0.6)');
    rect(ctx, -6, -0.06, 5.55, 0.06, 'rgba(0,0,0,0.18)');
    for (const x of [-3, 1]) rect(ctx, x - 0.4, -0.4, x + 0.4, 0.4, 'rgba(0,0,0,0.15)');
  }
  function container(ctx, lw) {
    if (0.6 / lw < 4) return;                             // ribs only when they are more than a few pixels apart
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let x = -5.7; x < 6.05; x += 0.6) line(ctx, [x, -1.2, x, 1.2]);
  }
  function basketball(ctx) {
    ctx.strokeStyle = '#ffffff';
    line(ctx, [0, -7.5, 0, 7.5]); circle(ctx, 0, 0, 1.8);
    mirrored(ctx, () => {
      rect(ctx, -14, -2.45, -8.2, 2.45); circle(ctx, -8.2, 0, 1.8);
      const bx = -14 + 1.575, a = Math.asin(6.6 / 6.75), ex = bx + 6.75 * Math.cos(a);
      line(ctx, [-14, -6.6, ex, -6.6]); line(ctx, [-14, 6.6, ex, 6.6]); circle(ctx, bx, 0, 6.75, -a, a);
    });
  }
  function soccer(ctx) {
    ctx.strokeStyle = '#ffffff';
    line(ctx, [0, -34, 0, 34]); circle(ctx, 0, 0, 9.15);
    mirrored(ctx, () => {
      rect(ctx, -52.5, -20.16, -36, 20.16); rect(ctx, -52.5, -9.16, -47, 9.16);
      const a = Math.acos(5.5 / 9.15); circle(ctx, -41.5, 0, 9.15, -a, a);
    });
  }
  function football(ctx, lw) {
    rect(ctx, -54.85, -24.4, -45.71, 24.4, 'rgba(0,0,0,0.2)'); rect(ctx, 45.71, -24.4, 54.85, 24.4, 'rgba(0,0,0,0.2)');
    ctx.strokeStyle = '#ffffff';
    const step = 4.572 / lw < 3 ? 9.144 : 4.572;          // every 5 yards, or 10 when they would crowd
    for (let x = -45.72; x <= 45.73; x += step) line(ctx, [x, -24.4, x, 24.4]);
  }

  /**
   * Draws the references over the map. view: { cx, cy, zoom, w, h, dpr } as
   * for BR.draw. opts: objs (placed), selected, hover (indexes), ghost (an
   * object being placed), cursor ([x, y] world: the person under the mouse).
   */
  function draw(ctx, view, opts = {}) {
    const { cx, cy, zoom, w, h, dpr = 1 } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sx = (x) => (x - cx) * zoom + w / 2, sy = (y) => (y - cy) * zoom + h / 2;
    const objs = opts.objs || [], list = objs.map((o, k) => [o, k]);
    if (opts.ghost) list.push([opts.ghost, -1]);
    for (const [o, k] of list) {
      const r = byId[o.id], X = sx(o.x), Y = sy(o.y), c = Math.abs(Math.cos(o.rot || 0)), s = Math.abs(Math.sin(o.rot || 0));
      const hw = (c * r.w + s * r.h) / 2 * zoom, hh = (s * r.w + c * r.h) / 2 * zoom;
      if (X + hw < -40 || X - hw > w + 40 || Y + hh < -40 || Y - hh > h + 40) continue;
      const lit = k === opts.selected || k === opts.hover || k < 0;
      ctx.save();
      ctx.globalAlpha = k < 0 ? 0.6 : 1;
      ctx.translate(X, Y); ctx.rotate(o.rot || 0); ctx.scale(zoom, zoom);
      const lw = 1 / zoom;
      ctx.lineWidth = lw;
      ctx.fillStyle = r.fill;
      if (r.round) { ctx.beginPath(); ctx.arc(0, 0, r.w / 2, 0, Math.PI * 2); ctx.fill(); }
      else {
        ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
        if (r.mark && Math.max(r.w, r.h) * zoom >= 8) r.mark(ctx, lw);
      }
      ctx.lineWidth = (lit ? 2 : 1) * lw;
      ctx.strokeStyle = lit ? '#ffffff' : 'rgba(20,18,15,0.85)';
      if (r.round) circle(ctx, 0, 0, r.w / 2); else ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = k < 0 ? 0.75 : 1;
      if (Math.max(hw, hh) < 5) {                         // too small to see at this zoom: a ring marks where it is
        ctx.strokeStyle = lit ? '#ffffff' : r.round ? r.fill : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2); ctx.stroke();
      }
      if (k === opts.selected && !r.round) {
        const [hx, hy] = handle(o, zoom), HX = sx(hx), HY = sy(hy), a = o.rot || 0, ex = X + Math.cos(a) * r.w / 2 * zoom, ey = Y + Math.sin(a) * r.w / 2 * zoom;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(HX, HY); ctx.stroke();
        ctx.fillStyle = '#e5cc9b'; ctx.beginPath(); ctx.arc(HX, HY, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (lit || Math.max(hw, hh) >= 9) {
        const text = r.name + ' · ' + sizeOf(r);
        ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.fillStyle = '#ffffff';
        const ty = Y + Math.max(hh, 6) + 6;
        ctx.strokeText(text, X, ty); ctx.fillText(text, X, ty);
      }
      ctx.restore();
    }
    if (opts.cursor && !opts.ghost) {
      // the cursor: a person at true size, and a ring round it while that is only a few pixels
      const X = sx(opts.cursor[0]), Y = sy(opts.cursor[1]), r = byId.human.w / 2 * zoom;
      ctx.save();
      ctx.fillStyle = byId.human.fill; ctx.strokeStyle = 'rgba(20,18,15,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(X, Y, Math.max(r, 1.5), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (r < 5) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X, Y, 7, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  BR.SCALE = { REFS, byId, sizeOf, toLocal, contains, hit, handle, draw, HANDLE };
})(typeof window !== 'undefined' ? window : globalThis);
