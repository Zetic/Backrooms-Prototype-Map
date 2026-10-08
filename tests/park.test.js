// The park: a hall whose floor is tiled by zones, sometimes with a building
// built by its own template. run: node tests/park.test.js [seeds]
// (the br.building contract itself is checked for every archetype by
// tests/templates.test.js)
const { BR, components, harness } = require('./helpers');
const { walk1m } = require('./walk');
const { check, finish } = harness(), TPL = BR.TPL, TG = BR.TG;
const N = +(process.argv[2] || 40), SIDES = ['S', 'E', 'N', 'W'], G = 0.5;
const strip = (x) => JSON.stringify(x, (k, v) => (k === 'ms' ? undefined : v));
const builds = [];
for (let s = 1; s <= N; s++) {
  const spec = { archetype: 'park', seed: s * 104723, approach: SIDES[s % 4] };
  if (s % 4 === 0) spec.wrongness = 1;
  builds.push({ spec, b: TPL.generate(spec) });
}
const ok = builds.filter((x) => !x.b.error);
check('the park builds on every seed and main side', ok.length === builds.length, `${ok.length} of ${builds.length}`);

/** a raster (0.5 m cells) of what covers each cell: f(item) -> rects */
function raster(b, items, rectsOf) {
  const W = Math.round(b.site.w / G), H = Math.round(b.site.h / G), R = new Int32Array(W * H).fill(-1);
  let overlap = 0, off = 0;
  items.forEach((it, k) => { for (const q of rectsOf(it)) for (let y = Math.round(q[1] / G); y < Math.round(q[3] / G); y++) for (let x = Math.round(q[0] / G); x < Math.round(q[2] / G); x++) { if (x < 0 || y < 0 || x >= W || y >= H) { off++; continue; } if (R[y * W + x] >= 0) overlap++; R[y * W + x] = k; } });
  return { W, H, R, overlap, off };
}
const zoneAt = (b, x, y) => b.zones.find((z) => z.rects.some((q) => x > q[0] && x < q[2] && y > q[1] && y < q[3]));

// ---- 1. the hall's floor is tiled by zones, exactly
{
  let tiled = 0, patches = 0, crumbs = 0;
  for (const { b } of ok) {
    // the park's floor: its hall, and the pit sunk into it (a floor of its own, tpl/floors.js)
    const hall = b.rooms.find((r) => r.type === 'park'), floor = b.rooms.filter((r) => r === hall || r.parent === hall.id);
    const H = raster(b, floor, (r) => r.rects), Z = raster(b, b.zones, (z) => z.rects);
    let miss = 0, stray = 0;
    for (let i = 0; i < H.R.length; i++) { if (H.R[i] >= 0 && Z.R[i] < 0) miss++; if (Z.R[i] >= 0 && H.R[i] < 0) stray++; }
    if (!miss && !stray && !Z.overlap && !Z.off && b.zones.every((z) => floor.some((r) => r.id === z.room))) tiled++;
    // each zone is one connected patch, and none is a crumb
    for (const z of b.zones) {
      const cells = new Set(), key = (x, y) => x + ',' + y;
      for (const q of z.rects) for (let y = q[1]; y < q[3]; y += G) for (let x = q[0]; x < q[2]; x += G) cells.add(key(x, y));
      const [first] = cells, seen = new Set([first]), st = [first];
      while (st.length) { const [x, y] = st.pop().split(',').map(Number); for (const [a, c] of [[x + G, y], [x - G, y], [x, y + G], [x, y - G]]) { const k = key(a, c); if (cells.has(k) && !seen.has(k)) { seen.add(k); st.push(k); } } }
      if (seen.size === cells.size) patches++;
      if (z.area < 1) crumbs++;
    }
  }
  const zones = ok.reduce((s, x) => s + x.b.zones.length, 0);
  check('every cell of the park\'s floor is in exactly one zone', tiled === ok.length, `${tiled} of ${ok.length} parks`);
  check('a zone is one connected patch, and none is a crumb under 1 m²', patches === zones && crumbs === 0, `${zones} zones, ${crumbs} crumbs`);
}

// ---- 2. what every park has
{
  let full = 0;
  for (const { b } of ok) {
    const n = (t) => b.zones.filter((z) => z.type === t).length;
    const play = b.zones.find((z) => z.type === 'playground');
    if (n('playground') === 1 && play.area >= 7 * 6 * 0.8 * 0.8 - 1e-9 && n('path') >= 1 && n('lawn') >= 1) full++;
  }
  check('every park has one playground, paths and lawn', full === ok.length, `${full} of ${ok.length}`);
  let seats = 0, onPath = 0;
  for (const { b } of ok) for (const z of b.zones.filter((x) => x.type === 'seating')) {
    seats++;
    const q = z.rects[0], ring = [[q[0] - 0.25, (q[1] + q[3]) / 2], [q[2] + 0.25, (q[1] + q[3]) / 2], [(q[0] + q[2]) / 2, q[1] - 0.25], [(q[0] + q[2]) / 2, q[3] + 0.25]];
    if (ring.some(([x, y]) => (zoneAt(b, x, y) || {}).type === 'path')) onPath++;
  }
  check('every bench spot is on the edge of a path', seats > 0 && onPath === seats, `${onPath} of ${seats}`);
  // the entrance: on the main side, onto a path
  let gates = 0, onto = 0;
  for (const { b } of ok) for (const p of b.portals) {
    gates++;
    const op = b.openings.find((o) => o.id === p.opening), mid = [(op.a[0] + op.b[0]) / 2, (op.a[1] + op.b[1]) / 2], d = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[p.side];
    if ((zoneAt(b, mid[0] + d[0] * 0.25, mid[1] + d[1] * 0.25) || {}).type === 'path') onto++;
  }
  check('every way into the park opens onto a path, the main one on the main side', onto === gates && ok.every(({ b }) => b.portals.find((p) => p.main).side === b.approach), `${onto} of ${gates}`);
}

