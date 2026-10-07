/*
 * world.js - the template-first world. Every site on the infinite plane is
 * built by a template from its outline and its connections; nothing else
 * draws floor or walls.
 *
 * The plane is cut into 128 m cells. Each cell is planned from (seed, i, j)
 * and its four borders alone, so any part of the map can be asked for in any
 * order and the answer never changes:
 *
 *   1. borders  every cell border has 2-4 openings, decided by the border
 *               itself, so the two cells agree on them without asking each
 *               other
 *   2. POIs     claim their places first (poi.js): houses on lots with a
 *               yard, block-sized templates on flush lots, smaller ones
 *               inside filler sites
 *   3. blocks   every lot is cut out along its own edges; the rest of the
 *               cell is cut into 8-32 m blocks (whole metres) that keep a
 *               block's width from a lot, 2 m from a POI inside a filler and
 *               1 m from any opening that must not be cut
 *   4. sites    some small blocks merge into a neighbour (L, T and Z sites);
 *               a lot's block never does. Every block belongs to exactly one
 *               site, so a cell has no gaps and no overlaps
 *   5. graph    a random spanning tree over the sites' shared edges plus a
 *               few loops; each edge is an exact opening on the shared line.
 *               A yard is entered from its front; a flush lot only through
 *               its own doors. The border openings join each cell to its
 *               neighbours, so the whole plane is one connected graph
 *   6. build    each site is built from its connections: a filler from the
 *               pool (round any POI inside it), the yard round a house, or a
 *               flush building alone (src/tpl/lot.js)
 *
 * Biome: one slow noise field, openness, tilts the filler weights between
 * deep warrens and open stretches and sets how big the blocks get.
 *
 * Caches are bounded and only ever hold results of pure functions.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL;
  const { hash4, Rng, fbm, contrast, makeUF } = BR;

  const CFG = {
    cell: 128,                                            // must match BR.POI_CFG.cell
    border: { n: [2, 4], end: 8, widths: [[1.5, 0.6], [2, 0.3], [2.5, 0.1]] },
    block: { min: 8, max: [18, 32], pStop: 0.4, tries: 12, clear: 2 },
    merge: { p: 0.3, maxArea: 900, maxSide: 40, minShared: 4 },
    edge: { end: 1, widths: [[1.5, 0.55], [2, 0.25], [1, 0.1], [3, 0.1]] },
    loops: [0.1, 0.3],                                    // chance a non-tree edge is opened, deep warren .. open stretch
    biome: { scale: 380, k: 1.7 },
    limits: { cells: 400, builds: 2500 }
  };
  const S = { BV: 0x7701, BH: 0x7702, CELL: 0x7703, SITE: 0x7704, GRAPH: 0x7705, BIOME: 0x7706 };
  const G = TG.GRID, U = (m) => Math.round(m / G);
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const pickW = (rng, list) => { let t = rng.f(); for (const [v, p] of list) { t -= p; if (t < 0) return v; } return list[list.length - 1][0]; };

  // ------------------------------------------------------------- biome
  /** openness in [0, 1]: 0 deep warren, 1 open stretch */
  function openness(seed, x, y) { return contrast(fbm(seed ^ S.BIOME, x / CFG.biome.scale, y / CFG.biome.scale, 2), CFG.biome.k); }
  const biomeName = (o) => (o < 0.3 ? 'deep warren' : o > 0.7 ? 'open stretch' : 'backrooms');
  /** filler weights for an openness: the pool's own weights, tilted */
  function fillerWeights(o) {
    const k = { enclosed: 1.3 - 0.6 * o, mixed: 0.5 + o, open: 0.15 + 2.2 * o }, w = {};
    for (const F of FILL.list()) if (F.weight > 0) w[F.id] = F.weight * (k[F.feel] || 1);
    return w;
  }

  // ------------------------------------------------------------- borders
  /**
   * Openings across the west ('v') or north ('h') border of cell (i, j), in
   * metres along the border from the cell's corner: [[a, b], ...]. Both cells
   * ask the same question, so they get the same answer.
   */
  function borderOpenings(seed, o, i, j) {
    const B = CFG.border, rng = new Rng(hash4(seed, i, j, o === 'v' ? S.BV : S.BH));
    const n = rng.int(B.n[0], B.n[1]), slot = (CFG.cell - 2 * B.end) / n, out = [];
    for (let k = 0; k < n; k++) {
      const w = pickW(rng, B.widths), lo = B.end + k * slot + 1, hi = B.end + (k + 1) * slot - 1 - w;
      const a = Math.round(rng.range(lo, hi) * 2) / 2;
      out.push([a, a + w]);
    }
    return out;
  }

  // ------------------------------------------------------------- cell plan
  /**
   * The plan of cell (i, j):
   * { i, j, rect, density, openness, pois, lots, borders, blocks, sites, conns, byId, connById }
   * site: { id, i, j, k, kind ('filler' | 'lot' | 'flush'), rects (world
   *         metres, whole), bbox, area, lots, pois, seed, openness, conns: [conn ids] }
   * conn: { id, o ('h': the line y = c, 'v': x = c), c, s0, s1 (world metres
   *         along the line), a, b (site ids, a west / north of b; a border
   *         connection has the neighbour cell's site as null), route, cross }
   */
  function planCell(W, i, j) {
    const seed = W.seed, C = CFG.cell, x0 = i * C, y0 = j * C, x1 = x0 + C, y1 = y0 + C;
    const rng = new Rng(hash4(seed, i, j, S.CELL));
    const borders = { W: borderOpenings(seed, 'v', i, j), E: borderOpenings(seed, 'v', i + 1, j), N: borderOpenings(seed, 'h', i, j), S: borderOpenings(seed, 'h', i, j + 1) };
    const pc = BR.buildPOICell(W, i, j);

    // ---- flush lots are built now: the door is the edge, so the world puts
    // its connections exactly on the template's doors
    const lots = [], dropped = new Set();
    for (const L of pc.lots) {
      if (L.kind === 'flush') {
        const P = L.pois[0], b = BR.buildPOI(W, P);
        if (b.error) { dropped.add(P.id); continue; }
        Object.defineProperty(L, 'b', { value: b, enumerable: false });
        L.doors = [];
        for (const p of b.portals) {
          if (p.level) continue;
          const op = b.openings.find((x) => x.id === p.opening), horiz = op.a[1] === op.b[1];
          const c = horiz ? op.a[1] + P.bbox[1] : op.a[0] + P.bbox[0], s0 = horiz ? Math.min(op.a[0], op.b[0]) + P.bbox[0] : Math.min(op.a[1], op.b[1]) + P.bbox[1];
          const r = L.rect;
          if (horiz ? c === r[1] || c === r[3] : c === r[0] || c === r[2]) L.doors.push({ portal: p.id, o: horiz ? 'h' : 'v', c, s0, s1: s0 + op.width, main: !!p.main });
        }
      }
      lots.push(L);
    }
    const pois = pc.pois.filter((P) => !dropped.has(P.id)), inside = pois.filter((P) => P.mode === 'inside');

    // ---- blocks: lots are cut out along their own edges; other cuts keep a
    // block's width from a lot, 2 m from a POI inside a filler, and 1 m from
    // any opening that must not be cut (border openings, flush doors)
    const B = CFG.block, cl = B.clear, blocks = [], holes = [];
    for (const side of ['N', 'E', 'S', 'W']) for (const [a, b] of borders[side]) {
      const vert = side === 'W' || side === 'E';
      holes.push({ o: vert ? 'v' : 'h', c: side === 'W' ? x0 : side === 'E' ? x1 : side === 'N' ? y0 : y1, s0: (vert ? y0 : x0) + a, s1: (vert ? y0 : x0) + b });
    }
    for (const L of lots) for (const d of L.doors || []) holes.push(d);
    const cutOk = (r, lotsIn, inIn, vert, c) => {
      for (const L of lotsIn) {
        const a = vert ? L.rect[0] : L.rect[1], b = vert ? L.rect[2] : L.rect[3];
        if (c > a && c < b) return false;
        const d = c <= a ? a - c : c - b;
        if (d > 0 && d < B.min) return false;
      }
      for (const P of inIn) { const b = P.bbox; if (vert ? c > b[0] - cl && c < b[2] + cl : c > b[1] - cl && c < b[3] + cl) return false; }
      for (const h of holes) if (h.o === (vert ? 'h' : 'v') && (vert ? h.c === r[1] || h.c === r[3] : h.c === r[0] || h.c === r[2]) && c > h.s0 - 1 && c < h.s1 + 1) return false;
      return true;
    };
    const split = (r, lotsIn, inIn) => {
      const w = r[2] - r[0], h = r[3] - r[1];
      const cut = (vert, c) => {
        if (!cutOk(r, lotsIn, inIn, vert, c)) return false;
        const a = vert ? [r[0], r[1], c, r[3]] : [r[0], r[1], r[2], c], b = vert ? [c, r[1], r[2], r[3]] : [r[0], c, r[2], r[3]];
        const la = lotsIn.filter((L) => TG.roverlap(L.rect, a)), lb = lotsIn.filter((L) => TG.roverlap(L.rect, b));
        const len = (q) => (vert ? q[2] - q[0] : q[3] - q[1]);
        if ((!la.length && len(a) < B.min) || (!lb.length && len(b) < B.min)) return false;
        split(a, la, inIn.filter((P) => TG.roverlap(P.bbox, a)));
        split(b, lb, inIn.filter((P) => TG.roverlap(P.bbox, b)));
        return true;
      };
      if (lotsIn.length) {
        const edges = [];
        for (const L of lotsIn) {
          const q = L.rect;
          if (q[0] > r[0]) edges.push([true, q[0]]); if (q[2] < r[2]) edges.push([true, q[2]]);
          if (q[1] > r[1]) edges.push([false, q[1]]); if (q[3] < r[3]) edges.push([false, q[3]]);
        }
        if (!edges.length) { blocks.push({ r, lots: lotsIn, pois: inIn }); return; }
        for (let k = edges.length - 1; k > 0; k--) { const t = rng.int(0, k), e = edges[k]; edges[k] = edges[t]; edges[t] = e; }
        for (const [vert, c] of edges) if (cut(vert, c)) return;
      } else {
        const o = openness(seed, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2), max = Math.round(B.max[0] + (B.max[1] - B.max[0]) * o);
        if ((w < 2 * B.min && h < 2 * B.min) || (w <= max && h <= max && rng.f() < B.pStop)) { blocks.push({ r, lots: lotsIn, pois: inIn }); return; }
      }
      const canX = w >= 2 * B.min, canY = h >= 2 * B.min;
      const first = canX && (!canY || w > h * 1.15 || (h <= w * 1.15 && rng.f() < 0.5));
      for (const vert of canX && canY ? [first, !first] : canX ? [true] : canY ? [false] : []) {
        const lo = (vert ? r[0] : r[1]) + B.min, hi = (vert ? r[2] : r[3]) - B.min;
        for (let t = 0; t < B.tries; t++) if (cut(vert, rng.int(lo, hi))) return;
      }
      blocks.push({ r, lots: lotsIn, pois: inIn });
    };
    split([x0, y0, x1, y1], lots.slice(), inside.slice());

    // ---- shared edges between blocks (a west / north of b)
    const n = blocks.length, adj = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const p = blocks[a].r, q = blocks[b].r;
      if (p[2] === q[0]) { const s0 = Math.max(p[1], q[1]), s1 = Math.min(p[3], q[3]); if (s1 > s0) adj.push({ a, b, o: 'v', c: p[2], s0, s1 }); }
      if (p[3] === q[1]) { const s0 = Math.max(p[0], q[0]), s1 = Math.min(p[2], q[2]); if (s1 > s0) adj.push({ a, b, o: 'h', c: p[3], s0, s1 }); }
    }

    // ---- sites: some small blocks merge into a neighbour; a lot's block never does
    const M = CFG.merge, uf = makeUF(n), area = blocks.map((k) => TG.rarea(k.r)), box = blocks.map((k) => k.r.slice());
    const order = blocks.map((_, k) => k);
    for (let k = n - 1; k > 0; k--) { const t = rng.int(0, k), s = order[k]; order[k] = order[t]; order[t] = s; }
    for (const a of order) {
      if (blocks[a].lots.length || rng.f() >= M.p) continue;
      const cand = [];
      for (const e of adj) {
        const b = e.a === a ? e.b : e.b === a ? e.a : -1;
        if (b >= 0 && e.s1 - e.s0 >= M.minShared && !blocks[b].lots.length && uf.find(b) !== uf.find(a) && cand.indexOf(b) < 0) cand.push(b);
      }
      if (!cand.length) continue;
      const b = cand[rng.int(0, cand.length - 1)], ra = uf.find(a), rb = uf.find(b);
      const A = area[ra] + area[rb], bx = [Math.min(box[ra][0], box[rb][0]), Math.min(box[ra][1], box[rb][1]), Math.max(box[ra][2], box[rb][2]), Math.max(box[ra][3], box[rb][3])];
      if (A > M.maxArea || bx[2] - bx[0] > M.maxSide || bx[3] - bx[1] > M.maxSide) continue;
      uf.union(a, b);
      const r = uf.find(a);
      area[r] = A; box[r] = bx;
    }
    const groups = new Map();
    for (let a = 0; a < n; a++) { const r = uf.find(a); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(a); }
    const list = [...groups.values()].map((ks) => ({ ks, bbox: box[uf.find(ks[0])] }));
    list.sort((p, q) => p.bbox[1] - q.bbox[1] || p.bbox[0] - q.bbox[0]);
    const siteOf = new Int32Array(n);
    const sites = list.map((g, k) => {
      for (const b of g.ks) siteOf[b] = k;
      const rects = g.ks.map((b) => blocks[b].r).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      const ls = g.ks.flatMap((b) => blocks[b].lots), ins = g.ks.flatMap((b) => blocks[b].pois);
      const exact = ls.length === 1 && rects.length === 1 && rects[0].every((v, t) => v === ls[0].rect[t]);
      return {
        id: i + ',' + j + ':' + k, i, j, k, kind: !ls.length ? 'filler' : exact && ls[0].kind === 'flush' ? 'flush' : 'lot',
        rects, bbox: g.bbox, area: rects.reduce((s, q) => s + TG.rarea(q), 0),
        lots: ls, pois: ls.flatMap((L) => L.pois).concat(ins), seed: hash4(seed, i, j, (k << 8) ^ S.SITE),
        openness: openness(seed, (g.bbox[0] + g.bbox[2]) / 2, (g.bbox[1] + g.bbox[3]) / 2), conns: []
      };
    });

    // a flush lot the cuts could not free (rare) is left out: its doors would
    // open onto the site round it
    for (const s of sites) {
      const bad = s.kind === 'lot' ? s.lots.filter((L) => L.kind === 'flush') : [];
      if (!bad.length) continue;
      for (const L of bad) { dropped.add(L.pois[0].id); lots.splice(lots.indexOf(L), 1); }
      s.lots = s.lots.filter((L) => bad.indexOf(L) < 0);
      s.pois = s.pois.filter((P) => !dropped.has(P.id));
      if (!s.lots.length) s.kind = 'filler';
    }

    // ---- graph: shared segments per site pair, merged where they run on. A
    // flush lot is joined only through its own doors
    const pairs = new Map();
    for (const e of adj) {
      const A = siteOf[e.a], Bk = siteOf[e.b];
      if (A === Bk || sites[A].kind === 'flush' || sites[Bk].kind === 'flush') continue;
      const key = A < Bk ? A + '|' + Bk : Bk + '|' + A;
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push({ o: e.o, c: e.c, s0: e.s0, s1: e.s1, lo: A, hi: Bk });
    }
    const E = [], EG = CFG.edge, grng = new Rng(hash4(seed, i, j, S.GRAPH));
    for (const key of [...pairs.keys()].sort()) {
      const segs = pairs.get(key).sort((p, q) => (p.o < q.o ? -1 : p.o > q.o ? 1 : 0) || p.c - q.c || p.s0 - q.s0), out = [];
      for (const s of segs) {
        const t = out[out.length - 1];
        if (t && t.o === s.o && t.c === s.c && t.lo === s.lo && t.s1 === s.s0) t.s1 = s.s1; else out.push(Object.assign({}, s));
      }
      const usable = out.filter((s) => s.s1 - s.s0 >= 2 * EG.end + 1);
      if (usable.length) E.push({ key, segs: usable, w: grng.f() });
    }
    // a yard is entered from the front: one neighbour across its front is
    // joined first, on the stretch in front of the lot
    for (const s of sites) {
      const L = s.kind === 'lot' && s.lots.find((q) => q.kind === 'yard');
      if (!L) continue;
      const f = L.approach, q = L.rect, vert = f === 'E' || f === 'W', lo = vert ? q[1] : q[0], hi = vert ? q[3] : q[2];
      let best = null;
      for (const e of E) {
        const [a, b] = e.key.split('|').map(Number);
        if (a !== s.k && b !== s.k) continue;
        const front = [];
        for (const g of e.segs) {
          const mine = (f === 'S' || f === 'E') ? g.lo === s.k : g.hi === s.k;
          const ahead = f === 'S' ? g.c >= q[3] : f === 'N' ? g.c <= q[1] : f === 'E' ? g.c >= q[2] : g.c <= q[0];
          const s0 = Math.max(g.s0, lo), s1 = Math.min(g.s1, hi);
          if (g.o === (vert ? 'v' : 'h') && mine && ahead && s1 - s0 >= 2 * EG.end + 1.5) front.push(Object.assign({}, g, { s0, s1 }));
        }
        if (front.length && (!best || e.w < best.e.w)) best = { e, front };
      }
      if (best) { best.e.w -= 2; best.e.segs = best.front; }
    }
    E.sort((p, q) => p.w - q.w || (p.key < q.key ? -1 : 1));
    const conns = [], tree = makeUF(sites.length), cellOpen = openness(seed, (x0 + x1) / 2, (y0 + y1) / 2);
    const pLoop = CFG.loops[0] + (CFG.loops[1] - CFG.loops[0]) * cellOpen;
    const at = (x, y) => sites.findIndex((s) => s.rects.some((q) => x >= q[0] && x < q[2] && y >= q[1] && y < q[3]));
    for (const s of sites) {
      if (s.kind !== 'flush') continue;
      const L = s.lots[0];
      L.portalConns = {};
      for (const d of L.doors) {
        const m = (d.s0 + d.s1) / 2, inner = d.o === 'h' ? (d.c === L.rect[1] ? 1 : -1) : (d.c === L.rect[0] ? 1 : -1);
        const other = d.o === 'h' ? at(m, d.c - inner * 0.5) : at(d.c - inner * 0.5, m);
        if (other < 0) continue;
        const lowIsLot = inner === 1 ? false : true, id = i + ',' + j + ':e' + conns.length;
        conns.push({ id, o: d.o, c: d.c, s0: d.s0, s1: d.s1, a: sites[lowIsLot ? s.k : other].id, b: sites[lowIsLot ? other : s.k].id, route: d.main, cross: false });
        L.portalConns[d.portal] = id;
        tree.union(s.k, other);
      }
    }
    const place = (e, route) => {
      let w = pickW(grng, EG.widths);
      let fit = e.segs.filter((s) => s.s1 - s.s0 >= w + 2 * EG.end);
      if (!fit.length) { w = 1; fit = e.segs; }
      let tot = 0;
      for (const s of fit) tot += s.s1 - s.s0;
      let t = grng.f() * tot, s = fit[fit.length - 1];
      for (const q of fit) { t -= q.s1 - q.s0; if (t < 0) { s = q; break; } }
      const lo = s.s0 + EG.end, hi = s.s1 - EG.end - w;
      const p = Math.round((lo + grng.f() * (hi - lo)) * 2) / 2;
      conns.push({ id: i + ',' + j + ':e' + conns.length, o: s.o, c: s.c, s0: p, s1: p + w, a: sites[s.lo].id, b: sites[s.hi].id, route, cross: false });
    };
    for (const e of E) { const [a, b] = e.key.split('|').map(Number); if (tree.union(a, b)) { e.tree = true; place(e, true); } }
    for (const e of E) if (!e.tree && grng.f() < pLoop) place(e, false);

    // ---- border connections: owned by the block whose edge holds them
    for (const side of ['N', 'E', 'S', 'W']) borders[side].forEach(([a, b], k) => {
      const vert = side === 'W' || side === 'E', c = side === 'W' ? x0 : side === 'E' ? x1 : side === 'N' ? y0 : y1;
      const s0 = (vert ? y0 : x0) + a, s1 = (vert ? y0 : x0) + b;
      const bid = vert ? 'v' + (side === 'W' ? i : i + 1) + ',' + j : 'h' + i + ',' + (side === 'N' ? j : j + 1);
      let owner = -1;
      blocks.forEach((bl, t) => {
        const r = bl.r, on = vert ? r[side === 'W' ? 0 : 2] === c && r[1] <= s0 && r[3] >= s1 : r[side === 'N' ? 1 : 3] === c && r[0] <= s0 && r[2] >= s1;
        if (on) owner = t;
      });
      const mine = sites[siteOf[owner]].id, low = side === 'W' || side === 'N';
      conns.push({ id: bid + ':' + k, o: vert ? 'v' : 'h', c, s0, s1, a: low ? null : mine, b: low ? mine : null, route: true, cross: true,
        peerCell: side === 'W' ? [i - 1, j] : side === 'E' ? [i + 1, j] : side === 'N' ? [i, j - 1] : [i, j + 1] });
    });
    const byId = new Map(sites.map((s) => [s.id, s]));
    for (const cn of conns) for (const sid of [cn.a, cn.b]) if (sid) byId.get(sid).conns.push(cn.id);
    return { i, j, rect: [x0, y0, x1, y1], density: pc.density, openness: cellOpen, pois: pois.filter((P) => !dropped.has(P.id)), lots, borders, blocks: blocks.map((b) => b.r), sites, conns, byId, connById: new Map(conns.map((c) => [c.id, c])) };
  }

  /** a connection as a filler sees it from one of its sites (site frame, metres) */
  function connFor(site, cn) {
    const ox = site.bbox[0], oy = site.bbox[1], lowSide = cn.a === site.id;
    const side = cn.o === 'v' ? (lowSide ? 'E' : 'W') : (lowSide ? 'S' : 'N');
    return { id: cn.id, side, at: cn.s0 - (cn.o === 'h' ? ox : oy), width: cn.s1 - cn.s0, line: cn.c - (cn.o === 'h' ? oy : ox), kind: 'opening', route: cn.route };
  }
  const local = (rects, ox, oy) => rects.map((q) => [q[0] - ox, q[1] - oy, q[2] - ox, q[3] - oy]);

  // ------------------------------------------------------------- build
  /**
   * A site's blueprints: { site, origin, filler (br.filler, or null for a
   * flush lot), buildings: [{ poi, origin, b (br.building), conns:
   * { portalId: connId } }], conns (the site's connections, its own frame),
   * issues, ms }.
   *   filler  a pool filler, built round any POI inside it
   *   lot     the yard, built round its house and sheds
   *   flush   the building alone: its doors are the site's connections
   * Inside a filler or a yard, buildings come first: their footprints leave
   * the site and their doors become connections it honours (LOT.build).
   */
  function buildSite(W, site) {
    const t0 = now(), ox = site.bbox[0], oy = site.bbox[1];
    const cell = W.cell(site.i, site.j);
    const conns = site.conns.map((id) => connFor(site, cell.connById.get(id)));
    const out = { site, origin: [ox, oy], filler: null, buildings: [], conns, issues: [], ms: 0 };
    if (site.kind === 'flush') {
      const L = site.lots[0], P = L.pois[0];
      out.buildings.push({ poi: P, origin: [P.bbox[0], P.bbox[1]], b: L.b, conns: Object.assign({}, L.portalConns) });
      out.ms = now() - t0;
      return out;
    }
    const byId = new Map(site.pois.map((P) => [P.id, P])), pre = new Map();
    for (const L of site.lots) if (L.b) pre.set(L.pois[0].id, L.b);
    const r = BR.LOT.build({
      seed: site.seed, site: { rects: local(site.rects, ox, oy) }, filler: W.fillerOf(site), connections: conns,
      buildings: site.pois.map((P) => ({ id: P.id, archetype: P.archetype, seed: P.seed, approach: P.approach, rects: local(P.rects, ox, oy), flush: P.mode === 'flush', toBack: P.mode === 'yard', b: pre.get(P.id) })),
      lots: site.lots.map((L) => ({ rect: local([L.rect], ox, oy)[0], front: L.approach, kind: L.kind }))
    });
    out.filler = r.setting;
    out.conns = r.conns;
    out.issues = r.issues;
    out.buildings = r.buildings.map((B) => ({ poi: byId.get(B.id), origin: [B.origin[0] + ox, B.origin[1] + oy], b: B.b, conns: B.conns }));
    out.ms = now() - t0;
    return out;
  }

  // ------------------------------------------------------------- the world
  class World {
    constructor(seed, opts) {
      this.seed = seed >>> 0;
      this.limits = Object.assign({}, CFG.limits, opts && opts.limits);
      this.cells = new Map();
      this.builds = new Map();
      this.stats = { cellsPlanned: 0, sitesBuilt: 0, buildMs: 0, poisBuilt: 0, issues: 0 };
    }
    static lru(map, key, limit, make) {
      let v = map.get(key);
      if (v !== undefined) { map.delete(key); map.set(key, v); return v; }
      v = make();
      map.set(key, v);
      if (map.size > limit) { let drop = Math.max(1, limit >> 2); for (const k of map.keys()) { if (drop-- <= 0) break; map.delete(k); } }
      return v;
    }
    /** the plan of cell (i, j) */
    cell(i, j) { return World.lru(this.cells, i + ',' + j, this.limits.cells, () => { this.stats.cellsPlanned++; return planCell(this, i, j); }); }
    cellAt(x, y) { const C = CFG.cell; return this.cell(Math.floor(x / C), Math.floor(y / C)); }
    /** a site by id ('i,j:k') */
    site(id) { const c = id.indexOf(':'), ij = id.slice(0, c).split(','); return this.cell(+ij[0], +ij[1]).byId.get(id) || null; }
    siteAt(x, y) {
      for (const s of this.cellAt(x, y).sites) for (const q of s.rects) if (x >= q[0] && x < q[2] && y >= q[1] && y < q[3]) return s;
      return null;
    }
    /** sites whose bbox meets [x0, y0, x1, y1] */
    sitesIn(x0, y0, x1, y1) {
      const C = CFG.cell, out = [];
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++)
        for (const s of this.cell(i, j).sites) { const b = s.bbox; if (b[0] < x1 && b[2] > x0 && b[1] < y1 && b[3] > y0) out.push(s); }
      return out;
    }
    poiAt(x, y) {
      const s = this.siteAt(x, y);
      if (!s) return null;
      for (const P of s.pois) for (const q of P.rects) if (x >= q[0] && x < q[2] && y >= q[1] && y < q[3]) return P;
      return null;
    }
    poisIn(x0, y0, x1, y1) { return this.sitesIn(x0, y0, x1, y1).flatMap((s) => s.pois.filter((P) => P.bbox[0] < x1 && P.bbox[2] > x0 && P.bbox[1] < y1 && P.bbox[3] > y0)); }
    /** the filler that builds a site: the pool's pick with the biome's weights, the yard for a lot, none for a flush lot */
    fillerOf(site) {
      if (site.kind === 'flush') return null;
      if (site.kind === 'lot') return 'yard';
      if (!site._filler) site._filler = FILL.pick({ seed: site.seed, site: { rects: local(site.rects, site.bbox[0], site.bbox[1]) }, weights: fillerWeights(site.openness) });
      return site._filler;
    }
    /** a site's blueprints (cached) */
    build(site) {
      return World.lru(this.builds, site.id, this.limits.builds, () => {
        const r = buildSite(this, site);
        this.stats.sitesBuilt++; this.stats.buildMs += r.ms; this.stats.poisBuilt += r.buildings.length; this.stats.issues += r.issues.length;
        return r;
      });
    }
    hasBuild(site) { return this.builds.has(site.id); }
    /** the site on the other side of a connection, or null */
    peer(site, cn) {
      if (!cn.cross) return this.site(cn.a === site.id ? cn.b : cn.a);
      const c = this.cell(cn.peerCell[0], cn.peerCell[1]).connById.get(cn.id);
      return c ? this.site(c.a || c.b) : null;
    }
    connection(site, id) {
      const cn = this.cell(site.i, site.j).connById.get(id);
      return cn || null;
    }
    biomeAt(x, y) { const o = openness(this.seed, x, y); return { openness: o, name: biomeName(o) }; }

    /**
     * The world's room graph over the sites of cells [i0..i1] x [j0..j1]:
     * every blueprint's own graph, joined where two portals share a
     * connection. Nodes: 'siteId/roomId' or 'siteId/poiId/roomId'.
     * Returns { nodes: Set, edges: [[u, v]], dangling: [connection ids that leave the region] }.
     */
    graph(i0, j0, i1, j1) {
      const nodes = new Set(), edges = [], ends = new Map();
      const end = (id, node) => { if (!ends.has(id)) ends.set(id, []); ends.get(id).push(node); };
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const s of this.cell(i, j).sites) {
        const r = this.build(s), f = r.filler, pre = s.id + '/';
        if (f) {
          for (const rm of f.rooms) nodes.add(pre + rm.id);
          for (const e of f.graph.edges) if (e[0] !== 'outside' && e[1] !== 'outside') edges.push([pre + e[0], pre + e[1]]);
          for (const p of f.portals) end(p.connection, pre + p.room);
        }
        for (const B of r.buildings) {
          const bp = pre + B.poi.id + '/';
          for (const rm of B.b.rooms) nodes.add(bp + rm.id);
          for (const e of B.b.graph.edges) if (e[0] !== 'outside' && e[1] !== 'outside') edges.push([bp + e[0], bp + e[1]]);
          for (const p of B.b.portals) if (B.conns[p.id]) end(B.conns[p.id], bp + p.room);
        }
      }
      const dangling = [];
      for (const [id, list] of ends) {
        if (list.length === 1) dangling.push(id);
        for (let k = 1; k < list.length; k++) edges.push([list[0], list[k]]);
      }
      return { nodes, edges, dangling };
    }
  }

  BR.WORLD_CFG = CFG;
  BR.World = World;
  BR.worldFillerWeights = fillerWeights;
  BR.borderOpenings = borderOpenings;
  BR.openness = openness;
})(typeof window !== 'undefined' ? window : globalThis);
