/*
 * tpl/fillers/pool.js - the Backrooms filler pool: the first fillers, and
 * the pool as a whole.
 *
 * Each filler is a layout that paints rooms onto the site raster; the engine
 * (engine.js) lands the connections, cleans up, cuts the openings and checks
 * walkability. Units are kit cells (0.5 m). Cells left unpainted stay solid.
 * Shared layout and furnishing pieces are in kit.js.
 *
 * The pool leans enclosed, like the hand-drawn reference maps: clumps of
 * irregular rooms, long thin passages and chains of rooms, with an open hall
 * only now and then. Weights add up to 70 enclosed, 20 mixed, 10 open:
 *
 *   pool.js       warren, passage, enfilade, cells, ring (enclosed);
 *                 broken (mixed); ragged hall, pillar hall (open)
 *   corridors.js  corridor-led fillers (corridor with rooms, beads, comb...)
 *   halls.js      hall-led fillers (loop hall, partition field, aisles...)
 *   rooms.js      room-led fillers (big rooms, tiny entrances, nested...)
 *
 * Not in the pool (weight 0): `yard`, the room a house stands in, which
 * lives with the lots in src/tpl/lot.js.
 *
 * Each filler's `site` ranges are a typical site for it in metres (tools use
 * them; the world sizes sites itself). `fits` is the hard limit, in cells.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL;
  const { VOID, bsp, voidSome, notch, paintPath, route, noiseField } = FILL.lib;
  const { onEdge, blob, paintBlobs, row, slice, stub, alcove, stubWall, gappedWall, freeWall, column } = FILL.kit;
  const dims = (S) => [TG.rw(S.inner), TG.rh(S.inner)];

  // ------------------------------------------------------------ warren
  FILL.register({
    id: 'warren', name: 'Warren', feel: 'enclosed', weight: 18,
    blurb: 'A clump of 3-10 m rooms, most made of 2-3 overlapping rectangles, with off-centre openings and solid pockets between them.',
    doors: { opening: 0.8, door: 0.12, wide: 0.08 }, loops: 0.2,
    fits: (S) => S.area >= 120 && Math.min(...dims(S)) >= 8,
    site: { w: [12, 30], h: [10, 26] },
    layout(P, rng) {
      const rooms = [];
      for (const r of bsp([0, 0, P.W, P.H], rng, 6, 20, 0.3)) { const v = P.add('room', ['warren']); if (blob(P, r, v, rng, { plain: 0.3 })) rooms.push({ v, r }); }
      // a ragged clump: rooms on the edge go solid or get notched more often than inner ones
      const edge = new Set(rooms.filter((q) => onEdge(P, q.v)).map((q) => q.v));
      voidSome(P, rng, rng.range(0.2, 0.4), (v) => edge.has(v));
      voidSome(P, rng, rng.range(0.05, 0.15), (v) => !edge.has(v));
      for (const q of rooms) if (rng.f() < (edge.has(q.v) ? 0.35 : 0.1)) notch(P, q.v, q.r, rng, 6, 5);
    }
  });

  // ------------------------------------------------------------ passage
  FILL.register({
    id: 'passage', name: 'Winding passage', feel: 'enclosed', weight: 8,
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

  // ------------------------------------------------------------ enfilade
  FILL.register({
    id: 'enfilade', name: 'Enfilade', feel: 'enclosed', weight: 6,
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

  // ------------------------------------------------------------ cells
  FILL.register({
    id: 'cells', name: 'Cell cluster', feel: 'enclosed', weight: 4,
    blurb: 'A pocket of 2-4 m rooms and closets among ordinary rooms: a cluster in one end, closets off a short corridor, or small rooms round a middle one.',
    doors: { opening: 0.55, door: 0.45 }, loops: 0.06,
    fits: (S) => S.area >= 144 && S.area <= 1000 && Math.min(...dims(S)) >= 10,
    site: { w: [8, 18], h: [8, 16] },
    layout(P, rng) {
      // the pocket takes 30-60% of the site from one end (all of a small site);
      // ordinary 4-8 m rooms fill the rest
      const all = [0, 0, P.W, P.H], alongX = P.W >= P.H, len = alongX ? P.W : P.H;
      const take = P.site.area < 480 ? len : Math.max(12, Math.round(len * rng.range(0.3, 0.6))), first = rng.f() < 0.5;
      const pocket = alongX ? (first ? [0, 0, take, P.H] : [P.W - take, 0, P.W, P.H]) : (first ? [0, 0, P.W, take] : [0, P.H - take, P.W, P.H]);
      if (take < len) {
        const rest = [];
        for (const r of TG.rsub(all, pocket)) for (const q of bsp(r, rng, 8, 16, 0.35)) { const v = P.add('room', ['warren']); if (blob(P, q, v, rng, { plain: 0.4 })) rest.push(v); }
        voidSome(P, rng, rng.range(0.1, 0.25), (v) => rest.indexOf(v) >= 0);
      }
      const style = rng.weighted({ cluster: 0.45, corridor: 0.35, round: 0.2 });
      const cells = style === 'corridor' ? closetRow(P, rng, pocket) : style === 'round' ? roundRoom(P, rng, pocket) : cluster(P, rng, pocket);
      voidSome(P, rng, rng.range(0.04, 0.12), (v) => cells.indexOf(v) >= 0);
    }
  });

  /** cells: 2-4 m rooms and closets packed in rect q, some neighbours merged into L and T shapes */
  function cluster(P, rng, q) {
    const ids = [];
    for (const r of bsp(q, rng, 4, 8, 0.25)) {
      const v = P.add(TG.rlong(r) <= 6 && rng.f() < 0.4 ? 'closet' : 'cell', ['cells']);
      if (P.paint(r, v, true)) ids.push(v);
    }
    // merge about a quarter into a neighbour, never twice into the same one
    const grown = new Set(), gone = new Set();
    for (const v of ids) {
      if (rng.f() >= 0.25 || grown.has(v)) continue;
      const nb = new Map();
      for (const i of P.cells(v)) {
        const x = i % P.W, y = (i - x) / P.W;
        for (const u of [P.own(x - 1, y), P.own(x + 1, y), P.own(x, y - 1), P.own(x, y + 1)]) if (u >= 0 && u !== v && ids.indexOf(u) >= 0 && !gone.has(u) && !grown.has(u)) nb.set(u, (nb.get(u) || 0) + 1);
      }
      let to = -1, best = 3;
      for (const [u, n] of nb) if (n > best || (n === best && u < to)) { to = u; best = n; }
      if (to < 0) continue;
      for (const i of P.cells(v)) P.R.a[i] = to;
      if (P.rooms[to].type === 'closet') P.rooms[to].type = 'cell';
      grown.add(to); gone.add(v);
    }
    return ids.filter((v) => !gone.has(v));
  }

  /** cells: a short 1-1.5 m corridor down rect q with closets and small rooms off both sides */
  function closetRow(P, rng, q) {
    const alongX = TG.rw(q) >= TG.rh(q), cw = rng.int(2, 3), C0 = alongX ? q[1] : q[0], C1 = alongX ? q[3] : q[2];
    const mid = C0 + Math.floor((C1 - C0 - cw) / 2) + rng.int(-2, 2), c0 = Math.max(C0, Math.min(C1 - cw, mid));
    const hall = P.add('passage', ['cells']), ids = [hall];
    P.paint(alongX ? [q[0], c0, q[2], c0 + cw] : [c0, q[1], c0 + cw, q[3]], hall);
    const d0 = Math.min(c0 - C0, rng.int(4, 8)), d1 = Math.min(C1 - c0 - cw, rng.int(4, 8));
    const sides = [];
    if (d0 >= 4) sides.push(alongX ? [q[0], c0 - d0, q[2], c0] : [c0 - d0, q[1], c0, q[3]]);
    if (d1 >= 4) sides.push(alongX ? [q[0], c0 + cw, q[2], c0 + cw + d1] : [c0 + cw, q[1], c0 + cw + d1, q[3]]);
    for (const s of sides) for (const { v } of row(P, rng, s, alongX, 4, 8, 'cell', ['cells'])) {
      if (rng.f() < 0.35) P.rooms[v].type = 'closet';
      P.require.push([hall, v]); ids.push(v);
    }
    return ids;
  }

  /** cells: a 4-6 m room in the middle of rect q with a band of small rooms round it */
  function roundRoom(P, rng, q) {
    const d = rng.int(4, 6), mw = Math.min(TG.rw(q) - 2 * d, rng.int(8, 12)), mh = Math.min(TG.rh(q) - 2 * d, rng.int(8, 12));
    if (mw < 6 || mh < 6) return cluster(P, rng, q);
    const mx = q[0] + d + rng.int(0, TG.rw(q) - 2 * d - mw), my = q[1] + d + rng.int(0, TG.rh(q) - 2 * d - mh);
    const mid = P.add('room', ['cells', 'middle']), ids = [mid];
    P.paint([mx, my, mx + mw, my + mh], mid);
    const o = [mx - d, my - d, mx + mw + d, my + mh + d];
    const bands = [[[o[0], o[1], o[2], my], true], [[o[0], my + mh, o[2], o[3]], true], [[o[0], my, mx, my + mh], false], [[mx + mw, my, o[2], my + mh], false]];
    for (const [s, ax] of bands) for (const { v, r } of row(P, rng, s, ax, 4, 8, 'cell', ['cells'])) {
      ids.push(v);
      if (TG.rinter([r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1], [mx, my, mx + mw, my + mh]) && rng.f() < 0.6) P.require.push([mid, v]);
    }
    return ids;
  }

  // ------------------------------------------------------------ ring
  FILL.register({
    id: 'ring', name: 'Ring', feel: 'enclosed', weight: 3,
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
        paintBlobs(P, around, 'room', ['warren'], rng, { plain: 0.4 });
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
    id: 'broken', name: 'Broken room', feel: 'mixed', weight: 4,
    blurb: 'A mid-size room cut up by stub walls and partial partitions, with small rooms or solid around it.',
    doors: { opening: 0.8, door: 0.1, wide: 0.1 }, loops: 0.15,
    fits: (S) => Math.min(...dims(S)) >= 14,
    site: { w: [16, 30], h: [16, 28] },
    layout(P, rng) {
      // a 10-18 m hall somewhere in the site; a warren or solid around it
      const I = P.inner, hw = Math.min(TG.rw(I), rng.int(20, 36)), hh = Math.min(TG.rh(I), rng.int(20, 36));
      const hx = I[0] + rng.int(0, TG.rw(I) - hw), hy = I[1] + rng.int(0, TG.rh(I) - hh);
      const hall = [hx, hy, hx + hw, hy + hh];
      if (rng.f() < 0.75) paintBlobs(P, bsp([0, 0, P.W, P.H], rng, 5, 12, 0.3).flatMap((r) => TG.rsub(r, hall)).filter((q) => TG.rshort(q) >= 4), 'room', ['warren'], rng, { plain: 0.4 });
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

  // ------------------------------------------------------------ ragged hall
  FILL.register({
    id: 'ragged_hall', floors: { sunken: { p: 0.3, rooms: ['hall'], size: [4, 7], depth: [0.6, 1.2] } }, name: 'Ragged hall', feel: 'open', weight: 3,
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
    id: 'pillar_hall', floors: { gallery: { p: 0.45, rooms: ['hall'] }, sunken: { p: 0.15, rooms: ['hall'], size: [3.5, 6], depth: [0.6, 1] } }, vertical: { prefer: ['ramp', 'stair', 'ladder'] }, name: 'Pillar hall', feel: 'open', weight: 2,
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
})(typeof window !== 'undefined' ? window : globalThis);