// ---- 3. pillars stand on tile pads, off the paths and the playground
{
  let n = 0, good = 0;
  for (const { b } of ok) for (const c of b.columns) {
    n++;
    let pad = true;
    for (let y = c.rect[1] + 0.25; y < c.rect[3]; y += G) for (let x = c.rect[0] + 0.25; x < c.rect[2]; x += G) if ((zoneAt(b, x, y) || {}).type !== 'plaza') pad = false;
    if (pad) good++;
  }
  check('every pillar stands on a plaza pad', n > 0 && good === n, `${good} of ${n} pillars`);
  let walk = 0, bad = [];
  for (const { b, spec } of ok) { const w = walk1m(b); if (!w.unreached && !w.stuck.length) walk++; else bad.push(spec.seed + ': ' + w.unreached + ' cells'); }
  check('a 1 m walker from the entrances reaches every floor cell, round every pillar', walk === ok.length, `${walk} of ${ok.length}` + (bad.length ? '; ' + bad.slice(0, 2).join(', ') : ''));
}

// ---- 4. the building: sometimes, built by its own template, on a tile apron
{
  const withB = ok.filter(({ b }) => b.parts.length), share = withB.length / ok.length;
  check('a park has a building some of the time', share > 0.3 && share < 0.85, `${withB.length} of ${ok.length}`);
  let same = 0, doors = 0, onPark = 0, apron = 0;
  for (const { b } of withB) {
    const p = b.parts[0], base = TPL.archetypes[p.spec.archetype];
    const alone = TPL.generate({ archetype: Object.assign({}, base, p.spec.override || {}), seed: p.spec.seed, site: p.spec.site, approach: p.spec.approach, wrongness: p.spec.wrongness });
    const sig = (rs) => rs.map((r) => r.type + ':' + r.area).join(',');
    if (!alone.error && sig(b.rooms.filter((r) => r.part === p.id)) === sig(alone.rooms) && p.doors.length === alone.portals.length) same++;
    const hall = b.rooms.find((r) => r.type === 'park');
    for (const id of p.doors) { doors++; if (b.openings.find((o) => o.id === id).rooms.indexOf(hall.id) >= 0) onPark++; }
    // the cells just outside the building's walls are tile
    const fp = b.rooms.filter((r) => r.part === p.id).flatMap((r) => r.rects), bb = TG.bbox(fp);
    const ring = [[bb[0] - 0.25, (bb[1] + bb[3]) / 2], [bb[2] + 0.25, (bb[1] + bb[3]) / 2], [(bb[0] + bb[2]) / 2, bb[1] - 0.25], [(bb[0] + bb[2]) / 2, bb[3] + 0.25]];
    if (ring.every(([x, y]) => (zoneAt(b, x, y) || {}).type === 'plaza')) apron++;
  }
  check('the building is exactly what its template builds alone', same === withB.length, `${same} of ${withB.length}`);
  check('every door of the building opens onto the park', doors > 0 && onPark === doors, `${onPark} of ${doors}`);
  check('a building stands on a tile apron', apron === withB.length, `${apron} of ${withB.length}`);
  const kinds = new Set(withB.map(({ b }) => b.parts[0].archetype));
  check('the building comes from several templates', kinds.size >= 2, [...kinds].join(', '));
}

// ---- 5. wrongness, determinism
{
  const p = TPL.generate({ archetype: 'park', seed: 9, mutations: ['pit'] }), pit = p.zones.find((z) => z.type === 'pit');
  check('pit: a hole in the lawn, marked as a hazard', !!pit && pit.tags.indexOf('wrong:pit') >= 0 && pit.tags.indexOf('hazard') >= 0);
  const plain = TPL.generate({ archetype: 'park', seed: 9, mutations: [] }), crowd = TPL.generate({ archetype: 'park', seed: 9, mutations: ['crowded'] });
  check('crowded: pillars everywhere', crowd.columns.length > plain.columns.length * 2, `${plain.columns.length} -> ${crowd.columns.length}`);
  const spec = { archetype: 'park', seed: 4242, approach: 'E' }, a = strip(TPL.generate(spec));
  TPL.generate({ archetype: 'ranch', seed: 3 });
  check('same spec gives the same park, whatever was built before', a === strip(TPL.generate(spec)));
}

// ---- 6. on the map
{
  let found = null;
  for (const seed of [31337, 7]) {
    const W = new BR.World(seed);
    for (let i = -3; i <= 3 && !found; i++) for (let j = -3; j <= 3 && !found; j++) {
      const P = W.cell(i, j).pois.find((x) => x.archetype === 'park');
      if (P) found = { W, i, j, P };
    }
    if (found) break;
  }
  check('the world places parks', !!found);
  if (found) {
    const { W, i, j, P } = found, site = W.siteAt(P.cx, P.cy), B = W.build(site).buildings[0];
    check('a park is a flush lot of its own, joined through its own ways in', P.mode === 'flush' && site.kind === 'flush' && site.conns.length === B.b.portals.length, `${site.conns.length} ways in`);
    const g = W.graph(i - 1, j - 1, i + 1, j + 1), comp = components(g.nodes, g.edges);
    check('every room of it is reachable from the rest of the world', comp.sizes.length === 1 && [...g.nodes].filter((k) => k.indexOf(site.id + '/' + P.id + '/') === 0).length === B.b.rooms.length);
  }
}
finish();
