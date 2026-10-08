/*
 * tpl/fillers/halls.js - hall-led fillers: one big space sets the tone of
 * the site, and the rest is solid or a little warren round it.
 *
 *   loop_hall          a wide 3-5 m hall in an L, U or ring round a block of
 *                      2-4 rooms that open off it; the ring closes on itself,
 *                      an L or U through the rooms (mixed)
 *   cross_pillars      a big hall with rows of plus-shaped pillars on a grid
 *                      and a scalloped edge, a tooth at every pillar line
 *                      (open)
 *   partitions         a large room full of free-standing straight, L and T
 *                      wall pieces at irregular spacing: the Level 0 look
 *                      (mixed)
 *   room_maze          one square-ish room packed with short walls on a
 *                      1.5-2 m lattice until it is a maze (enclosed)
 *   office             a big room with loose rows of cubicle stubs and a few
 *                      small offices along one or two edges (mixed)
 *   aisles             a room of long parallel walls (partitions or thin
 *                      solid) with gaps to cross, like shelving rows (mixed)
 *   scattered_pillars  a big room with small pillars at random spacing and a
 *                      notched edge (open)
 *
 * A hall that does not fill its site gets a fringe of blob rooms (most of
 * them turned solid) or plain solid round it, and straight passages from the
 * connections the layout left in solid, so the engine has little to bridge.
 * Furnishings find their room by tag: room ids change when the engine
 * compacts the plan. Units are kit cells (0.5 m), rects [x0, y0, x1, y1].
 *
 * Most world sites are small (9-12 m across), so every filler here scales
 * down to a 9 m inner side (loop_hall and office 10 m):
 * under about 14 m the spacing, bands, widths and room counts shrink with
 * the site rather than the concept turning into noise.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL;
  const { VOID, bsp, notch, paintPath, route, noiseField, builtComponents } = FILL.lib;
  const K = FILL.kit;
  const dims = (S) => [TG.rw(S.inner), TG.rh(S.inner)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const SIDES = ['N', 'E', 'S', 'W'];

  // ------------------------------------------------------------ helpers
  /** a w x h rect at a random place in rect I (clipped to it) */
  function place(I, rng, w, h) {
    w = clamp(w, 1, TG.rw(I)); h = clamp(h, 1, TG.rh(I));
    const x = I[0] + rng.int(0, TG.rw(I) - w), y = I[1] + rng.int(0, TG.rh(I) - h);
    return [x, y, x + w, y + h];
  }
  /** a rect taking a share [lo, hi] of the inner rect each way (at least `min` cells), somewhere in it */
  function share(P, rng, lo, hi, min) {
    const I = P.inner, iw = TG.rw(I), ih = TG.rh(I);
    return place(I, rng, Math.max(Math.min(min, iw), Math.round(iw * rng.range(lo, hi))), Math.max(Math.min(min, ih), Math.round(ih * rng.range(lo, hi))));
  }

  /** rect r cut down to at most `max` cells each way (a random part of it) */
  function cap(r, rng, max) {
    const w = Math.min(TG.rw(r), max - rng.int(0, 6)), h = Math.min(TG.rh(r), max - rng.int(0, 6));
    return place(r, rng, w, h);
  }

  /** the largest room tagged `tag`, or -1 */
  function mainRoom(P, tag) {
    const n = new Int32Array(P.rooms.length);
    for (let i = 0; i < P.R.a.length; i++) if (P.R.a[i] >= 0) n[P.R.a[i]]++;
    let best = -1;
    for (let v = 0; v < P.rooms.length; v++) if (n[v] && P.rooms[v].tags.indexOf(tag) >= 0 && (best < 0 || n[v] > n[best])) best = v;
    return best;
  }
  /** bounding rect of room v's cells, and their count */
  function roomBox(P, v) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    let n = 0;
    for (let i = 0; i < P.R.a.length; i++) {
      if (P.R.a[i] !== v) continue;
      const x = i % P.W, y = (i - x) / P.W;
      n++;
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x + 1 > b[2]) b[2] = x + 1; if (y + 1 > b[3]) b[3] = y + 1;
    }
    return n ? { r: b, n } : null;
  }

  /** floor not joined to the piece holding cell i turns solid */
  function dropLoose(P, i) {
    const C = builtComponents(P), keep = C.label[i];
    if (keep < 0) return;
    for (let j = 0; j < P.R.a.length; j++) if (P.R.a[j] >= 0 && C.label[j] !== keep) P.R.a[j] = VOID;
  }
  /** cells within d cells (chessboard) of a cell where pred(i) holds */
  function dilate(P, pred, d) {
    const W = P.W, H = P.H, a = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0, last = -1e9; x < W; x++) { if (pred(y * W + x)) last = x; if (x - last <= d) a[y * W + x] = 1; }
      for (let x = W - 1, last = 1e9; x >= 0; x--) { if (pred(y * W + x)) last = x; if (last - x <= d) a[y * W + x] = 1; }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0, last = -1e9; y < H; y++) { if (a[y * W + x]) last = y; if (y - last <= d) out[y * W + x] = 1; }
      for (let y = H - 1, last = 1e9; y >= 0; y--) { if (a[y * W + x]) last = y; if (last - y <= d) out[y * W + x] = 1; }
    }
    return out;
  }

  /**
   * A little warren round the kept rects: blob rooms on a split of the site
   * outside them, a share `solid` of them left solid, and whatever does not
   * touch the floor at cell `anchor` dropped.
   */
  function fringe(P, rng, keep, solid, anchor) {
    const rects = [];
    for (const r of bsp([0, 0, P.W, P.H], rng, 7, 16, 0.3)) {
      let parts = [r];
      for (const k of keep) parts = [].concat(...parts.map((q) => TG.rsub(q, k)));
      for (const q of parts) if (TG.rshort(q) >= 5 && rng.f() >= solid) rects.push(q);
    }
    K.paintBlobs(P, rects, 'room', ['warren'], rng, { plain: 0.4, onlyVoid: true });
    dropLoose(P, anchor);
  }

  /** is connection c's landing on floor, or beside it? */
  function landed(P, c) {
    const q = c.landing;
    for (let y = q[1] - 1; y <= q[3]; y++) for (let x = q[0] - 1; x <= q[2]; x++) {
      const corner = (x < q[0] || x >= q[2]) && (y < q[1] || y >= q[3]);
      if (!corner && P.own(x, y) >= 0) return true;
    }
    return false;
  }

  /**
   * A straight passage, b cells wide (never wider than the connection), from
   * each connection the layout left in solid to the nearest floor (or to a
   * cell `o.goal` accepts), keeping off cells `o.avoid` marks. With `o.room`
   * it is a b-wide leg of that room instead. Returns the passage ids.
   */
  function linkConns(P, rng, b, o) {
    o = o || {};
    const R = P.R.a, W = P.W, made = [];
    for (const c of P.conns) {
      const q = c.landing;
      if (landed(P, c)) continue;
      const start = [((q[1] + q[3]) >> 1) * W + ((q[0] + q[2]) >> 1)];
      const goal = o.goal || ((i) => R[i] >= 0);
      const free = (i) => P.mask.a[i] === 1 && R[i] === VOID;
      let path = o.avoid ? route(P, start, { ok: (i) => free(i) && !o.avoid[i], goal, turn: o.turn || 8 }) : null;
      if (!path) path = route(P, start, { ok: free, goal: (i) => R[i] >= 0, turn: o.turn || 8 });
      if (!path) continue;
      const v = o.room !== undefined ? o.room : P.add('passage', ['link']);
      paintPath(P, path.slice(0, -1), o.room !== undefined ? b : Math.min(b, c.s1 - c.s0), v);
      made.push(v);
    }
    return made;
  }

  /** runs of room v's outline against solid: { o, c, s0, s1, dir } (dir +1: the room is below / right of the line) */
  function outline(P, v) {
    const out = [];
    for (const s of TG.boundaries(P.R, VOID)) {
      if (s.b === v && s.a < 0) out.push({ o: s.o, c: s.c, s0: s.s0, s1: s.s1, dir: 1 });
      else if (s.a === v && s.b < 0) out.push({ o: s.o, c: s.c, s0: s.s0, s1: s.s1, dir: -1 });
    }
    return out;
  }
  /** cut [t0, t1) of outline run e, d cells deep, out of room v into solid (never near a landing) */
  function edgeNotch(P, v, e, t0, t1, d) {
    const q = e.o === 'h' ? (e.dir > 0 ? [t0, e.c, t1, e.c + d] : [t0, e.c - d, t1, e.c]) : (e.dir > 0 ? [e.c, t0, e.c + d, t1] : [e.c - d, t0, e.c, t1]);
    if (P.hitsLanding([q[0] - 2, q[1] - 2, q[2] + 2, q[3] + 2])) return 0;
    return P.recolor(q, v, VOID);
  }

  /**
   * A partition on line c from s0 to s1; where the walker refuses the whole
   * run, its halves are tried (down to `min` cells), leaving a 0.5 m gap.
   * Returns the pieces placed.
   */
  function partRun(walk, o, c, s0, s1, min) {
    min = min || 4;
    if (s1 - s0 < 2) return 0;
    if (walk.partition(o, c, s0, s1)) return 1;
    if (s1 - s0 < 2 * min + 1) return 0;
    const m = (s0 + s1) >> 1;
    return partRun(walk, o, c, s0, m, min) + partRun(walk, o, c, m + 1, s1, min);
  }

  // ------------------------------------------------------------ loop hall
  FILL.register({
    id: 'loop_hall', tall: true, floors: { gallery: { p: 0.4, rooms: ['hall'] } }, name: 'Loop hall', feel: 'mixed', weight: 3,
    blurb: 'A wide 3-5 m hall in an L, U or ring round a block of 2-4 rooms that open off it, closing into a loop; solid or a little warren outside.',
    doors: { opening: 0.6, door: 0.3, wide: 0.1 }, loops: 0.1,
    fits: (S) => Math.min(...dims(S)) >= 20,
    site: { w: [10, 34], h: [10, 30] },
    layout(P, rng) {
      const I = P.inner, iw = TG.rw(I), ih = TG.rh(I), small = Math.min(iw, ih) < 28;
      // which sides of the block carry the hall: all four, three (a U) or two (an L)
      const form = rng.weighted(small ? { ring: 0.35, U: 0.4, L: 0.25 } : { ring: 0.4, U: 0.35, L: 0.25 }), k0 = rng.int(0, 3);
      const arms = form === 'ring' ? SIDES.slice() : form === 'U' ? SIDES.filter((_, k) => k !== k0) : [SIDES[k0], SIDES[(k0 + 1) % 4]];
      const has = (s) => arms.indexOf(s) >= 0;
      // the hall's arms are 3-5 m wide (down to 2.5 m to fit a small site); the
      // block grows with the site (40-62% of the inner rect, at least 5-6 m by
      // 5 m); solid or warren beyond
      const amin = small ? 5 : 6, amax = small ? 7 : 10, bmin = small ? 10 : 12;
      const base = rng.int(6, amax), bw = {};
      for (const s of SIDES) bw[s] = has(s) ? clamp(base + rng.int(-1, 1), amin, amax) : 0;
      const fit = (a, b, len, need) => { while (len - bw[a] - bw[b] < need && (bw[a] > amin || bw[b] > amin)) { if (bw[a] >= bw[b]) bw[a]--; else bw[b]--; } };
      fit('W', 'E', iw, bmin); fit('N', 'S', ih, 10);
      const ow = clamp(Math.round(iw * rng.range(0.4, 0.62)), bmin, Math.min(28, iw - bw.W - bw.E)), oh = clamp(Math.round(ih * rng.range(0.4, 0.62)), 10, Math.min(26, ih - bw.N - bw.S));
      const O = place(I, rng, ow + bw.W + bw.E, oh + bw.N + bw.S);
      // the block stops short of an open side, so the hall's arms run on past it and the L or U shows
      const B = [O[0] + bw.W, O[1] + bw.N, O[2] - bw.E, O[3] - bw.S];
      const short = (len, min) => Math.max(0, Math.min(rng.int(3, 8), len - min));
      if (!has('N')) B[1] += short(TG.rh(B), 10);
      if (!has('S')) B[3] -= short(TG.rh(B), 10);
      if (!has('W')) B[0] += short(TG.rw(B), bmin);
      if (!has('E')) B[2] -= short(TG.rw(B), bmin);
      const bwd = TG.rw(B), bht = TG.rh(B);
      // the block as a grid of 2-4 rooms; a U needs two along its open side
      const openSide = form === 'U' ? SIDES[k0] : null;
      let cols, rows;
      const n = rng.int(2, 4);
      if (n === 4 && bwd >= 12 && bht >= 12) { cols = 2; rows = 2; }
      else if (n >= 3 && Math.max(bwd, bht) >= 20) { if (bwd >= bht) { cols = 3; rows = 1; } else { cols = 1; rows = 3; } }
      else if (bwd >= bht) { cols = 2; rows = 1; } else { cols = 1; rows = 2; }
      if (openSide === 'N' || openSide === 'S') { if (cols < 2) { cols = 2; rows = bht >= 12 && rng.f() < 0.5 ? 2 : 1; } }
      if (openSide === 'E' || openSide === 'W') { if (rows < 2) { rows = 2; cols = bwd >= 12 && rng.f() < 0.5 ? 2 : 1; } }
      const cuts = (a0, a1, k) => {
        const out = [a0], jit = clamp(Math.floor((a1 - a0) / k) - 5, 0, 2);   // no room under 2.5 m
        for (let j = 1; j < k; j++) out.push(Math.round(a0 + ((a1 - a0) * j) / k) + rng.int(-jit, jit));
        out.push(a1);
        return out;
      };
      const xs = cuts(B[0], B[2], cols), ys = cuts(B[1], B[3], rows), grid = [];
      for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
        const v = P.add('room', ['block']);
        P.paint([xs[ci], ys[ri], xs[ci + 1], ys[ri + 1]], v);
        grid.push({ ci, ri, v });
      }
      const cell = (ci, ri) => grid.find((g) => g.ci === ci && g.ri === ri);
      const hall = P.add('hall', ['loop']), arm = { N: [O[0], O[1], O[2], O[1] + bw.N], S: [O[0], O[3] - bw.S, O[2], O[3]], W: [O[0], O[1], O[0] + bw.W, O[3]], E: [O[2] - bw.E, O[1], O[2], O[3]] };
      for (const s of arms) P.paint(arm[s], hall, true);
      const touches = (g) => (has('N') && g.ri === 0) || (has('S') && g.ri === rows - 1) || (has('W') && g.ci === 0) || (has('E') && g.ci === cols - 1);
      for (const g of grid) if (touches(g)) P.require.push([hall, g.v]);
      if (form !== 'ring') {
        // the hall's free ends, and a chain of rooms between them that keeps to the open sides
        const ends = [];
        for (const s of arms) for (const p of SIDES) {
          if (p === s || p === SIDES[(SIDES.indexOf(s) + 2) % 4] || has(p)) continue;
          const ew = s === 'W' || s === 'E' ? s : p, ns = s === 'N' || s === 'S' ? s : p;
          ends.push(cell(ew === 'W' ? 0 : cols - 1, ns === 'N' ? 0 : rows - 1));
        }
        if (ends.length >= 2 && ends[0] !== ends[1]) {
          const onOpen = (g) => (!has('N') && g.ri === 0) || (!has('S') && g.ri === rows - 1) || (!has('W') && g.ci === 0) || (!has('E') && g.ci === cols - 1);
          const dist = new Map([[ends[0], 0]]), prev = new Map(), todo = [ends[0]];
          while (todo.length) {
            todo.sort((a, b) => dist.get(a) - dist.get(b));
            const g = todo.shift();
            for (const h of grid) {
              if (Math.abs(h.ci - g.ci) + Math.abs(h.ri - g.ri) !== 1) continue;
              const d = dist.get(g) + (onOpen(h) ? 1 : 3);
              if (!dist.has(h) || d < dist.get(h)) { dist.set(h, d); prev.set(h, g); todo.push(h); }
            }
          }
          for (let g = ends[1]; prev.has(g); g = prev.get(g)) P.require.push([prev.get(g).v, g.v]);
        }
      }
      // a little warren off the hall's outer walls; solid against the block's open sides, so the hall reads
      const keep = [O];
      for (const s of SIDES) if (!has(s)) keep.push(s === 'N' ? [O[0] - 4, O[1] - 5, O[2] + 4, O[1]] : s === 'S' ? [O[0] - 4, O[3], O[2] + 4, O[3] + 5] : s === 'W' ? [O[0] - 5, O[1] - 4, O[0], O[3] + 4] : [O[2], O[1] - 4, O[2] + 5, O[3] + 4]);
      if (rng.f() < 0.4) fringe(P, rng, keep, rng.range(0.5, 0.75), P.cells(hall)[0]);
      linkConns(P, rng, 3);
    }
  });

  // ------------------------------------------------------------ cross-pillar hall
  FILL.register({
    id: 'cross_pillars', vertical: { prefer: ['ramp', 'stair', 'ladder'] }, name: 'Cross-pillar hall', feel: 'open', weight: 3,
    blurb: 'A big hall with rows of plus-shaped pillars on a regular grid and a scalloped edge, a tooth in the wall at every pillar line.',
    doors: { opening: 0.6, wide: 0.4 }, loops: 0.3,
    fits: (S) => Math.min(...dims(S)) >= 18,
    site: { w: [9, 40], h: [9, 36] },
    layout(P, rng) {
      const I = P.inner, v = P.add('hall', ['crosses']);
      let H = [0, 0, P.W, P.H];
      const inset = Math.min(TG.rw(I), TG.rh(I)) >= 44 && rng.f() < 0.35;
      if (inset) H = share(P, rng, 0.7, 0.9, 36);
      P.paint(H, v);
      const bb = roomBox(P, v).r;
      // the grid: pluses `span` across, `gap` apart, centred in the hall; at
      // least two rows across the short way (small pluses on a small site)
      const count = (len, span, gap) => Math.floor((len - 2 * (gap + 1) - span) / (span + gap)) + 1, short = Math.min(TG.rw(I), TG.rh(I));
      let t, arm, gap;
      for (let k = 0; k < 8; k++) {
        t = rng.f() < 0.5 ? 1 : 2; arm = t === 1 ? (rng.f() < 0.6 ? 2 : 1) : (rng.f() < 0.7 ? 1 : 2);
        gap = rng.f() < 0.75 ? rng.int(3, 4) : 5;
        if (count(short, 2 * arm + t, gap) >= 2) break;
      }
      if (count(short, 2 * arm + t, gap) < 2) { t = 1; arm = 1; gap = 3; }
      const span = 2 * arm + t, pitch = span + gap, em = gap + 1;
      const line = (a0, a1) => {
        const n = Math.max(1, Math.floor((a1 - a0 - 2 * em - span) / pitch) + 1), out = [];
        const o = a0 + Math.floor((a1 - a0 - ((n - 1) * pitch + span)) / 2);
        for (let k = 0; k < n; k++) out.push(o + k * pitch);
        return out;
      };
      P.crosses = { xs: line(bb[0], bb[2]), ys: line(bb[1], bb[3]), arm, t };
      // scallops: a tooth in every solid wall where a pillar line meets it
      const d = rng.int(1, 2), between = rng.f() < 0.35;
      for (const e of outline(P, v)) {
        const pos = e.o === 'h' ? P.crosses.xs : P.crosses.ys;
        for (const p of pos) {
          const mid = between ? p + span + (gap >> 1) : p + arm, tw = between ? 2 : t + 2;
          const t0 = between ? mid - 1 : mid - 1, t1 = t0 + tw;
          if (t0 >= e.s0 + 2 && t1 <= e.s1 - 2) edgeNotch(P, v, e, t0, t1, d);
        }
      }
      if (inset) fringe(P, rng, [H], rng.range(0.35, 0.6), P.cells(v)[0]);
      linkConns(P, rng, 3);
    },
    furnish(P, walk, rng) {
      const g = P.crosses;
      if (!g) return;
      for (const y of g.ys) for (const x of g.xs) K.plus(walk, x + g.arm, y + g.arm, g.arm, g.t, 2);
    }
  });

  // ------------------------------------------------------------ partition field
  FILL.register({
    id: 'partitions', name: 'Partition field', feel: 'mixed', weight: 3,
    blurb: 'A large room full of free-standing straight, L and T wall pieces at irregular spacing: the classic Level 0 look.',
    doors: { opening: 0.75, door: 0.1, wide: 0.15 }, loops: 0.2,
    fits: (S) => Math.min(...dims(S)) >= 18,
    site: { w: [9, 36], h: [9, 32] },
    layout(P, rng) {
      const small = Math.min(TG.rw(P.inner), TG.rh(P.inner)) < 28;
      const r = cap(share(P, rng, small ? 0.8 : 0.72, 1, small ? 18 : 26), rng, 48), v = P.add('hall', ['field']);
      if (rng.f() < (small ? 0.3 : 0.45)) K.blob(P, r, v, rng, { step: 0.4 }); else P.paint(r, v);
      for (let k = rng.int(0, small ? 1 : 2); k > 0; k--) notch(P, v, r, rng, small ? 6 : 8, 14);
      if (rng.f() < 0.6) fringe(P, rng, [r], rng.range(0.3, 0.6), P.cells(v)[0]);
      linkConns(P, rng, 3);
    },
    furnish(P, walk, rng) {
      const v = mainRoom(P, 'field'), box = v >= 0 && roomBox(P, v);
      if (!box) return;
      // pieces every 4-5.5 m (2.5-3.5 m in a small room), 1.5-4.5 m arms
      const small = TG.rshort(box.r) < 28;
      const r = box.r, g = small ? rng.int(5, 7) : rng.int(8, 11), lo = 3, hi = small ? rng.int(4, 6) : rng.int(6, 9);
      const shapes = { I: rng.range(0.3, 0.45), L: rng.range(0.3, 0.4), T: rng.range(0.15, 0.3) };
      for (let y = r[1] + 2; y < r[3] - 3; y += g) for (let x = r[0] + 2; x < r[2] - 3; x += g) {
        if (rng.f() < 0.12) continue;
        const px = x + rng.int(0, g - 2), py = y + rng.int(0, g - 2);
        if (P.own(px, py) !== v) continue;
        K.wallPiece(walk, r, rng, px, py, rng.weighted(shapes), lo, hi, 3);
      }
    }
  });

  // ------------------------------------------------------------ room maze
  FILL.register({
    id: 'room_maze', name: 'Room maze', feel: 'enclosed', weight: 2,
    blurb: 'One square-ish room packed with short walls on a 1.5-2 m lattice, so it becomes a maze inside a single room.',
    doors: { opening: 0.8, door: 0.2 }, loops: 0.1,
    fits: (S) => Math.min(...dims(S)) >= 18,
    site: { w: [9, 28], h: [9, 26] },
    layout(P, rng) {
      // 11-15 m across, or most of a smaller site (at least 9 m)
      const I = P.inner, mn = Math.min(TG.rw(I), TG.rh(I));
      const side = mn < 26 ? mn - rng.int(0, Math.min(4, mn - 18)) : clamp(rng.int(22, 30), 22, mn);
      const r = place(I, rng, clamp(side + rng.int(-3, 3), 18, TG.rw(I)), clamp(side + rng.int(-3, 3), 18, TG.rh(I)));
      const v = P.add('room', ['maze']);
      P.paint(r, v);
      if (rng.f() < 0.4) fringe(P, rng, [r], rng.range(0.5, 0.75), P.cells(v)[0]);
      linkConns(P, rng, 3);
    },
    furnish(P, walk, rng) {
      const v = mainRoom(P, 'maze');
      if (v < 0) return;
      const r = P.bigRect(v), s = TG.rshort(r) >= 32 && rng.f() < 0.35 ? 4 : 3;
      const nx = Math.floor(TG.rw(r) / s), ny = Math.floor(TG.rh(r) / s);
      if (nx < 3 || ny < 3) return;
      // cell boundaries: the spare cells go to the outer ring of cells
      const bounds = (a0, len, n) => { const o = Math.floor((len - n * s) / 2), out = [a0]; for (let k = 1; k < n; k++) out.push(a0 + o + k * s); out.push(a0 + len); return out; };
      const xb = bounds(r[0], TG.rw(r), nx), yb = bounds(r[1], TG.rh(r), ny);
      // a spanning tree over the cells (growing tree: mostly newest, sometimes random)
      const wv = new Uint8Array((nx - 1) * ny).fill(1), wh = new Uint8Array(nx * (ny - 1)).fill(1);   // wv[j*(nx-1)+i]: on line xb[i+1], row j; wh[j*nx+i]: on line yb[j+1], column i
      const seen = new Uint8Array(nx * ny), live = [rng.int(0, nx * ny - 1)];
      seen[live[0]] = 1;
      const newest = rng.range(0.55, 0.85);
      while (live.length) {
        const k = rng.f() < newest ? live.length - 1 : rng.int(0, live.length - 1), c = live[k], i = c % nx, j = (c - i) / nx;
        const nb = [];
        if (i > 0 && !seen[c - 1]) nb.push([c - 1, 'v', j * (nx - 1) + i - 1]);
        if (i < nx - 1 && !seen[c + 1]) nb.push([c + 1, 'v', j * (nx - 1) + i]);
        if (j > 0 && !seen[c - nx]) nb.push([c - nx, 'h', (j - 1) * nx + i]);
        if (j < ny - 1 && !seen[c + nx]) nb.push([c + nx, 'h', j * nx + i]);
        if (!nb.length) { live.splice(k, 1); continue; }
        const [d, o, w] = nb[rng.int(0, nb.length - 1)];
        if (o === 'v') wv[w] = 0; else wh[w] = 0;
        seen[d] = 1; live.push(d);
      }
      // a few loops, and no four walls meeting at a node (the walker API refuses crossings)
      const braid = rng.range(0.08, 0.2);
      for (let k = 0; k < wv.length; k++) if (wv[k] && rng.f() < braid) wv[k] = 0;
      for (let k = 0; k < wh.length; k++) if (wh[k] && rng.f() < braid) wh[k] = 0;
      // walls off the room's own walls: a depth-first maze leaves long runs along them
      const linked = () => {
        const got = new Uint8Array(nx * ny), st = [0];
        got[0] = 1;
        let n = 1;
        while (st.length) {
          const c = st.pop(), i = c % nx, j = (c - i) / nx;
          const go = (d) => { if (!got[d]) { got[d] = 1; n++; st.push(d); } };
          if (i > 0 && !wv[j * (nx - 1) + i - 1]) go(c - 1);
          if (i < nx - 1 && !wv[j * (nx - 1) + i]) go(c + 1);
          if (j > 0 && !wh[(j - 1) * nx + i]) go(c - nx);
          if (j < ny - 1 && !wh[j * nx + i]) go(c + nx);
        }
        return n === nx * ny;
      };
      const rim = [];
      for (let i = 0; i < nx - 1; i++) rim.push([wv, i], [wv, (ny - 1) * (nx - 1) + i]);
      for (let j = 0; j < ny - 1; j++) rim.push([wh, j * nx], [wh, j * nx + nx - 1]);
      for (const [arr, k] of rim) if (!arr[k] && rng.f() < 0.5) { arr[k] = 1; if (!linked()) arr[k] = 0; }
      for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
        const up = (j - 1) * (nx - 1) + i - 1, dn = j * (nx - 1) + i - 1, lf = (j - 1) * nx + i - 1, rt = (j - 1) * nx + i;
        if (wv[up] && wv[dn] && wh[lf] && wh[rt]) { const q = rng.int(0, 3); if (q === 0) wv[up] = 0; else if (q === 1) wv[dn] = 0; else if (q === 2) wh[lf] = 0; else wh[rt] = 0; }
      }
      // runs of wall along each lattice line, cut into short pieces
      const maxRun = rng.int(2, 4), runs = [];
      const collect = (n, get, line, bnd, o) => {
        let j0 = -1;
        for (let j = 0; j <= n; j++) {
          const on = j < n && get(j);
          if (on && j0 < 0) j0 = j;
          if (!on && j0 >= 0) {
            for (let a = j0; a < j; ) { const len = Math.min(j - a, maxRun); runs.push([o, line, bnd[a], bnd[a + len]]); a += len + 1; }
            j0 = -1;
          }
        }
      };
      for (let i = 0; i < nx - 1; i++) collect(ny, (j) => wv[j * (nx - 1) + i], xb[i + 1], yb, 'v');
      for (let j = 0; j < ny - 1; j++) collect(nx, (i) => wh[j * nx + i], yb[j + 1], xb, 'h');
      for (let k = runs.length - 1; k > 0; k--) { const q = rng.int(0, k); const t = runs[k]; runs[k] = runs[q]; runs[q] = t; }
      for (const [o, c, s0, s1] of runs) partRun(walk, o, c, s0, s1, s);
    }
  });

  // ------------------------------------------------------------ office remnant
  FILL.register({
    id: 'office', tall: true, floors: { gallery: { p: 0.2, rooms: ['hall'] }, sunken: { p: 0.2, rooms: ['hall'], size: [3, 5], depth: [0.45, 0.75] } }, name: 'Office remnant', feel: 'mixed', weight: 2,
    blurb: 'A big room scattered with short partition stubs in loose rows, like cubicles taken out, and a few small offices along one or two edges.',
    doors: { opening: 0.5, door: 0.4, wide: 0.1 }, loops: 0.15,
    fits: (S) => Math.min(...dims(S)) >= 20,
    site: { w: [10, 36], h: [10, 30] },
    layout(P, rng) {
      const I = P.inner, small = Math.min(TG.rw(I), TG.rh(I)) < 28;
      const M = cap(share(P, rng, small ? 0.85 : 0.78, 1, small ? 20 : 28), rng, 56), d = small ? rng.int(5, 6) : rng.int(6, 9);
      // offices along one or two edges of the room, never the whole edge; on a
      // small site along one long edge
      const longX = TG.rw(M) >= TG.rh(M), k0 = small ? (longX ? 0 : 1) + 2 * rng.int(0, 1) : rng.int(0, 3);
      const two = small ? TG.rshort(M) >= 24 && rng.f() < 0.3 : rng.f() < 0.45;
      const sides = two ? [SIDES[k0], SIDES[(k0 + (rng.f() < 0.5 ? 1 : 2)) % 4]] : [SIDES[k0]];
      const offices = [];
      for (const s of sides) {
        const alongX = s === 'N' || s === 'S', a0 = alongX ? M[0] : M[1], a1 = alongX ? M[2] : M[3];
        const end = () => (rng.f() < 0.5 ? 0 : small ? rng.int(3, 5) : rng.int(4, 10));
        const lo = a0 + end(), hi = a1 - end();
        if (hi - lo < (small ? 10 : 12)) continue;
        const strip = s === 'N' ? [lo, M[1], hi, M[1] + d] : s === 'S' ? [lo, M[3] - d, hi, M[3]] : s === 'W' ? [M[0], lo, M[0] + d, hi] : [M[2] - d, lo, M[2], hi];
        // two or more offices, 2.5-5.5 m wide
        const n = Math.max(2, Math.round((hi - lo) / (small ? rng.range(5, 7) : rng.range(6, 11)))), cut = [lo];
        for (let k = 1; k < n; k++) cut.push(Math.round(lo + ((hi - lo) * k) / n) + ((hi - lo) / n >= 7 ? rng.int(-1, 1) : 0));
        cut.push(hi);
        for (let k = 0; k < n; k++) {
          const o = P.add('room', ['office']), q = alongX ? [cut[k], strip[1], cut[k + 1], strip[3]] : [strip[0], cut[k], strip[2], cut[k + 1]];
          if (P.paint(q, o, true)) offices.push(o);
        }
      }
      const main = P.add('hall', ['open-office']);
      P.paint(M, main, true);
      const gone = rng.range(0, 0.2);
      for (const o of offices) {
        const cells = P.cells(o);
        if (rng.f() < gone && !cells.some((i) => P.land[i])) for (const i of cells) P.R.a[i] = VOID;
      }
      for (const o of offices) P.require.push([main, o]);
      if (rng.f() < 0.5) fringe(P, rng, [M], rng.range(0.4, 0.65), P.cells(main)[0]);
      linkConns(P, rng, 3);
    },
    furnish(P, walk, rng) {
      const v = mainRoom(P, 'open-office');
      if (v < 0) return;
      const room = P.bigRect(v), alongX = TG.rw(room) >= TG.rh(room);
      const r = place(room, rng, rng.int(36, 50), rng.int(30, 42));
      const A0 = alongX ? r[0] : r[1], A1 = alongX ? r[2] : r[3], C0 = alongX ? r[1] : r[0], C1 = alongX ? r[3] : r[2];
      const ro = alongX ? 'h' : 'v', dO = alongX ? 'v' : 'h';
      // rows of cubicle dividers straddling a row line, an aisle between rows
      // (tighter in a small room)
      const small = C1 - C0 < 22, mg = small ? 2 : 3;
      const half = small ? 2 : rng.int(2, 3), aisle = small ? rng.int(3, 4) : rng.int(4, 6), pitch = 2 * half + aisle, cw = small ? rng.int(4, 5) : rng.int(5, 6);
      for (let c = C0 + half + mg + rng.int(0, 2); c + half + mg <= C1; c += pitch + rng.int(-1, 1)) {
        let prev = -1;
        for (let a = A0 + mg + rng.int(0, 2); a <= A1 - mg; a += cw + (rng.f() < 0.3 ? 1 : 0)) {
          if (rng.f() < 0.3) { prev = -1; continue; }
          const jc = c + rng.int(-1, 1) * (rng.f() < 0.3 ? 1 : 0), up = rng.f() < 0.15 ? 0 : half, dn = rng.f() < 0.15 ? 0 : half;
          if (up + dn < 2) { prev = -1; continue; }
          const ok = walk.partition(dO, a, jc - up, jc + dn);
          if (ok && prev >= 0 && rng.f() < 0.22) walk.partition(ro, c, prev, a);
          prev = ok && jc === c && up && dn ? a : -1;
        }
      }
      if (rng.f() < 0.3) for (let k = rng.int(1, 2); k > 0; k--) K.column(walk, r, rng);
    }
  });

  // ------------------------------------------------------------ aisles
  /** the rows of an aisle room: [{ c, segs: [[s0, s1]] }] across rect r, every `pitch` cells, with gaps */
  function aisleRows(rng, r, alongX, pitch, t, endGap) {
    const A0 = alongX ? r[0] : r[1], A1 = alongX ? r[2] : r[3], C0 = alongX ? r[1] : r[0], C1 = alongX ? r[3] : r[2];
    const first = Math.max(3, pitch - t), n = Math.floor((C1 - C0 - 2 * first + pitch - t) / pitch);
    const off = C0 + Math.floor((C1 - C0 - ((n - 1) * pitch + t)) / 2), rows = [];
    const cross = rng.f() < 0.6 ? A0 + Math.round((A1 - A0) * rng.range(0.3, 0.7)) : -1;
    for (let k = 0; k < n; k++) {
      const c = off + k * pitch;
      const s0 = A0 + (rng.f() < 0.5 ? 0 : endGap + rng.int(0, 1)), s1 = A1 - (rng.f() < 0.5 ? 0 : endGap + rng.int(0, 1));
      const gaps = [];
      if (cross >= 0) gaps.push(cross + rng.int(-1, 1));
      for (let g = rng.int(s0 === A0 && s1 === A1 && cross < 0 ? 1 : 0, 2); g > 0; g--) gaps.push(rng.int(s0 + 4, s1 - 6));
      gaps.sort((p, q) => p - q);
      const segs = [];
      let a = s0;
      for (const g of gaps) { const gw = 3; if (g - a >= 3) segs.push([a, g]); a = Math.max(a, g + gw); }
      if (s1 - a >= 3) segs.push([a, s1]);
      rows.push({ c, segs });
    }
    return rows;
  }
  FILL.register({
    id: 'aisles', name: 'Aisles', feel: 'mixed', weight: 1,
    blurb: 'A room crossed by long parallel walls (partitions or thin solid) with gaps to cross between them, like shelving rows.',
    doors: { opening: 0.75, door: 0.1, wide: 0.15 }, loops: 0.15,
    fits: (S) => Math.min(...dims(S)) >= 18,
    site: { w: [9, 30], h: [9, 26] },
    layout(P, rng) {
      const r = share(P, rng, 0.75, 1, 18), v = P.add('hall', ['aisles']);
      P.paint(r, v);
      const alongX = TG.rw(r) >= TG.rh(r), solid = rng.f() < 0.5;
      P.aisles = { solid, alongX };
      if (solid) {
        const t = rng.int(1, 2), pitch = t + rng.int(4, 5);
        for (const { c, segs } of aisleRows(rng, r, alongX, pitch, t, 3)) for (const [s0, s1] of segs) P.recolor(alongX ? [s0, c, s1, c + t] : [c, s0, c + t, s1], v, VOID);
      }
      if (rng.f() < 0.55) fringe(P, rng, [r], rng.range(0.3, 0.6), P.cells(v)[0]);
      const avoid = new Uint8Array(P.W * P.H);
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) avoid[y * P.W + x] = 1;
      linkConns(P, rng, 3, { avoid });
    },
    furnish(P, walk, rng) {
      const v = mainRoom(P, 'aisles');
      if (v < 0 || !P.aisles || P.aisles.solid) return;
      const r = P.bigRect(v), alongX = TG.rw(r) >= TG.rh(r), o = alongX ? 'h' : 'v';
      for (const { c, segs } of aisleRows(rng, r, alongX, rng.int(4, 5), 0, 2)) for (const [s0, s1] of segs) partRun(walk, o, c, s0, s1, 4);
    }
  });

  // ------------------------------------------------------------ scattered pillars
  FILL.register({
    id: 'scattered_pillars', tall: true, floors: { gallery: { p: 0.2, rooms: ['hall'] }, sunken: { p: 0.25, rooms: ['hall'], size: [3.5, 6], depth: [0.6, 1.2] } }, name: 'Scattered pillars', feel: 'open', weight: 2,
    blurb: 'A big room with small 0.5-1 m pillars at random, non-grid spacing, thicker in places, and a notched edge.',
    doors: { opening: 0.65, wide: 0.35 }, loops: 0.3,
    fits: (S) => Math.min(...dims(S)) >= 18,
    site: { w: [9, 36], h: [9, 32] },
    layout(P, rng) {
      const I = P.inner, v = P.add('hall', ['scatter']), small = Math.min(TG.rw(I), TG.rh(I)) < 28;
      let H = [0, 0, P.W, P.H];
      const inset = Math.min(TG.rw(I), TG.rh(I)) >= 40 && rng.f() < 0.3;
      if (inset) H = share(P, rng, 0.72, 0.9, 32);
      P.paint(H, v);
      // the notched edge: small irregular notches all along the solid walls
      for (const e of outline(P, v)) {
        for (let t = e.s0 + rng.int(2, small ? 5 : 8); t < e.s1 - 5; ) {
          const w = rng.int(2, small ? 4 : 6), d = rng.int(1, small ? 2 : 3);
          if (t + w <= e.s1 - 2 && rng.f() < 0.65) edgeNotch(P, v, e, t, t + w, d);
          t += w + rng.int(3, small ? 8 : 12);
        }
      }
      for (let k = small ? 0 : rng.int(0, 2); k > 0; k--) notch(P, v, H, rng, 10, 16);
      if (inset) fringe(P, rng, [H], rng.range(0.35, 0.6), P.cells(v)[0]);
      linkConns(P, rng, 3);
    },
    furnish(P, walk, rng) {
      const v = mainRoom(P, 'scatter'), box = v >= 0 && roomBox(P, v);
      if (!box) return;
      const r = box.r, want = Math.round(box.n / rng.int(40, 70)), minD = TG.rshort(r) < 28 ? rng.int(4, 5) : rng.int(4, 7);
      const dense = noiseField(P, P.seed ^ 0x5ca7, rng.range(8, 14)), placed = [];
      for (let tries = 0; tries < want * 8 && placed.length < want; tries++) {
        const x = rng.int(r[0] + 2, r[2] - 3), y = rng.int(r[1] + 2, r[3] - 3);
        if (P.own(x, y) !== v || (dense[y * P.W + x] < 0.45 && rng.f() < 0.85)) continue;
        const s = rng.f() < 0.55 ? 1 : 2;
        if (placed.some((p) => Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y)) < minD)) continue;
        if (walk.column([x, y, x + s, y + s], 2)) placed.push([x, y]);
      }
      if (rng.f() < 0.4) for (let k = rng.int(1, 2); k > 0; k--) K.wallPiece(walk, r, rng, rng.int(r[0] + 4, r[2] - 5), rng.int(r[1] + 4, r[3] - 5), 'I', 2, 5, 3);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
