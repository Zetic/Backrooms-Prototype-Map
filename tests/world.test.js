// The template-first world: cell plans, the connection graph, every site
// built by a template, and the rules that make an infinite map work.
// run: node tests/world.test.js [seed]
const { BR, components, harness } = require('./helpers');
const { check, finish } = harness(), seed = +(process.argv[2] || 31337), C = BR.WORLD_CFG.cell, TPL = BR.TPL;
const strip = (x) => JSON.stringify(x, (k, v) => (k === 'ms' || k === '_filler' ? undefined : v));
const planPrint = (W, i0, j0, i1, j1) => {
  const out = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = W.cell(i, j); out.push(strip({ sites: c.sites, conns: c.conns })); }
  return out.join('\n');
};
const inRects = (rs, x, y) => rs.some((q) => x >= q[0] && x < q[2] && y >= q[1] && y < q[3]);

check('the world cell and the POI planning cell are the same size', C === BR.POI_CFG.cell);

// ---- 1. sites tile every cell: no gaps, no overlaps
const W = new BR.World(seed), R = [-3, -3, 2, 2];
{
  let bad = 0, offGrid = 0, overlap = 0, gaps = 0, n = 0, ids = new Set(), dup = 0, lookups = 0;
  for (let i = R[0]; i <= R[2]; i++) for (let j = R[1]; j <= R[3]; j++) {
    const c = W.cell(i, j), x0 = i * C, y0 = j * C, own = new Int32Array(C * C).fill(-1);
    for (const s of c.sites) {
      n++;
      if (ids.has(s.id)) dup++; ids.add(s.id);
      if (W.site(s.id) !== s) lookups++;
      for (const q of s.rects) {
        if (q.some((v) => v !== Math.round(v))) offGrid++;
        if (q[0] < x0 || q[1] < y0 || q[2] > x0 + C || q[3] > y0 + C) bad++;
        for (let y = q[1]; y < q[3]; y++) for (let x = q[0]; x < q[2]; x++) {
          const k = (y - y0) * C + (x - x0);
          if (own[k] >= 0) overlap++; else own[k] = s.k;
        }
      }
    }
    for (let k = 0; k < C * C; k++) if (own[k] < 0) gaps++;
  }
  check('sites tile every cell exactly: no gaps, no overlaps', gaps === 0 && overlap === 0 && bad === 0, `${n} sites in 36 cells, ${gaps} gap m², ${overlap} overlap m²`);
  check('sites are whole metres, ids are unique and resolve back', offGrid === 0 && dup === 0 && lookups === 0);
  const sizes = [];
  for (let i = R[0]; i <= R[2]; i++) for (let j = R[1]; j <= R[3]; j++) for (const s of W.cell(i, j).sites) if (!s.host) sizes.push(s.area);
  sizes.sort((a, b) => a - b);
  const odd = [...ids].map((id) => W.site(id)).filter((s) => s.rects.length > 1).length;
  check('filler sites are room-cluster sized, and some are irregular', sizes[0] >= 64 && sizes[Math.floor(sizes.length / 2)] < 400 && odd > n * 0.1,
    `median ${sizes[Math.floor(sizes.length / 2)]} m², ${odd} L / T / Z sites`);
}

// ---- 2. POIs claim their sites first
{
  let outside = 0, close = 0, pois = 0, lost = 0;
  for (let i = R[0]; i <= R[2]; i++) for (let j = R[1]; j <= R[3]; j++) {
    const c = W.cell(i, j);
    const hosted = new Set(c.sites.flatMap((s) => s.pois.map((P) => P.id)));
    for (const P of c.pois) { pois++; if (!hosted.has(P.id)) lost++; }
    for (const s of c.sites) for (const P of s.pois) {
      const b = P.bbox, block = s.rects.find((q) => q[0] <= b[0] && q[1] <= b[1] && q[2] >= b[2] && q[3] >= b[3]);
      if (!block) { outside++; continue; }
      if (b[0] - block[0] < 2 || b[1] - block[1] < 2 || block[2] - b[2] < 2 || block[3] - b[3] < 2) close++;
    }
  }
  check('every POI sits whole in one host site, 2 m clear of its edges', pois > 0 && lost === 0 && outside === 0 && close === 0, `${pois} POIs`);
}

