/*
 * tpl/fillers/kit.js - shared pieces for filler layouts and furnishings.
 *
 * Loaded after engine.js and before the pool files (pool.js, corridors.js,
 * halls.js, rooms.js), which take what they need from BR.FILL.kit. Units are
 * kit cells (0.5 m), rects [x0, y0, x1, y1].
 *
 *   layout     blob, paintBlobs (rooms as 2-3 overlapping rectangles),
 *              row (rooms side by side in a strip), slice (a chain of rooms),
 *              stub (a dead end off a room), alcove (a small room beside
 *              one), onEdge
 *   furnish    stubWall, gappedWall, freeWall, column, plus (a plus-shaped
 *              pillar), wallPiece (a free-standing straight, L or T wall)
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL;
  const { VOID } = FILL.lib;

  /** does room v touch the site outline? */
  function onEdge(P, v) {
    for (const i of P.cells(v)) {
      const x = i % P.W, y = (i - x) / P.W;
      if (!P.inSite(x - 1, y) || !P.inSite(x + 1, y) || !P.inSite(x, y - 1) || !P.inSite(x, y + 1)) return true;
    }
    return false;
  }

  /**
   * Room v painted into rect r as 2-3 overlapping rectangles, the room shape
   * of the hand-drawn maps: a block from one corner, a block reaching the
   * opposite corner that overlaps it by 2 m or more both ways, and sometimes
   * a third that turns one of the two notches into a step. The notches stay
   * solid; every side of r keeps some floor, so neighbours still meet. Rects
   * under 4 m either way, and a share `o.plain` of the rest, are painted
   * whole. Returns the cells painted.
   */
  function blob(P, r, v, rng, o) {
    o = o || {};
    const w = TG.rw(r), h = TG.rh(r);
    if (w < 8 || h < 8 || rng.f() < (o.plain || 0)) return P.paint(r, v, o.onlyVoid);
    const snap = (n, full) => (full - n < 2 ? full : Math.max(4, n));        // no notch under 1 m
    const cx = rng.f() < 0.5, cy = rng.f() < 0.5;
    const aw = snap(Math.round(w * rng.range(0.55, 0.85)), w), ah = snap(Math.round(h * rng.range(0.55, 0.85)), h);
    const bw = snap(Math.max(w - aw + 4, Math.round(w * rng.range(0.4, 0.8))), w), bh = snap(Math.max(h - ah + 4, Math.round(h * rng.range(0.4, 0.8))), h);
    const ax = cx ? r[0] : r[2] - aw, ay = cy ? r[1] : r[3] - ah, bx = cx ? r[2] - bw : r[0], by = cy ? r[3] - bh : r[1];
    const A = [ax, ay, ax + aw, ay + ah], B = [bx, by, bx + bw, by + bh];
    let n = P.paint(A, v, o.onlyVoid) + P.paint(B, v, o.onlyVoid);
    if (rng.f() < (o.step === undefined ? 0.5 : o.step)) {
      // the notches are what A and B leave of r; fill the inner corner of one
      const notches = [];
      for (const q of TG.rsub(r, A)) for (const t of TG.rsub(q, B)) if (TG.rshort(t) >= 4) notches.push(t);
      if (notches.length) {
        const N = notches[rng.int(0, notches.length - 1)], nw = TG.rw(N), nh = TG.rh(N);
        const cw = rng.int(2, nw - 2), ch = rng.int(2, nh - 2);
        const x0 = N[0] === r[0] ? N[2] - cw : N[0], y0 = N[1] === r[1] ? N[3] - ch : N[1];
        n += P.paint([x0, y0, x0 + cw, y0 + ch], v, o.onlyVoid);
      }
    }
    return n;
  }

  /** Each rect as a new room of `type` in the blob style (o: blob options). Returns the room ids painted. */
  function paintBlobs(P, rects, type, tags, rng, o) {
    const ids = [];
    for (const r of rects) { const v = P.add(type, tags); if (blob(P, r, v, rng, o)) ids.push(v); }
    return ids;
  }

  /**
   * Rooms side by side along strip s (alongX: they follow each other along
   * x), each [lo, hi] cells long, with `gap` cells of solid between them
   * ([min, max], default none). A last piece shorter than lo joins the one
   * before. Returns [{ v, r }].
   */
  function row(P, rng, s, alongX, lo, hi, type, tags, gap) {
    const a0 = alongX ? s[0] : s[1], a1 = alongX ? s[2] : s[3], out = [];
    const mk = (a, b) => (alongX ? [a, s[1], b, s[3]] : [s[0], a, s[2], b]);
    let t = a0;
    while (a1 - t >= Math.min(lo, a1 - a0)) {
      let len = rng.int(lo, hi);
      if (a1 - t - len < lo) len = a1 - t;
      const v = P.add(type, tags), r = mk(t, t + len);
      if (P.paint(r, v, true)) out.push({ v, r });
      t += len + (gap ? rng.int(gap[0], gap[1]) : 0);
    }
    return out;
  }

  /** rooms 3-8 m long from a0 to a1 (reversed: from a1 back), chained in order */
  function slice(P, rng, a0, a1, mk, reverse) {
    const out = [];
    let t = a0;
    const cuts = [];
    while (t < a1) {
      let len = rng.int(6, 16);
      if (a1 - t - len < 6) len = a1 - t;
      cuts.push([t, t + len]); t += len;
    }
    if (reverse) cuts.reverse();
    for (const [p, q] of cuts) {
      const r = mk(p, q), v = P.add('room', ['enfilade']);
      if (!P.paint(r, v, true)) continue;
      if (out.length) P.require.push([out[out.length - 1].v, v]);
      out.push({ v, r });
    }
    return out;
  }

  /** a straight dead end from a random cell of room v, b wide, up to len long */
  function stub(P, v, rng, b, len) {
    const cells = P.cells(v);
    if (!cells.length) return false;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let tries = 0; tries < 8; tries++) {
      const i = cells[rng.int(0, cells.length - 1)], x = i % P.W, y = (i - x) / P.W, d = DIRS[rng.int(0, 3)];
      const path = [];
      for (let t = 1; t <= len; t++) {
        const nx = x + d[0] * t, ny = y + d[1] * t;
        if (!P.inSite(nx, ny)) break;
        const j = ny * P.W + nx;
        if (P.R.a[j] >= 0 && P.R.a[j] !== v) break;
        // keep a cell of solid to either side so it reads as a stub, not a widening
        const sx = d[1], sy = d[0];
        if (P.own(nx + sx * b, ny + sy * b) >= 0 || P.own(nx - sx, ny - sy) >= 0) { if (t > 2) break; }
        path.push(j);
      }
      if (path.length >= 4) { FILL.lib.paintPath(P, path, b, v); return true; }
    }
    return false;
  }

  /** a small room on solid ground beside room v */
  function alcove(P, v, rng, type) {
    const cells = P.cells(v);
    for (let tries = 0; tries < 12 && cells.length; tries++) {
      const i = cells[rng.int(0, cells.length - 1)], x = i % P.W, y = (i - x) / P.W;
      const w = rng.int(4, 8), h = rng.int(4, 7), side = rng.int(0, 3);
      const off = rng.int(-(w - 2), 0);
      const q = side === 0 ? [x + off, y - h, x + off + w, y] : side === 1 ? [x + off, y + 1, x + off + w, y + 1 + h]
        : side === 2 ? [x - h, y + off, x, y + off + w] : [x + 1, y + off, x + 1 + h, y + off + w];
      if (!P.allVoid(q)) continue;
      P.paint(q, P.add(type, ['dead-end']));
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ furnishing
  /** a partition from one wall of rect r into the room, frac of the way across */
  function stubWall(walk, r, rng, frac) {
    const side = rng.int(0, 3), w = TG.rw(r), h = TG.rh(r);
    if (side === 0 || side === 2) {                         // from N / S: vertical wall at x = c
      if (w < 8) return false;
      const c = rng.int(r[0] + 3, r[2] - 3), len = Math.max(2, Math.round(h * frac));
      return side === 0 ? walk.partition('v', c, r[1], r[1] + len) : walk.partition('v', c, r[3] - len, r[3]);
    }
    if (h < 8) return false;
    const c = rng.int(r[1] + 3, r[3] - 3), len = Math.max(2, Math.round(w * frac));
    return side === 3 ? walk.partition('h', c, r[0], r[0] + len) : walk.partition('h', c, r[2] - len, r[2]);
  }
  /** a wall right across rect r with one or two 1-2 m gaps */
  function gappedWall(walk, r, rng) {
    const horiz = rng.f() < 0.5, a0 = horiz ? r[0] : r[1], a1 = horiz ? r[2] : r[3], c0 = horiz ? r[1] : r[0], c1 = horiz ? r[3] : r[2];
    if (c1 - c0 < 12 || a1 - a0 < 10) return false;
    const c = rng.int(c0 + Math.round((c1 - c0) * 0.3), c1 - Math.round((c1 - c0) * 0.3)), o = horiz ? 'h' : 'v';
    const g = rng.int(2, 4), at = rng.int(a0 + 2, a1 - 2 - g);
    let ok = false;
    if (rng.f() < 0.35 && a1 - a0 >= 20) {                   // two gaps: three pieces
      const g2 = rng.int(2, 4), at2 = rng.int(Math.min(at + g + 3, a1 - 2 - g2), a1 - 2 - g2);
      ok = walk.partition(o, c, a0, at) | walk.partition(o, c, at + g, at2) | walk.partition(o, c, at2 + g2, a1);
    } else ok = walk.partition(o, c, a0, at) | walk.partition(o, c, at + g, a1);
    return ok;
  }
  /** a free-standing partition inside rect r */
  function freeWall(walk, r, rng) {
    const horiz = rng.f() < 0.5, len = rng.int(4, 10);
    const along = horiz ? [r[0] + 3, r[2] - 3] : [r[1] + 3, r[3] - 3], across = horiz ? [r[1] + 3, r[3] - 3] : [r[0] + 3, r[2] - 3];
    if (along[1] - along[0] < len || across[1] <= across[0]) return false;
    const s = rng.int(along[0], along[1] - len), c = rng.int(across[0], across[1]);
    return walk.partition(horiz ? 'h' : 'v', c, s, s + len);
  }
  /** a 0.5 or 1 m column somewhere in rect r */
  function column(walk, r, rng) {
    const s = rng.f() < 0.6 ? 1 : 2;
    if (TG.rw(r) < s + 6 || TG.rh(r) < s + 6) return false;
    const x = rng.int(r[0] + 3, r[2] - 3 - s), y = rng.int(r[1] + 3, r[3] - 3 - s);
    return walk.column([x, y, x + s, y + s]);
  }
  /**
   * A plus-shaped pillar centred on cell (x, y): arms `arm` cells out from a
   * core `t` cells thick (t 1 or 2). Kept only if the walker still gets
   * everywhere.
   */
  function plus(walk, x, y, arm, t, margin) {
    const h = [x - arm, y, x + t + arm, y + t], v = [x, y - arm, x + t, y + t + arm];
    return walk.pillar([h, [v[0], v[1], v[2], y], [v[0], y + t, v[2], v[3]]], margin);
  }
  /**
   * A free-standing wall piece with its corner at (x, y): a straight run,
   * an L or a T, arms [lo, hi] cells long, at least `clear` cells from the
   * edges of rect r. Each arm is a partition; arms the walker rejects are
   * dropped. Returns the arms placed.
   */
  function wallPiece(walk, r, rng, x, y, shape, lo, hi, clear) {
    clear = clear === undefined ? 3 : clear;
    const inX = (a) => Math.max(r[0] + clear, Math.min(r[2] - clear, a)), inY = (a) => Math.max(r[1] + clear, Math.min(r[3] - clear, a));
    const len = () => rng.int(lo, hi), sx = rng.f() < 0.5 ? 1 : -1, sy = rng.f() < 0.5 ? 1 : -1;
    let n = 0;
    const h = (a, b) => { const s0 = inX(Math.min(a, b)), s1 = inX(Math.max(a, b)); if (s1 - s0 >= 2 && walk.partition('h', y, s0, s1)) n++; };
    const v = (a, b) => { const s0 = inY(Math.min(a, b)), s1 = inY(Math.max(a, b)); if (s1 - s0 >= 2 && walk.partition('v', x, s0, s1)) n++; };
    if (shape === 'I') { if (rng.f() < 0.5) h(x, x + sx * len()); else v(y, y + sy * len()); }
    else if (shape === 'L') { h(x, x + sx * len()); v(y, y + sy * len()); }
    else { const a = len(); h(x - a, x + a); v(y, y + sy * len()); }      // T
    return n;
  }

  FILL.kit = { onEdge, blob, paintBlobs, row, slice, stub, alcove, stubWall, gappedWall, freeWall, column, plus, wallPiece, VOID };
})(typeof window !== 'undefined' ? window : globalThis);
