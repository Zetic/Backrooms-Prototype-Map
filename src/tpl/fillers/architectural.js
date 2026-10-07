/* Architectural curved fillers: constant-radius circles, semicircles and
 * sectors, combined with straight wings and radial room divisions.
 * The kit raster remains the walkable plan. P.geometry records the intended
 * arcs and straight radial edges; the engine draws only surviving boundaries.
 */
(function (root) {
  'use strict';
  const { TG, FILL } = root.BR, TAU = 2 * Math.PI;
  const dims = (S) => [TG.rw(S.inner), TG.rh(S.inner)];
  const angle = (a) => (a % TAU + TAU) % TAU;

  // Design along the site's long axis, then turn/mirror the whole plan.
  function frame(P, rng) {
    const I = P.inner, turn = TG.rh(I) > TG.rw(I), flip = rng.f() < 0.5;
    const W = turn ? TG.rh(I) : TG.rw(I), H = turn ? TG.rw(I) : TG.rh(I);
    const pt = (x, y) => turn ? [I[0] + y, I[1] + (flip ? W - x : x)] : [I[0] + (flip ? W - x : x), I[1] + y];
    const rect = (q, v) => {
      const a = pt(q[0], q[1]), b = pt(q[2], q[3]);
      P.paint([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], v);
    };
    const geometry = (g) => { (P.geometry || (P.geometry = [])).push(g); };
    const arc = (v, c, r, start, sweep) => {
      const a = pt(c[0] + Math.cos(start), c[1] + Math.sin(start)), center = pt(...c);
      // A reflection reverses winding, so store an unsigned angular range.
      const end = pt(c[0] + Math.cos(start + sweep), c[1] + Math.sin(start + sweep));
      const sign = (turn ? -1 : 1) * (flip ? -1 : 1);
      geometry({ kind: 'arc', tag: P.rooms[v].tags[1], center, radius: r,
        start: Math.atan2((sign > 0 ? a : end)[1] - center[1], (sign > 0 ? a : end)[0] - center[0]), sweep });
    };
    const line = (v, a, b) => geometry({ kind: 'line', tag: P.rooms[v].tags[1], a: pt(...a), b: pt(...b) });
    const room = (type, tag) => P.add(type, ['architectural', tag]);
    const sector = (v, c, r, start, sweep, inner = 0) => {
      for (let y = Math.max(0, Math.floor(c[1] - r)); y < Math.min(H, Math.ceil(c[1] + r)); y++) {
        for (let x = Math.max(0, Math.floor(c[0] - r)); x < Math.min(W, Math.ceil(c[0] + r)); x++) {
          const dx = x + 0.5 - c[0], dy = y + 0.5 - c[1], d = Math.hypot(dx, dy);
          if (d <= r && d >= inner && angle(Math.atan2(dy, dx) - start) <= sweep + 1e-9) rect([x, y, x + 1, y + 1], v);
        }
      }
      arc(v, c, r, start, sweep);
      if (inner) arc(v, c, inner, start, sweep);
      if (sweep < TAU - 1e-9) for (const a of [start, start + sweep]) {
        line(v, [c[0] + inner * Math.cos(a), c[1] + inner * Math.sin(a)], [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
      }
    };
    return { W, H, rect, room, sector };
  }

  const common = { feel: 'mixed', weight: 1, doors: { opening: 0.75, door: 0.25 }, loops: 0.1 };
  FILL.register(Object.assign({}, common, {
    id: 'circular_hall', name: 'Circular hall and wing',
    blurb: 'A constant-radius circular hall opening into a straight rectangular wing, with small rooms beside the wing.',
    fits: (S) => Math.min(...dims(S)) >= 16 && Math.max(...dims(S)) >= 24,
    site: { w: [12, 34], h: [8, 26] },
    layout(P, rng) {
      const Q = frame(P, rng), { W, H } = Q;
      const r = Math.floor(Math.min((H - 2) / 2, (W - 8) * 0.4)), cy = Math.floor(H / 2), cx = r + 1;
      const v = Q.room('hall', 'circle');
      Q.sector(v, [cx, cy], r, 0, TAU);
      Q.rect([cx, cy - 3, W - 1, cy + 3], v);
      const x0 = cx + r + 1;
      if (W - 1 - x0 >= 6) for (const q of [[x0, 1, W - 1, cy - 3], [x0, cy + 3, W - 1, H - 1]]) {
        if (TG.rh(q) >= 4) { const u = Q.room('room', 'wing-room'); Q.rect(q, u); P.require.push([v, u]); }
      }
    }
  }));

  FILL.register(Object.assign({}, common, {
    id: 'twin_domes', name: 'Paired semicircular halls',
    blurb: 'Two matching semicircular halls on straight rectangular bases, joined by a short straight gallery.',
    fits: (S) => Math.min(...dims(S)) >= 16 && Math.max(...dims(S)) >= 28,
    site: { w: [14, 34], h: [8, 20] },
    layout(P, rng) {
      const Q = frame(P, rng), { W, H } = Q, r = Math.floor(Math.min((W - 8) / 4, H - 7));
      const y = r + 1, centers = [r + 1, W - r - 1];
      for (let k = 0; k < 2; k++) {
        const v = Q.room('hall', 'dome-' + k), x = centers[k];
        Q.sector(v, [x, y], r, Math.PI, Math.PI);
        Q.rect([x - r, y, x + r, y + 5], v);
      }
      const gallery = Q.room('passage', 'dome-gallery');
      Q.rect([centers[0], y + 2, centers[1], y + 5], gallery);
    }
  }));

  FILL.register(Object.assign({}, common, {
    id: 'sector', name: 'Circular sector room',
    blurb: 'A quarter-circle or 120-degree pie-slice room: one circular arc and two straight radial sides, with a squared entrance at the tip.',
    fits: (S) => Math.min(...dims(S)) >= 16,
    site: { w: [8, 28], h: [8, 26] },
    layout(P, rng) {
      const Q = frame(P, rng), { W, H } = Q, wide = rng.f() < 0.5;
      const c = [wide ? Math.floor(W / 3) : 1, H - 1];
      const r = Math.floor(Math.min(H - 2, W - c[0] - 1, wide ? 2 * (c[0] - 1) : Infinity));
      const v = Q.room('hall', 'sector-room');
      Q.sector(v, c, r, wide ? -2 * Math.PI / 3 : -Math.PI / 2, wide ? 2 * Math.PI / 3 : Math.PI / 2);
      // A usable entrance instead of a needle-thin wedge tip.
      Q.rect([Math.max(1, c[0] - 1), c[1] - 3, c[0] + 3, c[1]], v);
    }
  }));

  FILL.register(Object.assign({}, common, {
    id: 'radial_suite', name: 'Radial room suite',
    blurb: 'Concentric semicircular circulation and pie-slice rooms with straight radial sides, separated by solid wall bands.',
    fits: (S) => Math.min(...dims(S)) >= 24 && Math.max(...dims(S)) >= 36,
    site: { w: [18, 36], h: [12, 26] },
    layout(P, rng) {
      const Q = frame(P, rng), { W, H } = Q, r = Math.floor(Math.min((W - 2) / 2, H - 2));
      const c = [Math.floor(W / 2), H - 1], inner = Math.max(4, Math.floor(r * 0.3)), outer = inner + 4;
      const hall = Q.room('passage', 'radial-gallery');
      Q.sector(hall, c, outer, Math.PI, Math.PI, inner);
      const n = r < 20 ? 3 : rng.int(3, 5), step = Math.PI / n, gap = 2 / (outer + 2);
      for (let k = 0; k < n; k++) {
        const v = Q.room('room', 'radial-room-' + k);
        Q.sector(v, c, r, Math.PI + k * step + gap / 2, step - gap, outer + 2);
        // Each room enters at the middle of its radial bay, through a 1 m
        // throat across the solid band, rather than an arbitrary bridge.
        const a = Math.PI + (k + 0.5) * step;
        for (let d = outer - 1; d <= outer + 3; d += 0.5) {
          const x = Math.floor(c[0] + d * Math.cos(a) - 0.5), y = Math.floor(c[1] + d * Math.sin(a) - 0.5);
          Q.rect([x, y, x + 2, y + 2], v);
        }
        P.require.push([hall, v]);
      }
    }
  }));
})(typeof window !== 'undefined' ? window : globalThis);
