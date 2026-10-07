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
 *   2. POIs     claim their sites first (poi.js)
 *   3. blocks   the cell is cut into 8-32 m blocks (whole metres); no cut
 *               comes within 2 m of a POI or 1 m of a border opening, so a
 *               POI sits whole inside one block (a host block)
 *   4. sites    some small blocks merge into a neighbour (L, T and Z sites);
 *               every block belongs to exactly one site, so a cell has no
 *               gaps and no overlaps
 *   5. graph    a random spanning tree over the sites' shared edges plus a
 *               few loops; each edge is an exact opening on the shared line.
 *               The border openings join each cell to its neighbours, so the
 *               whole plane is one connected graph
 *   6. build    a filler from the pool builds each site from its
 *               connections. A host block builds its POIs first (their own
 *               templates); the host hall round them takes their portals as
 *               connections
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
   * { i, j, rect, density, pois, borders, sites: [site], conns: [conn], byId }
   * site: { id, i, j, k, rects (world metres, whole), bbox, area, pois, host,
   *         seed, openness, conns: [conn ids] }
   * conn: { id, o ('h': the line y = c, 'v': x = c), c, s0, s1 (world metres
   *         along the line), a, b (site ids, a west / north of b; a border
   *         connection has the neighbour cell's site as null), route, cross }
   */
  function planCell(W, i, j) {
    const seed = W.seed, C = CFG.cell, x0 = i * C, y0 = j * C, x1 = x0 + C, y1 = y0 + C;
    const rng = new Rng(hash4(seed, i, j, S.CELL));
    const borders = { W: borderOpenings(seed, 'v', i, j), E: borderOpenings(seed, 'v', i + 1, j), N: borderOpenings(seed, 'h', i, j), S: borderOpenings(seed, 'h', i, j + 1) };
    const pc = BR.buildPOICell(W, i, j), pois = pc.pois;

    // ---- blocks
    const B = CFG.block, cl = B.clear, blocks = [];
    const hits = (list, p) => list.some((q) => p > q[0] - 1 && p < q[1] + 1);
    const cutOk = (r, inside, vert, c) => {
      for (const P of inside) { const b = P.bbox; if (vert ? c > b[0] - cl && c < b[2] + cl : c > b[1] - cl && c < b[3] + cl) return false; }
      if (vert) return !(r[1] === y0 && hits(borders.N, c - x0)) && !(r[3] === y1 && hits(borders.S, c - x0));
      return !(r[0] === x0 && hits(borders.W, c - y0)) && !(r[2] === x1 && hits(borders.E, c - y0));
    };
    const split = (r, inside) => {
      const w = r[2] - r[0], h = r[3] - r[1];
      const o = openness(seed, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2), max = Math.round(B.max[0] + (B.max[1] - B.max[0]) * o);
      const canX = w >= 2 * B.min, canY = h >= 2 * B.min;
      if ((!canX && !canY) || (w <= max && h <= max && rng.f() < B.pStop)) { blocks.push({ r, pois: inside }); return; }
      const first = canX && (!canY || w > h * 1.15 || (h <= w * 1.15 && rng.f() < 0.5));
      for (const vert of canX && canY ? [first, !first] : [canX]) {
        const lo = (vert ? r[0] : r[1]) + B.min, hi = (vert ? r[2] : r[3]) - B.min;
        for (let t = 0; t < B.tries; t++) {
          const c = rng.int(lo, hi);
          if (!cutOk(r, inside, vert, c)) continue;
          const a = vert ? [r[0], r[1], c, r[3]] : [r[0], r[1], r[2], c], b = vert ? [c, r[1], r[2], r[3]] : [r[0], c, r[2], r[3]];
          split(a, inside.filter((P) => TG.roverlap(P.bbox, a)));
          split(b, inside.filter((P) => TG.roverlap(P.bbox, b)));
          return;
        }
      }
      blocks.push({ r, pois: inside });
    };
    split([x0, y0, x1, y1], pois.slice());

    // ---- shared edges between blocks (a west / north of b)
    const n = blocks.length, adj = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const p = blocks[a].r, q = blocks[b].r;
      if (p[2] === q[0]) { const s0 = Math.max(p[1], q[1]), s1 = Math.min(p[3], q[3]); if (s1 > s0) adj.push({ a, b, o: 'v', c: p[2], s0, s1 }); }
      if (p[3] === q[1]) { const s0 = Math.max(p[0], q[0]), s1 = Math.min(p[2], q[2]); if (s1 > s0) adj.push({ a, b, o: 'h', c: p[3], s0, s1 }); }
    }

    // ---- sites: some small blocks merge into a neighbour
    const M = CFG.merge, uf = makeUF(n), area = blocks.map((k) => TG.rarea(k.r)), box = blocks.map((k) => k.r.slice());
    const order = blocks.map((_, k) => k);
    for (let k = n - 1; k > 0; k--) { const t = rng.int(0, k), s = order[k]; order[k] = order[t]; order[t] = s; }
    for (const a of order) {
      if (blocks[a].pois.length || rng.f() >= M.p) continue;
      const cand = [];
      for (const e of adj) {
        const b = e.a === a ? e.b : e.b === a ? e.a : -1;
        if (b >= 0 && e.s1 - e.s0 >= M.minShared && !blocks[b].pois.length && uf.find(b) !== uf.find(a) && cand.indexOf(b) < 0) cand.push(b);
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
      const sp = g.ks.flatMap((b) => blocks[b].pois);
      return {
        id: i + ',' + j + ':' + k, i, j, k, rects, bbox: g.bbox, area: rects.reduce((s, q) => s + TG.rarea(q), 0),
        pois: sp, host: sp.length > 0, seed: hash4(seed, i, j, (k << 8) ^ S.SITE),
        openness: openness(seed, (g.bbox[0] + g.bbox[2]) / 2, (g.bbox[1] + g.bbox[3]) / 2), conns: []
      };
    });

    // ---- graph: shared segments per site pair, merged where they run on
    const pairs = new Map();
    for (const e of adj) {
      const A = siteOf[e.a], Bk = siteOf[e.b];
      if (A === Bk) continue;
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
    E.sort((p, q) => p.w - q.w || (p.key < q.key ? -1 : 1));
    const conns = [], tree = makeUF(sites.length), cellOpen = openness(seed, (x0 + x1) / 2, (y0 + y1) / 2);
    const pLoop = CFG.loops[0] + (CFG.loops[1] - CFG.loops[0]) * cellOpen;
    const place = (e, route) => {
      let w = pickW(grng, EG.widths);
      let fit = e.segs.filter((s) => s.s1 - s.s0 >= w + 2 * EG.end);
      if (!fit.length) { w = 1; fit = e.segs; }
      let tot = 0;
      for (const s of fit) tot += s.s1 - s.s0;
      let t = grng.f() * tot, s = fit[fit.length - 1];
      for (const q of fit) { t -= q.s1 - q.s0; if (t < 0) { s = q; break; } }
      const lo = s.s0 + EG.end, hi = s.s1 - EG.end - w;
      const at = Math.round((lo + grng.f() * (hi - lo)) * 2) / 2;
      conns.push({ id: i + ',' + j + ':e' + conns.length, o: s.o, c: s.c, s0: at, s1: at + w, a: sites[s.lo].id, b: sites[s.hi].id, route, cross: false });
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
    return { i, j, rect: [x0, y0, x1, y1], density: pc.density, openness: cellOpen, pois, borders, blocks: blocks.map((b) => b.r), sites, conns, byId, connById: new Map(conns.map((c) => [c.id, c])) };
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
   * A site's blueprints: { site, origin, filler (br.filler), buildings:
   * [{ poi, origin, b (br.building), conns: { portalId: connId } }], conns
   * (the filler's connections, world frame), issues, ms }.
   * A host site builds its POIs first: their footprints leave the host's
   * site (with any courtyard they close off), their ground-floor portals
   * become the host's connections.
   */
  function buildSite(W, site) {
    const t0 = now(), ox = site.bbox[0], oy = site.bbox[1];
    const cell = W.cell(site.i, site.j);
    const conns = site.conns.map((id) => connFor(site, cell.connById.get(id)));
    const out = { site, origin: [ox, oy], filler: null, buildings: [], conns: [], issues: [], ms: 0 };
    let rects = site.rects, hint = null;
    if (site.host) {
      const bw = U(site.bbox[2] - ox), bh = U(site.bbox[3] - oy), R = new TG.Raster(bw, bh, 1);
      for (const P of site.pois) {
        const b = BR.buildPOI(W, P);
        if (b.error) { out.issues.push(P.name + ': no layout fit its site'); continue; }
        const px = P.bbox[0] - ox, py = P.bbox[1] - oy, B = { poi: P, origin: [P.bbox[0], P.bbox[1]], b, conns: {} };
        for (const q of b.footprint[0].rects) R.fill([U(q[0] + px), U(q[1] + py), U(q[2] + px), U(q[3] + py)], 0);
        for (const p of b.portals) {
          if (p.level) continue;
          const op = b.openings.find((x) => x.id === p.opening), horiz = op.a[1] === op.b[1];
          const s0 = horiz ? Math.min(op.a[0], op.b[0]) + px : Math.min(op.a[1], op.b[1]) + py, s1 = s0 + op.width;
          const id = 'P' + P.id + ':' + p.id;
          conns.push({ id, side: TG.opposite(p.side), at: s0, width: op.width, line: horiz ? op.a[1] + py : op.a[0] + px, kind: 'opening', route: !!p.main });
          B.conns[p.id] = id;
        }
        out.buildings.push(B);
      }
      // a courtyard a building closes off is not the host's floor
      const seen = new Uint8Array(bw * bh), st = [];
      for (let x = 0; x < bw; x++) for (const y of [0, bh - 1]) if (R.a[y * bw + x] === 1 && !seen[y * bw + x]) { seen[y * bw + x] = 1; st.push(y * bw + x); }
      for (let y = 0; y < bh; y++) for (const x of [0, bw - 1]) if (R.a[y * bw + x] === 1 && !seen[y * bw + x]) { seen[y * bw + x] = 1; st.push(y * bw + x); }
      while (st.length) {
        const c = st.pop(), x = c % bw, y = (c - x) / bw;
        for (const d of [x > 0 ? c - 1 : -1, x < bw - 1 ? c + 1 : -1, y > 0 ? c - bw : -1, y < bh - 1 ? c + bw : -1]) if (d >= 0 && !seen[d] && R.a[d] === 1) { seen[d] = 1; st.push(d); }
      }
      for (let c = 0; c < bw * bh; c++) if (!seen[c]) R.a[c] = 0;
      rects = TG.rectsWhere(R, (v) => v === 1).map((q) => [q[0] * G + ox, q[1] * G + oy, q[2] * G + ox, q[3] * G + oy]);
      hint = { hall: site.pois.flatMap((P) => local(P.rects, ox, oy)) };
    }
    const spec = { rects: local(rects, ox, oy) };
    const ok = [];
    for (const c of conns) { const e = FILL.checkConnection(spec, c); if (e) out.issues.push(e); else ok.push(c); }
    const fid = site.host ? 'host' : W.fillerOf(site);
    let b = FILL.generate({ filler: fid, seed: site.seed, site: spec, connections: ok, hint });
    if (b.error) { out.issues.push(b.error); b = FILL.generate({ filler: 'warren', seed: site.seed, site: spec, connections: ok }); }
    out.filler = b;
    out.conns = ok;
    for (const x of (b.meta && b.meta.issues) || []) out.issues.push(x);
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
    /** the filler the pool picks for a (non-host) site, with the biome's weights */
    fillerOf(site) {
      if (site.host) return 'host';
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
        for (const rm of f.rooms) nodes.add(pre + rm.id);
        for (const e of f.graph.edges) if (e[0] !== 'outside' && e[1] !== 'outside') edges.push([pre + e[0], pre + e[1]]);
        for (const p of f.portals) end(p.connection, pre + p.room);
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
})(typeof window !== 'undefined' ? window : globalThis);
