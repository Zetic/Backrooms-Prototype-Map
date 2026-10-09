/*
 * seams.js - where two blueprints meet.
 *
 * Every blueprint is built on its own: a filler from its connections, a
 * house by its template. Now and then two of them end up wall to wall, each
 * with an exterior wall on the same line and floor on both sides of it: the
 * back of a house in a neighborhood against the filler next door, a filler
 * room against the one across a site edge, a small template against the
 * filler built round it. Nobody planned these; they emerge. A **seam** is one
 * such stretch, recorded once:
 *
 *   { id, o ('h': the line y = c, 'v': x = c), c, s0, s1 (world metres),
 *     a, b: { key, site, poi, part, room, kind, node, walls: [{ wall, s0, s1 }] },
 *     rule (the seam rule that applied, or null), openings: [...] (cut by the
 *     rule), through: [...] (openings either blueprint already had on this
 *     stretch: a house window that now looks into the room next door) }
 *
 * a is the side whose blueprint key sorts first; walls are the stretches of
 * each blueprint's own wall the seam stands for, so a client builds one wall
 * there and the map draws it once.
 *
 * Seam rules say what may be cut through a seam, by which templates meet
 * there (SEAM.RULES): a house (alone or inside a neighborhood) against the
 * backrooms sometimes gets a window, more rarely a door. A seam opening never
 * overlaps an opening either blueprint already has, and a door has 1 m of
 * floor clear in front of it on both sides. The dice are the seam's own
 * (world seed and seam id), and a seam reads two finished blueprints and
 * changes neither, so a seam is the same whatever was built first.
 *
 * This is the opposite of an adapter (lot.js): an adapter is forced (a
 * template wants a way out and the world digs one and plans a connection
 * for it); a seam is found after the fact and only ever adds a window or an
 * extra loop.
 *
 *   SEAM.item(key, b, origin, site?, poi?)  a blueprint placed in the world
 *   SEAM.between(X, Y, opts)                seams between two lists of items
 *   SEAM.within(items, opts)                seams among the items of one list
 *   SEAM.cuts(seams)                        what to leave out of each blueprint's walls when drawing
 *   W.seams(site), W.seamsBetween(A, B), W.neighbours(site)   on the map
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, { hash4, Rng } = BR;
  const SEAM = BR.SEAM = BR.SEAM || {};
  const G = 0.5, EPS = 1e-9;
  const snap = (v) => Math.round(v / G) * G;

  SEAM.CFG = {
    minLen: 1,         // shortest shared stretch that counts as a seam (m)
    clear: 0.5,        // a seam door keeps this far from the ends of the seam and from other openings (m)
    windowClear: 0.25, // a seam window, the same
    landing: 1         // floor a seam door needs clear in front of it, both sides (m)
  };

  /**
   * Seam rules, matched on the kinds of the two rooms that meet (either way
   * round). A room's kinds: its template's engine and 'template:<archetype>'
   * (a room of a part takes the part's: a house inside a neighborhood is a
   * house), or 'filler' and 'filler:<id>' for a filler room ('yard' for a
   * house's front yard). The first rule that matches applies. Each seam rolls
   * for a door, then for a window; one opening per seam at most.
   *   door / window: { p (chance), w: [min, max] (m), rooms: types allowed on
   *   the `a` side (null: any), skip: types never used on the `a` side }
   *   doors: at most this many doors between one template and one neighbour
   */
  SEAM.RULES = [
    {
      id: 'house-backrooms', a: ['house'], b: ['filler'],
      door: { p: 0.2, w: [1, 1], rooms: ['kitchen', 'laundry', 'mudroom', 'utility', 'garage', 'hall', 'family', 'living', 'dining', 'office', 'bedroom', 'master', 'closet', 'wic'] },
      window: { p: 0.5, w: [1, 1.5], skip: ['closet', 'wic', 'linen', 'pantry'], sill: 0.9, head: 2.1 },
      doors: 1
    }
  ];

  // ------------------------------------------------------------ items
  const local = new WeakMap();
  /** a blueprint's exterior walls and openings, in its own frame (cached per blueprint) */
  function prepare(b) {
    let P = local.get(b);
    if (P) return P;
    const rooms = new Map(b.rooms.map((r) => [r.id, r]));
    const inRoom = (rm, x, y) => rm.rects.some((q) => x > q[0] && x < q[2] && y > q[1] && y < q[3]);
    const walls = [], openings = [];
    for (const w of b.walls) {
      if (w.level || w.kind !== 'exterior') continue;
      const id = w.rooms[0] || w.rooms[1], rm = rooms.get(id);
      if (!rm) continue;
      const horiz = w.a[1] === w.b[1], c = horiz ? w.a[1] : w.a[0];
      const s0 = Math.min(horiz ? w.a[0] : w.a[1], horiz ? w.b[0] : w.b[1]), s1 = Math.max(horiz ? w.a[0] : w.a[1], horiz ? w.b[0] : w.b[1]);
      // the centre of the wall's first cell: never on a line between two of the room's rects
      const t = s0 + G / 2, side = horiz ? (inRoom(rm, t, c + 0.25) ? 1 : -1) : (inRoom(rm, c + 0.25, t) ? 1 : -1);
      walls.push({ id: w.id, o: horiz ? 'h' : 'v', c, s0, s1, room: id, side });
    }
    for (const op of b.openings) {
      if (op.level) continue;
      const horiz = op.a[1] === op.b[1];
      openings.push({ o: horiz ? 'h' : 'v', c: horiz ? op.a[1] : op.a[0], s0: Math.min(horiz ? op.a[0] : op.a[1], horiz ? op.b[0] : op.b[1]), s1: Math.max(horiz ? op.a[0] : op.a[1], horiz ? op.b[0] : op.b[1]), kind: op.kind });
    }
    P = { walls, openings, rooms, filler: b.schema === (BR.FILL && BR.FILL.SCHEMA), columns: (b.columns || []).map((c) => c.rect), partitions: b.walls.filter((w) => w.kind === 'partition') };
    local.set(b, P);
    return P;
  }
  /**
   * A blueprint placed in the world: key (unique: 'siteId' for a site's
   * filler, 'siteId/poiId' for a building), b, origin (where its frame sits,
   * metres), site and poi ids for the room graph's node names.
   */
  SEAM.item = (key, b, origin, site, poi) => ({ key, b, origin, site: site || null, poi: poi || null });
  const toWorld = (it, o, c, s) => (o === 'h' ? { c: c + it.origin[1], s: s + it.origin[0] } : { c: c + it.origin[0], s: s + it.origin[1] });
  function wallsOf(it) {
    const P = prepare(it.b);
    return P.walls.map((w) => { const A = toWorld(it, w.o, w.c, w.s0), B = toWorld(it, w.o, w.c, w.s1); return Object.assign({}, w, { c: A.c, s0: A.s, s1: B.s }); });
  }
  function openingsOf(it) {
    const P = prepare(it.b);
    return P.openings.map((w) => { const A = toWorld(it, w.o, w.c, w.s0), B = toWorld(it, w.o, w.c, w.s1); return { o: w.o, c: A.c, s0: A.s, s1: B.s, kind: w.kind }; });
  }
  /** what kind of thing a room is, for the rules */
  function kindsOf(it, roomId) {
    const b = it.b;
    if (prepare(b).filler) return b.filler === 'yard' ? ['yard', 'filler:yard'] : ['filler', 'filler:' + b.filler];
    const rm = prepare(b).rooms.get(roomId), part = rm && rm.part && b.parts ? b.parts.find((p) => p.id === rm.part) : null;
    return part ? [part.engine, 'template:' + part.archetype] : [b.engine, 'template:' + b.archetype];
  }
  const nodeOf = (it, room) => (it.poi ? it.site + '/' + it.poi + '/' + room : it.site + '/' + room);
  const matches = (list, kinds) => list.some((k) => kinds.indexOf(k) >= 0);

  // ------------------------------------------------------------ finding seams
  /** raw shared stretches between two items: their exterior walls on one line, rooms on opposite sides */
  function shared(X, Y, cfg) {
    const byLine = new Map(), out = [];
    for (const w of wallsOf(Y)) { const k = w.o + w.c; if (!byLine.has(k)) byLine.set(k, []); byLine.get(k).push(w); }
    for (const w of wallsOf(X)) for (const v of byLine.get(w.o + w.c) || []) {
      if (v.side === w.side) continue;
      const s0 = Math.max(w.s0, v.s0), s1 = Math.min(w.s1, v.s1);
      if (s1 - s0 < cfg.minLen - EPS) continue;
      out.push({ o: w.o, c: w.c, s0, s1, x: { room: w.room, wall: w.id, side: w.side }, y: { room: v.room, wall: v.id, side: v.side } });
    }
    // runs that carry on across a wall break (same two rooms) are one seam
    out.sort((p, q) => (p.o < q.o ? -1 : p.o > q.o ? 1 : 0) || p.c - q.c || p.s0 - q.s0);
    const merged = [];
    for (const s of out) {
      const t = merged[merged.length - 1];
      const part = (z) => ({ wall: z.wall, s0: s.s0, s1: s.s1 });
      if (t && t.o === s.o && t.c === s.c && Math.abs(t.s1 - s.s0) < EPS && t.x.room === s.x.room && t.y.room === s.y.room) {
        t.s1 = s.s1; t.xw.push(part(s.x)); t.yw.push(part(s.y));
      } else merged.push(Object.assign({}, s, { xw: [part(s.x)], yw: [part(s.y)] }));
    }
    return merged;
  }

  /** is the 1 m strip in front of [s0, s1] on `side` all floor of `room` in item `it`, with no column or partition in it? */
  function landingClear(it, room, o, c, s0, s1, side, depth) {
    const P = prepare(it.b), rm = P.rooms.get(room);
    const oc = o === 'h' ? it.origin[1] : it.origin[0], os = o === 'h' ? it.origin[0] : it.origin[1];
    const lc = c - oc, l0 = s0 - os, l1 = s1 - os;
    const r = o === 'h' ? [l0, side > 0 ? lc : lc - depth, l1, side > 0 ? lc + depth : lc] : [side > 0 ? lc : lc - depth, l0, side > 0 ? lc + depth : lc, l1];
    for (let x = r[0] + G / 2; x < r[2]; x += G) for (let y = r[1] + G / 2; y < r[3]; y += G) if (!rm.rects.some((q) => x > q[0] && x < q[2] && y > q[1] && y < q[3])) return false;
    if (P.columns.some((q) => TG.roverlap(q, r))) return false;
    for (const w of P.partitions) {
      const q = [Math.min(w.a[0], w.b[0]), Math.min(w.a[1], w.b[1]), Math.max(w.a[0], w.b[0]), Math.max(w.a[1], w.b[1])];
      if (q[0] < r[2] && q[2] > r[0] && q[1] < r[3] && q[3] > r[1] && (q[0] > r[0] || q[2] < r[2] || q[1] > r[1] || q[3] < r[3])) return false;
    }
    return true;
  }

  /** free stretches of a seam for a new opening: off its ends and clear of both sides' openings */
  function freeSpans(seam, openings, clear) {
    let free = [[seam.s0 + clear, seam.s1 - clear]];
    for (const op of openings) {
      if (op.o !== seam.o || Math.abs(op.c - seam.c) > EPS || op.s1 <= seam.s0 || op.s0 >= seam.s1) continue;
      const lo = op.s0 - clear, hi = op.s1 + clear, next = [];
      for (const [a, b] of free) { if (lo > a) next.push([a, Math.min(b, lo)]); if (hi < b) next.push([Math.max(a, hi), b]); }
      free = next;
    }
    return free.filter(([a, b]) => b - a > EPS);
  }

  /**
   * Seams between two lists of items (two neighbouring sites, or the filler
   * and the buildings of one site). opts: { seed, rules?, cfg? }. Returns the
   * seams sorted by id; every result depends only on the items and the seed.
   */
  SEAM.between = (X, Y, opts) => {
    opts = opts || {};
    const cfg = Object.assign({}, SEAM.CFG, opts.cfg || {}), rules = opts.rules || SEAM.RULES, seed = (opts.seed >>> 0) || 0;
    const raw = [];
    for (const x of X) for (const y of Y) {
      if (x.key === y.key) continue;
      const [A, B] = x.key < y.key ? [x, y] : [y, x];
      for (const s of shared(A, B, cfg)) raw.push({ A, B, s });
    }
    const seams = raw.map(({ A, B, s }) => {
      const side = (it, z, ws) => ({ key: it.key, site: it.site, poi: it.poi, part: (prepare(it.b).rooms.get(z.room) || {}).part || null, room: z.room, kind: kindsOf(it, z.room), node: nodeOf(it, z.room), walls: ws });
      return { id: A.key + '|' + B.key + '|' + s.o + s.c + ':' + s.s0, o: s.o, c: s.c, s0: s.s0, s1: s.s1, length: Math.round((s.s1 - s.s0) * 100) / 100,
        a: side(A, s.x, s.xw), b: side(B, s.y, s.yw), aSide: s.x.side, rule: null, openings: [], through: [], _items: [A, B] };
    }).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    // ---- the rules
    const doors = new Map(), opsCache = new Map();
    const opsOf = (it) => { if (!opsCache.has(it.key)) opsCache.set(it.key, openingsOf(it)); return opsCache.get(it.key); };
    for (const S of seams) {
      const [A, B] = S._items;
      for (const [it, k] of [[A, 'a'], [B, 'b']]) for (const op of opsOf(it)) {
        if (op.o !== S.o || Math.abs(op.c - S.c) > EPS || op.s0 < S.s0 - EPS || op.s1 > S.s1 + EPS) continue;
        S.through.push({ kind: op.kind, s0: op.s0, s1: op.s1, from: k });
      }
      let rule = null, flip = false;
      for (const r of rules) {
        if (matches(r.a, S.a.kind) && matches(r.b, S.b.kind)) { rule = r; break; }
        if (matches(r.a, S.b.kind) && matches(r.b, S.a.kind)) { rule = r; flip = true; break; }
      }
      if (!rule) continue;
      S.rule = rule.id;
      const T = flip ? S.b : S.a, F = flip ? S.a : S.b, TI = flip ? B : A, FI = flip ? A : B;   // the template side, the other side
      const tType = (prepare(TI.b).rooms.get(T.room) || {}).type;
      const rng = new Rng(hash4(seed, TG.hashStr(S.id), 0x5ea4, 0));
      const dk = T.key + '|' + (T.part || '') + '|' + F.key;
      const D = rule.door, Wd = rule.window;
      const tSide = flip ? -S.aSide : S.aSide;                          // which way the template's room lies off the line
      const put = (kind, w, spec) => {
        // every position along the free stretches that fits, then one at random
        const at = [], free = freeSpans(S, opsOf(A).concat(opsOf(B)), kind === 'door' ? cfg.clear : cfg.windowClear);
        for (const [a, b] of free) for (let s = Math.ceil(a / G - EPS) * G; s + w <= b + EPS; s += G) {
          if (kind === 'door' && !(landingClear(TI, T.room, S.o, S.c, s, s + w, tSide, cfg.landing) && landingClear(FI, F.room, S.o, S.c, s, s + w, -tSide, cfg.landing))) continue;
          at.push(s);
        }
        if (!at.length) return false;
        const s0 = at[rng.int(0, at.length - 1)], s1 = s0 + w;
        const pt = (s) => (S.o === 'h' ? [s, S.c] : [S.c, s]);
        const op = { kind, a: pt(s0), b: pt(s1), width: w, s0, s1, tags: ['seam', rule.id] };
        if (kind === 'door') { op.height = 2.1; op.swingInto = flip ? 'b' : 'a'; op.swing = tSide; op.hinge = pt(s0); op.rooms = [S.a.node, S.b.node]; }
        else { op.sill = spec.sill !== undefined ? spec.sill : 0.9; op.head = spec.head !== undefined ? spec.head : 2.1; }
        S.openings.push(op);
        return true;
      };
      const allowed = (spec) => spec && (!spec.rooms || spec.rooms.indexOf(tType) >= 0) && (!spec.skip || spec.skip.indexOf(tType) < 0);
      const rollD = rng.f(), rollW = rng.f(), wD = D ? snap(rng.range(D.w[0], D.w[1])) : 0, wW = Wd ? snap(rng.range(Wd.w[0], Wd.w[1])) : 0;
      if (allowed(D) && rollD < D.p && (doors.get(dk) || 0) < (rule.doors === undefined ? 1 : rule.doors) && put('door', wD, D)) { doors.set(dk, (doors.get(dk) || 0) + 1); continue; }
      const hasWindow = opsOf(A).concat(opsOf(B)).some((op) => op.kind === 'window' && op.o === S.o && Math.abs(op.c - S.c) < EPS && op.s0 < S.s1 && op.s1 > S.s0);
      // (windows are off for now: BR.TPL.WINDOWS, tpl/framework.js)
      if (allowed(Wd) && rollW < Wd.p && !hasWindow && BR.TPL && BR.TPL.WINDOWS) put('window', wW, Wd);
    }
    for (const S of seams) { delete S._items; delete S.aSide; }
    return seams;
  };

  /** seams among the items of one list (a site's filler and the buildings inside it) */
  SEAM.within = (items, opts) => {
    const out = [];
    for (let i = 0; i < items.length; i++) for (const s of SEAM.between([items[i]], items.slice(i + 1), opts)) out.push(s);
    return out.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  };

  /**
   * What a renderer needs to draw a set of seams: per blueprint key, the
   * stretches to leave out of its walls (`cuts`, in world metres): every seam
   * opening on both sides, and on the `b` side the whole seam, so each shared
   * wall is drawn once (by its `a` side).
   */
  SEAM.cuts = (seams) => {
    const out = new Map(), add = (k, x) => { if (!out.has(k)) out.set(k, []); out.get(k).push(x); };
    for (const S of seams) {
      add(S.b.key, { o: S.o, c: S.c, s0: S.s0, s1: S.s1 });
      for (const op of S.openings) add(S.a.key, { o: S.o, c: S.c, s0: op.s0, s1: op.s1 });
      for (const op of S.through) if (op.from === 'b') add(S.a.key, { o: S.o, c: S.c, s0: op.s0, s1: op.s1 });     // the wall drawn keeps the other side's openings
    }
    return out;
  };

  // ------------------------------------------------------------ on the map
  const World = BR.World;
  if (World) {
    /** a site's blueprints as seam items (its filler, then its buildings) */
    World.prototype.blueprints = function (site) {
      const r = this.build(site), out = [];
      if (r.filler) out.push(SEAM.item(site.id, r.filler, r.fillerOrigin, site.id, null));
      for (const B of r.buildings) out.push(SEAM.item(site.id + '/' + B.poi.id, B.b, B.origin, site.id, B.poi.id));
      return out;
    };
    /** the sites that share an edge with this one, in this cell or the next */
    World.prototype.neighbours = function (site) {
      const b = site.bbox, out = [];
      for (const n of this.sitesIn(b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1)) {
        if (n.id === site.id) continue;
        const touch = site.rects.some((p) => n.rects.some((q) =>
          ((p[2] === q[0] || q[2] === p[0]) && Math.min(p[3], q[3]) > Math.max(p[1], q[1])) ||
          ((p[3] === q[1] || q[3] === p[1]) && Math.min(p[2], q[2]) > Math.max(p[0], q[0]))));
        if (touch) out.push(n);
      }
      return out.sort((p, q) => (p.id < q.id ? -1 : 1));
    };
    /** seams between two neighbouring sites, or (A === B) among one site's own blueprints; cached */
    World.prototype.seamsBetween = function (A, B) {
      if (!this.seamCache) this.seamCache = new Map();
      const [P, Q] = A.id <= B.id ? [A, B] : [B, A];
      return World.lru(this.seamCache, P.id + '|' + Q.id, this.limits.builds * 2, () => (P === Q || P.id === Q.id
        ? SEAM.within(this.blueprints(P), { seed: this.seed })
        : SEAM.between(this.blueprints(P), this.blueprints(Q), { seed: this.seed })));
    };
    /** every seam of a site: inside it, and with each of its neighbours */
    World.prototype.seams = function (site) {
      return this.seamsBetween(site, site).concat(...this.neighbours(site).map((n) => this.seamsBetween(site, n)));
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