// ---- 3. the connection graph
{
  let notShared = 0, offGrid = 0, narrow = 0, disagree = 0, cross = 0, trees = 0, loops = 0, deadEnds = 0, sites = 0, disconnected = 0;
  for (let i = R[0]; i <= R[2]; i++) for (let j = R[1]; j <= R[3]; j++) {
    const c = W.cell(i, j);
    for (const cn of c.conns) {
      if (cn.s1 - cn.s0 < 1) narrow++;
      if ([cn.c, cn.s0, cn.s1].some((v) => v * 2 !== Math.round(v * 2))) offGrid++;
      // the cells just either side of every 0.5 m of the opening belong to a and b
      for (let s = cn.s0 + 0.25; s < cn.s1; s += 0.5) {
        const pa = cn.o === 'v' ? [cn.c - 0.25, s] : [s, cn.c - 0.25], pb = cn.o === 'v' ? [cn.c + 0.25, s] : [s, cn.c + 0.25];
        const A = W.siteAt(pa[0], pa[1]), B = W.siteAt(pb[0], pb[1]);
        if ((cn.a && A.id !== cn.a) || (cn.b && B.id !== cn.b)) notShared++;
      }
      if (cn.cross) {
        cross++;
        const o = W.cell(cn.peerCell[0], cn.peerCell[1]).connById.get(cn.id);
        if (!o || o.o !== cn.o || o.c !== cn.c || o.s0 !== cn.s0 || o.s1 !== cn.s1 || !!o.a === !!cn.a) disagree++;
      } else if (cn.route) trees++; else loops++;
    }
    const inner = c.conns.filter((cn) => !cn.cross);
    const comp = components(c.sites.map((s) => s.id), inner.map((cn) => [cn.a, cn.b]));
    if (comp.sizes.length !== 1) disconnected++;
    for (const s of c.sites) { sites++; if (inner.filter((cn) => cn.a === s.id || cn.b === s.id).length === 1) deadEnds++; }
  }
  check('every connection is an exact opening on the line two sites share', notShared === 0 && offGrid === 0 && narrow === 0);
  check('both cells agree on every opening across their border', cross > 0 && disagree === 0, `${cross} border openings`);
  check('each cell is one connected graph of sites', disconnected === 0);
  check('the graph is route-shaped: a tree with dead ends and a few loops', loops > 0 && loops < trees * 0.4 && deadEnds > sites * 0.1,
    `${trees} tree edges, ${loops} loops, ${deadEnds} dead ends of ${sites} sites`);
}

// ---- 4. the same in any order
{
  const base = planPrint(W, -1, -1, 1, 1);
  const W2 = new BR.World(seed);
  for (let i = 1; i >= -1; i--) for (let j = 1; j >= -1; j--) W2.cell(i, j);
  W2.sitesIn(5000, 5000, 5400, 5300);
  check('cells planned in reverse order, after unrelated visits, come out the same', planPrint(W2, -1, -1, 1, 1) === base);
  const W3 = new BR.World(seed, { limits: { cells: 2, builds: 3 } });
  for (const [i, j] of [[1, 1], [-1, 0], [0, -1], [1, -1], [0, 0]]) W3.cell(i, j);
  check('a tiny cache leaves the plan unchanged', planPrint(W3, -1, -1, 1, 1) === base && W3.cells.size <= 2);
  const far = [-7813, 7810], fb = planPrint(new BR.World(seed), far[0], far[1], far[0] + 1, far[1]);
  const W4 = new BR.World(seed); W4.cell(far[0] + 1, far[1]); W4.cell(0, 0);
  check('far negative coordinates come out the same in any order', planPrint(W4, far[0], far[1], far[0] + 1, far[1]) === fb);
  check('a different seed makes a different world', planPrint(new BR.World(seed + 1), -1, -1, 1, 1) !== base);
}

// ---- 5. every site is built by a template, every connection honoured
const B = [-1, -1, 1, 1];
{
  let n = 0, issues = [], unhonoured = 0, ms = 0, poiMs = 0, pois = 0, failedPois = 0, offSite = 0, wrongSide = 0;
  const fillers = {}, feel = { enclosed: 0, mixed: 0, open: 0 };
  for (let i = B[0]; i <= B[2]; i++) for (let j = B[1]; j <= B[3]; j++) for (const s of W.cell(i, j).sites) {
    const r = W.build(s), f = r.filler;
    n++; ms += r.ms;
    issues.push(...r.issues.map((x) => s.id + ': ' + x));
    const want = new Set(s.conns.concat(r.buildings.flatMap((Bd) => Object.values(Bd.conns))));
    const got = new Set(f.portals.map((p) => p.connection));
    for (const id of want) if (!got.has(id)) unhonoured++;
    if (!s.host) { fillers[f.filler] = (fillers[f.filler] || 0) + 1; feel[f.feel] += s.area; }
    for (const Bd of r.buildings) {
      pois++;
      const P = Bd.poi, local = P.rects.map((q) => [q[0] - P.bbox[0], q[1] - P.bbox[1], q[2] - P.bbox[0], q[3] - P.bbox[1]]);
      const inside = (q) => { for (let x = q[0] + 0.25; x < q[2]; x += 0.5) for (let y = q[1] + 0.25; y < q[3]; y += 0.5) if (!inRects(local, x, y)) return false; return true; };
      if (!Bd.b.rooms.every((rm) => rm.rects.every(inside))) offSite++;
      const main = Bd.b.portals.find((p) => p.main);
      if (!main || main.side !== P.approach) wrongSide++;
    }
    failedPois += s.pois.length - r.buildings.length;
  }
  check('every site builds with no problems', issues.length === 0, `${n} sites; ${issues.slice(0, 3).join('; ')}`);
  check('every connection is cut on both sides, POI doors included', unhonoured === 0, `${unhonoured} missing`);
  check('every POI builds its template inside its site, facing its main side', pois > 0 && failedPois === 0 && offSite === 0 && wrongSide === 0, `${pois} POIs`);
  check('the fill leans enclosed and every pool filler appears', feel.enclosed > (feel.mixed + feel.open) && Object.keys(fillers).length >= 7,
    Object.entries(fillers).map(([k, v]) => k + ' ' + v).join(', '));
  const avg = ms / n;
  check('sites build fast enough to stream (under 5 ms on average)', avg < 5, `${avg.toFixed(2)} ms per site`);
}

