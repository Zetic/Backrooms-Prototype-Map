/*
 * tpl/floors.js - floors at other heights inside one template.
 *
 *   sunken   part of a room's floor drops 0.3-2 m, open all round its edge,
 *            with steps down into it: a conversation pit in a living room, a
 *            sunken floor in an office hall, the park's pit made real
 *   gallery  a raised floor along one wall of a hall, open to the hall on its
 *            inner edge; the hall becomes double height over the rest of its
 *            floor, the space under the gallery is its own low room (the
 *            undercroft) and a straight stair climbs a side wall to it
 *
 * A pattern runs on a finished building (any engine: a house, the park, a
 * filler), in metres, after its layout is done. It splits a room: the part
 * at the other height becomes a room of its own (a sunken room keeps its
 * level with a negative `floor` offset; a gallery gets a level of its own),
 * walls and openings move to the part they stand on, and the building records
 * a `vertical` joining the two floors. The elevation layer (elevation.js,
 * connections.js) turns that vertical into real steps or a stair, with their
 * cutouts and reservation.
 *
 * Recipes opt in, archetype or filler:
 *   floors: { sunken: { p, rooms: [types], zones: [zone types], depth: [m, m], size: [m, m] },
 *             gallery: { p, rooms: [types], at: [m, m], depth: [m, m] } }
 * A pattern that finds no room it fits is simply not applied; meta.floors
 * says what was.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL;
  const EPS = 1e-7, G = 0.5;
  const round = (n) => Math.round(n * 1000) / 1000;
  const snap = (v) => Math.round(v / G) * G;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const FLOORS = BR.FLOORS = {};

  function nextId(list, prefix) { const used = new Set(list.map((x) => x.id)); let k = list.length; while (used.has(prefix + k)) k++; return prefix + k; }
  const isH = (a, c) => Math.abs(a[1] - c[1]) < EPS;
  const along = (p, h) => (h ? p[0] : p[1]);
  const across = (p, h) => (h ? p[1] : p[0]);
  function subtract(rects, q) {
    const out = [];
    for (const r of rects) { if (!TG.roverlap(r, q)) out.push(r); else for (const p of TG.rsub(r, q)) if (TG.rvalid(p)) out.push(p); }
    return out;
  }
  const area = (rects) => Math.round(TG.rectsArea(rects) * 100) / 100;
  const edgesOf = (q) => [[[q[0], q[1]], [q[2], q[1]]], [[q[2], q[1]], [q[2], q[3]]], [[q[2], q[3]], [q[0], q[3]]], [[q[0], q[3]], [q[0], q[1]]]];
  const grow = (q, m) => [q[0] - m, q[1] - m, q[2] + m, q[3] + m];
  const segRect = (w) => [Math.min(w.a[0], w.b[0]), Math.min(w.a[1], w.b[1]), Math.max(w.a[0], w.b[0]), Math.max(w.a[1], w.b[1])];
  const touchesRect = (s, q) => s[0] <= q[2] + EPS && s[2] >= q[0] - EPS && s[1] <= q[3] + EPS && s[3] >= q[1] - EPS;

  /**
   * Move the stretch [s0, s1] of every wall of room `from` on line `c`
   * (horizontal or vertical) at level `lv` to room `to`, splitting walls at the
   * stretch's ends. Openings move with the piece they are on; one straddling
   * an end makes the move impossible (null). Returns the moved pieces.
   */
  function moveWalls(b, lv, h, c, s0, s1, from, to) {
    const moved = [], plan = [];
    for (const w of b.walls) {
      if ((w.level || 0) !== lv || !(w.rooms || []).includes(from) || isH(w.a, w.b) !== h || Math.abs(across(w.a, h) - c) > EPS) continue;
      const a0 = Math.min(along(w.a, h), along(w.b, h)), a1 = Math.max(along(w.a, h), along(w.b, h));
      const lo = Math.max(a0, s0), hi = Math.min(a1, s1);
      if (hi - lo < EPS) continue;
      for (const o of b.openings) {
        if (o.wall !== w.id) continue;
        const p = Math.min(along(o.a, h), along(o.b, h)), q = Math.max(along(o.a, h), along(o.b, h));
        if ((p < lo - EPS && q > lo + EPS) || (p < hi - EPS && q > hi + EPS)) return null;
      }
      plan.push({ w, a0, a1, lo, hi });
    }
    for (const { w, a0, a1, lo, hi } of plan) {
      const fwd = along(w.a, h) <= along(w.b, h), pt = (v) => (h ? [v, c] : [c, v]);
      const parts = [[a0, lo, false], [lo, hi, true], [hi, a1, false]].filter((x) => x[1] - x[0] > EPS);
      if (!fwd) parts.reverse();
      const at = b.walls.indexOf(w), pieces = parts.map(([u0, u1, mid], k) => Object.assign({}, w, {
        id: parts.length === 1 ? w.id : w.id + '.' + k,
        a: pt(fwd ? u0 : u1), b: pt(fwd ? u1 : u0),
        rooms: mid ? w.rooms.map((r) => (r === from ? to : r)) : w.rooms.slice(), _mid: mid
      }));
      b.walls.splice(at, 1, ...pieces);
      for (const o of b.openings) {
        if (o.wall !== w.id) continue;
        const p = (along(o.a, h) + along(o.b, h)) / 2, piece = pieces.find((x) => p >= Math.min(along(x.a, h), along(x.b, h)) - EPS && p <= Math.max(along(x.a, h), along(x.b, h)) + EPS);
        o.wall = piece.id;
        if (piece._mid) {
          o.rooms = o.rooms.map((r) => (r === from ? to : r));
          if (o.swingInto === from) o.swingInto = to;
          for (const pr of b.portals) if (pr.opening === o.id && pr.room === from) pr.room = to;
          for (const e of b.graph.edges) if (e[3] === o.id) for (const k of [0, 1]) if (e[k] === from) e[k] = to;
        }
      }
      // an open boundary that moved: the room beyond now opens onto `to` as well
      for (const x of pieces) if (x._mid && x.kind === 'open') {
        const other = x.rooms.find((r) => r && r !== to);
        if (other && !b.graph.edges.some((e) => e[2] === 'open' && ((e[0] === to && e[1] === other) || (e[0] === other && e[1] === to)))) b.graph.edges.push([to, other, 'open', null]);
      }
      for (const x of pieces) { if (x._mid) moved.push(x); delete x._mid; }
    }
    return moved;
  }
  /** the parts of [s0, s1] on line c not covered by the given wall pieces */
  function uncovered(walls, h, c, s0, s1) {
    const cov = walls.filter((w) => isH(w.a, w.b) === h && Math.abs(across(w.a, h) - c) < EPS)
      .map((w) => [Math.max(s0, Math.min(along(w.a, h), along(w.b, h))), Math.min(s1, Math.max(along(w.a, h), along(w.b, h)))]).filter((x) => x[1] > x[0] + EPS).sort((p, q) => p[0] - q[0]);
    const out = [];
    let t = s0;
    for (const [p, q] of cov) { if (p > t + EPS) out.push([t, p]); t = Math.max(t, q); }
    if (s1 > t + EPS) out.push([t, s1]);
    return out;
  }
  const levelZ = (b, lv) => ((b.levels || []).find((l) => l.index === (lv || 0)) || { elevation: 0 }).elevation;
  /** is the room free of curved walls, partitions and anything else this rect must keep off? */
  function clearOf(b, room, q) {
    if ((b.curves || []).some((cv) => cv.room === room.id)) return false;
    if (b.walls.some((w) => w.kind === 'partition' && (w.rooms || []).includes(room.id) && touchesRect(segRect(w), grow(q, 0.5)))) return false;
    if ((b.columns || []).some((c) => c.room === room.id && TG.roverlap(c.rect, grow(q, 0.5)))) return false;
    return true;
  }

  /** the largest rectangle inside a room's floor (its rects are often a union of strips) */
  function largest(room) {
    const bb = TG.bbox(room.rects), W = Math.round((bb[2] - bb[0]) / G), H = Math.round((bb[3] - bb[1]) / G), R = new TG.Raster(W, H, 0);
    for (const q of room.rects) R.fill([Math.round((q[0] - bb[0]) / G), Math.round((q[1] - bb[1]) / G), Math.round((q[2] - bb[0]) / G), Math.round((q[3] - bb[1]) / G)], 1);
    const c = TG.largestRect(R, (v) => v === 1);
    return c ? [bb[0] + c[0] * G, bb[1] + c[1] * G, bb[0] + c[2] * G, bb[1] + c[3] * G].map(round) : null;
  }
  const inRoom = (room, q) => { const L = room.rects.filter((r) => TG.roverlap(r, q)); return Math.abs(TG.rectsArea(L.map((r) => TG.rinter(r, q)).filter(Boolean)) - TG.rarea(q)) < 1e-6; };

  // ------------------------------------------------------------ sunken
  /** where a sunken floor could go, in order: [{ room, q, zone? }] */
  function sunkenSpots(b, cfg, rng) {
    const size = cfg.size || [3, 4.5], out = [];
    if (cfg.zones) {
      // a zone marked for it (the park's pit) sinks exactly where it is
      for (const z of (b.zones || []).filter((x) => cfg.zones.includes(x.type) && x.rects.length === 1)) {
        const r = b.rooms.find((x) => x.id === z.room);
        if (r && !r.floor) out.push({ room: r.id, q: z.rects[0].slice(), zone: z.id });
      }
      return out;
    }
    const rooms = b.rooms.filter((r) => !r.floor && (!cfg.rooms || cfg.rooms.includes(r.type)) && !(b.zones || []).some((z) => z.room === r.id))
      .sort((p, q) => q.area - p.area || (p.id < q.id ? -1 : 1));
    for (const r of rooms) {
      const R = largest(r);
      if (!R) continue;
      // a rim at least a metre wide all round, clear of every door
      const inner = [R[0] + 1, R[1] + 1, R[2] - 1, R[3] - 1], W = inner[2] - inner[0], H = inner[3] - inner[1];
      if (W < size[0] - EPS || H < size[0] - EPS) continue;
      for (let k = 0; k < 4; k++) {
        const w = Math.min(W, snap(rng.range(size[0], Math.min(size[1], W)))), h = Math.min(H, snap(rng.range(size[0], Math.min(size[1], H))));
        const x = inner[0] + snap(rng.range(0, W - w)), y = inner[1] + snap(rng.range(0, H - h));
        if (clearOf(b, r, [x, y, x + w, y + h])) out.push({ room: r.id, q: [x, y, x + w, y + h] });
      }
    }
    return out;
  }
  /** sink one spot of a copy of the building; returns { b, made } */
  function sink(b0, spot, cfg, rng) {
    const b = clone(b0), r = b.rooms.find((x) => x.id === spot.room), q = spot.q, depthR = cfg.depth || [0.45, 0.9];
    // its steps fit inside it: an entry and a flight along its longer side
    const fit = Math.floor((Math.max(q[2] - q[0], q[3] - q[1]) - 1) * 0.7 / 0.05 + EPS) * 0.05;
    const depth = round(Math.min(fit, Math.round(rng.range(depthR[0], depthR[1]) / 0.05) * 0.05));
    if (depth < 0.3 - EPS || !inRoom(r, q)) return null;
    const id = nextId(b.rooms, 'r'), lv = r.level || 0;
    r.rects = subtract(r.rects, q); r.area = area(r.rects);
    b.rooms.push({ id, type: 'sunken', name: 'sunken ' + (r.name || r.type), zone: r.zone, level: lv, floor: -depth, rects: [q], area: area([q]),
      ceiling: round((r.ceiling || 2.5) + depth), tags: [...new Set((TPL.CAT.ROOMS.sunken.tags || []).concat(r.tags || []))], parent: r.id });
    // its edge is open all round: a step down, no wall
    for (const [a, c] of edgesOf(q)) b.walls.push({ id: nextId(b.walls, 'w'), level: lv, kind: 'open', a, b: c, rooms: [r.id, id], thickness: 0, tags: ['edge'] });
    for (const c of b.columns || []) if (c.room === r.id && TG.rcontains(q, c.rect)) c.room = id;
    if (spot.zone) b.zones.find((z) => z.id === spot.zone).room = id;
    b.graph.nodes.push(id);
    b.graph.edges.push([r.id, id, 'stair', null]);
    b.verticals = b.verticals || [];
    const vid = nextId(b.verticals, 'v');
    b.verticals.push({ id: vid, kind: 'stair', rooms: [r.id, id], local: true, types: ['stair'], shape: 'straight', dead: false, tags: ['steps', 'sunken'] });
    return { b, vid, made: { pattern: 'sunken', room: r.id, sunken: id, depth, size: [round(q[2] - q[0]), round(q[3] - q[1])] } };
  }

  // ------------------------------------------------------------ gallery
  const inRoomPt = (room, p) => room.rects.some((q) => p[0] > q[0] + EPS && p[0] < q[2] - EPS && p[1] > q[1] + EPS && p[1] < q[3] - EPS);
  /**
   * where a gallery could go: along a straight run of the room's real walls,
   * the longest stretch over which a strip of the gallery's depth stays inside
   * the room. Longest first.
   */
  function gallerySpots(b, cfg, rng) {
    const dep = cfg.depth || [2.5, 4], at = cfg.at || [3.25, 3.75], out = [];
    const rooms = b.rooms.filter((r) => !r.floor && !(r.level || 0) && (!cfg.rooms || cfg.rooms.includes(r.type)) && !(b.zones || []).some((z) => z.room === r.id) && !(b.curves || []).some((cv) => cv.room === r.id))
      .sort((p, q) => q.area - p.area || (p.id < q.id ? -1 : 1));
    for (const r of rooms) {
      const lines = new Map();
      for (const w of b.walls) {
        if ((w.level || 0) !== 0 || w.kind === 'open' || w.kind === 'partition' || !(w.rooms || []).includes(r.id)) continue;
        const h = isH(w.a, w.b), key = (h ? 'h' : 'v') + across(w.a, h);
        if (!lines.has(key)) lines.set(key, { h, c: across(w.a, h), segs: [] });
        lines.get(key).segs.push([Math.min(along(w.a, h), along(w.b, h)), Math.max(along(w.a, h), along(w.b, h))]);
      }
      for (const { h, c, segs } of [...lines.values()].sort((p, q) => (p.h === q.h ? p.c - q.c : p.h ? -1 : 1))) {
        segs.sort((p, q) => p[0] - q[0]);
        const runs = [];
        for (const sg of segs) { const last = runs[runs.length - 1]; if (last && sg[0] <= last[1] + EPS) last[1] = Math.max(last[1], sg[1]); else runs.push(sg.slice()); }
        for (const [u0, u1] of runs) {
          if (u1 - u0 < 8 - EPS) continue;
          const mid = (u0 + u1) / 2, plus = h ? [mid, c + 0.25] : [c + 0.25, mid], minus = h ? [mid, c - 0.25] : [c - 0.25, mid];
          const dir = inRoomPt(r, plus) ? 1 : inRoomPt(r, minus) ? -1 : 0;
          if (!dir) continue;
          const d = snap(rng.range(dep[0], dep[1])), z = round(Math.round(rng.range(at[0], at[1]) / 0.05) * 0.05);
          const strip = (t0, t1) => { const a = c, e = c + dir * d; return h ? [t0, Math.min(a, e), t1, Math.max(a, e)] : [Math.min(a, e), t0, Math.max(a, e), t1]; };
          // the stretches where a strip that deep lies inside the room, in half metres
          let best = null, t = u0;
          while (t < u1 - EPS) {
            let e = t;
            while (e < u1 - EPS && inRoom(r, strip(e, e + G))) e += G;
            if (e - t > (best ? best[1] - best[0] : 0) + EPS) best = [t, e];
            t = e > t ? e : t + G;
          }
          if (!best || best[1] - best[0] < 8 - EPS) continue;
          const side = h ? (dir > 0 ? 'N' : 'S') : (dir > 0 ? 'W' : 'E');
          out.push({ room: r.id, q: strip(best[0], best[1]).map(round), side, z, d, len: best[1] - best[0] });
        }
      }
    }
    return out.sort((p, q) => q.len - p.len);
  }
  /** raise a gallery on a copy of the building; returns { b, made } or null */
  function raise(b0, spot) {
    const SLAB = 0.25, { q, side, z, d } = spot, h = side === 'N' || side === 'S';
    const b = clone(b0), r = b.rooms.find((x) => x.id === spot.room), lv = 0;
    // columns under it stay (they hold it up); none may stand on its open edges
    const edgeIn = side === 'N' ? [q[0], q[3], q[2], q[3]] : side === 'S' ? [q[0], q[1], q[2], q[1]] : side === 'W' ? [q[2], q[1], q[2], q[3]] : [q[0], q[1], q[0], q[3]];
    if ((b.columns || []).some((col) => col.room === r.id && touchesRect(edgeIn, col.rect) && !TG.rcontains(q, col.rect))) return null;
    if ((b.columns || []).some((col) => col.room === r.id && TG.roverlap(col.rect, q) && !TG.rcontains(q, col.rect))) return null;
    if (b.walls.some((w) => w.kind === 'partition' && (w.rooms || []).includes(r.id) && touchesRect(segRect(w), q))) return null;
    if (!inRoom(r, q)) return null;
    const U = nextId(b.rooms, 'r');
    b.rooms.push({ id: U, type: 'undercroft', name: 'under the gallery', zone: 'circulation', level: lv, rects: [q], area: area([q]), ceiling: round(z - SLAB), tags: (TPL.CAT.ROOMS.undercroft.tags || []).slice(), parent: r.id });
    // the hall becomes double height over the rest of its floor
    const ceil = Math.max(r.ceiling || 2.5, round(z + 2.6)), Lg = (b.levels || []).length, Gal = nextId(b.rooms, 'r');
    r.ceiling = ceil;
    b.rooms.push({ id: Gal, type: 'gallery', name: 'gallery', zone: 'circulation', level: Lg, rects: [q], area: area([q]), ceiling: round(ceil - z), tags: (TPL.CAT.ROOMS.gallery.tags || []).slice(), parent: r.id });
    b.levels.push({ index: Lg, elevation: round(levelZ(b, lv) + z), height: round(ceil - z) });
    b.levels[0].height = Math.max(b.levels[0].height || 0, ceil);
    r.rects = subtract(r.rects, q); r.area = area(r.rects);
    // every edge: walls along it move to the undercroft and rise again round
    // the gallery; open stretches become an edge below and a rail above
    for (const [a, e] of edgesOf(q)) {
      const eh = isH(a, e), ec = across(a, eh), u0 = Math.min(along(a, eh), along(e, eh)), u1 = Math.max(along(a, eh), along(e, eh));
      const moved = moveWalls(b, lv, eh, ec, u0, u1, r.id, U);
      if (!moved) return null;
      for (const w of moved) b.walls.push({ id: nextId(b.walls, 'w'), level: Lg, kind: 'exterior', a: w.a.slice(), b: w.b.slice(), rooms: w.rooms.map((x) => (x === U ? Gal : null)), thickness: Math.max(0.3, w.thickness || 0) });
      for (const [p, s] of uncovered(moved, eh, ec, u0, u1)) {
        const A = eh ? [p, ec] : [ec, p], B = eh ? [s, ec] : [ec, s];
        b.walls.push({ id: nextId(b.walls, 'w'), level: lv, kind: 'open', a: A, b: B, rooms: [r.id, U], thickness: 0, tags: ['under gallery'] });
        b.walls.push({ id: nextId(b.walls, 'w'), level: Lg, kind: 'open', a: A.slice(), b: B.slice(), rooms: [Gal, null], thickness: 0, tags: ['rail'] });
      }
    }
    for (const col of b.columns || []) if (col.room === r.id && TG.rcontains(q, col.rect)) col.room = U;
    b.footprint = b.footprint || [];
    b.footprint.push({ level: Lg, rects: [q] });
    b.graph.nodes.push(U, Gal);
    b.graph.edges.push([r.id, U, 'open', null], [r.id, Gal, 'stair', null]);
    b.verticals = b.verticals || [];
    const vid = nextId(b.verticals, 'v');
    b.verticals.push({ id: vid, kind: 'stair', rooms: [r.id, Gal], types: ['stair'], shape: 'straight', walled: true, dead: false, tags: ['gallery stair'] });
    return { b, vid, made: { pattern: 'gallery', room: r.id, gallery: Gal, undercroft: U, at: z, depth: d, side } };
  }

  /**
   * A pattern is kept only if its stair or steps can really be built and the
   * building still holds together: the elevation layer (when loaded) fits and
   * validates them on a copy first. Returns that adaptation (its stairs are
   * kept on the building), or null.
   */
  function buildable(c, vid) {
    const E = BR.ELEV;
    // without the elevation layer nothing can be proved, so nothing is applied:
    // a building never depends on which modules happen to be loaded
    if (!E || !E.prepare || !E.linkFloors) return null;
    try {
      const p = E.prepare(c, { deferCapabilities: true });
      // every stair the building asks for is built, this one included (a new
      // floor must not take another stair's place), and nothing else breaks
      // (exits up and down are not searched here: that is the adapter's job later)
      const need = (c.verticals || []).filter((v) => !v.dead && (v.rooms || []).length > 1).reduce((t, v) => t + v.rooms.length - 1, 0);
      const built = p.connectors.filter((k) => k.internal);
      return built.some((k) => k.vertical === vid) && built.length === need && !E.validate(p).errors.some((e) => !/^no physical/.test(e)) ? p : null;
    } catch (err) { return null; }
  }

  /**
   * Apply a recipe's floor patterns to a finished building, in place.
   * Deterministic: the same building, recipe and seed give the same floors.
   */
  FLOORS.apply = function apply(b, recipe, seed, id) {
    if (!b || b.error || !recipe) return b;
    const rng = new BR.Rng(BR.hash4(seed >>> 0, TG.hashStr(String(id || b.archetype || b.filler || '')), 0xF100, 0));
    // the building's own meta object stays (its build time is written into it afterwards)
    // (the last proof is of the building as it ends up: its stairs are kept from it)
    let proof = null;
    const made = [], commit = (got, p) => { for (const k of Object.keys(got.b)) if (k !== 'meta') b[k] = got.b[k]; made.push(got.made); proof = p; };
    if (recipe.gallery && rng.f() < (recipe.gallery.p === undefined ? 1 : recipe.gallery.p)) {
      let n = 0;
      for (const spot of gallerySpots(b, recipe.gallery, rng)) {
        if (n++ >= 4) break;                      // each try is proved by the elevation layer: a few, longest first
        const got = raise(b, spot), p = got && buildable(got.b, got.vid);
        if (p) { commit(got, p); break; }
      }
    }
    if (recipe.sunken && rng.f() < (recipe.sunken.p === undefined ? 1 : recipe.sunken.p)) {
      let n = 0;
      for (const spot of sunkenSpots(b, recipe.sunken, rng)) {
        if (n++ >= 6) break;
        const got = sink(b, spot, recipe.sunken, rng), p = got && buildable(got.b, got.vid);
        if (p) { commit(got, p); break; }
      }
    }
    if (made.length) { b.meta = b.meta || {}; b.meta.floors = made; BR.ELEV.bakeStairs(b, proof); }
    return b;
  };
  FLOORS._internal = { moveWalls, uncovered, subtract, gallerySpots, sunkenSpots, raise, sink, buildable, largest };
})(typeof window !== 'undefined' ? window : globalThis);
