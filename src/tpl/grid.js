/*
 * tpl/grid.js - the kit grid and the integer geometry every template uses.
 *
 * Template geometry is integer "units" of GRID metres (0.5 m: the kit grid an
 * Unreal modular kit snaps to). Rects are [x0, y0, x1, y1], half-open cells.
 *
 * Everything here is exact integer work - a raster of owners per cell is the
 * source of truth for adjacency, boundaries, exterior walls and reachability.
 */
(function (root) {
  'use strict';
  const BR = root.BR || (root.BR = {});
  const TG = {};

  TG.GRID = 0.5;            // metres per unit
  TG.OUT = -2;              // raster value outside the site

  // ------------------------------------------------------------------ rects
  TG.rw = (r) => r[2] - r[0];
  TG.rh = (r) => r[3] - r[1];
  TG.rarea = (r) => (r[2] - r[0]) * (r[3] - r[1]);
  TG.rshort = (r) => Math.min(r[2] - r[0], r[3] - r[1]);
  TG.rlong = (r) => Math.max(r[2] - r[0], r[3] - r[1]);
  TG.rvalid = (r) => r[2] > r[0] && r[3] > r[1];
  TG.rinter = (a, b) => {
    const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
    return r[2] > r[0] && r[3] > r[1] ? r : null;
  };
  TG.roverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  TG.rcontains = (a, b) => b[0] >= a[0] && b[1] >= a[1] && b[2] <= a[2] && b[3] <= a[3];
  TG.rcenter = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  /** a minus b as up to four rects (top, bottom, left, right bands). */
  TG.rsub = (a, b) => {
    const i = TG.rinter(a, b);
    if (!i) return [a.slice()];
    const out = [];
    if (i[1] > a[1]) out.push([a[0], a[1], a[2], i[1]]);
    if (i[3] < a[3]) out.push([a[0], i[3], a[2], a[3]]);
    if (i[0] > a[0]) out.push([a[0], i[1], i[0], i[3]]);
    if (i[2] < a[2]) out.push([i[2], i[1], a[2], i[3]]);
    return out;
  };
  TG.bbox = (rects) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of rects) { b[0] = Math.min(b[0], r[0]); b[1] = Math.min(b[1], r[1]); b[2] = Math.max(b[2], r[2]); b[3] = Math.max(b[3], r[3]); }
    return b;
  };
  TG.rectsArea = (rects) => rects.reduce((s, r) => s + TG.rarea(r), 0);

  // ----------------------------------------------------------------- raster
  class Raster {
    constructor(W, H, fill) {
      this.W = W; this.H = H;
      this.a = new Int32Array(W * H).fill(fill === undefined ? -1 : fill);
    }
    get(x, y) { return x < 0 || y < 0 || x >= this.W || y >= this.H ? TG.OUT : this.a[y * this.W + x]; }
    set(x, y, v) { if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.a[y * this.W + x] = v; }
    fill(r, v) {
      const x0 = Math.max(0, r[0]), y0 = Math.max(0, r[1]), x1 = Math.min(this.W, r[2]), y1 = Math.min(this.H, r[3]);
      for (let y = y0; y < y1; y++) this.a.fill(v, y * this.W + x0, y * this.W + x1);
    }
    /** true if every cell of r holds v */
    all(r, v) {
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (this.get(x, y) !== v) return false;
      return true;
    }
    any(r, v) {
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (this.get(x, y) === v) return true;
      return false;
    }
    count(v) { let n = 0; for (let i = 0; i < this.a.length; i++) if (this.a[i] === v) n++; return n; }
  }
  TG.Raster = Raster;

  /**
   * Boundary runs between different owners. Each run:
   *   { o: 'h'|'v', c, s0, s1, a, b }
   * 'h': the horizontal line y = c, x in [s0, s1); a owns the cell above
   *      (row c-1), b the cell below (row c).
   * 'v': the vertical line x = c, y in [s0, s1); a owns the cell left
   *      (column c-1), b the cell right (column c).
   * Owners outside the lot are TG.OUT. Runs break wherever (a, b) changes.
   */
  TG.boundaries = (R, outVal) => {
    const segs = [], W = R.W, H = R.H;
    if (outVal !== undefined) {
      // treat everything beyond the raster as outVal (so 'outside' is one owner)
      const g = R.get.bind(R);
      R = { W, H, get: (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? outVal : g(x, y)) };
    }
    for (let y = 0; y <= H; y++) {
      let run = null;
      for (let x = 0; x <= W; x++) {
        const a = x < W ? R.get(x, y - 1) : 0, b = x < W ? R.get(x, y) : 0;
        const diff = x < W && a !== b;
        if (diff && run && run.a === a && run.b === b) { run.s1 = x + 1; continue; }
        if (run) { segs.push(run); run = null; }
        if (diff) run = { o: 'h', c: y, s0: x, s1: x + 1, a, b };
      }
    }
    for (let x = 0; x <= W; x++) {
      let run = null;
      for (let y = 0; y <= H; y++) {
        const a = y < H ? R.get(x - 1, y) : 0, b = y < H ? R.get(x, y) : 0;
        const diff = y < H && a !== b;
        if (diff && run && run.a === a && run.b === b) { run.s1 = y + 1; continue; }
        if (run) { segs.push(run); run = null; }
        if (diff) run = { o: 'v', c: x, s0: y, s1: y + 1, a, b };
      }
    }
    return segs;
  };

  /** Largest axis-aligned rect of cells where pred(value) holds: [x0, y0, x1, y1] or null (histogram method). */
  TG.largestRect = (R, pred) => {
    const W = R.W, H = R.H, h = new Int32Array(W);
    let best = null, bestA = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) h[x] = pred(R.a[y * W + x]) ? h[x] + 1 : 0;
      const st = [];
      for (let x = 0; x <= W; x++) {
        const cur = x < W ? h[x] : 0;
        let start = x;
        while (st.length && st[st.length - 1][1] >= cur) {
          const [sx, sh] = st.pop();
          const A = sh * (x - sx);
          if (A > bestA) { bestA = A; best = [sx, y + 1 - sh, x, y + 1]; }
          start = sx;
        }
        st.push([start, cur]);
      }
    }
    return best;
  };

  /** Greedy maximal-rect decomposition of the cells where pred(value) holds (row-major, deterministic). */
  TG.rectsWhere = (R, pred) => {
    const W = R.W, H = R.H, used = new Uint8Array(W * H), out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (used[i] || !pred(R.a[i])) continue;
      let x1 = x;
      while (x1 < W && !used[y * W + x1] && pred(R.a[y * W + x1])) x1++;
      let y1 = y + 1;
      outer: for (; y1 < H; y1++) for (let k = x; k < x1; k++) if (used[y1 * W + k] || !pred(R.a[y1 * W + k])) break outer;
      for (let yy = y; yy < y1; yy++) for (let k = x; k < x1; k++) used[yy * W + k] = 1;
      out.push([x, y, x1, y1]);
    }
    return out;
  };

  /** 4-connected components of the cells where pred holds: array of cell index lists. */
  TG.components = (R, pred) => {
    const W = R.W, H = R.H, seen = new Uint8Array(W * H), comps = [];
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || !pred(R.a[i])) continue;
      const st = [i], c = [];
      seen[i] = 1;
      while (st.length) {
        const j = st.pop(); c.push(j);
        const x = j % W, y = (j - x) / W;
        const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
        for (const k of nb) if (k >= 0 && !seen[k] && pred(R.a[k])) { seen[k] = 1; st.push(k); }
      }
      comps.push(c);
    }
    return comps;
  };

  // ------------------------------------------------------------ orientation
  /**
   * Engines work in a canonical frame: x across the lot, y from the back
   * (y = 0) to the front (y = H), so the approach side is always 'S'. The
   * finished building is turned to face the requested approach side.
   *   cw, ch: canonical lot size (cw = length of the front edge).
   * Returns { w, h, pt(x, y), rect(r), side(s) } in real lot coordinates.
   */
  const SIDES = ['N', 'E', 'S', 'W'];
  TG.orient = (approach, cw, ch) => {
    let pt, w, h, k;
    if (approach === 'N') { w = cw; h = ch; pt = (x, y) => [cw - x, ch - y]; k = 2; }
    else if (approach === 'E') { w = ch; h = cw; pt = (x, y) => [y, cw - x]; k = 3; }
    else if (approach === 'W') { w = ch; h = cw; pt = (x, y) => [ch - y, x]; k = 1; }
    else { w = cw; h = ch; pt = (x, y) => [x, y]; k = 0; }
    const rect = (r) => {
      const a = pt(r[0], r[1]), b = pt(r[2], r[3]);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    };
    const side = (s) => SIDES[(SIDES.indexOf(s) + k) % 4];      // canonical direction -> real
    return { w, h, pt, rect, side };
  };
  TG.SIDES = SIDES;
  TG.opposite = (s) => SIDES[(SIDES.indexOf(s) + 2) % 4];

  /** Stable 32-bit hash of a string (for archetype ids in seeds). */
  TG.hashStr = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };

  BR.TG = TG;
})(typeof window !== 'undefined' ? window : globalThis);
