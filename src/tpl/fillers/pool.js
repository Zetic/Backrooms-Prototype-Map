/*
 * tpl/fillers/pool.js - the Backrooms filler pool.
 *
 * Each filler is a layout that paints rooms onto the site raster; the engine
 * (engine.js) lands the connections, cleans up, cuts the openings and checks
 * walkability. Units are kit cells (0.5 m). Cells left unpainted stay solid.
 *
 * The pool leans enclosed, like the hand-drawn reference map: clumps of
 * small irregular rooms, long thin passages and chains of rooms, with an
 * open hall only now and then.
 *
 *   enclosed  warren, passage, enfilade, cells, ring          (weight 70)
 *   mixed     broken room                                     (weight 20)
 *   open      ragged hall, pillar hall                        (weight 10)
 *
 * Not in the pool (weight 0): `host`, the hall the world wraps round a POI
 * building (src/world.js passes the POI's site as a hint).
 *
 * Each filler's `site` ranges are a typical site for it (tools use them; the
 * world sizes sites itself). `fits` is the hard limit.
 *
 * Ideas from the old world-first fill (since removed): its Backrooms zones
 * (open, split, warren, ring, gallery, corridorRooms...) and its knobs
 * (room scale, pillars, pOpen, pLoop, pWide), here retuned for less open
 * floor and more solid between rooms.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL;
  const { VOID, bsp, voidSome, notch, paintRooms, paintPath, route, noiseField } = FILL.lib;
  const dims = (S) => [TG.rw(S.inner), TG.rh(S.inner)];

  // ------------------------------------------------------------ warren
  FILL.register({
    id: 'warren', name: 'Warren', feel: 'enclosed', weight: 26,
    blurb: 'A clump of 3-10 m rooms with jagged outlines and off-centre openings; solid gaps between them.',
    doors: { opening: 0.8, door: 0.12, wide: 0.08 }, loops: 0.2,
    fits: (S) => S.area >= 120 && Math.min(...dims(S)) >= 8,
    site: { w: [12, 30], h: [10, 26] },
    layout(P, rng) {
      const rects = bsp([0, 0, P.W, P.H], rng, 6, 20, 0.3);
      const ids = paintRooms(P, rects, 'room', ['warren']);
      // a ragged clump: rooms on the edge go solid or get notched more often than inner ones
      const edge = new Set(ids.filter((v) => onEdge(P, v)));
      voidSome(P, rng, rng.range(0.2, 0.4), (v) => edge.has(v));
      voidSome(P, rng, rng.range(0.05, 0.15), (v) => !edge.has(v));
      ids.forEach((v, k) => { if (rng.f() < (edge.has(v) ? 0.6 : 0.25)) notch(P, v, rects[k], rng, 6, 5); });
    }
  });

  /** does room v touch the site outline? */
  function onEdge(P, v) {
    for (const i of P.cells(v)) {
      const x = i % P.W, y = (i - x) / P.W;
      if (!P.inSite(x - 1, y) || !P.inSite(x + 1, y) || !P.inSite(x, y - 1) || !P.inSite(x, y + 1)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ passage
  FILL.register({
    id: 'passage', name: 'Winding passage', feel: 'enclosed', weight: 16,
    blurb: 'A 1-2 m corridor that kinks between the connections, with alcoves and the odd dead-end stub.',
    doors: { opening: 1 }, loops: 0,
    fits: () => true,
    site: { w: [8, 26], h: [8, 24] },
    layout(P, rng) {
      const b = rng.f() < 0.55 ? 2 : rng.f() < 0.7 ? 3 : 4;
      const v = P.add('passage', ['winding']);
      const I = P.inner, iw = TG.rw(I), ih = TG.rh(I);
      // a hub somewhere in the middle half of the site
      const hx = I[0] + Math.floor(iw * 0.25) + rng.int(0, Math.max(0, Math.floor(iw * 0.5) - b));
      const hy = I[1] + Math.floor(ih * 0.25) + rng.int(0, Math.max(0, Math.floor(ih * 0.5) - b));
      const hub = [hx, hy, Math.min(I[2], hx + b), Math.min(I[3], hy + b)];
      P.paint(hub, v);
      if (rng.f() < 0.3 && iw >= 12 && ih >= 12) {          // a widening at the hub
        const s = rng.int(6, Math.min(12, iw - 4, ih - 4)), x = Math.max(I[0], Math.min(I[2] - s, hx - (s >> 1))), y = Math.max(I[1], Math.min(I[3] - s, hy - (s >> 1)));
        P.paint([x, y, x + s, y + s], P.add('room', ['widening']), true);
      }
      const noise = noiseField(P, P.seed, rng.range(4, 9));
      const built = (i) => P.R.a[i] >= 0;
      const free = (i) => P.mask.a[i] === 1 && P.R.a[i] === VOID;
      for (const c of P.conns) {
        const q = c.landing, start = [Math.floor((q[1] + q[3]) / 2) * P.W + Math.floor((q[0] + q[2]) / 2)];
        if (built(start[0])) continue;
        const path = route(P, start, { ok: free, goal: built, noise, noiseW: 3, turn: 7 });
        if (path) paintPath(P, path.slice(0, -1), Math.min(b, c.s1 - c.s0), v);
      }
      // dead-end stubs
      const stubs = rng.int(0, 2) + (P.site.area > 1600 ? 1 : 0);
      for (let k = 0; k < stubs; k++) stub(P, v, rng, b, rng.int(4, 14));
      // alcoves off the passage
      const alc = rng.int(0, 3);
      for (let k = 0; k < alc; k++) alcove(P, v, rng, rng.f() < 0.7 ? 'alcove' : 'closet');
    }
  });

  /** a straight dead end from a random cell of room v, b wide, up to len long */
  function stub(P, v, rng, b, len) {
    const cells = P.cells(v);
    if (!cells.length) return;
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
      if (path.length >= 4) { paintPath(P, path, b, v); return; }
    }
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

  // ------------------------------------------------------------ enfilade
  FILL.register({
    id: 'enfilade', name: 'Enfilade', feel: 'enclosed', weight: 14,
    blurb: 'A chain of rooms in a row, each through an off-centre opening; sometimes it turns a corner.',
    doors: { opening: 0.85, door: 0.15 }, loops: 0,
    fits: (S) => Math.max(...dims(S)) >= 16 && Math.min(...dims(S)) >= 6,
    site: { w: [16, 32], h: [8, 20] },
    layout(P, rng) {
      const I = P.inner, alongX = TG.rw(I) >= TG.rh(I);
      const A0 = alongX ? I[0] : I[1], A1 = alongX ? I[2] : I[3], C0 = alongX ? I[1] : I[0], C1 = alongX ? I[3] : I[2];
      const rect = (a0, a1, c0, c1) => (alongX ? [a0, c0, a1, c1] : [c0, a0, c1, a1]);
      const band = Math.min(C1 - C0, rng.int(7, 14)), c0 = C0 + rng.int(0, C1 - C0 - band);
      const chain = slice(P, rng, A0, A1, (a, b) => rect(a, b, c0, c0 + band));
      // sometimes the chain turns: an arm off one end across the rest of the site
      const room0 = C1 - (c0 + band), room1 = c0 - C0;
      if (Math.max(room0, room1) >= 10 && rng.f() < 0.4 && chain.length) {
        const atEnd = rng.f() < 0.5, end = atEnd ? chain[chain.length - 1] : chain[0];
        const er = end.r, ea0 = alongX ? er[0] : er[1], ea1 = alongX ? er[2] : er[3];
        const span = [ea0, Math.min(ea1, ea0 + 14)], down = room0 >= room1;
        const arm = slice(P, rng, down ? c0 + band : C0, down ? C1 : c0, (a, b) => rect(span[0], span[1], a, b), !down);
        if (arm.length) P.require.push([end.v, arm[0].v]);
      }
      // a couple of side rooms
      const sides = rng.int(0, 2);
      for (let k = 0; k < sides && chain.length; k++) {
        const pc = chain[rng.int(0, chain.length - 1)].r, d = rng.int(4, 8), l = rng.int(4, 8);
        const a = (alongX ? pc[0] : pc[1]) + rng.int(0, 2);
        const q = rng.f() < 0.5 ? rect(a, a + l, c0 - d, c0) : rect(a, a + l, c0 + band, c0 + band + d);
        if (P.allVoid(q)) P.paint(q, P.add(rng.f() < 0.5 ? 'closet' : 'room', ['side']));
      }
    }
  });

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

  // ------------------------------------------------------------ cells
  FILL.register({
    id: 'cells', name: 'Cell cluster', feel: 'enclosed', weight: 8,
    blurb: 'Tiny 2-4 m rooms and closets packed together; mostly a tree, so it reads like a maze.',
    doors: { opening: 0.55, door: 0.45 }, loops: 0.06,
    fits: (S) => S.area >= 64 && Math.min(...dims(S)) >= 6,
    site: { w: [8, 18], h: [8, 16] },
    layout(P, rng) {
      paintRooms(P, bsp([0, 0, P.W, P.H], rng, 4, 8, 0.25), 'cell', ['cells']);
      voidSome(P, rng, rng.range(0.06, 0.16));
    }
  });

  // ------------------------------------------------------------ ring
  FILL.register({
    id: 'ring', name: 'Ring', feel: 'enclosed', weight: 6,
    blurb: 'Rooms around a solid core (sometimes a closet), joined in a loop; a warren or solid around it.',
    doors: { opening: 0.85, door: 0.15 }, loops: 0.1,
    fits: (S) => Math.min(...dims(S)) >= 22,
    site: { w: [14, 30], h: [14, 28] },
    layout(P, rng) {
      // the ring is 14-26 m across, somewhere in the site; the rest is warren or solid
      const I = P.inner, ow = Math.min(TG.rw(I), rng.int(28, 52)), oh = Math.min(TG.rh(I), rng.int(28, 52));
      const ox = I[0] + rng.int(0, TG.rw(I) - ow), oy = I[1] + rng.int(0, TG.rh(I) - oh);
      const o = [ox, oy, ox + ow, oy + oh], b = rng.int(4, 7);
      const core = [o[0] + b, o[1] + b, o[2] - b, o[3] - b];
      // outside the ring first: a warren or solid
      if (rng.f() < 0.7) {
        const around = [];
        for (const r of bsp([0, 0, P.W, P.H], rng, 6, 14, 0.3)) for (const q of TG.rsub(r, o)) if (TG.rshort(q) >= 4) around.push(q);
        paintRooms(P, around, 'room', ['warren']);
      }
      const pieces = [];
      const split = (a0, a1, mk) => {
        const n = a1 - a0 > 20 && rng.f() < 0.7 ? 2 : 1, cut = a0 + Math.round((a1 - a0) / 2) + rng.int(-3, 3);
        return n === 1 ? [mk(a0, a1)] : [mk(a0, cut), mk(cut, a1)];
      };
      pieces.push(...split(o[0], o[2], (a, c) => [a, o[1], c, o[1] + b]));                 // top, left to right
      pieces.push([o[2] - b, o[1] + b, o[2], o[3] - b]);                                    // right
      pieces.push(...split(o[0], o[2], (a, c) => [a, o[3] - b, c, o[3]]).reverse());        // bottom, right to left
      pieces.push([o[0], o[1] + b, o[0] + b, o[3] - b]);                                    // left
      const ids = pieces.map((r) => { const v = P.add('room', ['ring']); P.paint(r, v); return v; });
      for (let k = 0; k < ids.length; k++) P.require.push([ids[k], ids[(k + 1) % ids.length]]);
      if (rng.f() < 0.3 && TG.rshort(core) >= 4 && TG.rlong(core) <= 14) P.paint(core, P.add('closet', ['core']));
      else P.paint(core, VOID);
      voidSome(P, rng, 0.35, (v) => P.rooms[v].tags.indexOf('warren') >= 0);
    }
  });

  // ------------------------------------------------------------ broken room
  FILL.register({
    id: 'broken', name: 'Broken room', feel: 'mixed', weight: 20,
    blurb: 'A mid-size room cut up by stub walls and partial partitions, with small rooms or solid around it.',
    doors: { opening: 0.8, door: 0.1, wide: 0.1 }, loops: 0.15,
    fits: (S) => Math.min(...dims(S)) >= 14,
    site: { w: [16, 30], h: [16, 28] },
    layout(P, rng) {
      // a 10-18 m hall somewhere in the site; a warren or solid around it
      const I = P.inner, hw = Math.min(TG.rw(I), rng.int(20, 36)), hh = Math.min(TG.rh(I), rng.int(20, 36));
      const hx = I[0] + rng.int(0, TG.rw(I) - hw), hy = I[1] + rng.int(0, TG.rh(I) - hh);
      const hall = [hx, hy, hx + hw, hy + hh];
      if (rng.f() < 0.75) paintRooms(P, bsp([0, 0, P.W, P.H], rng, 5, 12, 0.3).flatMap((r) => TG.rsub(r, hall)).filter((q) => TG.rshort(q) >= 4), 'room', ['warren']);
      const v = P.add('hall', ['broken']);
      P.paint(hall, v);
      for (let k = rng.int(0, 2); k > 0; k--) notch(P, v, hall, rng, 8, 10);
      voidSome(P, rng, 0.45, (x) => x !== v);
      P.hall = v;
    },
    furnish(P, walk, rng) {
      const v = P.hall, r = P.bigRect(v);
      if (!r) return;
      const w = TG.rw(r), h = TG.rh(r);
      // a partial partition across the room (a wall with a gap), then stubs
      if (rng.f() < 0.6) gappedWall(walk, r, rng);
      const n = Math.round(rng.range(1.5, 3) + (w * h) / 250);
      for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) if (stubWall(walk, r, rng, rng.range(0.3, 0.7))) k++;
      if (rng.f() < 0.35) freeWall(walk, r, rng);
      if (rng.f() < 0.2) for (let k = rng.int(1, 3); k > 0; k--) column(walk, r, rng);
    }
  });

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
  function column(walk, r, rng) {
    const s = rng.f() < 0.6 ? 1 : 2;
    if (TG.rw(r) < s + 6 || TG.rh(r) < s + 6) return false;
    const x = rng.int(r[0] + 3, r[2] - 3 - s), y = rng.int(r[1] + 3, r[3] - 3 - s);
    return walk.column([x, y, x + s, y + s]);
  }

  // ------------------------------------------------------------ ragged hall
  FILL.register({
    id: 'ragged_hall', name: 'Ragged hall', feel: 'open', weight: 5,
    blurb: 'A big room with a notched, uneven outline, a few columns and sometimes a solid block in the middle.',
    doors: { opening: 0.7, wide: 0.3 }, loops: 0.3,
    fits: (S) => Math.min(...dims(S)) >= 24,
    site: { w: [16, 36], h: [16, 32] },
    layout(P, rng) {
      const v = P.add('hall', ['ragged']);
      P.paint([0, 0, P.W, P.H], v);
      const bb = [0, 0, P.W, P.H];
      for (let k = rng.int(5, 10); k > 0; k--) notch(P, v, bb, rng, 10, 12);
      if (rng.f() < 0.4) {                                     // a solid block to walk around
        const s = rng.int(4, 10), t = rng.int(4, 10), I = P.inner;
        if (TG.rw(I) > s + 12 && TG.rh(I) > t + 12) {
          const x = rng.int(I[0] + 6, I[2] - 6 - s), y = rng.int(I[1] + 6, I[3] - 6 - t);
          P.recolor([x, y, x + s, y + t], v, VOID);
        }
      }
      // a few nooks walled off along the edge
      for (let k = rng.int(0, 3); k > 0; k--) {
        const I = P.inner, w = rng.int(5, 9), h = rng.int(5, 8), side = rng.int(0, 1);
        const x = rng.int(I[0], I[2] - w), y = side ? I[1] : I[3] - h;
        const q = [x, y, x + w, y + h];
        if (!P.hitsLanding(q)) P.recolor(q, v, P.add('room', ['nook']));
      }
      P.hall = v;
    },
    furnish(P, walk, rng) {
      const r = P.bigRect(P.hall);
      if (!r) return;
      if (rng.f() < 0.45) for (let k = rng.int(2, 6); k > 0; k--) column(walk, r, rng);
      if (rng.f() < 0.3) for (let k = rng.int(1, 2); k > 0; k--) stubWall(walk, r, rng, rng.range(0.15, 0.35));
    }
  });

  // ------------------------------------------------------------ pillar hall
  FILL.register({
    id: 'pillar_hall', name: 'Pillar hall', feel: 'open', weight: 5,
    blurb: 'An open floor on a grid of columns; the rare big space between the enclosed stretches.',
    doors: { opening: 0.6, wide: 0.4 }, loops: 0.3,
    fits: (S) => Math.min(...dims(S)) >= 24,
    site: { w: [16, 36], h: [16, 32] },
    layout(P, rng) {
      const v = P.add('hall', ['pillars']);
      P.paint([0, 0, P.W, P.H], v);
      for (let k = rng.int(0, 3); k > 0; k--) notch(P, v, [0, 0, P.W, P.H], rng, 6, 16);
      P.hall = v;
    },
    furnish(P, walk, rng) {
      const r = P.bigRect(P.hall);
      if (!r) return;
      const sp = rng.int(7, 12), s = rng.f() < 0.6 ? 1 : 2, ox = rng.int(2, sp), oy = rng.int(2, sp);
      for (let y = r[1] + oy; y + s <= r[3] - 2; y += sp) for (let x = r[0] + ox; x + s <= r[2] - 2; x += sp) walk.column([x, y, x + s, y + s]);
    }
  });

  // ------------------------------------------------------------ host (not in the pool)
  FILL.register({
    id: 'host', name: 'Host hall', feel: 'open', weight: 0,
    blurb: 'A big hall wrapped round a POI building, plain Backrooms beyond it. The world uses it for POI sites; it is not in the pool.',
    doors: { opening: 0.75, door: 0.15, wide: 0.1 }, loops: 0.25,
    fits: (S) => Math.min(...dims(S)) >= 8,
    site: { w: [24, 44], h: [22, 40] },
    layout(P, rng) {
      // the hall: the POI's site (the hint) plus 1-3 m round it; without a hint, the middle of the site
      const c = P.inner, mx = TG.rw(c) >> 2, my = TG.rh(c) >> 2;
      const hall = P.hint && P.hint.hall.length ? P.hint.hall : [[c[0] + mx, c[1] + my, c[2] - mx, c[3] - my]];
      const grow = rng.int(2, 6), v = P.add('hall', ['host']);
      for (const q of hall) P.paint([q[0] - grow, q[1] - grow, q[2] + grow, q[3] + grow], v);
      P.hall = v;
      // beyond it: a warren, part of it left solid
      const ids = paintRooms(P, bsp([0, 0, P.W, P.H], rng, 6, 18, 0.3), 'room', ['host'], true);
      voidSome(P, rng, rng.range(0.25, 0.45), (k) => ids.indexOf(k) >= 0);
    },
    furnish(P, walk, rng) {
      if (rng.f() < 0.5) return;
      const r = P.bigRect(P.hall);
      if (!r || TG.rshort(r) < 14) return;
      const sp = rng.int(8, 12), ox = rng.int(3, sp), oy = rng.int(3, sp);
      for (let y = r[1] + oy; y + 1 <= r[3] - 3; y += sp) for (let x = r[0] + ox; x + 1 <= r[2] - 3; x += sp) walk.column([x, y, x + 1, y + 1]);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