// ---- 6. one connected world
{
  const g = W.graph(B[0], B[1], B[2], B[3]), comp = components(g.nodes, g.edges);
  const poiRooms = [...g.nodes].filter((k) => k.split('/').length === 3).length;
  check('every room in 3 x 3 cells, POI rooms included, is reachable from every other', comp.sizes.length === 1 && poiRooms > 0,
    `${g.nodes.size} rooms (${poiRooms} in POIs), ${comp.sizes.length} piece(s)`);
  const cross = new Set();
  for (let i = B[0]; i <= B[2]; i++) for (let j = B[1]; j <= B[3]; j++) for (const cn of W.cell(i, j).conns) if (cn.cross) {
    const inside = cn.peerCell[0] >= B[0] && cn.peerCell[0] <= B[2] && cn.peerCell[1] >= B[1] && cn.peerCell[1] <= B[3];
    if (!inside) cross.add(cn.id);
  }
  check('only openings that leave the region are left dangling', g.dangling.length === cross.size && g.dangling.every((id) => cross.has(id)), `${g.dangling.length} lead out`);
}

// ---- 7. builds are the same whatever was built before
{
  const s = W.cell(0, 0).sites.find((x) => x.host) || W.cell(0, 0).sites[0];
  const W2 = new BR.World(seed, { limits: { cells: 3, builds: 2 } });
  for (const t of W2.sitesIn(900, 900, 1000, 1000).slice(0, 6)) W2.build(t);
  check('a site builds the same whatever was built before', strip(W2.build(W2.site(s.id))) === strip(W.build(s)));
  const t = W.cell(0, 0).sites.find((x) => !x.host);
  check('a filler site builds the same as FILL.generate on its own spec', strip(W.build(t).filler) === strip(BR.FILL.generate({
    filler: W.fillerOf(t), seed: t.seed, site: { rects: t.rects.map((q) => [q[0] - t.bbox[0], q[1] - t.bbox[1], q[2] - t.bbox[0], q[3] - t.bbox[1]]) }, connections: W.build(t).conns
  })));
}

// ---- 8. POI placement: density, variety, rhythm
{
  const ps = W.poisIn(-700, -700, 700, 700), ha = 1400 * 1400 / 1e4, st = BR.poiStats(ps, ha), cat = BR.poiCatalogue();
  const tiers = BR.POI_TIERS.filter((t) => cat[t].length);
  check('POI density is dense but not crowded', st.perHa > 2 && st.perHa < 7, st.perHa.toFixed(2) + ' POIs/ha');
  check('every tier with templates is placed', tiers.every((t) => st.byTier[t] > 0), JSON.stringify(st.byTier));
  const used = new Set(ps.map((P) => P.archetype)), all = tiers.flatMap((t) => cat[t].map((a) => a.id));
  check('every template in the catalogue appears', all.every((id) => used.has(id)), `${used.size}/${all.length}`);
  const shapes = new Set(ps.map((P) => P.shape)), sides = new Set(ps.map((P) => P.approach));
  check('POI sites come in irregular shapes and face every side', shapes.size >= 3 && sides.size === 4, [...shapes].join(','));
  check('small POIs cluster beside bigger ones', ps.filter((P) => P.cluster).length > ps.length * 0.15);
  const cells = []; for (let i = -5; i < 5; i++) for (let j = -5; j < 5; j++) cells.push(W.cell(i, j));
  const d = cells.map((c) => c.density), quiet = cells.filter((c) => c.pois.length <= 2).length;
  check('density has a rhythm of busy and quiet cells', Math.max(...d) / Math.min(...d) > 3 && quiet > 0, `${quiet} quiet of ${cells.length}`);
  const o = cells.map((c) => c.openness);
  check('the biome swings between deep warren and open stretches', Math.min(...o) < 0.3 && Math.max(...o) > 0.65, `openness ${Math.min(...o).toFixed(2)}-${Math.max(...o).toFixed(2)}`);
}

// ---- 9. cost
{
  const W2 = new BR.World(seed + 9), t0 = Date.now();
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) W2.cell(i, j);
  const per = (Date.now() - t0) / 144;
  check('planning a cell is cheap (under 8 ms)', per < 8, `${per.toFixed(2)} ms per cell`);
}
finish();
