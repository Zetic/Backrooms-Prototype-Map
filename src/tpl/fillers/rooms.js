/*
 * tpl/fillers/rooms.js - room-led fillers: the shape of the rooms is the
 * point, more than the corridors between them.
 *
 * Like the rest of the pool (pool.js), each is a layout painted onto the
 * site raster in kit cells (0.5 m); the engine (engine.js) lands the
 * connections, cleans up, cuts the openings and checks walkability. Cells
 * left unpainted stay solid. Ordinary rooms use the blob shape of kit.js.
 *
 *   big_rooms   mixed     2-5 big blob rooms (5-7 m on a 10 m site, up to
 *                         12 m), joined through wide openings or no wall at
 *                         all into one sprawling space
 *   tiny_doors  enclosed  4-8 m blob rooms behind thick walls, joined only by
 *                         1 m doors; mostly a tree
 *   stepped     mixed     one big, mostly rectangular room whose outline
 *                         climbs in square steps along one or two sides
 *   sliver      enclosed  one very long room 1.5-3 m wide with a nub on one
 *                         side, solid or a couple of small rooms round it
 *   nested      enclosed  two or more ring corridors one inside the other
 *                         round a small core, each entered on a different side
 *   gallery     mixed     a central room ringed by 1.5-3 m bays between solid
 *                         piers or wall stubs
 *   repetition  enclosed  the same room copied 3-6 times in a row or grid
 *                         (2 x 2 on a small square site), joined the same way
 *
 * Each one scales its parts to the site, down to 8-10 m across (big_rooms
 * and sliver want 10 m), so they fit the small sites the world mostly has.
 *
 * Weights: enclosed 6 (tiny_doors 3, sliver, nested, repetition 1 each),
 * mixed 4 (big_rooms 2, stepped, gallery 1 each).
 *
 * Thick walls: tiny_doors, nested and repetition keep 0.5-1 m of solid
 * between their rooms and cut a 1 m throat through it where two rooms join
 * (the engine only opens rooms that share a wall), so the openings are
 * exactly where the layout wants them. Every throat is a required link.
 * Connections that land on solid get a straight passage to the nearest
 * floor (reach), so the engine has little left to bridge.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL;
  const { VOID, bsp, voidSome, paintPath, route } = FILL.lib;
  const K = FILL.kit;
  const dims = (S) => [TG.rw(S.inner), TG.rh(S.inner)];

  // ------------------------------------------------------------ shared helpers
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const inset = (r, d) => [r[0] + d, r[1] + d, r[2] - d, r[3] - d];

  /** does rect q (a landing) hold floor, or touch it along a side? */
  function touchesFloor(P, q) {
    for (let y = q[1]; y < q[3]; y++) for (let x = q[0] - 1; x <= q[2]; x++) if (P.own(x, y) >= 0) return true;
    for (let x = q[0]; x < q[2]; x++) if (P.own(x, q[1] - 1) >= 0 || P.own(x, q[3]) >= 0) return true;
    return false;
  }

  /**
   * Each connection that lands on solid gets a passage b cells wide to the
   * nearest floor, as straight as it can go. Returns the passages made.
   */
  function reach(P, rng, b) {
    const R = P.R.a, W = P.W;
    const built = (i) => R[i] >= 0, free = (i) => P.mask.a[i] === 1 && R[i] === VOID;
    let n = 0;
    for (const c of P.conns) {
      const q = c.landing;
      if (touchesFloor(P, q)) continue;
      const start = [Math.floor((q[1] + q[3]) / 2) * W + Math.floor((q[0] + q[2]) / 2)];
      const path = route(P, start, { ok: free, goal: built, turn: 8 });
      if (!path) continue;
      const v = P.add('passage', ['link']);
      P.paint(q, v, true);
      paintPath(P, path.slice(0, -1), Math.max(2, Math.min(b, c.s1 - c.s0)), v);
      n++;
    }
    return n;
  }

  /**
   * Room v, painted from a rect the site outline (or earlier rooms) clipped
   * to a strip under `min` cells across, goes back to solid: it would read
   * as a stray corridor. Returns whether v is kept.
   */
  function keepWide(P, v, min, q) {
    // is there a min x min square of v inside rect q (where v was painted)?
    const W = P.W, R = P.R.a, x0 = Math.max(0, q[0]), x1 = Math.min(W, q[2]), y0 = Math.max(0, q[1]), y1 = Math.min(P.H, q[3]);
    const h = new Int32Array(Math.max(0, x1 - x0));
    for (let y = y0; y < y1; y++) {
      let run = 0;
      for (let x = x0; x < x1; x++) {
        h[x - x0] = R[y * W + x] === v ? h[x - x0] + 1 : 0;
        run = h[x - x0] >= min ? run + 1 : 0;
        if (run >= min) return true;
      }
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (R[y * W + x] === v) R[y * W + x] = VOID;
    return false;
  }

  /** ordinary blob rooms in the site outside rect `keep`; about pVoid of them left solid. Returns their ids. */
  function surround(P, rng, keep, pVoid) {
    const ids = [];
    for (const r of bsp([0, 0, P.W, P.H], rng, 8, 18, 0.3)) for (const q of TG.rsub(r, keep)) {
      if (TG.rshort(q) < 4) continue;
      const v = P.add('room', ['warren']);
      if (K.blob(P, q, v, rng, { plain: 0.4, onlyVoid: true }) && keepWide(P, v, 6, q)) ids.push(v);
    }
    voidSome(P, rng, pVoid, (v) => ids.indexOf(v) >= 0);
    return ids;
  }

  /**
   * Places where two rooms face each other across `g` cells of solid, 1 m
   * wide: Map 'a|b' -> [{ a, b, r }], r the solid cells between them.
   */
  function facing(P, g) {
    const W = P.W, H = P.H, R = P.R.a, M = P.mask.a, out = new Map();
    const add = (a, b, r) => {
      const k = a < b ? a + '|' + b : b + '|' + a;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push({ a, b, r });
    };
    const gap = (r) => {
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) { const i = y * W + x; if (R[i] !== VOID || M[i] !== 1) return false; }
      return true;
    };
    for (let y = 0; y + 1 < H; y++) for (let x = 0; x + g + 1 < W; x++) {
      const i = y * W + x, a = R[i], b = R[i + g + 1];
      if (a < 0 || b < 0 || a === b || R[i + W] !== a || R[i + W + g + 1] !== b) continue;
      const r = [x + 1, y, x + 1 + g, y + 2];
      if (gap(r)) add(a, b, r);
    }
    for (let y = 0; y + g + 1 < H; y++) for (let x = 0; x + 1 < W; x++) {
      const i = y * W + x, a = R[i], b = R[i + (g + 1) * W];
      if (a < 0 || b < 0 || a === b || R[i + 1] !== a || R[i + (g + 1) * W + 1] !== b) continue;
      const r = [x, y + 1, x + 2, y + 1 + g];
      if (gap(r)) add(a, b, r);
    }
    return out;
  }

  /**
   * Cut throats from facing(): a spanning tree, plus a share `extra` of the
   * other pairs as loops. Each throat goes to one of its rooms and is a
   * required link. Returns the throats cut.
   */
  function cutThroats(P, rng, cand, extra) {
    const keys = shuffle([...cand.keys()].sort(), rng), uf = BR.makeUF(P.rooms.length), made = [];
    for (const k of keys) {
      const list = cand.get(k), a = list[0].a, b = list[0].b;
      if (uf.find(a) === uf.find(b) && rng.f() >= extra) continue;
      // away from the ends of a run where it can be, so it reads as a doorway in a wall
      const mid = list.length > 2 ? list.slice(1, -1) : list, t = mid[rng.int(0, mid.length - 1)];
      P.paint(t.r, t.a);
      P.require.push([t.a, t.b]);
      uf.union(a, b);
      made.push(t);
    }
    return made;
  }

  /** the room object's current index (rooms are renumbered after layout), or -1 */
  const idOf = (P, obj) => P.rooms.indexOf(obj);

  // ------------------------------------------------------------ big rooms
  FILL.register({
    id: 'big_rooms', name: 'Interconnected big rooms', feel: 'mixed', weight: 2,
    blurb: '2-5 big rooms of overlapping rectangles (5-7 m on a small site, up to 12 m on a big one), joined through wide openings or no wall at all into one sprawling space; solid round it.',
    doors: { wide: 0.8, opening: 0.2 }, loops: 0.3,
    fits: (S) => Math.min(...dims(S)) >= 20 && S.area >= 400 && S.area <= 5600,
    site: { w: [10, 40], h: [10, 36] },
    layout(P, rng) {
      const W = P.W, H = P.H, I = P.inner, M = P.mask.a;
      // 2-3 rooms on a 10 m site, up to 5 on a big one
      const n = Math.max(2, Math.min(5, Math.round(Math.sqrt(P.site.area) / 2 / rng.range(3.4, 5.5))));
      // rooms 5-12 m, bigger on a bigger site, so the cluster takes most of a small site and about half of a big one
      const ts = Math.round(Math.sqrt((P.site.area * 0.6) / n)), lo = Math.max(10, Math.min(20, ts - 4)), hi = Math.max(lo + 3, Math.min(24, ts + 4));
      const side = () => rng.int(lo, hi), meet = lo < 14 ? 6 : 8;
      const inSite = (r) => { let k = 0; for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) k += M[y * W + x]; return k; };
      const over = (r, q) => { const t = TG.rinter(r, q); return t ? TG.rarea(t) : 0; };
      // rooms lean towards the connections no room reaches yet, so the passages in stay short
      const gapTo = (r, q) => Math.max(0, q[0] - r[2], r[0] - q[2]) + Math.max(0, q[1] - r[3], r[1] - q[3]);
      const pull = (rooms, r) => {
        let s = 0;
        for (const c of P.conns) if (!rooms.some((q) => gapTo(q.r, c.landing) <= 2)) s += Math.max(0, 24 - gapTo(r, c.landing)) * 8;
        return s;
      };
      // a few tries, keeping the one that places the most rooms (on a small
      // site a first room in the middle leaves no room beside it)
      let rooms = [];
      for (let attempt = 0; attempt < 6 && rooms.length < n; attempt++) {
        const got = place();
        if (got.length > rooms.length) rooms = got;
      }
      function place() {
        const rooms = [];
        {
          let best = null, bestS = -Infinity;
          for (let t = 0; t < 8; t++) {
            const w = Math.min(TG.rw(I), side()), h = Math.min(TG.rh(I), side());
            const x = I[0] + rng.int(0, TG.rw(I) - w), y = I[1] + rng.int(0, TG.rh(I) - h), r = [x, y, x + w, y + h];
            const sc = pull(rooms, r) + rng.f() * 40;
            if (sc > bestS) { bestS = sc; best = r; }
          }
          rooms.push({ r: best, parent: -1, side: -1, into: 0 });
        }
        // each next room meets an earlier one along 3-4 m or more, reaching a little into it
        for (let k = 1; k < n; k++) {
          let best = null, bestS = -Infinity;
          for (let t = 0; t < 30; t++) {
            const pi = rng.int(0, rooms.length - 1), a = rooms[pi].r, s = rng.int(0, 3);
            const w = Math.min(W, side()), h = Math.min(H, side()), into = rng.int(0, 3);
            let x, y;
            if (s === 0 || s === 2) {
              const ov = Math.min(meet, w, TG.rw(a));
              x = rng.int(a[0] - w + ov, a[2] - ov); y = s === 0 ? a[1] - h + into : a[3] - into;
            } else {
              const ov = Math.min(meet, h, TG.rh(a));
              y = rng.int(a[1] - h + ov, a[3] - ov); x = s === 3 ? a[0] - w + into : a[2] - into;
            }
            x = Math.max(0, Math.min(W - w, x)); y = Math.max(0, Math.min(H - h, y));
            const r = [x, y, x + w, y + h], area = w * h;
            const shared = s === 0 || s === 2 ? Math.min(r[2], a[2]) - Math.max(r[0], a[0]) : Math.min(r[3], a[3]) - Math.max(r[1], a[1]);
            if (shared < meet || over(r, a) > area * 0.3) continue;
            const ins = inSite(r);
            if (ins < area * 0.7) continue;
            let others = 0;
            rooms.forEach((q, j) => { if (j !== pi) others += over(r, q.r); });
            if (others > area * 0.1) continue;
            const sc = ins - over(r, a) - 3 * others + pull(rooms, r) + rng.f() * 40;
            if (sc > bestS) {
              bestS = sc;
              best = { r, parent: pi, side: s, into: s === 0 ? r[3] - a[1] : s === 2 ? a[3] - r[1] : s === 3 ? r[2] - a[0] : a[2] - r[0] };
            }
          }
          if (best) rooms.push(best);
        }
        return rooms;
      }
      for (const q of rooms) {
        q.v = P.add('room', ['big']);
        K.blob(P, q.r, q.v, rng, { plain: 0.2, onlyVoid: true, step: 0.6 });
      }
      // make sure each room still meets its parent along 3 m: fill the notches by the seam
      for (const q of rooms) {
        if (q.parent < 0) continue;
        const p = rooms[q.parent], a = p.r, r = q.r, s = q.side;
        const lo = s === 0 || s === 2 ? Math.max(r[0], a[0]) : Math.max(r[1], a[1]), hi = s === 0 || s === 2 ? Math.min(r[2], a[2]) : Math.min(r[3], a[3]);
        const L = s === 0 ? a[1] : s === 2 ? a[3] : s === 3 ? a[0] : a[2], dir = s === 0 || s === 3 ? -1 : 1;
        const band = (c0, c1) => (s === 0 || s === 2 ? [lo, Math.min(c0, c1), hi, Math.max(c0, c1)] : [Math.min(c0, c1), lo, Math.max(c0, c1), hi]);
        let contact = 0;
        for (const i of P.cells(q.v)) {
          const x = i % W, y = (i - x) / W;
          if (P.own(x - 1, y) === p.v || P.own(x + 1, y) === p.v || P.own(x, y - 1) === p.v || P.own(x, y + 1) === p.v) contact++;
        }
        if (contact >= 6) continue;
        P.paint(TG.rinter(band(L, L - dir * 4), a) || [0, 0, 0, 0], p.v, true);
        P.paint(TG.rinter(band(L - dir * Math.max(0, q.into), L + dir * 4), r) || [0, 0, 0, 0], q.v, true);
      }
      // now and then no wall at all between a room and the one it grew from
      // (not between most pairs: the rooms would read as one blob)
      P.open = [];
      let opens = Math.max(1, (rooms.length - 1) >> 1);
      for (const q of shuffle(rooms.filter((q) => q.parent >= 0), rng)) if (opens > 0 && rng.f() < 0.4) { P.open.push([rooms[q.parent].v, q.v]); opens--; }
      P.big = rooms.map((q) => P.rooms[q.v]);
      reach(P, rng, rng.int(2, 3));
    },
    furnish(P, walk, rng) {
      for (const obj of P.big || []) {
        const v = idOf(P, obj), r = v >= 0 ? P.bigRect(v) : null;
        if (!r) continue;
        // a room under 6 m across gets a column now and then, no stub wall
        const big = TG.rshort(r) >= 12;
        if (rng.f() < 0.3) for (let k = big ? rng.int(1, 3) : 1; k > 0; k--) K.column(walk, r, rng);
        if (big && rng.f() < 0.2) K.stubWall(walk, r, rng, rng.range(0.2, 0.4));
      }
    }
  });

  // ------------------------------------------------------------ tiny entrances
  FILL.register({
    id: 'tiny_doors', name: 'Tiny entrances', feel: 'enclosed', weight: 3,
    blurb: '4-8 m rooms of overlapping rectangles behind 0.5-1 m of solid, joined only by 1 m doors through it; mostly a tree.',
    doors: { door: 1 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 18,
    site: { w: [9, 30], h: [9, 26] },
    layout(P, rng) {
      // (0.5 m walls on a site under 10 m, so it still splits in two each way)
      const W = P.W, H = P.H, g = Math.min(TG.rw(P.inner), TG.rh(P.inner)) < 20 || rng.f() < 0.7 ? 1 : 2;
      const ids = [];
      for (const r of bsp([0, 0, W, H], rng, 8 + g, 16 + g, 0.3)) {
        // the room keeps g cells of solid on its inner right and bottom sides: a thick wall to its neighbour
        const q = [r[0], r[1], r[2] < W ? r[2] - g : r[2], r[3] < H ? r[3] - g : r[3]];
        const v = P.add('room', ['tiny-doors']);
        if (K.blob(P, q, v, rng, { plain: 0.45, step: 0.35 }) && keepWide(P, v, 6, q)) ids.push(v);
      }
      const made = cutThroats(P, rng, facing(P, g), 0.1);
      // a few rooms left solid (never cutting the floor in two), and their dangling throats with them
      voidSome(P, rng, rng.range(0.06, 0.16), (v) => ids.indexOf(v) >= 0);
      for (const t of made) if (!P.cells(t.b).length || !P.cells(t.a).length) P.recolor(t.r, t.a, VOID);
      reach(P, rng, 2);
    }
  });

  // ------------------------------------------------------------ stepped room
  FILL.register({
    id: 'stepped', name: 'Stepped big room', feel: 'mixed', weight: 1,
    blurb: 'One big, mostly rectangular room whose outline climbs in square 1-2 m steps along one or two of its sides, like a staircase in plan; now and then a small room in the solid by the steps.',
    doors: { opening: 0.7, door: 0.3 }, loops: 0.1,
    fits: (S) => Math.min(...dims(S)) >= 16,
    site: { w: [8, 34], h: [8, 30] },
    layout(P, rng) {
      const W = P.W, I = P.inner;
      // the room: the site's biggest rectangle, up to about 30 m across (the rest warren or solid)
      const zw = Math.min(TG.rw(I), rng.int(56, 64)), zh = Math.min(TG.rh(I), rng.int(52, 64));
      const zx = I[0] + rng.int(0, TG.rw(I) - zw), zy = I[1] + rng.int(0, TG.rh(I) - zh), zone = [zx, zy, zx + zw, zy + zh];
      const short = Math.min(zw, zh);
      // square steps, 1 m on a small site and up to 2 m on a big one
      const s = short < 30 ? 2 : short < 46 ? rng.int(2, 3) : rng.int(3, 4);
      const BW = Math.ceil(zw / s), BH = Math.ceil(zh / s), NB = BW * BH;
      const blk = (bx, by) => [zx + bx * s, zy + by * s, Math.min(zone[2], zx + bx * s + s), Math.min(zone[3], zy + by * s + s)];
      // which sides step (0 N, 1 E, 2 S, 3 W): one, mostly a long one; two meeting at a corner; or two facing
      const longNS = BW >= BH, one = rng.f() < 0.7 ? (longNS ? 0 : 1) + (rng.f() < 0.5 ? 2 : 0) : rng.int(0, 3);
      const pick = rng.weighted({ one: 0.4, corner: 0.45, facing: 0.15 });
      const sides = pick === 'one' ? [one] : pick === 'corner' ? [one, (one + (rng.f() < 0.5 ? 1 : 3)) % 4] : [one, (one + 2) % 4];
      // a side's depth profile in blocks: a staircase up (ramp), up and down
      // again (peak) or down and up (valley), each tread 1-3 blocks long
      const profile = (n, D) => {
        const kind = rng.weighted({ ramp: 0.4, peak: 0.35, valley: 0.25 });
        for (; D >= 1; D--) {
          let lv = [];
          for (let d = 0; d <= D; d++) lv.push(d);
          if (kind === 'peak') lv = lv.concat(lv.slice(0, -1).reverse());
          if (kind === 'valley') lv = lv.slice().reverse().concat(lv.slice(1));
          if (lv.length > n) continue;
          const tr = Math.max(1, Math.min(3, Math.floor(n / (lv.length + 1))));
          const hold = lv.map(() => Math.max(1, tr + (rng.f() < 0.35 ? (rng.f() < 0.5 ? -1 : 1) : 0)));
          let sum = hold.reduce((a, b) => a + b, 0);
          for (let k = 0; sum > n && k < 200; k++) { const j = rng.int(0, hold.length - 1); if (hold[j] > 1) { hold[j]--; sum--; } }
          if (sum > n) continue;
          // what is left goes to the flat runs at the two ends
          const rest = n - sum, a = rng.int(0, rest);
          hold[0] += a; hold[hold.length - 1] += rest - a;
          const p = [];
          lv.forEach((d, j) => { for (let k = 0; k < hold[j]; k++) p.push(d); });
          return rng.f() < 0.5 ? p.reverse() : p;
        }
        return new Array(n).fill(0);
      };
      const prof = [null, null, null, null];
      for (const sd of sides) {
        const n = sd % 2 === 0 ? BW : BH, cross = sd % 2 === 0 ? BH : BW;
        // steps deep enough to read, the room keeping the rest: up to 40% of its depth, a quarter each when two sides face
        const Dmax = Math.max(2, Math.min(6, Math.floor(cross * (pick === 'facing' ? 0.25 : 0.4))));
        prof[sd] = profile(n, rng.int(Math.max(2, Dmax - 1), Dmax));
      }
      const cut = new Uint8Array(NB);
      for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
        cut[by * BW + bx] = (prof[0] && by < prof[0][bx]) || (prof[2] && BH - 1 - by < prof[2][bx]) ||
          (prof[3] && bx < prof[3][by]) || (prof[1] && BW - 1 - bx < prof[1][by]) ? 1 : 0;
      }
      // each connection that lands in the steps keeps a way in: the shortest run of blocks to the room
      for (const c of P.conns) {
        const q = TG.rinter(c.landing, zone);
        if (!q) continue;
        const prev = new Int32Array(NB).fill(-2), st = [];
        for (let bx = Math.floor((q[0] - zx) / s); bx <= Math.floor((q[2] - 1 - zx) / s); bx++) for (let by = Math.floor((q[1] - zy) / s); by <= Math.floor((q[3] - 1 - zy) / s); by++) {
          const b = by * BW + bx;
          if (prev[b] === -2) { prev[b] = -1; st.push(b); }
        }
        let end = -1;
        for (let h = 0; h < st.length; h++) {
          const b = st[h];
          if (!cut[b]) { end = b; break; }
          const bx = b % BW, by = (b - bx) / BW;
          for (const [nx, ny] of [[bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]]) {
            const nb = ny * BW + nx;
            if (nx >= 0 && ny >= 0 && nx < BW && ny < BH && prev[nb] === -2) { prev[nb] = b; st.push(nb); }
          }
        }
        for (let b = end; b >= 0; b = prev[b]) cut[b] = 0;
      }
      const v = P.add('hall', ['stepped']);
      P.paint(zone, v);
      for (let b = 0; b < NB; b++) if (cut[b]) { const bx = b % BW; P.recolor(blk(bx, (b - bx) / BW), v, VOID); }
      // now and then a small room in the solid by the steps
      const edge = [];
      for (const i of P.cells(v)) {
        const x = i % W, y = (i - x) / W;
        if (P.own(x, y - 1) === VOID || P.own(x, y + 1) === VOID || P.own(x - 1, y) === VOID || P.own(x + 1, y) === VOID) edge.push(i);
      }
      for (let k = short < 30 ? +(rng.f() < 0.25) : rng.int(0, 2), tries = 0; k > 0 && tries < 40 && edge.length; tries++) {
        const i = edge[rng.int(0, edge.length - 1)], x = i % W, y = (i - x) / W;
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]].filter((d) => P.own(x + d[0], y + d[1]) === VOID);
        if (!dirs.length) continue;
        const d = dirs[rng.int(0, dirs.length - 1)], w = rng.int(4, 8), dep = rng.int(4, 7), off = rng.int(-(w - 2), 0);
        const q = d[1] < 0 ? [x + off, y - dep, x + off + w, y] : d[1] > 0 ? [x + off, y + 1, x + off + w, y + 1 + dep]
          : d[0] < 0 ? [x - dep, y + off, x, y + off + w] : [x + 1, y + off, x + 1 + dep, y + off + w];
        if (!P.allVoid(q) || P.hitsLanding(q)) continue;
        P.paint(q, P.add(rng.f() < 0.5 ? 'closet' : 'room', ['side']));
        k--;
      }
      P.hallObj = P.rooms[v];
      if ((zw < P.W || zh < P.H) && rng.f() < 0.5) surround(P, rng, zone, rng.range(0.3, 0.5));
      reach(P, rng, 2);
    },
    furnish(P, walk, rng) {
      const v = idOf(P, P.hallObj), r = v >= 0 ? P.bigRect(v) : null;
      if (!r) return;
      if (rng.f() < 0.4) for (let k = rng.int(1, TG.rshort(r) < 20 ? 2 : 4); k > 0; k--) K.column(walk, r, rng);
    }
  });

  // ------------------------------------------------------------ sliver
  FILL.register({
    id: 'sliver', name: 'Long sliver room', feel: 'enclosed', weight: 1,
    blurb: 'One very long room 1.5-3 m wide, nearly the length of the site, with a nub or a widening on one side; solid or a couple of small rooms round it.',
    doors: { opening: 0.8, door: 0.2 }, loops: 0,
    fits: (S) => { const d = dims(S), L = Math.max(...d), C = Math.min(...d); return L >= 20 && C >= 8 && C <= 32 && C <= L * 0.8; },
    site: { w: [10, 36], h: [6, 14] },
    layout(P, rng) {
      const I = P.inner, alongX = TG.rw(I) >= TG.rh(I);
      const A0 = alongX ? I[0] : I[1], A1 = alongX ? I[2] : I[3], C0 = alongX ? I[1] : I[0], C1 = alongX ? I[3] : I[2];
      const rect = (a0, a1, c0, c1) => (alongX ? [a0, c0, a1, c1] : [c0, a0, c1, a1]);
      // 1.5-3 m wide, and never more than a seventh of its length, so it stays a sliver on a short site
      const C = C1 - C0, b = Math.min(rng.f() < 0.25 ? 3 : rng.int(4, 6), C - 2, Math.max(3, Math.floor((A1 - A0) / 7)));
      const widening = rng.f() < 0.35, nd = Math.min(widening ? rng.int(2, 3) : rng.int(2, 5), C - b);
      const side = rng.f() < 0.5 ? -1 : 1;
      // across the site: near the connections (on a long side, or across an end), so their passages stay short
      const lo = C0 + (side < 0 ? nd : 0), hi = Math.max(lo, C1 - b - (side > 0 ? nd : 0));
      let c0 = lo, best = Infinity;
      for (let c = lo; c <= hi; c++) {
        let cost = rng.f() * 6;
        for (const cn of P.conns) {
          const q = cn.landing, q0 = alongX ? q[1] : q[0], q1 = alongX ? q[3] : q[2];
          cost += Math.max(0, c - q1, q0 - (c + b));
        }
        if (cost < best) { best = cost; c0 = c; }
      }
      const a0 = A0 + rng.int(0, 3), a1 = A1 - rng.int(0, 3);
      const v = P.add('room', ['sliver']);
      P.paint(rect(a0, a1, c0, c0 + b), v);
      const nl = widening ? rng.int(8, 16) : rng.int(3, 8), at = a0 + 3 + rng.int(0, Math.max(0, a1 - a0 - 6 - nl));
      P.paint(rect(at, Math.min(a1 - 3, at + nl), side < 0 ? c0 - nd : c0 + b, side < 0 ? c0 : c0 + b + nd), v);
      // now and then a small room or two beside it
      for (let k = C < 14 ? 0 : +rng.weighted({ 0: 0.6, 1: 0.32, 2: 0.08 }), tries = 0; k > 0 && tries < 16; tries++) {
        const len = rng.int(6, 12), dep = rng.int(5, 10), s0 = rng.int(a0, Math.max(a0, a1 - len)), up = rng.f() < 0.5;
        const q = up ? rect(s0, s0 + len, c0 - dep, c0) : rect(s0, s0 + len, c0 + b, c0 + b + dep);
        if (!P.allVoid(q)) continue;
        P.paint(q, P.add(rng.f() < 0.4 ? 'closet' : 'room', ['side']));
        k--;
      }
      // a connection on a long side may come in through a small room of its own
      for (const c of P.conns) {
        if (touchesFloor(P, c.landing) || (alongX ? c.o !== 'h' : c.o !== 'v') || rng.f() < 0.75) continue;
        const q = c.landing, k = rng.int(1, 4), sa0 = (alongX ? q[0] : q[1]) - k, sa1 = (alongX ? q[2] : q[3]) + k;
        const fromLow = c.side === 'N' || c.side === 'W', edge = fromLow ? (alongX ? q[1] : q[0]) : (alongX ? q[3] : q[2]);
        const r = fromLow ? rect(sa0, sa1, edge, c0) : rect(sa0, sa1, c0 + b, edge);
        const depth = fromLow ? c0 - edge : edge - c0 - b;
        if (depth < 4 || depth > 14 || !P.allVoid(r)) continue;
        P.paint(r, P.add('room', ['side']));
      }
      reach(P, rng, 2);
    }
  });

  // ------------------------------------------------------------ nested rooms
  FILL.register({
    id: 'nested', name: 'Nested rooms', feel: 'enclosed', weight: 1,
    blurb: 'A room in a room in a room: 1-2 m ring corridors one inside the other round a small core, each entered on a different side, so you walk round every ring.',
    doors: { opening: 0.75, door: 0.25 }, loops: 0,
    fits: (S) => Math.min(...dims(S)) >= 18,
    site: { w: [9, 28], h: [9, 26] },
    layout(P, rng) {
      const I = P.inner, sh = Math.min(TG.rw(I), TG.rh(I));
      // two rings at least: on a 9 m site, 1 m rings behind 0.5 m walls round a 3 m core
      let g = rng.f() < 0.75 ? 1 : 2;
      if (sh - 4 * (2 + g) < 6) g = 1;
      const core = Math.max(6, Math.min(rng.int(6, 10), sh - 4 * (2 + g)));
      // ring widths from the outside in: as many as fit round the core, up to five
      const ws = [];
      let used = 0;
      while (ws.length < 5) {
        const more = ws.length ? 0 : 2 + g;                 // room kept for a second ring
        let w = rng.int(2, sh < 30 ? 3 : 4);
        while (w > 2 && sh - 2 * (used + w + g + more) < core) w--;
        if (sh - 2 * (used + w + g + more) < core) break;
        ws.push(w); used += w + g;
      }
      // the block: no bigger than the rings and the core need (the rest warren or solid)
      const ex = Math.max(0, sh - 2 * used - rng.int(core, core + 4));
      let ow = TG.rw(I) - ex, oh = TG.rh(I) - ex;
      if (ow > oh) ow = Math.min(ow, oh + rng.int(4, 20)); else oh = Math.min(oh, ow + rng.int(4, 20));
      const ox = I[0] + rng.int(0, TG.rw(I) - ow), oy = I[1] + rng.int(0, TG.rh(I) - oh);
      const O = [ox, oy, ox + ow, oy + oh];
      const rings = [];
      let R = O;
      for (const w of ws) {
        const v = P.add('passage', ['nested', 'ring']);
        P.paint([R[0], R[1], R[2], R[1] + w], v); P.paint([R[0], R[3] - w, R[2], R[3]], v);
        P.paint([R[0], R[1] + w, R[0] + w, R[3] - w], v); P.paint([R[2] - w, R[1] + w, R[2], R[3] - w], v);
        rings.push({ v, R });
        R = inset(R, w + g);
      }
      const cv = P.add('room', ['nested', 'core']);
      P.paint(R, cv);
      rings.push({ v: cv, R });
      // the way in to each ring is round the far side from the way in to the one outside it
      let f = rng.f();
      for (let k = 0; k + 1 < rings.length; k++) {
        const Rn = rings[k + 1].R, nw = TG.rw(Rn) - 3, nh = TG.rh(Rn) - 3, per = 2 * (nw + nh);
        let t = Math.floor(f * per) % per, q;
        if (t < nw) { const x = Rn[0] + 1 + t; q = [x, Rn[1] - g, x + 2, Rn[1]]; }
        else if ((t -= nw) < nh) { const y = Rn[1] + 1 + t; q = [Rn[2], y, Rn[2] + g, y + 2]; }
        else if ((t -= nh) < nw) { const x = Rn[2] - 3 - t; q = [x, Rn[3], x + 2, Rn[3] + g]; }
        else { t -= nw; const y = Rn[3] - 3 - t; q = [Rn[0] - g, y, Rn[0], y + 2]; }
        P.paint(q, rings[k].v);
        P.require.push([rings[k].v, rings[k + 1].v]);
        f = (f + rng.range(0.38, 0.62)) % 1;
      }
      if (O[0] > 0 || O[1] > 0 || O[2] < P.W || O[3] < P.H) {
        if (rng.f() < 0.7) surround(P, rng, O, rng.range(0.3, 0.5));
      }
      reach(P, rng, 2);
    }
  });

  // ------------------------------------------------------------ gallery
  FILL.register({
    id: 'gallery', name: 'Gallery', feel: 'mixed', weight: 1,
    blurb: 'A central room ringed by shallow 1.5-3 m bays, one after another along every wall, between solid piers or wall stubs.',
    doors: { opening: 0.7, wide: 0.15, door: 0.15 }, loops: 0.1,
    fits: (S) => Math.min(...dims(S)) >= 16,
    site: { w: [8, 30], h: [8, 26] },
    layout(P, rng) {
      // bays 1.5-3 m deep and 1.5-3.5 m wide, smaller on a small site
      const I = P.inner, mn = Math.min(TG.rw(I), TG.rh(I)), d = rng.int(3, Math.max(3, Math.min(6, Math.floor(mn / 7))));
      let bl = mn < 24 ? rng.int(3, 4) : rng.int(4, 7), p = rng.int(1, 2);
      // (stubs only on a bigger site: on a small one they read as a plain room)
      const stubs = mn >= 30 && rng.f() < 0.3;
      const gw = Math.min(TG.rw(I), rng.int(36, 54)), gh = Math.min(TG.rh(I), rng.int(36, 54));
      const gx = I[0] + rng.int(0, TG.rw(I) - gw), gy = I[1] + rng.int(0, TG.rh(I) - gh);
      const G = [gx, gy, gx + gw, gy + gh], Hh = inset(G, d);
      // every side keeps three bays where they fit, two at least: narrower bays and piers on a short side
      const hs = Math.min(TG.rw(Hh), TG.rh(Hh)), want = hs >= 13 ? 3 : 2;
      while (Math.floor((hs - p) / (bl + p)) < want && (bl > 3 || p > 1)) { if (p > 1) p--; else bl--; }
      const v = P.add('hall', ['gallery']);
      P.paint(Hh, v);
      const lines = [];
      // bays along each side: [a0, a1) along it, mk(s0, s1) the bay rect, ln(s) a stub line between bays
      const side = (a0, a1, mk, ln) => {
        const L = a1 - a0;
        if (stubs) {
          const n = Math.max(3, Math.round(L / (bl + 1)));
          P.paint(mk(a0, a1), v);
          for (let k = 1; k < n; k++) lines.push(ln(a0 + Math.round((k * L) / n)));
          return;
        }
        const n = Math.max(1, Math.floor((L - p) / (bl + p))), off = a0 + Math.floor((L - (n * bl + (n + 1) * p)) / 2);
        for (let k = 0; k < n; k++) { const s0 = off + p + k * (bl + p); P.paint(mk(s0, s0 + bl), v); }
      };
      side(Hh[0], Hh[2], (s0, s1) => [s0, G[1], s1, Hh[1]], (s) => ['v', s, G[1], Hh[1]]);
      side(Hh[0], Hh[2], (s0, s1) => [s0, Hh[3], s1, G[3]], (s) => ['v', s, Hh[3], G[3]]);
      side(Hh[1], Hh[3], (s0, s1) => [G[0], s0, Hh[0], s1], (s) => ['h', s, G[0], Hh[0]]);
      side(Hh[1], Hh[3], (s0, s1) => [Hh[2], s0, G[2], s1], (s) => ['h', s, Hh[2], G[2]]);
      // a connection on a side comes in through a bay of its own (no stray piece of pier left by its landing)
      for (const c of P.conns) {
        const q = c.landing;
        if (!TG.roverlap(q, G)) continue;
        // (across a corner it runs on to the hall)
        const x0 = Math.min(q[0], Hh[2] - 2), x1 = Math.max(q[2], Hh[0] + 2), y0 = Math.min(q[1], Hh[3] - 2), y1 = Math.max(q[3], Hh[1] + 2);
        const r = c.side === 'N' ? [x0, G[1], x1, Hh[1]] : c.side === 'S' ? [x0, Hh[3], x1, G[3]]
          : c.side === 'W' ? [G[0], y0, Hh[0], y1] : [Hh[2], y0, G[2], y1];
        const t = TG.rinter(r, G);
        if (t) P.paint(t, v);
      }
      P.gal = { obj: P.rooms[v], H: Hh, lines, rhythm: bl + p };
      if (G[0] > 0 || G[1] > 0 || G[2] < P.W || G[3] < P.H) {
        if (rng.f() < 0.6) surround(P, rng, G, rng.range(0.35, 0.55));
      }
      reach(P, rng, 2);
    },
    furnish(P, walk, rng) {
      const gal = P.gal;
      if (!gal) return;
      // sometimes a row of columns down the middle, in step with the bays (first:
      // a column on its own needs no walk check, one beside a partition does)
      const H = gal.H, w = TG.rw(H), h = TG.rh(H);
      if (Math.min(w, h) >= 16 && rng.f() < 0.5) {
        const alongX = w >= h, s = rng.f() < 0.5 ? 1 : 2, rowsN = Math.min(w, h) >= 22 ? 2 : 1;
        for (let k = 1; k <= rowsN; k++) {
          const c = (alongX ? H[1] : H[0]) + Math.round(((alongX ? h : w) * k) / (rowsN + 1)) - (s >> 1);
          const a0 = alongX ? H[0] : H[1], a1 = alongX ? H[2] : H[3];
          for (let a = a0 + Math.floor(gal.rhythm / 2) + 2; a + s <= a1 - 3; a += gal.rhythm) walk.column(alongX ? [a, c, a + s, c + s] : [c, a, c + s, a + s]);
        }
      }
      for (const [o, c, s0, s1] of gal.lines) walk.partition(o, c, s0, s1);
    }
  });

  // ------------------------------------------------------------ repetition
  FILL.register({
    id: 'repetition', name: 'Repetition', feel: 'enclosed', weight: 1,
    blurb: 'The same room - same outline, same partition or columns - copied 3-6 times in a row or grid behind thick walls, joined the same way each time.',
    doors: { opening: 0.7, door: 0.3 }, loops: 0,
    // three or more copies 4 m or more across: a row of three, or a 2 x 2 grid on a small square site
    fits: (S) => { const d = dims(S), A = Math.max(...d), C = Math.min(...d); return C >= 17 || (A >= 26 && C >= 10); },
    site: { w: [9, 40], h: [9, 24] },
    layout(P, rng) {
      const I = P.inner, alongX = TG.rw(I) >= TG.rh(I);
      const A = alongX ? TG.rw(I) : TG.rh(I), C = alongX ? TG.rh(I) : TG.rw(I), g = C < 22 ? 1 : rng.int(1, 2);
      // rows (up to 3) of copies about 6-8 m across; one row needs room for three along, else a grid
      const rowsMax = Math.max(1, Math.min(3, Math.floor((C + g) / (8 + g)))), three = Math.floor((A + g) / (8 + g)) >= 3;
      let rows = Math.max(1, Math.min(rowsMax, Math.round((C + g) / (rng.int(12, 17) + g))));
      if (rows === 1 && !three) rows = rowsMax;
      if (rows > 1 && three && rng.f() < 0.1) rows = 1;
      const nMin = rows === 1 ? 3 : 2, nMax = Math.floor(6 / rows);
      let n = Math.max(nMin, Math.min(nMax, Math.round((A + g) / (rng.int(12, 17) + g))));
      while (n > nMin && (A - (n - 1) * g) / n < 10) n--;
      const ml = Math.min(18, Math.floor((A - (n - 1) * g) / n));
      const mc = rows > 1 ? Math.min(18, Math.floor((C - (rows - 1) * g) / rows)) : Math.min(C, rng.int(12, 18));
      const mw = alongX ? ml : mc, mh = alongX ? mc : ml, small = Math.min(mw, mh) < 11;
      // the module: one blob, with a 1 m way through to the next copy each way it is joined
      const Mk = new Uint8Array(mw * mh);
      const fake = {
        paint(r) {
          let k = 0;
          for (let y = Math.max(0, r[1]); y < Math.min(mh, r[3]); y++) for (let x = Math.max(0, r[0]); x < Math.min(mw, r[2]); x++) { Mk[y * mw + x] = 1; k++; }
          return k;
        }
      };
      K.blob(fake, [0, 0, mw, mh], 0, rng, { plain: 0.1, step: 0.6 });
      const at = (x, y) => Mk[y * mw + x] === 1;
      // a way through on the far side (x = mw - 1 when horiz) at the same place on the near side
      const through = (horiz) => {
        const len = horiz ? mh : mw, far = horiz ? mw - 1 : mh - 1;
        const fl = (t, e) => (horiz ? at(e, t) && at(e, t + 1) : at(t, e) && at(t + 1, e));
        const both = [], one = [];
        for (let t = 2; t + 2 <= len - 2; t++) if (fl(t, far)) (fl(t, 0) ? both : one).push(t);
        const pool = both.length ? both : one.length ? one : [Math.max(0, (len >> 1) - 1)];
        const t = pool[rng.int(0, pool.length - 1)];
        // carry the near side in along the same two rows until it meets the room
        for (let e = 0; e < (horiz ? mw : mh) && !fl(t, e); e++) for (const u of [t, t + 1]) Mk[horiz ? u * mw + e : e * mw + u] = 1;
        for (let e = (horiz ? mw : mh) - 1; e >= 0 && !fl(t, e); e--) for (const u of [t, t + 1]) Mk[horiz ? u * mw + e : e * mw + u] = 1;
        return t;
      };
      const tA = through(alongX), tC = rows > 1 ? through(!alongX) : -1;
      const totA = n * ml + (n - 1) * g, totC = rows * mc + (rows - 1) * g;
      const a0 = (alongX ? I[0] : I[1]) + rng.int(0, A - totA), c0 = (alongX ? I[1] : I[0]) + rng.int(0, C - totC);
      const copies = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
        const pa = a0 + i * (ml + g), pc = c0 + j * (mc + g), x = alongX ? pa : pc, y = alongX ? pc : pa;
        const v = P.add('room', ['repetition']);
        for (let yy = 0; yy < mh; yy++) for (let xx = 0; xx < mw; xx++) if (Mk[yy * mw + xx]) P.paint([x + xx, y + yy, x + xx + 1, y + yy + 1], v);
        copies.push({ i, j, x, y, v });
      }
      const get = (i, j) => copies[j * n + i];
      for (const cp of copies) {
        if (cp.i + 1 < n) {      // along
          const q = alongX ? [cp.x + mw, cp.y + tA, cp.x + mw + g, cp.y + tA + 2] : [cp.x + tA, cp.y + mh, cp.x + tA + 2, cp.y + mh + g];
          P.paint(q, cp.v); P.require.push([cp.v, get(cp.i + 1, cp.j).v]);
        }
        if (cp.j + 1 < rows) {   // across
          const q = alongX ? [cp.x + tC, cp.y + mh, cp.x + tC + 2, cp.y + mh + g] : [cp.x + mw, cp.y + tC, cp.x + mw + g, cp.y + tC + 2];
          P.paint(q, cp.v); P.require.push([cp.v, get(cp.i, cp.j + 1).v]);
        }
      }
      // the same furnishing in every copy: a stub wall, a column or two, or both
      const items = [];
      const floorRun = (o, c, s0, s1) => { for (let s = s0; s < s1; s++) if (o === 'v' ? !(at(c - 1, s) && at(c, s)) : !(at(s, c - 1) && at(s, c))) return false; return true; };
      const clear = (r, m) => { for (let y = r[1] - m; y < r[3] + m; y++) for (let x = r[0] - m; x < r[2] + m; x++) if (x < 0 || y < 0 || x >= mw || y >= mh || !at(x, y)) return false; return true; };
      if (rng.f() < 0.7) for (let tries = 0; tries < 20; tries++) {
        const o = rng.f() < 0.5 ? 'v' : 'h', span = o === 'v' ? mh : mw, cross = o === 'v' ? mw : mh;
        const c = rng.int(3, cross - 3), L = Math.max(3, Math.round(span * rng.range(0.3, 0.55))), fromLo = rng.f() < 0.5;
        // from the wall on that side into the room
        let s0 = fromLo ? 0 : span - 1;
        while (s0 >= 0 && s0 < span && !(o === 'v' ? at(c - 1, s0) && at(c, s0) : at(s0, c - 1) && at(s0, c))) s0 += fromLo ? 1 : -1;
        const r0 = fromLo ? s0 : s0 + 1 - L, r1 = r0 + L;
        if (r0 < 0 || r1 > span || !floorRun(o, c, r0, r1)) continue;
        items.push({ kind: 'wall', o, c, s0: r0, s1: r1 });
        break;
      }
      // (a copy under 5.5 m across gets one or the other)
      if (!items.length || (!small && rng.f() < 0.6)) {
        const s = rng.f() < 0.6 ? 1 : 2, two = rng.f() < 0.4;
        for (let tries = 0; tries < 20; tries++) {
          const x = rng.int(3, mw - 3 - s), y = rng.int(3, mh - 3 - s), r = [x, y, x + s, y + s];
          if (!clear(r, 2)) continue;
          items.push({ kind: 'column', r });
          if (two) {
            const r2 = alongX ? [mw - x - s, y, mw - x, y + s] : [x, mh - y - s, x + s, mh - y];
            if (clear(r2, 2) && !TG.roverlap([r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3], r2)) items.push({ kind: 'column', r: r2 });
          }
          break;
        }
      }
      // columns first: one on its own needs no walk check, one beside a partition does
      items.sort((p, q) => (p.kind === 'column' ? 0 : 1) - (q.kind === 'column' ? 0 : 1));
      P.rep = { copies: copies.map((cp) => [cp.x, cp.y]), items };
      // a big leftover (the arms of an L or U) mostly gets ordinary rooms, kept
      // 1 m off the copies so they still read as one block
      const block = alongX ? [a0, c0, a0 + totA, c0 + totC] : [c0, a0, c0 + totC, a0 + totA];
      if (P.site.area - TG.rarea(block) > P.site.area * 0.4 && rng.f() < 0.8) surround(P, rng, inset(block, -2), rng.range(0.3, 0.5));
      reach(P, rng, 2);
    },
    furnish(P, walk) {
      const rep = P.rep;
      if (!rep) return;
      for (const [x, y] of rep.copies) for (const it of rep.items) {
        if (it.kind === 'wall') walk.partition(it.o, it.c + (it.o === 'v' ? x : y), it.s0 + (it.o === 'v' ? y : x), it.s1 + (it.o === 'v' ? y : x));
        else walk.column([it.r[0] + x, it.r[1] + y, it.r[2] + x, it.r[3] + y]);
      }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
