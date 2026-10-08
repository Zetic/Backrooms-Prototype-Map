/*
 * tpl/fillers/corridors.js - corridor-led fillers: the long thin passages of
 * the reference maps, and the rooms hung on them.
 *
 * Each layout lays its corridors first and aims them at the connections (a
 * straight spur from each landing that does not already touch the floor,
 * see `reach`), and only then packs rooms along them, so the engine has
 * little to bridge. Everything else stays solid. Units are kit cells (0.5 m).
 *
 *   corridor_rooms  an empty office or hotel floor: one or two corridors,
 *                   small rooms and closets packed along both sides
 *   doors_nowhere   a hall lined with doors, most onto 1 m closets or tiny
 *                   dead ends, one or two onto a real room
 *   beads           small rooms strung on a thin wandering corridor
 *   comb            a corridor with a row of dead-end teeth down one side
 *   long_hall       a narrow hall the length of the site, one or two turns,
 *                   hardly a door
 *   stair_step      a corridor stepping diagonally across in 1-2 m jogs
 *   switchback      a corridor folding back and forth on itself
 *   corridor_loop   a ring corridor round a solid block, spurs out
 *   tunnels         branching tunnels of mixed widths, each branch ending
 *                   in a small room
 *
 * All enclosed; together they weigh 23 of the pool's 70 enclosed.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL;
  const { VOID, paintPath, noiseField } = FILL.lib;
  const K = FILL.kit;
  const dims = (S) => [TG.rw(S.inner), TG.rh(S.inner)];
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ============================================================ shared helpers
  const at = (P, x, y) => y * P.W + x;
  const xy = (P, i) => { const x = i % P.W; return [x, (i - x) / P.W]; };
  /** the middle cell of a connection's landing */
  const mid = (P, c) => at(P, (c.landing[0] + c.landing[2] - 1) >> 1, (c.landing[1] + c.landing[3] - 1) >> 1);
  const grow = (r, k) => [r[0] - k, r[1] - k, r[2] + k, r[3] + k];

  /** every cell of r is site and solid */
  function clear(P, r) {
    if (!TG.rvalid(r)) return false;
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (P.own(x, y) !== VOID) return false;
    return true;
  }
  /** no built cell in r (cells off the site are fine) */
  function unbuilt(P, r) {
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (P.own(x, y) >= 0) return false;
    return true;
  }
  /** share of r that is site */
  function inSiteShare(P, r) {
    let n = 0;
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (P.inSite(x, y)) n++;
    return n / Math.max(1, TG.rarea(r));
  }
  /** does rect q, or a cell beside it, hold a room that passes test? */
  function touches(P, q, test) {
    for (let y = q[1] - 1; y <= q[3]; y++) for (let x = q[0] - 1; x <= q[2]; x++) {
      if ((x < q[0] || x >= q[2]) && (y < q[1] || y >= q[3])) continue;
      const o = P.own(x, y);
      if (o >= 0 && test(o)) return true;
    }
    return false;
  }

  /** steps (4-way, over the site) from the seed cells; -1 where it never gets */
  function bfs(P, seeds) {
    const W = P.W, N = W * P.H, d = new Int32Array(N).fill(-1), q = [];
    for (const i of seeds) if (d[i] < 0) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= N || d[j] >= 0 || P.mask.a[j] !== 1) continue;
        d[j] = d[i] + 1; q.push(j);
      }
    }
    return d;
  }
  /** steps from each site cell to the outline (1 on the edge row) */
  function edgeDist(P) {
    const seeds = [];
    for (let i = 0; i < P.W * P.H; i++) {
      if (P.mask.a[i] !== 1) continue;
      const [x, y] = xy(P, i);
      if (!P.inSite(x - 1, y) || !P.inSite(x + 1, y) || !P.inSite(x, y - 1) || !P.inSite(x, y + 1)) seeds.push(i);
    }
    const d = bfs(P, seeds);
    for (let i = 0; i < d.length; i++) if (d[i] >= 0) d[i]++;
    return d;
  }

  /**
   * Cheapest 4-way path from the start cells to a goal cell, as lib.route
   * (cell indices, start and goal included, or null), but on typed arrays
   * with a bucket queue, which keeps the many routes these layouts make
   * cheap. ok, goal: Uint8Array per cell; cost: extra cost per cell entered
   * (in steps, or null); turn: the cost of a bend (steps).
   */
  function fastRoute(P, starts, ok, goal, cost, turn) {
    const W = P.W, H = P.H, N = W * H, U = 4, T = Math.round((turn || 0) * U);
    const dist = new Int32Array(N * 5).fill(0x7fffffff), prev = new Int32Array(N * 5).fill(-1), q = [];
    const step = cost ? new Int32Array(N) : null;
    if (cost) for (let i = 0; i < N; i++) step[i] = U + Math.round(cost[i] * U);
    const push = (d, s) => { (q[d] || (q[d] = [])).push(s); };
    for (const i of starts) { dist[i * 5 + 4] = 0; push(0, i * 5 + 4); }
    for (let d = 0; d < q.length; d++) {
      const b = q[d];
      if (!b) continue;
      for (let k = 0; k < b.length; k++) {
        const s = b[k];
        if (dist[s] !== d) continue;
        const i = (s / 5) | 0, dir = s - i * 5;
        if (dir !== 4 && goal[i]) {
          const path = [];
          for (let t = s; t >= 0; t = prev[t]) path.push((t / 5) | 0);
          return path.reverse();
        }
        const x = i % W;
        for (let e = 0; e < 4; e++) {
          let j;
          if (e === 0) { if (x + 1 >= W) continue; j = i + 1; } else if (e === 1) { j = i + W; if (j >= N) continue; } else if (e === 2) { if (x === 0) continue; j = i - 1; } else { j = i - W; if (j < 0) continue; }
          if (!ok[j] && !goal[j]) continue;
          const nd = d + (step ? step[j] : U) + (dir !== 4 && dir !== e ? T : 0), t = j * 5 + e;
          if (nd < dist[t]) { dist[t] = nd; prev[t] = s; push(nd, t); }
        }
      }
      q[d] = null;
    }
    return null;
  }
  /** per-cell flags: built floor of a room `test` accepts */
  function floorOf(P, test) {
    const R = P.R.a, f = new Uint8Array(R.length);
    for (let i = 0; i < R.length; i++) if (R[i] >= 0 && test(R[i])) f[i] = 1;
    return f;
  }
  /** per-cell flags: solid site cells (not marked in block) */
  function solidOf(P, block) {
    const R = P.R.a, f = new Uint8Array(R.length);
    for (let i = 0; i < R.length; i++) if (P.mask.a[i] === 1 && R[i] === VOID && !(block && block[i])) f[i] = 1;
    return f;
  }

  /**
   * A cost field for routes: noise (times nw), plus a toll on cells within
   * k of a built cell of a room `isT` rejects, so routes keep solid between
   * themselves and other rooms where they can.
   */
  function keepOff(P, isT, k, noise, nw) {
    const W = P.W, H = P.H, R = P.R.a, f = new Float32Array(W * H);
    if (noise) for (let i = 0; i < f.length; i++) f[i] = noise[i] * nw;
    if (k > 0) {
      // dilate the other rooms' cells by k: along rows, then along columns (prefix counts)
      const row = new Uint8Array(W * H), near = new Uint8Array(W * H), pre = new Int32Array(Math.max(W, H) + 1);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) { const v = R[y * W + x]; pre[x + 1] = pre[x] + (v >= 0 && !isT(v) ? 1 : 0); }
        for (let x = 0; x < W; x++) if (pre[Math.min(W, x + k + 1)] - pre[Math.max(0, x - k)] > 0) row[y * W + x] = 1;
      }
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) pre[y + 1] = pre[y] + row[y * W + x];
        for (let y = 0; y < H; y++) if (pre[Math.min(H, y + k + 1)] - pre[Math.max(0, y - k)] > 0) near[y * W + x] = 1;
      }
      for (let i = 0; i < f.length; i++) if (near[i]) f[i] += 4;
    }
    return f;
  }

  /**
   * A spur from each connection to the floor of the rooms `isT` accepts:
   * the cheapest, straightest route from the middle of its landing through
   * solid, painted b cells wide (at most the connection's width) as room v
   * (or v(c)). Landings that already touch built floor are left alone (the
   * engine joins them); cells `o.block` marks are never entered.
   */
  function reach(P, isT, b, v, o) {
    o = o || {};
    const out = [];
    for (const c of P.conns) {
      if (touches(P, c.landing, () => true)) continue;
      const cost = keepOff(P, isT, o.keep === undefined ? 2 : o.keep, o.noise, o.noiseW || 0);
      const path = fastRoute(P, [mid(P, c)], solidOf(P, o.block), floorOf(P, isT), cost, o.turn === undefined ? 6 : o.turn);
      if (!path) continue;
      const id = typeof v === 'function' ? v(c) : v;
      paintPath(P, path.slice(0, -1), Math.max(2, Math.min(b, c.s1 - c.s0)), id);
      out.push({ c, path, id });
    }
    return out;
  }

  /**
   * A path of cells through waypoints [x, y]: straight lines where the
   * site allows, else routed round with as few turns as it can. Waypoints
   * off the site are skipped.
   */
  function legs(P, pts, ok) {
    ok = ok || P.mask.a;
    const out = [];
    let cur = -1;
    for (const p of pts) {
      if (!P.inSite(p[0], p[1])) continue;
      const g = at(P, p[0], p[1]);
      if (cur < 0) { cur = g; out.push(g); continue; }
      if (g === cur) continue;
      const [cx, cy] = xy(P, cur);
      let seg = null;
      if (cx === p[0] || cy === p[1]) {
        seg = [];
        const dx = Math.sign(p[0] - cx), dy = Math.sign(p[1] - cy);
        for (let x = cx, y = cy; x !== p[0] || y !== p[1];) {
          x += dx; y += dy;
          const i = at(P, x, y);
          if (!ok[i]) { seg = null; break; }
          seg.push(i);
        }
      }
      if (!seg) {
        const goal = new Uint8Array(P.W * P.H);
        goal[g] = 1;
        const r = fastRoute(P, [cur], ok, goal, null, 20);
        if (!r) continue;
        seg = r.slice(1);
      }
      for (const i of seg) out.push(i);
      cur = g;
    }
    return out;
  }

  // ------------------------------------------------------------ straight corridors
  // A segment is a straight corridor band: along [a0, a1), across [c0, c1).
  const segRect = (s) => (s.alongX ? [s.a0, s.c0, s.a1, s.c1] : [s.c0, s.a0, s.c1, s.a1]);
  const cellOf = (s, a, c) => (s.alongX ? [a, c] : [c, a]);
  /** the across line k cells out from side `side` (-1 / +1) of segment s */
  const outC = (s, side, k) => (side > 0 ? s.c1 + k : s.c0 - 1 - k);
  /** columns [a, b) on that side of s, from k0 to k1 cells out */
  function band(s, side, a, b, k0, k1) {
    const c0 = side > 0 ? s.c1 + k0 : s.c0 - k1, c1 = side > 0 ? s.c1 + k1 : s.c0 - k0;
    return s.alongX ? [a, c0, b, c1] : [c0, a, c1, b];
  }
  /** longest run along the axis where every cell across [c0, c1) is site: [a0, a1) */
  function runAt(P, alongX, c0, c1) {
    const A = alongX ? P.W : P.H;
    let r = [0, 0], t = -1;
    for (let a = 0; a <= A; a++) {
      let ok = a < A;
      for (let c = c0; c < c1 && ok; c++) ok = alongX ? P.inSite(a, c) : P.inSite(c, a);
      if (ok && t < 0) t = a;
      if (!ok && t >= 0) { if (a - t > r[1] - r[0]) r = [t, a]; t = -1; }
    }
    return r;
  }
  /**
   * A straight corridor band cw wide along one axis, where the site gives it
   * its longest run, near `want` (0-1) across the inner rect (or [lo, hi)).
   */
  function spine(P, rng, alongX, cw, want, lo, hi) {
    const I = P.inner;
    lo = lo === undefined ? (alongX ? I[1] : I[0]) : lo;
    hi = hi === undefined ? (alongX ? I[3] : I[2]) : hi;
    const target = lo + Math.max(0, hi - lo - cw) * want;
    let best = null, bs = -Infinity;
    for (let c = lo; c + cw <= hi; c++) {
      const r = runAt(P, alongX, c, c + cw), sc = r[1] - r[0] - Math.abs(c - target) * 0.75 + rng.f();
      if (r[1] > r[0] && sc > bs) { bs = sc; best = { alongX, a0: r[0], a1: r[1], c0: c, c1: c + cw }; }
    }
    if (!best) {
      const c = clamp(Math.round(target), 0, (alongX ? P.H : P.W) - cw);
      best = { alongX, a0: alongX ? I[0] : I[1], a1: alongX ? I[2] : I[3], c0: c, c1: c + cw };
    }
    return best;
  }
  /** columns of side `side` of s where corridor v runs and the first `need` cells out are solid site: [[a, b)] */
  function freeRuns(P, s, side, v, need) {
    const out = [];
    let t = -1;
    for (let a = s.a0; a <= s.a1; a++) {
      let ok = a < s.a1;
      if (ok) { const p = cellOf(s, a, side > 0 ? s.c1 - 1 : s.c0); ok = P.own(p[0], p[1]) === v; }
      for (let k = 0; k < need && ok; k++) { const p = cellOf(s, a, outC(s, side, k)); ok = P.own(p[0], p[1]) === VOID; }
      if (ok && t < 0) t = a;
      if (!ok && t >= 0) { out.push([t, a]); t = -1; }
    }
    return out;
  }
  /** how deep (up to max cells, from k0) columns [a, b) on that side of s stay solid site */
  function depthFree(P, s, side, a, b, max, k0) {
    k0 = k0 || 0;
    for (let k = k0; k < k0 + max; k++) for (let t = a; t < b; t++) { const p = cellOf(s, t, outC(s, side, k)); if (P.own(p[0], p[1]) !== VOID) return k - k0; }
    return max;
  }

  /**
   * A room of w0-w1 by d0-d1 cells on solid beside room v, touching it along
   * 2 cells or more and nothing else; required to v. Returns its id or -1.
   */
  function hang(P, rng, v, w0, w1, d0, d1, type, tags) {
    const cells = P.cells(v);
    for (let tries = 0; tries < 40 && cells.length; tries++) {
      const i = cells[rng.int(0, cells.length - 1)], x = i % P.W, y = (i - x) / P.W;
      const [dx, dy] = DIRS[rng.int(0, 3)];
      if (P.own(x + dx, y + dy) !== VOID) continue;
      const w = rng.int(w0, w1), d = rng.int(d0, d1), off = rng.int(0, w - 2);
      let r;
      if (dx) { const x0 = dx > 0 ? x + 1 : x - d; r = [x0, y - off, x0 + d, y - off + w]; }
      else { const y0 = dy > 0 ? y + 1 : y - d; r = [x - off, y0, x - off + w, y0 + d]; }
      if (!clear(P, r) || touches(P, r, (o) => o !== v)) continue;
      let n = 0;
      for (let t = 0; t < w; t++) {
        const p = dx ? [dx > 0 ? r[0] - 1 : r[2], r[1] + t] : [r[0] + t, dy > 0 ? r[1] - 1 : r[3]];
        if (P.own(p[0], p[1]) === v) n++;
      }
      if (n < 2) continue;
      const u = P.add(type, tags);
      P.paint(r, u);
      P.require.push([v, u]);
      return u;
    }
    return -1;
  }

  /**
   * Corridors cw wide out into the parts of the site more than `far` cells
   * from corridor v (the legs of an L or U site): along each part's long
   * axis from its far end until it meets v, or with a cross corridor over
   * to v when it runs alongside. Painted as v; returns the new segments.
   */
  function arms(P, rng, v, cw, far, max) {
    const W = P.W, N = W * P.H, out = [];
    for (let k = 0; k < (max || 2); k++) {
      const d = bfs(P, P.cells(v)), lab = new Int32Array(N).fill(-1);
      let best = null;
      for (let i = 0; i < N; i++) {
        if (d[i] <= far || lab[i] >= 0) continue;
        const st = [i], b = [Infinity, Infinity, -Infinity, -Infinity];
        let n = 0;
        lab[i] = i;
        while (st.length) {
          const j = st.pop(), [x, y] = xy(P, j);
          n++;
          b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x + 1); b[3] = Math.max(b[3], y + 1);
          for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy, t = ny * W + nx;
            if (nx >= 0 && ny >= 0 && nx < W && ny < P.H && d[t] > far && lab[t] < 0) { lab[t] = i; st.push(t); }
          }
        }
        if (!best || n > best.n) best = { n, b };
      }
      if (!best || best.n < 2 * far * far || TG.rshort(best.b) < far) break;
      const b = best.b, alongX = TG.rw(b) >= TG.rh(b);
      const c = (alongX ? (b[1] + b[3]) >> 1 : (b[0] + b[2]) >> 1) - (cw >> 1) + rng.int(-2, 2);
      const lo = alongX ? b[0] : b[1], hi = (alongX ? b[2] : b[3]) - 1;
      const dAt = (a) => { const p = alongX ? [a, c] : [c, a]; return P.inSite(p[0], p[1]) ? d[at(P, p[0], p[1])] : -1; };
      const dir = dAt(lo) >= dAt(hi) ? 1 : -1, start = dir > 0 ? lo : hi;
      const cellsAt = (a) => { const r = []; for (let q = c; q < c + cw; q++) r.push(alongX ? [a, q] : [q, a]); return r; };
      let a = start, hit = false;
      for (;; a += dir) {
        const cs = cellsAt(a);
        if (cs.some((p) => !P.inSite(p[0], p[1]))) { a -= dir; break; }
        if (cs.some((p) => P.own(p[0], p[1]) === v)) { hit = true; break; }
      }
      if ((a - start) * dir < 4) break;
      const seg = { alongX, a0: Math.min(start, a), a1: Math.max(start, a) + 1, c0: c, c1: c + cw };
      P.paint(segRect(seg), v);
      out.push(seg);
      if (hit) continue;
      // alongside: a cross corridor from its middle over to v, the shorter way
      const t = (seg.a0 + seg.a1 - cw) >> 1;
      let link = null;
      for (const sd of [-1, 1]) {
        for (let q = sd > 0 ? c + cw : c - 1, n = 0; n < 60; q += sd, n++) {
          const row = []; for (let u = t; u < t + cw; u++) row.push(alongX ? [u, q] : [q, u]);
          if (row.some((p) => !P.inSite(p[0], p[1]))) break;
          if (row.some((p) => P.own(p[0], p[1]) === v)) { if (!link || n < link.n) link = { n, s: { alongX: !alongX, a0: sd > 0 ? c + cw : q + 1, a1: sd > 0 ? q : c, c0: t, c1: t + cw } }; break; }
        }
      }
      if (link && link.n > 0) P.paint(segRect(link.s), v);
    }
    return out;
  }

  /**
   * A small room in rect r (solid cells only): kit.blob's overlapping
   * rectangles from 4 m up; under that, with chance p, a corner notch at
   * least 1 m each way cut out (an L), so small rooms are not all boxes.
   */
  function smallRoom(P, rng, r, v, p) {
    const w = TG.rw(r), h = TG.rh(r);
    if (Math.min(w, h) >= 8) return K.blob(P, r, v, rng, { plain: 1 - p, onlyVoid: true });
    const n = P.paint(r, v, true);
    if (w >= 6 && h >= 6 && rng.f() < p) {
      const nx = rng.int(2, w - 4), ny = rng.int(2, h - 4), x0 = rng.f() < 0.5 ? r[0] : r[2] - nx, y0 = rng.f() < 0.5 ? r[1] : r[3] - ny;
      P.recolor([x0, y0, x0 + nx, y0 + ny], v, VOID);
    }
    return n;
  }

  /** a site cell far from all built floor and at least `edge` from the outline, or -1 */
  function farPoint(P, rng, dE, edge, min) {
    const seeds = [];
    for (let i = 0; i < P.R.a.length; i++) if (P.R.a[i] >= 0) seeds.push(i);
    const d = seeds.length ? bfs(P, seeds) : null;
    let best = -1, bs = -Infinity;
    for (let i = 0; i < P.R.a.length; i++) {
      if (dE[i] < edge || P.R.a[i] !== VOID) continue;
      const di = d ? (d[i] < 0 ? 999 : d[i]) : 50;
      if (di < min) continue;
      const s = Math.min(di, 30) + rng.f() * 6;
      if (s > bs) { bs = s; best = i; }
    }
    return best;
  }

  // ============================================================ corridor with rooms
  /** rooms and closets packed along side `side` of corridor segment s, up to maxD deep */
  function packSide(P, rng, s, side, hall, maxD) {
    let solid = false;
    for (const [a, b] of freeRuns(P, s, side, hall, 3)) {
      let t = a;
      while (b - t >= 3) {
        // now and then a slot left solid, never two running
        if (!solid && b - t >= 12 && rng.f() < 0.08) { solid = true; t += rng.int(3, 6); continue; }
        solid = false;
        const small = rng.f() < 0.25 || maxD < 5;
        let w = small ? rng.int(3, 4) : rng.int(5, 10);
        if (b - t - w < 3) w = b - t;
        if (w > 12) w = w >> 1;
        const dmax = depthFree(P, s, side, t, t + w, Math.min(maxD, small ? 5 : maxD));
        const d = Math.min(dmax, small ? rng.int(3, 5) : rng.int(5, Math.max(5, maxD)));
        if (d >= 3 && w * d >= 9) {
          const v = P.add(small || d < 5 ? 'closet' : 'room', ['office']);
          P.paint(band(s, side, t, t + w, 0, d), v);
          P.require.push([hall, v]);
        }
        t += w;
      }
    }
  }

  FILL.register({
    id: 'corridor_rooms', biomes: ['houseroom'], name: 'Corridor with rooms', feel: 'enclosed', weight: 4,
    blurb: 'One or two long 1-1.5 m corridors with small rooms and closets packed along both sides, like an empty office or hotel floor.',
    doors: { door: 0.8, opening: 0.2 }, loops: 0.04,
    fits: (S) => Math.min(...dims(S)) >= 14 && Math.max(...dims(S)) >= 20,
    site: { w: [14, 32], h: [10, 24] },
    layout(P, rng) {
      const I = P.inner, alongX = TG.rw(I) >= TG.rh(I);
      const IA0 = alongX ? I[0] : I[1], IA1 = alongX ? I[2] : I[3], C0 = alongX ? I[1] : I[0], C1 = alongX ? I[3] : I[2], C = C1 - C0;
      const cw = rng.int(2, 3), D = 10, hall = P.add('passage', ['corridor']);
      const segs = [], sides = [], ends = [];
      if (C >= 2 * cw + 32 && rng.f() < 0.6) {
        // two parallel corridors, rooms back to back between them, joined by a cross corridor
        const midB = rng.int(12, Math.min(20, C - 2 * cw - 12)), rest = C - 2 * cw - midB;
        const o0 = clamp((rest >> 1) + rng.int(-3, 3), Math.min(6, rest >> 1), rest - Math.min(6, rest >> 1));
        const c1 = C0 + o0, c2 = c1 + cw + midB;
        const r1 = runAt(P, alongX, c1, c1 + cw), r2 = runAt(P, alongX, c2, c2 + cw);
        const s1 = { alongX, a0: r1[0], a1: r1[1], c0: c1, c1: c1 + cw }, s2 = { alongX, a0: r2[0], a1: r2[1], c0: c2, c1: c2 + cw };
        const lo = Math.max(s1.a0, s2.a0, IA0), hi = Math.min(s1.a1, s2.a1, IA1);
        const t = hi - lo < cw + 16 || rng.f() < 0.35 ? (rng.f() < 0.5 ? lo : hi - cw) : rng.int(lo + 6, hi - cw - 6);
        segs.push(s1, s2, { alongX: !alongX, a0: c1, a1: c2 + cw, c0: t, c1: t + cw });
        sides.push([s1, -1, D], [s1, 1, midB >> 1], [s2, -1, midB - (midB >> 1)], [s2, 1, D]);
      } else if (C >= cw + 34 && IA1 - IA0 >= 28 && rng.f() < 0.7) {
        // a corridor near one side and a branch off it into the deep side: a T, or an L
        const side = rng.f() < 0.5 ? -1 : 1;
        const s = spine(P, rng, alongX, cw, side > 0 ? rng.range(0.15, 0.3) : rng.range(0.7, 0.85));
        const lo = Math.max(s.a0, IA0), hi = Math.min(s.a1, IA1);
        const atEnd = rng.f() < 0.4, t = atEnd ? (rng.f() < 0.5 ? lo + rng.int(0, 2) : hi - cw - rng.int(0, 2)) : rng.int(lo + 8, hi - cw - 8);
        if (atEnd) { if (t < (lo + hi) / 2) s.a0 = t; else s.a1 = t + cw; }
        const br = side > 0 ? { alongX: !alongX, a0: s.c1, a1: C1, c0: t, c1: t + cw } : { alongX: !alongX, a0: C0, a1: s.c0, c0: t, c1: t + cw };
        segs.push(s, br);
        sides.push([s, -1, D], [s, 1, D], [br, -1, D], [br, 1, D]);
        if (!atEnd) ends.push([s, rng.f() < 0.5]);
      } else {
        const s = spine(P, rng, alongX, cw, rng.range(0.4, 0.6));
        let jog = null;
        if (s.a1 - s.a0 >= 30 && rng.f() < 0.4) {
          const J = s.a0 + Math.round((s.a1 - s.a0) * rng.range(0.35, 0.65)), sh = (rng.f() < 0.5 ? -1 : 1) * rng.int(cw + 1, cw + 4);
          const c0 = s.c0 + sh, r = runAt(P, alongX, c0, c0 + cw);
          if (c0 - C0 >= 5 && C1 - c0 - cw >= 5 && r[0] <= J && r[1] >= s.a1) {
            jog = [{ alongX, a0: s.a0, a1: J + cw, c0: s.c0, c1: s.c1 }, { alongX, a0: J, a1: s.a1, c0, c1: c0 + cw },
              { alongX: !alongX, a0: Math.min(s.c0, c0), a1: Math.max(s.c1, c0 + cw), c0: J, c1: J + cw }];
          }
        }
        if (jog) {
          segs.push(...jog);
          sides.push([jog[0], -1, D], [jog[0], 1, D], [jog[1], -1, D], [jog[1], 1, D]);
          if (rng.f() < 0.4) ends.push([jog[rng.f() < 0.5 ? 0 : 1], null]);
        } else {
          segs.push(s);
          sides.push([s, -1, D], [s, 1, D]);
          for (const hiEnd of [false, true]) if (rng.f() < 0.35) ends.push([s, hiEnd]);
        }
      }
      // a room across the end of a corridor now and then
      const endRooms = [];
      for (const [s, hiEnd0] of ends) {
        const hiEnd = hiEnd0 === null ? s.a1 > (IA0 + IA1) / 2 : hiEnd0, e = rng.int(5, 8);
        if (s.a1 - s.a0 < e + 16) continue;
        const k0 = rng.int(0, 5), k1 = rng.int(0, 5);
        const a0 = hiEnd ? s.a1 - e : s.a0, a1 = hiEnd ? s.a1 : s.a0 + e;
        if (hiEnd) s.a1 -= e; else s.a0 += e;
        endRooms.push(s.alongX ? [a0, s.c0 - k0, a1, s.c1 + k1] : [s.c0 - k0, a0, s.c1 + k1, a1]);
      }
      for (const s of segs) P.paint(segRect(s), hall);
      // the far legs of an L or U site get a corridor of their own
      for (const s of arms(P, rng, hall, cw, D + 3, 2)) sides.push([s, -1, D], [s, 1, D]);
      for (const r of endRooms) { const v = P.add('room', ['office', 'end']); if (P.paint(r, v, true)) P.require.push([hall, v]); }
      reach(P, (v) => v === hall, cw, hall, { turn: 10, keep: 0 });
      for (const [s, side, d] of sides) packSide(P, rng, s, side, hall, d);
    }
  });

  // ============================================================ doors to nowhere
  FILL.register({
    id: 'doors_nowhere', biomes: ['houseroom'], name: 'Doors to nowhere', feel: 'enclosed', weight: 2,
    blurb: 'A 1.5-2.5 m hall lined with doors on both sides; most open onto 1 m closets or tiny dead ends, one or two onto a real room.',
    doors: { door: 1 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 12 && Math.max(...dims(S)) >= 20,
    site: { w: [12, 26], h: [8, 16] },
    layout(P, rng) {
      const I = P.inner, alongX = TG.rw(I) >= TG.rh(I);
      const hw = rng.int(3, 5), hall = P.add('passage', ['doors']);
      const s = spine(P, rng, alongX, hw, rng.range(0.35, 0.65));
      P.paint(segRect(s), hall);
      const legs2 = arms(P, rng, hall, hw, 10, 1);
      reach(P, (v) => v === hall, Math.min(hw, 3), hall, { turn: 10, keep: 0 });
      // one or two doors lead on: a closet, and a real room behind it
      const lead = rng.f() < 0.6 ? 1 : 2;
      for (let k = 0, tries = 0; k < lead && tries < 16; tries++) {
        const side = rng.f() < 0.5 ? -1 : 1, w = rng.int(2, 3), vd = 3;
        if (s.a1 - s.a0 < w + 4) break;
        const a = rng.int(s.a0 + 2, s.a1 - w - 2);
        if (depthFree(P, s, side, a - 1, a + w + 1, vd) < vd) continue;
        const rw = rng.int(6, 12), ra = a + (w >> 1) - (rw >> 1) + rng.int(-2, 2);
        const rd = Math.min(rng.int(6, 10), depthFree(P, s, side, ra, ra + rw, 10, vd));
        if (rd < 5) continue;
        const ves = P.add('closet', ['doors', 'vestibule']), room = P.add('room', ['doors', 'beyond']);
        P.paint(band(s, side, a, a + w, 0, vd), ves);
        const r = band(s, side, ra, ra + rw, vd, vd + rd);
        if (TG.rshort(r) >= 8 && rng.f() < 0.6) K.blob(P, r, room, rng, { plain: 0.2 }); else P.paint(r, room);
        P.require.push([hall, ves], [ves, room]);
        k++;
      }
      // the rest: a door every metre or so, onto 1.5 m closets, shallow
      // cupboards and the odd tiny dead end (a room under 2 m² would be
      // merged away, so a closet is 1.5 x 1.5 m, or 1 x 2 m)
      const pw = rng.f() < 0.75 ? 3 : 2, gap = rng.int(1, 2);
      for (const sg of [s].concat(legs2)) for (const side of [-1, 1]) for (const [a, b] of freeRuns(P, sg, side, hall, 2)) {
        let t = a + rng.int(0, gap);
        while (t + 2 <= b) {
          const r = rng.f();
          let w = pw, d = pw === 2 ? 4 : 3, type = 'closet';
          if (r < 0.08) { w = 2; d = rng.int(5, 7); type = 'alcove'; } else if (r < 0.24) { w = 4; d = 2; } else if (r < 0.28) { t += pw + gap; continue; }
          if (t + w > b) { w = b - t; d = w === 2 ? 4 : 3; }
          const fd = depthFree(P, sg, side, t, t + w, d);
          if (fd >= 2 && w * fd >= 8) {
            const v = P.add(type, ['doors', type === 'alcove' ? 'dead-end' : 'closet']);
            P.paint(band(sg, side, t, t + w, 0, Math.min(d, fd)), v);
            P.require.push([hall, v]);
          }
          t += w + gap;
        }
      }
    }
  });

  // ============================================================ beads on a string
  /** the two ends of the string: the connections farthest apart, or the far ends of the site */
  function farEnds(P, rng) {
    const I = P.inner, alongX = TG.rw(I) >= TG.rh(I);
    const pts = P.conns.map((c) => mid(P, c));
    const dist = (i, j) => { const a = xy(P, i), b = xy(P, j); return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); };
    let best = null, bd = -1;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (dist(pts[i], pts[j]) > bd) { bd = dist(pts[i], pts[j]); best = [pts[i], pts[j]]; }
    if (best && bd >= 0.6 * Math.max(P.W, P.H)) return best;
    // connections close together (or none): the string runs out to the far end of the site
    const inset = (a, c) => (alongX ? at(P, a, c) : at(P, c, a));
    const A0 = alongX ? I[0] : I[1], A1 = alongX ? I[2] : I[3], C0 = alongX ? I[1] : I[0], C1 = alongX ? I[3] : I[2];
    const cA = () => rng.int(C0 + Math.min(3, (C1 - C0) >> 2), C1 - 1 - Math.min(3, (C1 - C0) >> 2));
    const e0 = inset(A0 + 2, cA()), e1 = inset(A1 - 3, cA());
    if (!pts.length) return rng.f() < 0.5 ? [e0, e1] : [e1, e0];
    let far = [pts[0], e0], fd = -1;
    for (const p of pts) for (const e of [e0, e1]) if (dist(p, e) > fd) { fd = dist(p, e); far = [p, e]; }
    return far;
  }

  /**
   * Beads on path (cell indices): rooms 4-8 cells a side centred on path
   * cells every few metres, with solid between them, and the path between
   * them painted cw wide as passages, each required to the beads either
   * side. o: { first (index of the first bead), end (a bead at the end) }.
   */
  function string(P, rng, path, cw, o) {
    o = o || {};
    const W = P.W, n = path.length, beads = [];
    if (!n) return;
    // on a narrow site (under 12 m) the beads are smaller and closer, so the string still shows
    const small = TG.rshort(P.inner) < 24, B = small ? 6 : 8;
    const inR = (r, i) => { const x = i % W, y = (i - x) / W; return x >= r[0] && x < r[2] && y >= r[1] && y < r[3]; };
    const fits = (r, k) => {
      if (inSiteShare(P, r) < 0.75 || !unbuilt(P, grow(r, 2))) return false;
      for (const b of beads) if (TG.roverlap(grow(r, 2), b.r)) return false;
      const near = grow(r, 2), span = TG.rw(r) + TG.rh(r);
      for (let j = 0; j < n; j++) if (Math.abs(j - k) > span && inR(near, path[j])) return false;
      return true;
    };
    const bead = (k) => {
      // a bead stands out from the string: at least 1.5 m wider than it across the path
      const [x, y] = xy(P, path[k]), q = xy(P, path[Math.min(n - 1, k + 1)]), p = xy(P, path[Math.max(0, k - 1)]);
      const horiz = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]), across = rng.int(Math.min(B, cw + 3), B), along = rng.int(4, B);
      const bw = horiz ? along : across, bh = horiz ? across : along;
      const r = [x - (bw >> 1), y - (bh >> 1), x - (bw >> 1) + bw, y - (bh >> 1) + bh];
      return fits(r, k) ? r : null;
    };
    let k = o.first === undefined ? rng.int(3, 7) : o.first;
    while (k < n - (small ? 5 : 7)) {
      const r = bead(k);
      if (!r) { k++; continue; }
      beads.push({ r, k });
      while (k < n && inR(r, path[k])) k++;
      k += small ? rng.int(2, 4) + 2 : rng.int(2, 6) + 3;
    }
    if (o.end && n > 4) {
      const r = bead(n - 1);
      if (r) beads.push({ r, k: n - 1 });
    }
    const ids = new Set();
    for (const b of beads) {
      const v = P.add(TG.rarea(b.r) <= 30 ? 'cell' : 'room', ['bead']);
      smallRoom(P, rng, b.r, v, 0.35);
      ids.add(v);
    }
    // the corridor between the beads, one passage per stretch
    let seg = -1, cells = [], prev = -1;
    const flush = (next) => {
      if (seg < 0) return;
      paintPath(P, cells, cw, seg);
      if (prev >= 0) P.require.push([prev, seg]);
      if (next >= 0) P.require.push([seg, next]);
      seg = -1; cells = [];
    };
    for (let j = 0; j < n; j++) {
      const own = P.R.a[path[j]];
      if (ids.has(own)) { flush(own); prev = own; continue; }
      if (own !== VOID && own !== seg) { flush(-1); prev = -1; continue; }
      if (seg < 0) seg = P.add('passage', ['string']);
      cells.push(path[j]);
    }
    flush(-1);
  }

  FILL.register({
    id: 'beads', biomes: ['houseroom'], name: 'Beads on a string', feel: 'enclosed', weight: 4,
    blurb: 'A 1-1.5 m corridor wandering across the site with small 2-4 m rooms hung on it like beads: it runs in one side of each and out the other.',
    doors: { opening: 0.8, door: 0.2 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 10 && Math.max(...dims(S)) >= 20,
    site: { w: [12, 30], h: [10, 24] },
    layout(P, rng) {
      const cw = rng.int(2, 3), dE = edgeDist(P), nz = noiseField(P, P.seed, rng.range(5, 9));
      const cost = new Float32Array(P.W * P.H);
      for (let i = 0; i < cost.length; i++) cost[i] = nz[i] * 8 + (dE[i] > 0 && dE[i] < 5 ? (5 - dE[i]) * 1.5 : 0);
      const [s, e] = farEnds(P, rng), N = P.W * P.H, I = P.inner;
      const to = (i) => { const g = new Uint8Array(N); g[i] = 1; return g; };
      let path = null;
      const [sx, sy] = xy(P, s), [ex, ey] = xy(P, e), near = Math.abs(sx - ex) + Math.abs(sy - ey) < 0.8 * (P.W + P.H);
      if (rng.f() < (near ? 0.9 : 0.5)) {
        // by way of the part of the site farthest from both ends, so it wanders over the site
        const k = Math.min(4, TG.rshort(I) >> 2);
        let m = -1, bs = -1;
        for (let y = I[1] + k; y < I[3] - k; y++) for (let x = I[0] + k; x < I[2] - k; x++) {
          const sc = Math.min(Math.abs(x - sx) + Math.abs(y - sy), Math.abs(x - ex) + Math.abs(y - ey)) + rng.f() * 10;
          if (sc > bs) { bs = sc; m = at(P, x, y); }
        }
        // the way there keeps away from the other end, and the way on clear of the way there
        const via = (a, b) => {
          const [bx, by] = xy(P, b), D = (P.W + P.H) >> 2, c1 = cost.slice();
          for (let i = 0; i < N; i++) { const x = i % P.W, d = Math.abs(x - bx) + Math.abs((i - x) / P.W - by); if (d < D) c1[i] += (D - d) * 0.8; }
          const p1 = fastRoute(P, [a], P.mask.a, to(m), c1, 3);
          if (!p1) return null;
          const ok = P.mask.a.slice(), R0 = cw + 3;
          for (let j = 0; j < p1.length - R0 - 3; j++) {
            const [x, y] = xy(P, p1[j]);
            for (let yy = Math.max(0, y - R0); yy <= Math.min(P.H - 1, y + R0); yy++) for (let xx = Math.max(0, x - R0); xx <= Math.min(P.W - 1, x + R0); xx++) ok[yy * P.W + xx] = 0;
          }
          const p2 = fastRoute(P, [m], ok, to(b), cost, 3);
          return p2 ? p1.concat(p2.slice(1)) : null;
        };
        if (m >= 0 && P.mask.a[m]) {
          path = via(s, e);
          if (!path) { path = via(e, s); if (path) path.reverse(); }
        }
      }
      if (!path) path = fastRoute(P, [s], P.mask.a, to(e), cost, 3);
      if (path) string(P, rng, path, cw, { end: !P.conns.some((c) => mid(P, c) === e) });
      const any = () => true;
      // the other connections join it on a spur, with a bead on a long one
      for (const c of P.conns) {
        if (touches(P, c.landing, any)) continue;
        const p = fastRoute(P, [mid(P, c)], solidOf(P), floorOf(P, any), keepOff(P, () => false, 3, nz, 6), 4);
        if (p) string(P, rng, p.slice(0, -1), cw, { first: p.length > 20 ? rng.int(5, 8) : p.length });
      }
      // a big site gets a dead-end string out to a last bead
      if (P.site.area > 900 && rng.f() < 0.6) {
        const f = farPoint(P, rng, dE, 4, 12);
        if (f >= 0) {
          const p = fastRoute(P, [f], solidOf(P), floorOf(P, any), keepOff(P, () => false, 3, nz, 6), 4);
          if (p) string(P, rng, p.slice(0, -1).reverse(), cw, { first: rng.int(4, 7), end: true });
        }
      }
    }
  });

  // ============================================================ comb
  FILL.register({
    id: 'comb', name: 'Comb corridor', feel: 'enclosed', weight: 2,
    blurb: 'A corridor with a row of short parallel dead-end stubs or 1 m alcoves down one side, ending nowhere.',
    doors: { opening: 0.8, door: 0.2 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 10 && Math.max(...dims(S)) >= 16,
    site: { w: [10, 26], h: [7, 16] },
    layout(P, rng) {
      const I = P.inner, alongX = TG.rw(I) >= TG.rh(I), cw = rng.int(2, 3);
      const C0 = alongX ? I[1] : I[0], C1 = alongX ? I[3] : I[2];
      // the teeth face away from the connections where they can, so the spurs from
      // the connections do not cut through them (side > 0: teeth towards +c)
      const across = (sd) => P.conns.filter((c) => c.side === (alongX ? (sd > 0 ? 'S' : 'N') : (sd > 0 ? 'E' : 'W'))).length;
      const nA = across(1), nB = across(-1);
      const side = nA !== nB && rng.f() < 0.8 ? (nA < nB ? 1 : -1) : rng.f() < 0.5 ? -1 : 1, v = P.add('passage', ['comb']);
      const s = spine(P, rng, alongX, cw, side > 0 ? rng.range(0, 0.25) : rng.range(0.75, 1));
      P.paint(segRect(s), v);
      // the teeth: 1 m stubs 2.5-6 m long, or (mostly where there is little room) 1-2 m alcoves
      const room = side > 0 ? C1 - s.c1 : s.c0 - C0;
      const alc = rng.f() < (room < 9 ? 0.5 : 0.1), tw = alc ? rng.int(2, 3) : (rng.f() < 0.75 ? 2 : 3), gap = rng.int(2, 3);
      const len = alc ? rng.int(3, 4) : clamp(rng.int(5, 12), 2, Math.max(2, room - 1));
      // along all of it, or a stretch (on a long spine, and never fewer than four teeth)
      const L = s.a1 - s.a0, pitch = tw + gap;
      const span = rng.f() < 0.7 || L < 32 ? L : Math.max(Math.min(L, 4 * pitch), Math.round(L * rng.range(0.55, 0.85)));
      const t0 = s.a0 + rng.int(0, L - span), t1 = t0 + span;
      // a gap in the teeth in front of each connection they face, for its spur to come straight in
      const facing = alongX ? (side > 0 ? 'S' : 'N') : (side > 0 ? 'E' : 'W');
      const skip = P.conns.filter((c) => c.side === facing).map((c) => [c.s0 - 1, c.s1 + 1]);
      for (const [a, b] of freeRuns(P, s, side, v, 2)) {
        let t = Math.max(a, t0) + rng.int(0, 1);
        while (t + tw <= Math.min(b, t1)) {
          const z = skip.find((q) => t < q[1] && q[0] < t + tw);
          if (z) { t = z[1]; continue; }
          let l = alc || rng.f() >= 0.08 ? len : len - rng.int(1, Math.max(1, len - 3));
          l = Math.min(l, depthFree(P, s, side, t, t + tw, l));
          if (l >= 2) P.paint(band(s, side, t, t + tw, 0, l), v);
          t += tw + gap;
        }
      }
      // the connections last: a spur from across the teeth joins a tooth's tip
      reach(P, (u) => u === v, cw, v, { turn: 10, keep: 0 });
    }
  });

  // ============================================================ long hallway
  FILL.register({
    id: 'long_hall', name: 'Long hallway', feel: 'enclosed', weight: 2,
    blurb: 'A narrow 1-1.5 m hall running the length of the site with one or two turns and hardly a door, solid all round.',
    doors: { door: 0.6, opening: 0.4 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 8 && Math.max(...dims(S)) >= 20,
    site: { w: [16, 40], h: [8, 22] },
    layout(P, rng) {
      // the hall's axis and rows come from the whole site, not the inner rect, so on
      // an L or U it runs the site's full length (rows are bands cw wide, as painted)
      const alongX = P.W >= P.H, cw = rng.int(2, 3);
      const hall = P.add('passage', ['long']);
      const CL = alongX ? P.H : P.W;
      const pt = (a, c) => (alongX ? [a, c] : [c, a]);
      const ac = (i) => { const p = xy(P, i); return alongX ? p : [p[1], p[0]]; };
      const inS = (a, c) => P.inSite(...pt(a, c));
      const lowSide = alongX ? 'W' : 'N', highSide = alongX ? 'E' : 'S', sideLo = alongX ? 'N' : 'W', sideHi = alongX ? 'S' : 'E';
      const pick = (sides) => { const cs = P.conns.filter((c) => sides.indexOf(c.side) >= 0); return cs.length ? cs[rng.int(0, cs.length - 1)] : null; };
      const any = (cs) => cs[rng.int(0, cs.length - 1)];
      const runs = [];
      let lo = 1e9, hi = -1, best = 0;
      for (let c = 2; c <= CL - cw; c++) {
        const r = runs[c] = runAt(P, alongX, c - 1, c + cw - 1);
        if (r[1] - r[0] >= 4) { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); best = Math.max(best, r[1] - r[0]); }
      }
      const rows = (f) => { const out = []; for (let c = 2; c <= CL - cw; c++) if (runs[c][1] - runs[c][0] >= 4 && f(c, runs[c])) out.push(c); return out; };
      if (!best) return;
      const endOf = (c, atHi) => [atHi ? runs[c][1] - 1 : runs[c][0], c];
      const reachesLo = (r, k) => r[0] <= lo + k, reachesHi = (r, k) => r[1] >= hi - k;
      const flip = rng.f() < 0.5, zig = rng.f() < 0.6;  // which end it starts from; Z or L
      const startC = pick([flip ? highSide : lowSide]);
      // a free start sits at the end of a row that reaches the site's end (for an L, a full-length row)
      let starts = rows((c, r) => (flip ? reachesHi(r, 2) : reachesLo(r, 2)) && (zig || r[1] - r[0] >= best - 3));
      if (!starts.length) starts = rows((c, r) => (flip ? reachesHi(r, 2) : reachesLo(r, 2)));
      let S = startC ? ac(mid(P, startC)) : endOf(any(starts), flip);
      let pts;
      if (zig) {
        // a Z: along, across, along
        const endC = pick([flip ? lowSide : highSide]);
        let E;
        if (endC) E = ac(mid(P, endC));
        else {
          const far = (r, k) => (flip ? reachesLo(r, k) : reachesHi(r, k));
          let cs = rows((c, r) => far(r, 2) && Math.abs(c - S[1]) >= cw + 3);
          if (!cs.length) cs = rows((c, r) => far(r, 8) && Math.abs(c - S[1]) >= cw + 3);
          if (!cs.length) cs = rows((c, r) => far(r, 2));
          E = endOf(any(cs), !flip);
        }
        // the cross leg goes where it stays inside the site, nearest a turn 30-70% along
        const c0 = Math.min(S[1], E[1]), c1 = Math.max(S[1], E[1]);
        const okT = (a) => { for (let c = c0 - 1; c < c1 + cw - 1; c++) for (let k = -1; k < cw - 1; k++) if (!inS(a + k, c)) return false; return true; };
        let t = Math.round(S[0] + (E[0] - S[0]) * rng.range(0.3, 0.7));
        if (!okT(t)) {
          let bt = -1;
          for (let a = Math.min(S[0], E[0]) + 2; a <= Math.max(S[0], E[0]) - 2; a++) if (okT(a) && (bt < 0 || Math.abs(a - t) < Math.abs(bt - t))) bt = a;
          if (bt >= 0) t = bt;
        }
        pts = [S, [t, S[1]], [t, E[1]], E];
      } else {
        // an L: nearly the whole length, then off to one side
        const far = (c) => Math.abs(ac(mid(P, c))[0] - S[0]) >= 0.6 * (hi - lo);
        const scs = P.conns.filter((c) => (c.side === sideLo || c.side === sideHi) && far(c)), sc = scs.length ? scs[rng.int(0, scs.length - 1)] : null;
        let E;
        if (sc) {
          E = ac(mid(P, sc));
          // a free start keeps away from the end's row, so the turn is a real one
          if (!startC && Math.abs(E[1] - S[1]) < cw + 6) { const cs = starts.filter((c) => Math.abs(c - E[1]) >= cw + 6); if (cs.length) S = endOf(any(cs), flip); }
        } else {
          // run along the start's row, then turn to whichever side is deeper there
          const r = runAt(P, alongX, S[1] - 1, S[1] + cw - 1), d = flip ? -1 : 1;
          let a = S[0];
          if (a < r[0] || a >= r[1]) { while (inS(a + d, S[1])) a += d; } else a = flip ? r[0] : r[1] - 1;
          const t = Math.round(S[0] + (a - S[0]) * rng.range(0.75, 0.92));
          let up = S[1], dn = S[1];
          while (inS(t, up - 1)) up--;
          while (inS(t, dn + 1)) dn++;
          const toHi = dn - S[1] === S[1] - up ? rng.f() < 0.5 : dn - S[1] > S[1] - up;
          E = [t, toHi ? dn : up];
        }
        pts = [S, [E[0], S[1]], E];
      }
      const path = legs(P, pts.map((p) => pt(p[0], p[1])));
      paintPath(P, path, cw, hall);
      reach(P, (v) => v === hall, cw, hall, { turn: 12 });
      // a room or two at most, and now and then a dead-end stub
      const nr = rng.weighted({ 0: 0.3, 1: 0.5, 2: 0.2 });
      const sm = TG.rshort(P.inner) < 24;          // under 12 m: smaller rooms, so the hall still leads
      for (let k = 0; k < +nr; k++) hang(P, rng, hall, sm ? 5 : 6, sm ? 8 : 12, sm ? 4 : 5, sm ? 7 : 10, 'room', ['long']);
      if (rng.f() < 0.25) K.stub(P, hall, rng, cw, rng.int(4, 10));
    }
  });

  // ============================================================ stair-step corridor
  FILL.register({
    id: 'stair_step', name: 'Stair-step corridor', feel: 'enclosed', weight: 2,
    blurb: 'A corridor that steps diagonally across the site in 1-2 m jogs, a staircase of short runs, sometimes with a room at one end.',
    doors: { opening: 0.75, door: 0.25 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 12 && Math.max(...dims(S)) >= 16,
    site: { w: [10, 26], h: [10, 22] },
    layout(P, rng) {
      const I = P.inner, cw = rng.int(2, 3), v = P.add('passage', ['stairs']);
      const x0 = I[0] + 1, x1 = I[2] - 2, y0 = I[1] + 1, y1 = I[3] - 2;
      // the diagonal whose ends sit nearest the connections
      const ends = [[[x0, y0], [x1, y1]], [[x1, y0], [x0, y1]]];
      const score = (e) => P.conns.reduce((s, c) => { const p = xy(P, mid(P, c)); return s + Math.min(...e.map((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]))); }, 0);
      let di = score(ends[0]) <= score(ends[1]) ? 0 : 1;
      if (!P.conns.length || rng.f() < 0.25) di = rng.f() < 0.5 ? 0 : 1;
      let [S, E] = ends[di];
      if (rng.f() < 0.5) [S, E] = [E, S];
      const sx = Math.sign(E[0] - S[0]) || 1, sy = Math.sign(E[1] - S[1]) || 1;
      const dx = Math.abs(E[0] - S[0]), dy = Math.abs(E[1] - S[1]), wide = dx >= dy;
      const Lg = wide ? dx : dy, Sh = wide ? dy : dx;
      // steps of 1-2 m each way, as steep as the site; straight runs make up the rest of the length
      const ratio = Lg / Math.max(1, Sh), lg = ratio >= 1.6 ? 4 : rng.int(3, 4), sh = clamp(Math.round(lg / ratio), 2, 4);
      let n = Math.max(2, Math.floor(Sh / sh));
      if (n * lg > Lg) n = Math.max(2, Math.floor(Lg / lg));
      const lead = Math.max(0, Lg - n * lg), leadIn = rng.int(0, lead), rest = Math.max(0, Sh - n * sh);
      const mv = (p, l, s) => (wide ? [p[0] + sx * l, p[1] + sy * s] : [p[0] + sx * s, p[1] + sy * l]);
      const pts = [S];
      let p = mv(S, leadIn, 0);
      pts.push(p);
      const longFirst = rng.f() < 0.5;
      for (let k = 0; k < n; k++) {
        const l = lg + (rng.f() < 0.2 ? rng.int(-1, 1) : 0), s = sh + (k < rest ? 1 : 0);
        if (longFirst) { p = mv(p, l, 0); pts.push(p); p = mv(p, 0, s); pts.push(p); } else { p = mv(p, 0, s); pts.push(p); p = mv(p, l, 0); pts.push(p); }
      }
      pts.push(mv(p, lead - leadIn, 0));
      // sometimes a room at one end
      if (rng.f() < 0.5) {
        const q = rng.f() < 0.5 ? pts[0] : pts[pts.length - 1], w = rng.int(6, 10), h = rng.int(6, 10);
        const rx = clamp(q[0] - (w >> 1), I[0], I[2] - w), ry = clamp(q[1] - (h >> 1), I[1], I[3] - h), r = [rx, ry, rx + w, ry + h];
        const u = P.add('room', ['stairs', 'end']);
        if (TG.rshort(r) >= 8 && rng.f() < 0.5) K.blob(P, r, u, rng, { plain: 0.3 }); else P.paint(r, u);
        P.require.push([v, u]);
      }
      paintPath(P, legs(P, pts), cw, v);
      reach(P, (u) => u === v, cw, v, { turn: 8 });
    }
  });

  // ============================================================ switchback
  FILL.register({
    id: 'switchback', name: 'Switchback', feel: 'enclosed', weight: 2,
    blurb: 'A corridor folding back and forth on itself, its runs side by side with thin solid between, so crossing a small site takes far too long.',
    doors: { opening: 0.85, door: 0.15 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 10 && Math.max(...dims(S)) >= 16,
    site: { w: [10, 22], h: [8, 18] },
    layout(P, rng) {
      const I = P.inner, alongX = TG.rw(I) >= TG.rh(I);
      const cw = rng.int(2, 3), g = rng.f() < 0.55 ? 2 : 1;
      const A0 = alongX ? I[0] : I[1], A1 = alongX ? I[2] : I[3], C0 = alongX ? I[1] : I[0], C1 = alongX ? I[3] : I[2];
      const n = Math.max(1, Math.floor((C1 - C0 + g) / (cw + g))), used = n * cw + (n - 1) * g, off = C0 + rng.int(0, C1 - C0 - used);
      const rect = (a0, a1, c0, c1) => (alongX ? [a0, c0, a1, c1] : [c0, a0, c1, a1]);
      const cOf = (j) => off + j * (cw + g);
      // fold j turns at the high end when (j + phase) is even; pick the phase
      // that puts the two loose ends nearest the connections
      const hiTurn = (j, ph) => (j + ph) % 2 === 0;
      const loose = (ph) => {
        const e0 = hiTurn(0, ph) ? A0 : A1 - 1, e1 = n > 1 ? (hiTurn(n - 2, ph) ? A0 : A1 - 1) : (e0 === A0 ? A1 - 1 : A0);
        return [[e0, cOf(0) + (cw >> 1)], [e1, cOf(n - 1) + (cw >> 1)]].map((q) => (alongX ? q : [q[1], q[0]]));
      };
      const score = (ph) => P.conns.reduce((s, c) => { const p = xy(P, mid(P, c)); return s + Math.min(...loose(ph).map((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]))); }, 0);
      let ph = score(0) <= score(1) ? 0 : 1;
      if (!P.conns.length || rng.f() < 0.2) ph = rng.int(0, 1);
      const v = P.add('passage', ['switchback']);
      for (let j = 0; j < n; j++) P.paint(rect(A0, A1, cOf(j), cOf(j) + cw), v);
      for (let j = 0; j + 1 < n; j++) P.paint(hiTurn(j, ph) ? rect(A1 - cw, A1, cOf(j) + cw, cOf(j + 1)) : rect(A0, A0 + cw, cOf(j) + cw, cOf(j + 1)), v);
      // a landing that would bridge two folds gets a vestibule of its own, with one way in
      const FB = rect(A0, A1, off, off + used), block = new Uint8Array(P.W * P.H);
      for (let y = FB[1]; y < FB[3]; y++) for (let x = FB[0]; x < FB[2]; x++) block[y * P.W + x] = 1;
      for (const c of P.conns) {
        const q = c.landing;
        let gap = false;
        for (let y = q[1]; y < q[3] && !gap; y++) for (let x = q[0]; x < q[2]; x++) if (block[y * P.W + x] && P.own(x, y) === VOID) { gap = true; break; }
        if (gap) P.paint(q, P.add('passage', ['landing']));
      }
      reach(P, (u) => u === v, cw, v, { turn: 8, block });
    }
  });

  // ============================================================ corridor loop
  FILL.register({
    id: 'corridor_loop', name: 'Corridor loop', feel: 'enclosed', weight: 2,
    blurb: 'A narrow 1-1.5 m corridor running round a solid block, square or stepped, with a spur or two out to the connections and sometimes a closet in the block.',
    doors: { opening: 0.7, door: 0.3 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 14,
    site: { w: [10, 24], h: [10, 20] },
    layout(P, rng) {
      const I = P.inner, iw = TG.rw(I), ih = TG.rh(I), cw = rng.int(2, 3), W = P.W;
      const minO = 2 * cw + 6;
      const ow = clamp(iw - rng.int(2, Math.max(2, Math.round(iw * 0.45))), Math.min(minO, iw), iw);
      const oh = clamp(ih - rng.int(2, Math.max(2, Math.round(ih * 0.45))), Math.min(minO, ih), ih);
      const ox = I[0] + rng.int(0, iw - ow), oy = I[1] + rng.int(0, ih - oh), o = [ox, oy, ox + ow, oy + oh];
      const reg = new Uint8Array(W * P.H);
      for (let y = o[1]; y < o[3]; y++) for (let x = o[0]; x < o[2]; x++) reg[y * W + x] = 1;
      // stepped: a corner or two cut out of the ring's outline
      if (rng.f() < 0.45) {
        const two = rng.f() < 0.35, corners = [0, 1, 2, 3];
        for (let i = 3; i > 0; i--) { const j = rng.int(0, i); [corners[i], corners[j]] = [corners[j], corners[i]]; }
        for (let k = 0; k < (two ? 2 : 1); k++) {
          const mx = Math.floor((ow - 2 * cw - 6) / (two ? 2 : 1)), my = Math.floor((oh - 2 * cw - 6) / (two ? 2 : 1));
          if (mx < cw + 2 || my < cw + 2) break;
          const nx = rng.int(cw + 2, mx), ny = rng.int(cw + 2, my), cn = corners[k];
          const x0 = cn & 1 ? o[2] - nx : o[0], y0 = cn & 2 ? o[3] - ny : o[1];
          for (let y = y0; y < y0 + ny; y++) for (let x = x0; x < x0 + nx; x++) reg[y * W + x] = 0;
        }
      }
      const isReg = (x, y) => x >= 0 && y >= 0 && x < W && y < P.H && reg[y * W + x] === 1;
      const core = (x, y) => { for (let dy = -cw; dy <= cw; dy++) for (let dx = -cw; dx <= cw; dx++) if (!isReg(x + dx, y + dy)) return false; return true; };
      const ring = P.add('passage', ['ring']), coreCells = [];
      for (let y = o[1]; y < o[3]; y++) for (let x = o[0]; x < o[2]; x++) {
        if (!reg[y * W + x]) continue;
        if (core(x, y)) coreCells.push(y * W + x); else P.paint([x, y, x + 1, y + 1], ring);
      }
      // sometimes a closet in the block, against the ring
      if (coreCells.length && rng.f() < 0.35) {
        const kb = [Infinity, Infinity, -Infinity, -Infinity];
        for (const i of coreCells) { const [x, y] = xy(P, i); kb[0] = Math.min(kb[0], x); kb[1] = Math.min(kb[1], y); kb[2] = Math.max(kb[2], x + 1); kb[3] = Math.max(kb[3], y + 1); }
        const inCore = (r) => { for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (!isReg(x, y) || !core(x, y)) return false; return true; };
        for (let tries = 0; tries < 10; tries++) {
          const w = rng.int(3, 5), d = rng.int(3, 4), sd = rng.int(0, 3);
          if (TG.rw(kb) < w + 3 || TG.rh(kb) < d + 3) break;
          const a = sd < 2 ? rng.int(kb[0], kb[2] - w) : rng.int(kb[1], kb[3] - w);
          const r = sd === 0 ? [a, kb[1], a + w, kb[1] + d] : sd === 1 ? [a, kb[3] - d, a + w, kb[3]] : sd === 2 ? [kb[0], a, kb[0] + d, a + w] : [kb[2] - d, a, kb[2], a + w];
          if (!inCore(r)) continue;
          const u = P.add('closet', ['ring', 'core']);
          P.paint(r, u);
          P.require.push([ring, u]);
          break;
        }
      }
      reach(P, (u) => u === ring, cw, ring, { turn: 8 });
      // with a connection or none, a dead-end corridor going off it
      if (P.conns.length <= 1 && rng.f() < 0.6) {
        const sides = [[0, -1, o[1] - 0], [0, 1, P.H - o[3]], [-1, 0, o[0]], [1, 0, W - o[2]]].sort((p, q) => q[2] - p[2]);
        const [dx, dy, room] = sides[rng.int(0, 1)];
        if (room >= 5) {
          const len = Math.min(room - 1, rng.int(4, 12));
          const t = dx ? oy + cw + rng.int(0, Math.max(0, oh - 3 * cw)) : ox + cw + rng.int(0, Math.max(0, ow - 3 * cw));
          const r = dx ? (dx > 0 ? [o[2], t, o[2] + len, t + cw] : [o[0] - len, t, o[0], t + cw]) : (dy > 0 ? [t, o[3], t + cw, o[3] + len] : [t, o[1] - len, t + cw, o[1]]);
          if (unbuilt(P, r)) P.paint(r, ring);
        }
      }
    }
  });

  // ============================================================ branching tunnels
  FILL.register({
    id: 'tunnels', name: 'Branching tunnels', feel: 'enclosed', weight: 3,
    blurb: 'Tunnels of mixed widths (1-2.5 m) branching like a tree from the connections, each branch ending in a small blob room.',
    doors: { opening: 0.85, door: 0.15 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 14 && S.area >= 320,
    site: { w: [12, 30], h: [12, 26] },
    layout(P, rng) {
      const tun = P.add('passage', ['tunnel']), isT = (u) => u === tun;
      const nz = noiseField(P, P.seed, rng.range(4, 8)), dE = edgeDist(P);
      const cost = () => { const f = keepOff(P, isT, 2, nz, 8); for (let i = 0; i < f.length; i++) if (dE[i] > 0 && dE[i] < 3) f[i] += 3; return f; };
      // a small site gets narrower tunnels, shorter branches and smaller rooms
      const I = P.inner, small = TG.rshort(I) < 28, tw = small ? rng.int(2, 4) : rng.int(3, 5);
      // the trunk: from the first connection (or the middle) to the others
      if (P.conns.length) paintPath(P, [mid(P, P.conns[0])], Math.min(tw, P.conns[0].s1 - P.conns[0].s0), tun);
      else { const x = I[0] + (TG.rw(I) >> 1) + rng.int(-3, 3), y = I[1] + (TG.rh(I) >> 1) + rng.int(-3, 3); paintPath(P, [at(P, x, y)], tw, tun); }
      for (const c of P.conns.slice(1)) {
        if (touches(P, c.landing, () => true)) continue;
        const p = fastRoute(P, [mid(P, c)], solidOf(P), floorOf(P, isT), cost(), 2);
        if (p) paintPath(P, p.slice(0, -1), tw, tun);
      }
      // branches: out to the far corners of what is left, each ending in a room
      const nb = clamp(Math.round(P.site.area / 500) + rng.int(0, 1), 2, 7);
      for (let k = 0, tries = 0; k < nb && tries < nb * 2; tries++) {
        const f = farPoint(P, rng, dE, small ? 2 : 3, small ? 6 : 9);
        if (f < 0) break;
        const p = fastRoute(P, [f], solidOf(P), floorOf(P, isT), cost(), 2);
        if (!p) continue;
        const [x, y] = xy(P, f), w = small ? rng.int(4, 7) : rng.int(5, 9), h = small ? rng.int(4, 7) : rng.int(5, 9);
        const r = [x - (w >> 1), y - (h >> 1), x - (w >> 1) + w, y - (h >> 1) + h];
        const u = P.add(w * h >= 40 ? 'room' : 'cell', ['tunnel-end']);
        smallRoom(P, rng, r, u, 0.7);
        paintPath(P, p.slice(0, -1), small ? rng.int(2, 3) : rng.int(2, 4), tun);
        P.require.push([tun, u]);
        k++;
      }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
