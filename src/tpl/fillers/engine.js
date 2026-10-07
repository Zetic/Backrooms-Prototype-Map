/*
 * tpl/fillers/engine.js - filler templates: the plain Backrooms that fill
 * every site no POI claims.
 *
 *   BR.FILL.generate(spec) -> filler blueprint (br.filler/0.1, docs/fillers.md)
 *
 * A filler builds one site from its outline and its connections (the
 * openings the world's connection graph hands it). It never looks at the
 * world, so the same spec always gives the same result, in any load order.
 *
 * There are thousands of fillers per km², so there is no candidate search:
 * a filler's layout paints rooms onto a raster of the site once, and the
 * shared pipeline makes the result sound:
 *   1. land     every connection gets a landing (1 m of floor behind the
 *               opening); one the layout left solid is carved open
 *   2. clean    no slivers under 1 m, no room in two pieces, no crumbs
 *   3. join     one connected floor: solid gaps are bridged by passages
 *   4. openings portals exactly where the world asked, then a spanning
 *               tree of openings between rooms, then a few loops
 *   5. furnish  the filler's partitions and columns, each kept only if
 *               every floor cell stays walkable
 *   6. output   metres, site frame (+x right, +y down)
 *
 * Cells a layout leaves unbuilt are solid: the mass between rooms that gives
 * the Backrooms its enclosed feel. All geometry is integer kit units
 * (TG.GRID = 0.5 m) and all randomness is seeded.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, { Rng, hash4 } = BR;
  const FILL = BR.FILL = BR.FILL || {};
  FILL.SCHEMA = 'br.filler/0.1';
  FILL.fillers = FILL.fillers || {};
  FILL.register = (f) => { FILL.fillers[f.id] = f; };
  FILL.list = () => Object.keys(FILL.fillers).map((k) => FILL.fillers[k]);

  const G = TG.GRID, VOID = -1;
  const U = (m) => Math.round(m / G);
  const SIDES = ['N', 'E', 'S', 'W'];
  const PASS = { door: 1, opening: 1 };             // walkable opening kinds a filler cuts
  const SALT = { LAYOUT: 1, JOIN: 2, OPEN: 3, FURNISH: 4, CEIL: 5, PICK: 6 };
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

  /** Room catalogue: zone, tags and ceiling range (m). */
  const TYPES = FILL.TYPES = {
    room: { zone: 'public', tags: ['backrooms'], ceil: [2.4, 3.0] },
    hall: { zone: 'public', tags: ['backrooms', 'large'], ceil: [2.8, 4.2] },
    passage: { zone: 'circulation', tags: ['backrooms', 'circulation'], ceil: [2.3, 2.7] },
    cell: { zone: 'private', tags: ['backrooms', 'small'], ceil: [2.2, 2.6] },
    alcove: { zone: 'private', tags: ['backrooms', 'alcove'], ceil: [2.2, 2.6] },
    closet: { zone: 'service', tags: ['backrooms', 'closet'], ceil: [2.2, 2.5] }
  };

  // ============================================================ site
  /** spec.site ({ w, h } or { rects }, metres) -> canonical units, origin at the bbox corner. */
  function makeSite(site) {
    let rects = site.rects ? site.rects.map((q) => q.slice()) : [[0, 0, site.w, site.h]];
    const bb = TG.bbox(rects);
    rects = rects.map((q) => [q[0] - bb[0], q[1] - bb[1], q[2] - bb[0], q[3] - bb[1]]);
    const W = U(bb[2] - bb[0]), H = U(bb[3] - bb[1]);
    const mask = new TG.Raster(W, H, 0);
    for (const q of rects) mask.fill(q.map(U), 1);
    const inner = TG.largestRect(mask, (v) => v === 1) || [0, 0, 0, 0];
    return { W, H, mask, inner, area: mask.count(1), rects, w: bb[2] - bb[0], h: bb[3] - bb[1] };
  }

  /**
   * Straight runs of the site outline, metres: [{ side, line, s0, s1 }].
   * side is the direction you leave the site through that run; line is its
   * y (N, S) or x (E, W); [s0, s1) runs along it. Tools use this to pick
   * connections; the world gets them from its connection graph.
   */
  FILL.outline = (site) => {
    const S = makeSite(site), out = [];
    const m = (x, y) => S.mask.get(x, y) === 1;
    for (const side of SIDES) {
      const horiz = side === 'N' || side === 'S', len = horiz ? S.W : S.H, cross = horiz ? S.H : S.W;
      for (let L = 0; L <= cross; L++) {
        let start = -1;
        for (let s = 0; s <= len; s++) {
          let edge = false;
          if (s < len) {
            const inC = cellIn(side, L, s), outC = cellOut(side, L, s);
            edge = m(inC[0], inC[1]) && !m(outC[0], outC[1]);
          }
          if (edge && start < 0) start = s;
          if (!edge && start >= 0) { out.push({ side, line: L * G, s0: start * G, s1: s * G }); start = -1; }
        }
      }
    }
    return out;
  };
  /**
   * n connections spread over the outline, for tools and tests (the world
   * gets real ones from its connection graph). Prefers different sides.
   */
  FILL.sampleConnections = (site, n, seed) => {
    const rng = new Rng(hash4(seed >>> 0, n, 0x636f6e, 7)), runs = FILL.outline(site).filter((r) => r.s1 - r.s0 >= 2.5);
    const out = [], used = [], S = makeSite(site);
    for (let k = 0, tries = 0; out.length < n && runs.length && tries < n * 4; tries++, k++) {
      const fresh = runs.filter((r) => out.every((c) => c.side !== r.side));
      const pool = fresh.length ? fresh : runs;
      // longer runs are likelier, as a real neighbour is
      let tot = 0;
      for (const r of pool) tot += r.s1 - r.s0;
      let t = rng.f() * tot, r = pool[pool.length - 1];
      for (const q of pool) { t -= q.s1 - q.s0; if (t < 0) { r = q; break; } }
      const width = rng.f() < 0.7 ? 1.5 : rng.f() < 0.5 ? 1 : 2;
      const lo = r.s0 + 0.5, hi = r.s1 - 0.5 - width;
      if (hi < lo) continue;
      let at = Math.round((lo + rng.f() * (hi - lo)) * 2) / 2;
      if (used.some((u) => u.side === r.side && u.line === r.line && at < u.at + u.width + 1 && u.at < at + width + 1)) continue;
      const c = { id: 'c' + out.length, side: r.side, at, width, line: r.line, route: rng.f() < 0.75 };
      if (landConnection(c, S, k).error) continue;           // e.g. no 1 m of floor behind it
      out.push(c); used.push(c);
    }
    return out;
  };
  /** Can this connection be honoured on this site? null if so, else why not (the world checks before it asks). */
  FILL.checkConnection = (site, c) => landConnection(c, makeSite(site), 0).error || null;

  // the cell just inside / just outside an outline line at position s
  function cellIn(side, L, s) { return side === 'N' ? [s, L] : side === 'S' ? [s, L - 1] : side === 'W' ? [L, s] : [L - 1, s]; }
  function cellOut(side, L, s) { return side === 'N' ? [s, L - 1] : side === 'S' ? [s, L] : side === 'W' ? [L - 1, s] : [L, s]; }

  /**
   * A connection (metres): { id, side, at, width, line?, kind?, route?, clear? }.
   * The opening runs from `at` to `at + width` along the outline on `side`
   * (x for N / S, y for E / W). `line` picks the outline line when the side
   * has several (an L or U site); by default it is the outermost line that
   * fits. Returns it in units with its landing rect, or { error }.
   */
  function landConnection(c, S, k) {
    const side = c.side, id = c.id !== undefined ? String(c.id) : 'c' + k;
    if (SIDES.indexOf(side) < 0) return { error: 'connection ' + id + ': bad side ' + side };
    const horiz = side === 'N' || side === 'S', len = horiz ? S.W : S.H, cross = horiz ? S.H : S.W;
    const s0 = U(c.at), s1 = s0 + U(c.width || 1.5);
    if (s1 - s0 < 2) return { error: 'connection ' + id + ' is narrower than 1 m' };
    if (s0 < 0 || s1 > len) return { error: 'connection ' + id + ' runs off the site' };
    const m = (p) => S.mask.get(p[0], p[1]) === 1;
    const fits = (L) => {
      for (let s = s0; s < s1; s++) if (!m(cellIn(side, L, s)) || m(cellOut(side, L, s))) return false;
      for (let s = s0; s < s1; s++) {          // 1 m of floor behind it
        const p = cellIn(side, L, s), d = side === 'N' ? [0, 1] : side === 'S' ? [0, -1] : side === 'W' ? [1, 0] : [-1, 0];
        if (!m([p[0] + d[0], p[1] + d[1]])) return false;
      }
      return true;
    };
    let L = -1;
    if (c.line !== undefined) { L = U(c.line); if (!fits(L)) L = -1; }
    else {
      const order = [];
      for (let t = 0; t <= cross; t++) order.push(side === 'N' || side === 'W' ? t : cross - t);
      for (const t of order) if (fits(t)) { L = t; break; }
    }
    if (L < 0) return { error: 'connection ' + id + ' is not on the site outline' };
    const landing = side === 'N' ? [s0, L, s1, L + 2] : side === 'S' ? [s0, L - 2, s1, L] : side === 'W' ? [L, s0, L + 2, s1] : [L - 2, s0, L, s1];
    return { id, side, o: horiz ? 'h' : 'v', line: L, s0, s1, landing, kind: c.kind === 'door' ? 'door' : 'opening',
      route: c.route !== false, clear: c.clear !== undefined ? c.clear : 1, src: c };
  }

  // ============================================================ plan
  /** The raster a filler paints, with helpers. Room ids index P.rooms; VOID is solid. */
  function makePlan(S, conns, seed) {
    const W = S.W, H = S.H;
    const P = {
      W, H, site: S, mask: S.mask, inner: S.inner, conns, seed,
      R: new TG.Raster(W, H, VOID), rooms: [], require: [], partitions: [], columns: [],
      land: new Uint8Array(W * H)
    };
    for (const c of conns) for (let y = c.landing[1]; y < c.landing[3]; y++) for (let x = c.landing[0]; x < c.landing[2]; x++) P.land[y * W + x] = 1;
    P.add = (type, tags) => { P.rooms.push({ type, tags: tags || [] }); return P.rooms.length - 1; };
    P.inSite = (x, y) => x >= 0 && y >= 0 && x < W && y < H && S.mask.a[y * W + x] === 1;
    P.own = (x, y) => (P.inSite(x, y) ? P.R.a[y * W + x] : -2);
    /** paint the site cells of r with v (only solid cells if onlyVoid); returns the count */
    P.paint = (r, v, onlyVoid) => {
      let n = 0;
      for (let y = Math.max(0, r[1]); y < Math.min(H, r[3]); y++) for (let x = Math.max(0, r[0]); x < Math.min(W, r[2]); x++) {
        const i = y * W + x;
        if (S.mask.a[i] !== 1 || (onlyVoid && P.R.a[i] !== VOID)) continue;
        P.R.a[i] = v; n++;
      }
      return n;
    };
    /** cells of r owned by `from` become `to` (unless they are landing cells) */
    P.recolor = (r, from, to) => {
      let n = 0;
      for (let y = Math.max(0, r[1]); y < Math.min(H, r[3]); y++) for (let x = Math.max(0, r[0]); x < Math.min(W, r[2]); x++) {
        const i = y * W + x;
        if (P.R.a[i] === from && !P.land[i]) { P.R.a[i] = to; n++; }
      }
      return n;
    };
    P.allVoid = (r) => {
      if (r[0] < 0 || r[1] < 0 || r[2] > W || r[3] > H || !TG.rvalid(r)) return false;
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (!P.inSite(x, y) || P.R.a[y * W + x] !== VOID) return false;
      return true;
    };
    P.hitsLanding = (r) => {
      for (let y = Math.max(0, r[1]); y < Math.min(H, r[3]); y++) for (let x = Math.max(0, r[0]); x < Math.min(W, r[2]); x++) if (P.land[y * W + x]) return true;
      return false;
    };
    P.cells = (v) => { const out = []; for (let i = 0; i < W * H; i++) if (P.R.a[i] === v) out.push(i); return out; };
    /** largest rect of one room's cells */
    P.bigRect = (v) => TG.largestRect(P.R, (x) => x === v);
    return P;
  }

  // ============================================================ routing
  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v;
      let i = k.length;
      k.push(key); v.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] < key || (k[p] === key && v[p] <= val)) break;
        k[i] = k[p]; v[i] = v[p]; i = p;
      }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v, top = [k[0], v[0]], lk = k.pop(), lv = v.pop(), n = k.length;
      if (n) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && (k[c + 1] < k[c] || (k[c + 1] === k[c] && v[c + 1] < v[c]))) c++;
          if (lk < k[c] || (lk === k[c] && lv <= v[c])) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return top;
    }
  }

  /**
   * Cheapest 4-connected path from a start cell to a goal cell (cell indices,
   * start and goal included), or null. o: { ok(i), goal(i), noise
   * (Float32Array), noiseW, turn (cost of a bend) }.
   */
  function route(P, starts, o) {
    const W = P.W, H = P.H, N = W * H, ND = 5, turn = o.turn || 0, nz = o.noise, nw = o.noiseW || 0;
    const dist = new Float64Array(N * ND).fill(Infinity), prev = new Int32Array(N * ND).fill(-1);
    const h = new Heap(), DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    for (const i of starts) { dist[i * ND + 4] = 0; h.push(0, i * ND + 4); }
    while (h.size) {
      const [d, s] = h.pop();
      if (d > dist[s]) continue;
      const i = (s / ND) | 0, dir = s % ND;
      if (dir !== 4 && o.goal(i)) {
        const path = [];
        for (let t = s; t >= 0; t = prev[t]) path.push((t / ND) | 0);
        return path.reverse();
      }
      const x = i % W, y = (i - x) / W;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!o.goal(j) && !o.ok(j)) continue;
        const c = d + 1 + (nz ? nz[j] * nw : 0) + (dir !== 4 && dir !== k ? turn : 0);
        const t = j * ND + k;
        if (c < dist[t]) { dist[t] = c; prev[t] = s; h.push(c, t); }
      }
    }
    return null;
  }

  /** Paint a path b cells wide (solid cells only), keeping the brush inside the site. */
  function paintPath(P, path, b, v) {
    const offs = [];
    for (let dy = -(b - 1); dy <= 0; dy++) for (let dx = -(b - 1); dx <= 0; dx++) offs.push([dx, dy]);
    const c = -((b - 1) / 2);
    offs.sort((p, q) => (Math.abs(p[0] - c) + Math.abs(p[1] - c)) - (Math.abs(q[0] - c) + Math.abs(q[1] - c)) || p[1] - q[1] || p[0] - q[0]);
    let n = 0;
    for (const i of path) {
      const x = i % P.W, y = (i - x) / P.W;
      let done = false;
      for (const [dx, dy] of offs) {
        const r = [x + dx, y + dy, x + dx + b, y + dy + b];
        let fit = true;
        for (let yy = r[1]; yy < r[3] && fit; yy++) for (let xx = r[0]; xx < r[2]; xx++) if (!P.inSite(xx, yy)) { fit = false; break; }
        if (!fit) continue;
        n += P.paint(r, v, true); done = true; break;
      }
      if (!done && P.R.a[i] === VOID && P.mask.a[i] === 1) { P.R.a[i] = v; n++; }
    }
    return n;
  }

  /** 4-connected components of built cells: { label (Int32Array), count, sizes } */
  function builtComponents(P) {
    const W = P.W, N = W * P.H, R = P.R.a, label = new Int32Array(N).fill(-1), sizes = [];
    for (let i = 0; i < N; i++) {
      if (R[i] < 0 || label[i] >= 0) continue;
      const c = sizes.length, st = [i];
      label[i] = c;
      let n = 0;
      while (st.length) {
        const j = st.pop(); n++;
        const x = j % W;
        if (x > 0 && R[j - 1] >= 0 && label[j - 1] < 0) { label[j - 1] = c; st.push(j - 1); }
        if (x < W - 1 && R[j + 1] >= 0 && label[j + 1] < 0) { label[j + 1] = c; st.push(j + 1); }
        if (j >= W && R[j - W] >= 0 && label[j - W] < 0) { label[j - W] = c; st.push(j - W); }
        if (j + W < N && R[j + W] >= 0 && label[j + W] < 0) { label[j + W] = c; st.push(j + W); }
      }
      sizes.push(n);
    }
    return { label, count: sizes.length, sizes };
  }

  // ============================================================ layout helpers
  /** Recursive split of rect r into rooms with sides in [min, max] (some stop early when under max). */
  function bsp(r, rng, min, max, pStop, out) {
    out = out || [];
    const w = TG.rw(r), h = TG.rh(r);
    const canX = w >= 2 * min, canY = h >= 2 * min;
    if ((!canX && !canY) || (w <= max && h <= max && rng.f() < (pStop === undefined ? 0.35 : pStop))) { out.push(r); return out; }
    const alongX = canX && (!canY || w > h * 1.15 || (w * 1.15 >= h && rng.f() < 0.5));
    const len = alongX ? w : h, cut = rng.int(min, len - min);
    if (alongX) { bsp([r[0], r[1], r[0] + cut, r[3]], rng, min, max, pStop, out); bsp([r[0] + cut, r[1], r[2], r[3]], rng, min, max, pStop, out); }
    else { bsp([r[0], r[1], r[2], r[1] + cut], rng, min, max, pStop, out); bsp([r[0], r[1] + cut, r[2], r[3]], rng, min, max, pStop, out); }
    return out;
  }

  /** Turn about frac of the rooms solid, never one holding a landing and never cutting the floor in two. */
  function voidSome(P, rng, frac, filter) {
    const ids = [];
    P.rooms.forEach((_, i) => { if (!filter || filter(i)) ids.push(i); });
    for (let i = ids.length - 1; i > 0; i--) { const j = rng.int(0, i); const t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
    let want = Math.round(ids.length * frac), done = 0;
    const base = builtComponents(P).count;
    for (const v of ids) {
      if (done >= want) break;
      const cells = P.cells(v);
      if (!cells.length || cells.some((i) => P.land[i])) continue;
      for (const i of cells) P.R.a[i] = VOID;
      if (builtComponents(P).count > Math.max(1, base)) { for (const i of cells) P.R.a[i] = v; continue; }
      done++;
    }
    return done;
  }

  /** Cut a notch (corner or mid-edge) out of room v's rect r into solid, keeping `keep` units of room. */
  function notch(P, v, r, rng, max, keep) {
    keep = keep || 4; max = max || 8;
    const w = TG.rw(r), h = TG.rh(r);
    if (w < keep + 2 || h < keep + 2) return false;
    const nw = rng.int(2, Math.max(2, Math.min(max, w - keep))), nh = rng.int(2, Math.max(2, Math.min(max, h - keep)));
    const side = rng.int(0, 3);
    let q;
    if (side === 0 || side === 2) {                   // N / S edge: notch nw wide, nh deep
      const t = r[0] + (rng.f() < 0.5 ? (rng.f() < 0.5 ? 0 : w - nw) : rng.int(0, w - nw));
      q = side === 0 ? [t, r[1], t + nw, r[1] + nh] : [t, r[3] - nh, t + nw, r[3]];
    } else {
      const t = r[1] + (rng.f() < 0.5 ? (rng.f() < 0.5 ? 0 : h - nh) : rng.int(0, h - nh));
      q = side === 3 ? [r[0], t, r[0] + nw, t + nh] : [r[2] - nw, t, r[2], t + nh];
    }
    if (P.hitsLanding(q)) return false;
    return P.recolor(q, v, VOID) > 0;
  }

  /** Paint each rect as a new room of `type` (solid cells only). Returns the room ids. */
  function paintRooms(P, rects, type, tags, onlyVoid) {
    const ids = [];
    for (const r of rects) { const v = P.add(type, tags); if (P.paint(r, v, onlyVoid)) ids.push(v); }
    return ids;
  }

  /** Per-cell value noise in [0, 1) for wandering routes. */
  function noiseField(P, seed, scale) {
    const f = new Float32Array(P.W * P.H);
    for (let y = 0; y < P.H; y++) for (let x = 0; x < P.W; x++) f[y * P.W + x] = BR.fbm(seed, x / scale, y / scale, 2);
    return f;
  }

  FILL.lib = { U, VOID, bsp, voidSome, notch, paintRooms, paintPath, route, noiseField, builtComponents };

  // ============================================================ pipeline
  /** 1. landings: every connection gets one room behind it. */
  function land(P) {
    const W = P.W, R = P.R.a;
    for (const c of P.conns) {
      const q = c.landing, counts = new Map();
      for (let y = q[1]; y < q[3]; y++) for (let x = q[0]; x < q[2]; x++) { const v = R[y * W + x]; if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1); }
      let v = -1, best = 0;
      for (const [k, n] of counts) if (n > best || (n === best && k < v)) { v = k; best = n; }
      if (v < 0) {
        // solid behind the opening: join the room next to the landing, else a new passage
        const nb = new Map();
        for (let y = q[1] - 1; y <= q[3]; y++) for (let x = q[0] - 1; x <= q[2]; x++) {
          const inside = x >= q[0] && x < q[2] && y >= q[1] && y < q[3];
          const o = P.own(x, y);
          if (!inside && o >= 0) nb.set(o, (nb.get(o) || 0) + 1);
        }
        for (const [k, n] of nb) if (n > best || (n === best && k < v)) { v = k; best = n; }
        if (v < 0) v = P.add('passage', ['landing']);
      }
      P.paint(q, v, false);
    }
  }

  /** 2. clean: slivers to a neighbour (or solid), rooms split into pieces, crumbs merged. */
  function clean(P) {
    const W = P.W, H = P.H, R = P.R.a;
    const own = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -2 : R[y * W + x]);
    // is (x, y) inside a 2x2 block of room v? (cells of room `also` count too:
    // a sliver moving over cell by cell is judged as if it had moved already)
    const covered = (x, y, v, also) => {
      const is = (a, b) => { const o = own(a, b); return o === v || (also !== undefined && o === also); };
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        if (is(x + dx, y + dy) && is(x + dx + 1, y + dy) && is(x + dx, y + dy + 1) && is(x + dx + 1, y + dy + 1)) return true;
      }
      return false;
    };
    // relaxed passes move slivers over whole; strict ones settle what is left
    for (let pass = 0; pass < 12; pass++) {
      const strict = pass >= 4;
      let changed = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, v = R[i];
        if (v < 0 || covered(x, y, v)) continue;
        let to = VOID;
        for (const n of [own(x - 1, y), own(x + 1, y), own(x, y - 1), own(x, y + 1)]) {
          if (n < 0 || n === v) continue;
          R[i] = n;
          if (covered(x, y, n, strict ? undefined : v)) { to = n; break; }
          R[i] = v;
        }
        R[i] = to; changed++;
      }
      if (!changed && strict) break;
    }
    // split rooms into 4-connected pieces; the biggest keeps the id
    const N = W * H, piece = new Int32Array(N).fill(-1), pieces = [];
    for (let i = 0; i < N; i++) {
      if (R[i] < 0 || piece[i] >= 0) continue;
      const v = R[i], cells = [], st = [i];
      piece[i] = pieces.length;
      while (st.length) {
        const j = st.pop(); cells.push(j);
        const x = j % W;
        for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) if (k >= 0 && k < N && R[k] === v && piece[k] < 0) { piece[k] = pieces.length; st.push(k); }
      }
      pieces.push({ v, cells, land: cells.some((j) => P.land[j]) });
    }
    const best = new Map();
    pieces.forEach((p, k) => { const b = best.get(p.v); if (b === undefined || p.cells.length > pieces[b].cells.length) best.set(p.v, k); });
    pieces.forEach((p, k) => {
      if (best.get(p.v) === k) return;
      const nv = P.add(P.rooms[p.v].type, P.rooms[p.v].tags);
      for (const j of p.cells) R[j] = nv;
      p.v = nv;
    });
    // crumbs (< 2 m²) join the neighbour they share most edge with
    for (const p of pieces) {
      if (p.cells.length >= 8 || p.land) continue;
      const nb = new Map();
      for (const j of p.cells) {
        const x = j % W, y = (j - x) / W;
        for (const n of [own(x - 1, y), own(x + 1, y), own(x, y - 1), own(x, y + 1)]) if (n >= 0 && n !== p.v) nb.set(n, (nb.get(n) || 0) + 1);
      }
      let to = VOID, bn = 0;
      for (const [k, n] of nb) if (n > bn || (n === bn && k < to)) { to = k; bn = n; }
      for (const j of p.cells) R[j] = to;
    }
  }

  /**
   * 3. one floor: bridge solid gaps with 1 m passages (shortest, so they read
   * as gaps in a wall run). brush is the passage width in cells; the engine
   * widens it when a 1 m bridge keeps getting cleaned away as a sliver.
   */
  function bridge(P, brush) {
    const R = P.R.a;
    let carved = 0;
    for (let guard = 0; guard < 64; guard++) {
      const C = builtComponents(P);
      if (C.count <= 1) break;
      // from the smallest piece to any other
      let small = 0;
      for (let k = 1; k < C.count; k++) if (C.sizes[k] < C.sizes[small]) small = k;
      const starts = [];
      for (let i = 0; i < R.length; i++) if (C.label[i] === small) starts.push(i);
      const path = route(P, starts, { ok: (i) => P.mask.a[i] === 1 && R[i] === VOID, goal: (i) => R[i] >= 0 && C.label[i] !== small });
      if (!path) break;
      // a short gap widens the room it starts from (a new 1 m room there would
      // be a sliver); a longer one is a passage of its own, or grows one
      const from = R[path[0]];
      const v = path.length <= 5 || P.rooms[from].type === 'passage' ? from : P.add('passage', ['bridge']);
      carved += paintPath(P, path.slice(1, -1), brush || 2, v);
    }
    return carved;
  }

  /** Drop rooms with no cells; renumber. */
  function compact(P) {
    const n = P.rooms.length, count = new Int32Array(n), R = P.R.a;
    for (let i = 0; i < R.length; i++) if (R[i] >= 0) count[R[i]]++;
    const map = new Int32Array(n).fill(-1), rooms = [];
    for (let v = 0; v < n; v++) if (count[v]) { map[v] = rooms.length; rooms.push(P.rooms[v]); }
    for (let i = 0; i < R.length; i++) if (R[i] >= 0) R[i] = map[R[i]];
    P.rooms = rooms;
    P.require = P.require.map(([a, b]) => [map[a], map[b]]).filter(([a, b]) => a >= 0 && b >= 0 && a !== b);
  }

  /** 4. openings: portals at the connections, a spanning tree of openings, loops, open boundaries as a last resort. */
  function openings(P, rng, F) {
    const segs = TG.boundaries(P.R, VOID);
    const walls = segs.map((s, k) => ({ id: k, o: s.o, c: s.c, s0: s.s0, s1: s.s1, lo: s.a, hi: s.b, kind: s.a >= 0 && s.b >= 0 ? 'interior' : 'exterior' }));
    const pairs = new Map(), key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    for (const w of walls) if (w.kind === 'interior') { const k = key(w.lo, w.hi); if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(w); }
    const ops = [], portals = [], links = [], issues = [], occ = new Map();
    const lk = (w) => w.o + w.c;
    const free = (w, s0, s1, gap) => { for (const [a, b] of occ.get(lk(w)) || []) if (s0 < b + gap && a < s1 + gap) return false; return true; };
    const cut = (w, s0, s1, kind) => {
      if (!occ.has(lk(w))) occ.set(lk(w), []);
      occ.get(lk(w)).push([s0, s1]);
      const op = { id: ops.length, wall: w.id, kind, s0, s1, into: null, portal: null };
      ops.push(op);
      return op;
    };
    const size = (v) => { let n = 0; for (let i = 0; i < P.R.a.length; i++) if (P.R.a[i] === v) n++; return n; };

    // portals: exactly where the world asked
    for (const c of P.conns) {
      const p = c.landing, room = P.R.a[p[1] * P.W + p[0]];
      const w = walls.find((x) => x.kind === 'exterior' && x.o === c.o && x.c === c.line && x.s0 <= c.s0 && x.s1 >= c.s1 && (x.lo === room || x.hi === room));
      if (!w || !free(w, c.s0, c.s1, 0)) { issues.push('connection ' + c.id + ' could not be cut'); continue; }
      const op = cut(w, c.s0, c.s1, c.kind);
      if (c.kind === 'door') op.into = room;
      op.portal = portals.length;
      portals.push({ conn: c, opening: op.id, room });
    }

    // openings between rooms
    const D = F.doors || { opening: 1 };
    const uf = BR.makeUF(P.rooms.length), linked = new Set();
    const link = (a, b) => {
      const kind = rng.weighted(D);
      let want = kind === 'wide' ? rng.int(4, 8) : kind === 'door' ? 2 : rng.int(2, 3);
      const real = kind === 'wide' ? 'opening' : kind;
      const ws = pairs.get(key(a, b)) || [];
      for (const width of want > 2 ? [want, 2] : [2]) {
        const cand = [];
        for (const w of ws) {
          const len = w.s1 - w.s0, mg = len >= width + 2 ? 1 : 0;
          for (let s = w.s0 + mg; s + width <= w.s1 - mg; s++) if (free(w, s, s + width, 1)) cand.push([w, s]);
        }
        if (!cand.length) continue;
        const [w, s] = cand[rng.int(0, cand.length - 1)];
        const op = cut(w, s, s + width, real);
        if (real === 'door') op.into = size(a) <= size(b) ? a : b;
        links.push({ a, b, kind: real, opening: op.id });
        linked.add(key(a, b)); uf.union(a, b);
        return true;
      }
      return false;
    };
    for (const [a, b] of P.require) if (!linked.has(key(a, b))) link(a, b);
    const edges = [...pairs.keys()].sort().map((k) => {
      const [a, b] = k.split('|').map(Number), len = pairs.get(k).reduce((s, w) => s + w.s1 - w.s0, 0);
      return { k, a, b, w: rng.f() - Math.min(len, 24) * (F.longBias || 0.01) };
    });
    edges.sort((p, q) => p.w - q.w || (p.k < q.k ? -1 : 1));
    for (const e of edges) if (uf.find(e.a) !== uf.find(e.b)) link(e.a, e.b);
    let loops = 0;
    for (const e of edges) if (!linked.has(e.k) && rng.f() < (F.loops || 0) && link(e.a, e.b)) loops++;
    // last resort: no wall at all between two rooms that could not share an opening
    for (const e of edges) {
      if (uf.find(e.a) === uf.find(e.b)) continue;
      for (const w of pairs.get(e.k)) w.kind = 'open';
      links.push({ a: e.a, b: e.b, kind: 'open', opening: null });
      linked.add(e.k); uf.union(e.a, e.b);
    }
    // filler-asked open boundaries
    for (const [a, b] of P.open || []) {
      const k = key(a, b);
      if (!pairs.has(k) || linked.has(k)) continue;
      for (const w of pairs.get(k)) w.kind = 'open';
      links.push({ a, b, kind: 'open', opening: null }); linked.add(k); uf.union(a, b);
    }
    return { walls, ops, portals, links, loops, issues, uf };
  }

  /** Walkability on the cell grid: room floor, openings, partitions, columns. */
  function walker(P, J) {
    const W = P.W, H = P.H, R = P.R.a, N = W * H;
    const passH = new Uint8Array(W * (H + 1)), passV = new Uint8Array((W + 1) * H);   // line y=c at x: c*W+x; line x=c at y: y*(W+1)+c
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = R[y * W + x];
      if (v < 0) continue;
      if (x + 1 < W && R[y * W + x + 1] === v) passV[y * (W + 1) + x + 1] = 1;
      if (y + 1 < H && R[(y + 1) * W + x] === v) passH[(y + 1) * W + x] = 1;
    }
    const setLine = (o, c, s0, s1, val) => { for (let s = s0; s < s1; s++) { if (o === 'h') passH[c * W + s] = val; else passV[s * (W + 1) + c] = val; } };
    for (const op of J.ops) { const w = J.walls[op.wall]; if (w.kind === 'interior' && PASS[op.kind]) setLine(w.o, w.c, op.s0, op.s1, 1); }
    for (const w of J.walls) if (w.kind === 'open') setLine(w.o, w.c, w.s0, w.s1, 1);
    const col = new Uint8Array(N), keep = new Uint8Array(N);
    // keep 1 m clear on both sides of every opening (and 0.5 m to each side of it)
    for (const op of J.ops) {
      const w = J.walls[op.wall];
      for (let s = op.s0 - 1; s < op.s1 + 1; s++) for (let d = -2; d < 2; d++) {
        const x = w.o === 'h' ? s : w.c + d, y = w.o === 'h' ? w.c + d : s;
        if (x >= 0 && y >= 0 && x < W && y < H) keep[y * W + x] = 1;
      }
    }
    for (const w of J.walls) if (w.kind === 'open') for (let s = w.s0; s < w.s1; s++) for (let d = -1; d < 1; d++) {
      const x = w.o === 'h' ? s : w.c + d, y = w.o === 'h' ? w.c + d : s;
      if (x >= 0 && y >= 0 && x < W && y < H) keep[y * W + x] = 1;
    }
    const ok = () => {
      let total = 0, first = -1;
      for (let i = 0; i < N; i++) if (R[i] >= 0 && !col[i]) { total++; if (first < 0) first = i; }
      if (first < 0) return false;
      const seen = new Uint8Array(N), st = [first];
      seen[first] = 1;
      let n = 0;
      while (st.length) {
        const i = st.pop(); n++;
        const x = i % W, y = (i - x) / W;
        const go = (j, pass) => { if (pass && R[j] >= 0 && !col[j] && !seen[j]) { seen[j] = 1; st.push(j); } };
        if (x + 1 < W) go(i + 1, passV[y * (W + 1) + x + 1]);
        if (x > 0) go(i - 1, passV[y * (W + 1) + x]);
        if (y + 1 < H) go(i + W, passH[(y + 1) * W + x]);
        if (y > 0) go(i - W, passH[y * W + x]);
      }
      return n === total;
    };
    const api = {
      ok,
      /** a partition on line c ('h': y = c, 'v': x = c) from s0 to s1, inside one room */
      partition(o, c, s0, s1) {
        if (s1 - s0 < 2) return false;
        // no crossings and no doubled-up walls
        for (const q of P.partitions) {
          if (q.o !== o && q.c > s0 && q.c < s1 && c > q.s0 && c < q.s1) return false;
          if (q.o === o && Math.abs(q.c - c) < 3 && q.s0 < s1 + 1 && s0 < q.s1 + 1) return false;
        }
        let room = -1;
        for (let s = s0; s < s1; s++) {
          const a = o === 'h' ? [s, c - 1] : [c - 1, s], b = o === 'h' ? [s, c] : [c, s];
          if (a[0] < 0 || a[1] < 0 || b[0] >= W || b[1] >= H) return false;
          const ia = a[1] * W + a[0], ib = b[1] * W + b[0];
          if (R[ia] < 0 || R[ia] !== R[ib] || keep[ia] || keep[ib] || col[ia] || col[ib]) return false;
          if ((o === 'h' ? passH[c * W + s] : passV[s * (W + 1) + c]) === 0) return false;
          room = R[ia];
        }
        setLine(o, c, s0, s1, 0);
        if (!ok()) { setLine(o, c, s0, s1, 1); return false; }
        P.partitions.push({ o, c, s0, s1, room });
        return true;
      },
      /** a column on rect r, inside one room with `margin` cells of that room around it */
      column(r, margin) {
        margin = margin === undefined ? 2 : margin;
        const room = P.own(r[0], r[1]);
        if (room < 0) return false;
        for (let y = r[1] - margin; y < r[3] + margin; y++) for (let x = r[0] - margin; x < r[2] + margin; x++) {
          if (P.own(x, y) !== room) return false;
          const i = y * W + x;
          if (col[i] || (x >= r[0] && x < r[2] && y >= r[1] && y < r[3] && keep[i])) return false;
        }
        for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) col[y * W + x] = 1;
        // a column with open floor of its own room all round cannot cut anything off
        // unless a partition in that room helps it; only then walk the whole floor
        const alone = margin >= 1 && !P.partitions.some((p) => p.room === room);
        if (!alone && !ok()) { for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) col[y * W + x] = 0; return false; }
        P.columns.push({ rect: r.slice(), room });
        return true;
      }
    };
    return api;
  }

  // ============================================================ picking
  /** Fillers that fit a site: [{ id, weight }] */
  function fitting(S, weights) {
    const out = [];
    for (const F of FILL.list()) {
      const w = weights && weights[F.id] !== undefined ? weights[F.id] : F.weight !== undefined ? F.weight : 1;
      if (w > 0 && (!F.fits || F.fits(S))) out.push({ id: F.id, w });
    }
    return out;
  }
  /** Pick a filler for a site from the pool weights (or `weights`, e.g. a biome's). */
  FILL.pick = (spec) => {
    const S = makeSite(spec.site || { w: 16, h: 16 });
    const list = fitting(S, spec.weights);
    if (!list.length) return 'passage';
    const rng = new Rng(hash4(spec.seed >>> 0, S.W * 4096 + S.H, S.area, SALT.PICK));
    const w = {};
    for (const f of list) w[f.id] = f.w;
    return rng.weighted(w);
  };

  // ============================================================ generate
  /**
   * spec: { filler (id; picked from the pool when omitted), seed, site: { w, h } | { rects } (metres),
   *         connections: [{ id, side, at, width, line?, kind?, route? }], weights?,
   *         hint? ({ lots: [{ rect, front, kind }] }, metres: the yard's lots, src/tpl/lot.js) }
   * Returns a filler blueprint (docs/fillers.md) or { error }.
   */
  function generate(spec) {
    const t0 = now(), seed = spec.seed >>> 0;
    const S = makeSite(spec.site || { w: 16, h: 16 });
    const landed = (spec.connections || []).map((c, k) => landConnection(c, S, k));
    const bad = landed.find((c) => c.error);
    const fid = spec.filler || FILL.pick(spec);
    const F = FILL.fillers[fid];
    const fail = (msg) => ({ schema: FILL.SCHEMA, error: msg, filler: fid, seed, site: { w: S.w, h: S.h, rects: S.rects }, meta: { ms: Math.round((now() - t0) * 10) / 10 } });
    if (!F) return fail('unknown filler ' + fid);
    if (bad) return fail(bad.error);
    // order-free: connections are handled sorted by place, so input order never matters
    const conns = landed.slice().sort((a, b) => SIDES.indexOf(a.side) - SIDES.indexOf(b.side) || a.line - b.line || a.s0 - b.s0);
    for (let k = 1; k < conns.length; k++) {
      const a = conns[k - 1], b = conns[k];
      if (a.side === b.side && a.line === b.line && b.s0 < a.s1) return fail('connections ' + a.id + ' and ' + b.id + ' overlap');
    }
    let ch = 0x636f6e;
    for (const c of conns) ch = hash4(ch, SIDES.indexOf(c.side) * 65536 + c.line, c.s0 * 65536 + c.s1, c.kind === 'door' ? 1 : 0);
    const base = hash4(seed, TG.hashStr(F.id), S.W * 4096 + S.H, hash4(S.area, ch, 0, 0));
    const rs = (salt) => new Rng(hash4(base, salt, 0, 0x66));

    const P = makePlan(S, conns, base);
    P.hint = spec.hint && spec.hint.lots ? { lots: spec.hint.lots.map((L) => Object.assign({}, L, { rect: L.rect.map(U) })) } : null;
    F.layout(P, rs(SALT.LAYOUT), F);
    land(P);
    clean(P);
    let carved = 0;
    for (let round = 0; round < 6 && builtComponents(P).count > 1; round++) { carved += bridge(P, round < 2 ? 2 : 3); clean(P); }
    if (!builtComponents(P).count) P.paint(P.inner, P.add('room', ['fallback']));   // too small for the layout: one plain room
    compact(P);
    const J = openings(P, rs(SALT.OPEN), F);
    const walk = walker(P, J);
    if (F.furnish) F.furnish(P, walk, rs(SALT.FURNISH));
    const issues = J.issues.slice();
    if (builtComponents(P).count !== 1) issues.push('floor is not one piece');
    if (!walk.ok()) issues.push('some floor cannot be walked to');
    for (let v = 1; v < P.rooms.length; v++) if (J.uf.find(v) !== J.uf.find(0)) { issues.push('room graph is not connected'); break; }
    const crng = rs(SALT.CEIL);
    for (const rm of P.rooms) { const c = (TYPES[rm.type] || TYPES.room).ceil; rm.ceiling = Math.round(crng.range(c[0], c[1]) * 10) / 10; }
    const b = output(spec, S, P, J, F, seed);
    b.meta.carved = Math.round(carved * G * G * 10) / 10;
    b.meta.loops = J.loops;
    b.meta.issues = issues;
    b.meta.ms = Math.round((now() - t0) * 100) / 100;
    return b;
  }

  // ============================================================ output
  function output(spec, S, P, J, F, seed) {
    const W = P.W, m = (v) => Math.round(v * G * 1000) / 1000, id = (v) => (v >= 0 ? 'r' + v : null);
    const pt = (o, c, s) => (o === 'h' ? [m(s), m(c)] : [m(c), m(s)]);
    // per-room rects, area
    const bbox = P.rooms.map(() => [Infinity, Infinity, -Infinity, -Infinity]), cells = new Int32Array(P.rooms.length);
    for (let i = 0; i < P.R.a.length; i++) {
      const v = P.R.a[i];
      if (v < 0) continue;
      const x = i % W, y = (i - x) / W, b = bbox[v];
      cells[v]++;
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x + 1 > b[2]) b[2] = x + 1; if (y + 1 > b[3]) b[3] = y + 1;
    }
    const counts = {};
    const rooms = P.rooms.map((rm, v) => {
      const b = bbox[v], sub = new TG.Raster(b[2] - b[0], b[3] - b[1], 0);
      for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) if (P.R.a[y * W + x] === v) sub.set(x - b[0], y - b[1], 1);
      const rects = TG.rectsWhere(sub, (x) => x === 1).map((r) => [m(r[0] + b[0]), m(r[1] + b[1]), m(r[2] + b[0]), m(r[3] + b[1])]);
      rects.sort((p, q) => (q[2] - q[0]) * (q[3] - q[1]) - (p[2] - p[0]) * (p[3] - p[1]));
      counts[rm.type] = (counts[rm.type] || 0) + 1;
      const ty = TYPES[rm.type] || TYPES.room;
      return { id: id(v), type: rm.type, name: rm.type + (counts[rm.type] > 1 ? ' ' + counts[rm.type] : ''), zone: ty.zone, level: 0,
        rects, area: Math.round(cells[v] * G * G * 100) / 100, ceiling: rm.ceiling, tags: ty.tags.concat(rm.tags || []) };
    });
    const THICK = { exterior: 0.3, interior: 0.15, open: 0 };
    const walls = J.walls.map((w) => ({ id: 'w' + w.id, level: 0, kind: w.kind, a: pt(w.o, w.c, w.s0), b: pt(w.o, w.c, w.s1), rooms: [id(w.lo), id(w.hi)], thickness: THICK[w.kind] }));
    P.partitions.forEach((p, k) => walls.push({ id: 'pw' + k, level: 0, kind: 'partition', a: pt(p.o, p.c, p.s0), b: pt(p.o, p.c, p.s1), rooms: [id(p.room), id(p.room)], thickness: 0.15 }));
    const ops = J.ops.map((op) => {
      const w = J.walls[op.wall];
      const o = { id: 'o' + op.id, level: 0, wall: 'w' + w.id, kind: op.kind, a: pt(w.o, w.c, op.s0), b: pt(w.o, w.c, op.s1), width: m(op.s1 - op.s0),
        rooms: [id(w.lo), id(w.hi)], height: op.kind === 'door' ? 2.1 : 2.2 };
      if (op.into !== null) { o.swingInto = id(op.into); o.hinge = o.a; }
      if (op.portal !== null) o.portal = 'p' + op.portal;
      return o;
    });
    const portals = J.portals.map((p, k) => ({
      id: 'p' + k, connection: p.conn.id, opening: 'o' + p.opening, level: 0, room: id(p.room), role: 'both', kind: p.conn.kind,
      side: p.conn.side, width: m(p.conn.s1 - p.conn.s0), clear: p.conn.clear, main: false, tags: [p.conn.route ? 'route' : 'side']
    }));
    const columns = P.columns.map((c, k) => ({ id: 'k' + k, room: id(c.room), rect: c.rect.map(m) }));
    const graph = { nodes: rooms.map((r) => r.id).concat('outside'), edges: [] };
    for (const L of J.links) graph.edges.push([id(L.a), id(L.b), L.kind, L.opening !== null ? 'o' + L.opening : null]);
    for (const p of J.portals) graph.edges.push([id(p.room), 'outside', p.conn.kind, 'o' + p.opening]);
    const built = P.R.a.reduce((s, v) => s + (v >= 0 ? 1 : 0), 0);
    const bigFloor = rooms.reduce((s, r) => s + (r.area >= 80 ? r.area : 0), 0);
    return {
      schema: FILL.SCHEMA, filler: F.id, name: F.name, feel: F.feel, seed, grid: G,
      site: { w: S.w, h: S.h, rects: S.rects },
      connections: J.portals.map((p) => ({ id: p.conn.id, side: p.conn.side, at: m(p.conn.s0), width: m(p.conn.s1 - p.conn.s0), line: m(p.conn.line), kind: p.conn.kind, route: p.conn.route })),
      levels: [{ index: 0, elevation: 0, height: Math.max(...rooms.map((r) => r.ceiling), 2.4) }],
      footprint: [{ level: 0, rects: TG.rectsWhere(P.R, (v) => v >= 0).map((r) => r.map(m)) }],
      rooms, walls, openings: ops, portals, columns, verticals: [], graph,
      meta: {
        rooms: rooms.length, built: Math.round((built / S.area) * 1000) / 1000,
        openFloor: Math.round((bigFloor / Math.max(1, built * G * G)) * 1000) / 1000,
        partitions: P.partitions.length, columns: P.columns.length
      }
    };
  }

  FILL.generate = generate;
  FILL.makeSite = makeSite;
})(typeof window !== 'undefined' ? window : globalThis);
