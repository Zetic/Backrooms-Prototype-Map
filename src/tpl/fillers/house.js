/*
 * tpl/fillers/house.js - house floors: the rooms of a house, laid out the way
 * a house lays them out, for a growth's `houseroom` branches (biomes.js).
 *
 * Not backrooms that feel like a house: every room is a house room of the
 * catalogue (tpl/catalogue.js), with its type, label, tags and ceiling - a
 * bedroom, a bathroom, a linen closet, a kitchen - and every one opens off a
 * house hallway, as a house's rooms do. Only the solid between them is the
 * backrooms'.
 *
 *   hallways   one hallway (1-2 m) down the long way of the site, or two or
 *              three side by side on a deep site, joined by a cross hallway;
 *              the legs of an L or U site get one of their own, and a short
 *              run out to each of the site's doors
 *   rooms      packed along both sides of every hallway, each at the size
 *              its type takes, drawn from the floor's program (what kind of
 *              floor of a house it is) with no type past its share
 *   ends       a room across the end of a hallway now and then: a master
 *              bedroom with its ensuite and walk-in closet off it, or a
 *              living room
 *   open plan  on a living floor, a living room, dining room and kitchen
 *              side by side often have no wall between them
 *
 *   house_bedrooms  bedrooms, bathrooms and linen closets down a hallway,
 *                   a master suite at the end
 *   house_living    living room, dining room, kitchen and pantry, family
 *                   room, foyer, laundry, a half bath
 *   house_upstairs  an upstairs hall: bedrooms, a bathroom, a study, a
 *                   sitting room, the laundry
 *
 * Not in the pool (weight 0): a growth's branch asks for them by its biome.
 * Units are kit cells (0.5 m).
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL, CAT = BR.TPL.CAT;
  const C = FILL.corridor;
  const dims = (S) => [TG.rw(S.inner), TG.rh(S.inner)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------ room types
  // the catalogue's house rooms as filler rooms (the filler's 'hall' is a
  // backrooms hall, so a house's hallway is 'hallway' here)
  const KINDS = { hallway: 'hall', foyer: 'foyer', living: 'living', family: 'family', dining: 'dining', kitchen: 'kitchen', pantry: 'pantry',
    laundry: 'laundry', mudroom: 'mudroom', office: 'office', utility: 'utility', bedroom: 'bedroom', master: 'master', bath: 'bath', ensuite: 'ensuite', wic: 'wic', linen: 'linen' };
  for (const [type, c] of Object.entries(KINDS)) {
    const e = CAT.ROOMS[c];
    FILL.TYPES[type] = { zone: e.zone, tags: ['house'].concat(e.tags), ceil: e.ceil.slice(), label: e.label || c };
  }
  FILL.HOUSE_TYPES = Object.keys(KINDS);

  // each room's width along the hallway and depth back from it (cells)
  const SIZE = {
    bedroom: { w: [6, 9], d: [7, 9] }, master: { w: [8, 10], d: [8, 10] }, office: { w: [5, 7], d: [6, 8] },
    bath: { w: [4, 6], d: [5, 7] }, ensuite: { w: [4, 5], d: [4, 6] }, wic: { w: [3, 5], d: [4, 6] }, linen: { w: [2, 3], d: [2, 3] },
    living: { w: [9, 13], d: [9, 12] }, family: { w: [8, 11], d: [8, 11] }, dining: { w: [6, 8], d: [6, 8] }, kitchen: { w: [6, 8], d: [6, 8] },
    pantry: { w: [3, 4], d: [3, 5] }, utility: { w: [3, 5], d: [3, 5] }, laundry: { w: [4, 6], d: [4, 6] }, mudroom: { w: [4, 5], d: [4, 6] }, foyer: { w: [4, 6], d: [4, 6] }
  };
  // what kind of floor of a house: hallway width and room depth (cells), each
  // type's weight and how many at most in 200 m² of site (in the house, for
  // the ONE rooms), the rooms across a hallway's end, and which neighbours may stand open to each other
  const PROGRAMS = {
    bedrooms: { hall: [2, 3], depth: [7, 9], end: ['master'],
      rooms: { bedroom: [5, 99], bath: [2.5, 2], linen: [1.2, 2], wic: [0.4, 1], office: [0.6, 1] } },
    living: { hall: [3, 4], depth: [9, 12], end: ['living', 'family'], open: [['living', 'dining'], ['dining', 'kitchen'], ['living', 'family']],
      rooms: { living: [3, 2], dining: [2, 1], kitchen: [2, 1], family: [1.5, 1], pantry: [0.8, 1], laundry: [1, 1], bath: [1, 2], foyer: [0.8, 1], mudroom: [0.6, 1], office: [0.6, 1], bedroom: [0.2, 99] } },
    upstairs: { hall: [2, 3], depth: [7, 9], end: ['master', 'family'],
      rooms: { bedroom: [3, 99], bath: [2, 2], linen: [1, 2], family: [1, 1], office: [1.2, 1], laundry: [0.8, 1], wic: [0.5, 1] } }
  };
  // a room never beside another of the same type: these
  const ALONE = new Set(['bath', 'linen', 'wic', 'pantry', 'laundry', 'mudroom', 'foyer', 'kitchen', 'dining']);
  // one house has one of these however big the floor
  const ONE = new Set(['kitchen', 'dining', 'foyer', 'pantry', 'laundry', 'mudroom']);

  /** the next room type: by weight, none past its share, the small ones never twice running */
  function nextType(rng, prog, used, prev, room) {
    const w = {};
    for (const [t, [wt, max]] of Object.entries(prog.rooms)) {
      if ((used[t] || 0) >= (ONE.has(t) ? max : Math.round(max * used.k)) || (t === prev && ALONE.has(t))) continue;
      if (room !== undefined && SIZE[t].w[0] > room) continue;
      w[t] = wt;
    }
    return Object.keys(w).length ? rng.weighted(w) : null;
  }

  /** house rooms packed along side `side` of hallway segment s, at most dmax deep */
  function packSide(P, rng, s, side, hall, dmax, prog, used) {
    for (const [a, b] of C.freeRuns(P, s, side, hall, 3)) {
      let t = a, prev = null, prevV = -1;
      while (b - t >= 2) {
        let type = nextType(rng, prog, used, prev, b - t);
        if (!type) { if (b - t >= 2) type = 'linen'; else break; }
        const z = SIZE[type];
        let w = Math.min(rng.int(z.w[0], z.w[1]), b - t);
        // never leave a sliver of run: the room takes it
        if (b - t - w < 2) w = b - t;
        const dfree = C.depthFree(P, s, side, t, t + w, dmax);
        if (dfree < 2) { t++; prev = null; prevV = -1; continue; }
        // a room that would leave a strip of solid behind it reaches back to it
        const d = dfree <= z.d[1] * 1.5 && SIZE[type].w[0] >= 6 ? dfree : Math.min(dfree, rng.int(z.d[0], z.d[1]));
        if (w * d < 4) { t += w; continue; }
        const v = P.add(type, []);
        P.paint(C.band(s, side, t, t + w, 0, d), v);
        P.require.push([hall, v]);
        if (prevV >= 0 && prog.open && prog.open.some(([p, q]) => (p === prev && q === type) || (q === prev && p === type)) && rng.f() < 0.6) P.open.push([prevV, v]);
        used[type] = (used[type] || 0) + 1;
        prev = type; prevV = v;
        t += w;
      }
    }
  }

  /**
   * What packing leaves: every pocket of solid at least 1.5 m across that
   * meets the floor becomes a room, at most 5 x 6 m. Off the hallway, a room
   * of the program; off a room only, what opens off that room in a house: a
   * walk-in closet or ensuite off a bedroom, a pantry off a kitchen, a linen
   * closet or a storage room off the rest, a study where it is bigger.
   */
  function infill(P, rng, hall, prog, used) {
    const W = P.W, H = P.H, R = P.R.a, free = new TG.Raster(W, H, 0), skip = new Uint8Array(W * H);
    const CLOSET = { kitchen: 'pantry' };
    for (let n = 0; n < 60; n++) {
      for (let i = 0; i < W * H; i++) free.a[i] = P.mask.a[i] === 1 && R[i] === FILL.lib.VOID && !skip[i] && !P.land[i] ? 1 : 0;
      let r = TG.largestRect(free, (v) => v === 1);
      if (!r || TG.rshort(r) < 3 || TG.rarea(r) < 12) return;
      // the side that meets the most floor, and who is there
      const meet = { N: new Map(), S: new Map(), W: new Map(), E: new Map() };
      const add = (side, x, y) => { const v = P.own(x, y); if (v >= 0) meet[side].set(v, (meet[side].get(v) || 0) + 1); };
      for (let x = r[0]; x < r[2]; x++) { add('N', x, r[1] - 1); add('S', x, r[3]); }
      for (let y = r[1]; y < r[3]; y++) { add('W', r[0] - 1, y); add('E', r[2], y); }
      const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
      const side = Object.keys(meet).sort((a, b) => total(meet[b]) - total(meet[a]))[0];
      if (!total(meet[side])) { for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) skip[y * W + x] = 1; continue; }
      // at most 6 m along that side and 5 m back from it
      const along = side === 'N' || side === 'S', len = along ? TG.rw(r) : TG.rh(r), deep = along ? TG.rh(r) : TG.rw(r);
      const m = meet[side], who = m.has(hall) && m.get(hall) >= 2 ? hall : [...m.keys()].sort((a, b) => m.get(b) - m.get(a) || a - b)[0];
      const run = [...(along ? [r[0], r[2]] : [r[1], r[3]])], dd = Math.min(deep, 10);
      if (len > 12) { const o = rng.int(0, len - 12); run[0] += o; run[1] = run[0] + 12; }
      r = along ? [run[0], side === 'N' ? r[1] : r[3] - dd, run[1], side === 'N' ? r[1] + dd : r[3]]
        : [side === 'W' ? r[0] : r[2] - dd, run[0], side === 'W' ? r[0] + dd : r[2], run[1]];
      const room = TG.rarea(r) * 0.25, of = P.rooms[who].type;
      const bed = of === 'bedroom' || of === 'master';
      let type = who === hall ? nextType(rng, prog, used, null, Math.max(TG.rw(r), TG.rh(r))) || (room > 4 ? 'office' : 'linen')
        : bed ? (room > 6 && room <= 8 ? 'ensuite' : 'wic') : room <= 4 ? CLOSET[of] || 'linen' : room <= 9 ? (of === 'kitchen' ? 'pantry' : 'utility') : 'office';
      const v = P.add(type, []);
      P.paint(r, v, true);
      P.require.push([who, v]);
      used[type] = (used[type] || 0) + 1;
    }
  }

  function layout(P, rng, F) {
    const prog = PROGRAMS[F.program], I = P.inner, alongX = TG.rw(I) >= TG.rh(I);
    const C0 = alongX ? I[1] : I[0], C1 = alongX ? I[3] : I[2], CN = C1 - C0;
    const cw = rng.int(prog.hall[0], prog.hall[1]), D = rng.int(prog.depth[0], prog.depth[1]);
    const hall = P.add('hallway', []), used = { k: Math.max(1, P.site.area * 0.25 / 200) };
    P.hall = hall; P.open = P.open || []; P.passage = 'hallway';
    // the hallways: one per band of the site's depth, centred in it; on a
    // site too shallow for rooms both sides, along one edge
    const n = clamp(Math.round(CN / (cw + 2 * D)), 1, 3), segs = [];
    for (let k = 0; k < n; k++) {
      let c0 = Math.round(C0 + (k + 0.5) * CN / n - cw / 2);
      if (n === 1 && CN < cw + 12) c0 = rng.f() < 0.5 ? C0 : C1 - cw;
      const r = C.runAt(P, alongX, c0, c0 + cw);
      if (r[1] - r[0] >= 4) segs.push({ alongX, a0: r[0], a1: r[1], c0, c1: c0 + cw });
    }
    if (!segs.length) segs.push(C.spine(P, rng, alongX, cw, 0.5));
    const main = segs.slice(), half = Math.max(3, Math.ceil((CN / segs.length - cw) / 2));
    // side by side: a cross hallway joins them, at one end or part way along
    if (segs.length > 1) {
      const lo = Math.max(...segs.map((s) => s.a0)), hi = Math.min(...segs.map((s) => s.a1));
      if (hi - lo >= cw) {
        const t = hi - lo < cw + 16 || rng.f() < 0.4 ? (rng.f() < 0.5 ? lo : hi - cw) : rng.int(lo + 6, hi - cw - 6);
        segs.push({ alongX: !alongX, a0: segs[0].c0, a1: segs[segs.length - 1].c1, c0: t, c1: t + cw });
      }
    }
    // a room across the end of a hallway: the master suite, the living room
    const ends = [];
    for (const s of main) {
      if (rng.f() >= 0.6) continue;
      const type = prog.end[rng.int(0, prog.end.length - 1)], z = SIZE[type], e = rng.int(z.d[0], z.d[1]);
      if (s.a1 - s.a0 < e + 12) continue;
      const hiEnd = rng.f() < 0.5, a0 = hiEnd ? s.a1 - e : s.a0, a1 = hiEnd ? s.a1 : s.a0 + e;
      if (hiEnd) s.a1 -= e; else s.a0 += e;
      const k0 = rng.int(2, half), k1 = rng.int(2, half);
      ends.push({ type, r: s.alongX ? [a0, s.c0 - k0, a1, s.c1 + k1] : [s.c0 - k0, a0, s.c1 + k1, a1] });
    }
    for (const s of segs) P.paint(C.segRect(s), hall);
    for (const E of ends) {
      const v = P.add(E.type, []);
      if (!P.paint(E.r, v, true)) continue;
      P.require.push([hall, v]);
      used[E.type] = (used[E.type] || 0) + 1;
      // a master bedroom has its own bathroom and walk-in closet
      if (E.type === 'master') { C.hang(P, rng, v, 4, 5, 4, 6, 'ensuite', []); if (rng.f() < 0.7) C.hang(P, rng, v, 3, 4, 3, 5, 'wic', []); }
    }
    // the legs of an L or U site get a hallway of their own, and every door
    // of the site a short run of hallway to it
    const arms = C.arms(P, rng, hall, cw, D + 3, 2);
    C.reach(P, (v) => v === hall, cw, hall, { turn: 10, keep: 0 });
    for (const c of P.conns) if (C.touches(P, c.landing, (v) => v === hall)) P.paint(c.landing, hall, true);
    for (const s of main) for (const side of [-1, 1]) packSide(P, rng, s, side, hall, half, prog, used);
    for (const s of segs.slice(main.length).concat(arms)) for (const side of [-1, 1]) packSide(P, rng, s, side, hall, D, prog, used);
    infill(P, rng, hall, prog, used);
  }

  const register = (id, program, name, weight, blurb, fits, doors) => FILL.register({
    id, program, biomes: ['houseroom'], biomeWeight: weight, weight: 0, name, feel: 'enclosed', blurb, doors, loops: 0.03, fits,
    site: { w: [10, 32], h: [8, 24] }, layout
  });
  register('house_bedrooms', 'bedrooms', 'Bedroom hallway', 3,
    'A house\'s bedroom wing: bedrooms, bathrooms and linen closets either side of a 1-1.5 m hallway, now and then a master bedroom across its end with its ensuite and walk-in closet. Growth branches only.',
    (S) => Math.min(...dims(S)) >= 12, { door: 1 });
  register('house_living', 'living', 'Living rooms', 3,
    'The public rooms of a house off a wide hallway: living room, dining room and kitchen (often open to each other), a family room, pantry, laundry, foyer and a half bath. Growth branches only.',
    (S) => Math.min(...dims(S)) >= 14, { door: 0.5, opening: 0.3, wide: 0.2 });
  register('house_upstairs', 'upstairs', 'Upstairs hall', 2,
    'The upstairs of a house: bedrooms, a bathroom, a study and a sitting room off a hallway, the laundry and linen closets between. Growth branches only.',
    (S) => Math.min(...dims(S)) >= 12, { door: 0.9, opening: 0.1 });
})(typeof window !== 'undefined' ? window : globalThis);
