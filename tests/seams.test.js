// Seams: where two blueprints end up wall to wall, and what the seam rules
// cut through those shared walls (src/seams.js).
// run: node tests/seams.test.js [--full]
const { BR, components, harness, MODE } = require('./helpers');
const { check, finish } = harness(), SEAM = BR.SEAM, TPL = BR.TPL, LOT = BR.LOT, TG = BR.TG;
const strip = (x) => JSON.stringify(x);
const EPS = 1e-9;

// neighborhoods on a few maps: their houses stand on the lot edge, so they meet fillers.
// Full mode looks at every one in 8 x 8 cells of three seeds; quick mode at
// three known ones (seed, cell; one has the only seam door), and says so if the generator has moved them
const hoods = [], KNOWN = [[7, 0, 1], [7, -2, 0], [12345, -1, -4]];
const hoodsIn = (W, i, j) => { for (const P of W.cell(i, j).pois) if (P.archetype === 'neighborhood') hoods.push({ W, P, site: W.siteAt(P.cx, P.cy) }); };
if (MODE.full) for (const seed of [31337, 7, 12345]) {
  const W = new BR.World(seed);
  for (let i = -4; i < 4; i++) for (let j = -4; j < 4; j++) hoodsIn(W, i, j);
} else for (const [seed, i, j] of KNOWN) hoodsIn(new BR.World(seed), i, j);
check('there are neighborhoods to look at', hoods.length >= 3, hoods.length + (MODE.full || hoods.length >= 3 ? '' : ': the known places in seams.test.js no longer hold one each, update them'));
const all = [];
for (const h of hoods) for (const S of h.W.seams(h.site)) all.push({ h, S });
const W0 = new BR.World(31337);
for (const s of W0.cell(0, 0).sites.slice(0, 30)) for (const S of W0.seams(s)) all.push({ h: { W: W0 }, S });

// ---- 1. a seam is one shared wall: both blueprints have an exterior wall there, floor on both sides
{
  let bad = [], n = 0;
  const itemOf = (W, key) => { const site = W.site(key.split('/')[0]); return W.blueprints(site).find((it) => it.key === key); };
  const inRoom = (it, room, x, y) => it.b.rooms.find((r) => r.id === room).rects.some((q) => x - it.origin[0] > q[0] && x - it.origin[0] < q[2] && y - it.origin[1] > q[1] && y - it.origin[1] < q[3]);
  for (const { h, S } of all) {
    n++;
    const A = itemOf(h.W, S.a.key), B = itemOf(h.W, S.b.key);
    const covered = (it, side) => {
      let len = 0;
      for (const ref of side.walls) {
        const w = it.b.walls.find((x) => x.id === ref.wall);
        if (!w || w.kind !== 'exterior') return false;
        len += ref.s1 - ref.s0;
      }
      return Math.abs(len - (S.s1 - S.s0)) < 1e-6;
    };
    const mid = S.s0 + 0.25, p = S.o === 'h' ? [[mid, S.c - 0.25], [mid, S.c + 0.25]] : [[S.c - 0.25, mid], [S.c + 0.25, mid]];
    const floor = (inRoom(A, S.a.room, ...p[0]) && inRoom(B, S.b.room, ...p[1])) || (inRoom(A, S.a.room, ...p[1]) && inRoom(B, S.b.room, ...p[0]));
    if (!covered(A, S.a) || !covered(B, S.b) || !floor || S.s1 - S.s0 < SEAM.CFG.minLen - EPS || S.a.key >= S.b.key) bad.push(S.id);
  }
  check('every seam is one wall both blueprints share, with floor on both sides', n > 50 && bad.length === 0, `${n} seams` + (bad.length ? ', bad: ' + bad.slice(0, 2).join(' ') : ''));
}

// ---- 2. the rules: houses meet the backrooms, alone or inside a neighborhood
{
  const house = all.filter(({ S }) => S.rule === 'house-backrooms');
  const inHood = house.filter(({ S }) => (S.a.kind[0] === 'house' ? S.a : S.b).part);
  check('a house inside a neighborhood is matched as a house', inHood.length > 0 && inHood.every(({ S }) => S.a.kind.concat(S.b.kind).indexOf('filler') >= 0), `${inHood.length} house-backrooms seams`);
  const ops = house.flatMap(({ S }) => S.openings), doors = ops.filter((o) => o.kind === 'door').length, wins = ops.filter((o) => o.kind === 'window').length;
  // (no windows while they are off: TPL.WINDOWS)
  check('seam rules cut windows and doors through some of them', doors > 0 && (BR.TPL.WINDOWS ? wins > 0 : wins === 0), `${wins} windows, ${doors} doors on ${house.length} seams`);
  check('no rule, no opening (filler against filler, yards, the street)', all.every(({ S }) => S.rule || !S.openings.length));
  // every opening: inside its seam, clear of the ends and of what either side already has there
  const R = SEAM.RULES[0];
  let bad = [];
  for (const { h, S } of all) {
    if (!S.openings.length) continue;
    const site = (k) => h.W.site(k.split('/')[0]), its = [S.a, S.b].map((sd) => h.W.blueprints(site(sd.key)).find((it) => it.key === sd.key));
    const others = [];
    for (const it of its) for (const op of it.b.openings) {
      const horiz = op.a[1] === op.b[1], c = (horiz ? op.a[1] + it.origin[1] : op.a[0] + it.origin[0]);
      if ((horiz ? 'h' : 'v') !== S.o || Math.abs(c - S.c) > EPS) continue;
      const s0 = Math.min(horiz ? op.a[0] : op.a[1], horiz ? op.b[0] : op.b[1]) + (horiz ? it.origin[0] : it.origin[1]);
      others.push([s0, s0 + op.width]);
    }
    for (const op of S.openings) {
      const clear = op.kind === 'door' ? SEAM.CFG.clear : SEAM.CFG.windowClear;
      if (S.openings.length > 1 || op.s0 < S.s0 + clear - EPS || op.s1 > S.s1 - clear + EPS || others.some(([a, b]) => op.s0 < b + clear - EPS && a < op.s1 + clear - EPS)) bad.push(S.id + ' ' + op.kind);
      const T = S.a.kind[0] === 'house' ? S.a : S.b, it = its[T === S.a ? 0 : 1], type = it.b.rooms.find((r) => r.id === T.room).type;
      if (op.kind === 'door' && R.door.rooms.indexOf(type) < 0) bad.push(S.id + ' door in a ' + type);
      if (op.kind === 'window' && R.window.skip.indexOf(type) >= 0) bad.push(S.id + ' window in a ' + type);
    }
  }
  check('a seam opening sits inside its seam, clear of its ends and of every other opening, in a room the rule allows', bad.length === 0, bad.slice(0, 3).join('; '));
  // a house window already on a seam looks into the room next door: it is recorded
  if (BR.TPL.WINDOWS) check('a window a house already had on a seam is recorded as looking through', house.some(({ S }) => S.through.some((o) => o.kind === 'window')));
}

// ---- 3. a seam door has floor in front of it on both sides, and joins the world graph
{
  let doors = 0, clear = 0;
  for (const { h, S } of all) for (const op of S.openings) {
    if (op.kind !== 'door') continue;
    doors++;
    let ok = true;
    for (const sd of [S.a, S.b]) {
      const site = h.W.site(sd.key.split('/')[0]), it = h.W.blueprints(site).find((x) => x.key === sd.key), rm = it.b.rooms.find((r) => r.id === sd.room);
      // which side of the line this room is on
      const mid = op.s0 + 0.25, has = (x, y) => rm.rects.some((q) => x - it.origin[0] > q[0] && x - it.origin[0] < q[2] && y - it.origin[1] > q[1] && y - it.origin[1] < q[3]);
      const d = S.o === 'h' ? (has(mid, S.c + 0.25) ? 1 : -1) : (has(S.c + 0.25, mid) ? 1 : -1);
      for (let s = op.s0 + 0.25; s < op.s1; s += 0.5) for (let t = 0.25; t < SEAM.CFG.landing; t += 0.5) {
        const [x, y] = S.o === 'h' ? [s, S.c + d * t] : [S.c + d * t, s];
        if (!has(x, y) || (it.b.columns || []).some((c) => x - it.origin[0] > c.rect[0] && x - it.origin[0] < c.rect[2] && y - it.origin[1] > c.rect[1] && y - it.origin[1] < c.rect[3])) ok = false;
      }
    }
    if (ok) clear++;
  }
  check('a seam door has 1 m of floor clear in front of it on both sides', doors > 0 && clear === doors, `${clear} of ${doors}`);
  // the room graph round a neighborhood with a seam door: the door is an edge, the world one piece
  const withDoor = hoods.find((h) => h.W.seams(h.site).some((S) => S.openings.some((o) => o.kind === 'door')));
  if (withDoor) {
    const { W, site } = withDoor, g = W.graph(site.i - 1, site.j - 1, site.i + 1, site.j + 1), comp = components(g.nodes, g.edges);
    const S = W.seams(site).find((x) => x.openings.some((o) => o.kind === 'door'));
    const has = g.edges.some(([u, v]) => (u === S.a.node && v === S.b.node) || (u === S.b.node && v === S.a.node));
    check('a seam door is an edge of the world room graph, and the world stays one piece', has && comp.sizes.length === 1 && g.nodes.has(S.a.node) && g.nodes.has(S.b.node), `${comp.sizes.length} piece(s)`);
  } else check('a seam door is an edge of the world room graph, and the world stays one piece', false, 'no seam door found');
}

// ---- 4. emergent and order-free: the same whatever was built first
{
  const h = hoods[0], seed = h.W.seed, id = h.site.id;
  const a = strip(new BR.World(seed).seams(new BR.World(seed).site(id)));
  const W2 = new BR.World(seed, { limits: { cells: 3, builds: 4 } });
  const s2 = W2.site(id);
  for (const n of W2.neighbours(s2).reverse()) W2.build(n);
  for (const t of W2.sitesIn(900, 900, 1000, 1000).slice(0, 4)) W2.build(t);
  check('a seam is the same whatever was built before, and with a tiny cache', strip(W2.seams(W2.site(id))) === a);
  // seams never change the blueprints they read
  const W3 = new BR.World(seed), s3 = W3.site(id), before = strip(W3.build(s3));
  W3.seams(s3);
  check('finding seams leaves both blueprints as they were', strip(W3.build(s3)) === before);
}

// ---- 5. rules are data
{
  const run = (rules, seed) => hoods.flatMap((h) => { const items = [h.site].concat(h.W.neighbours(h.site)).map((x) => h.W.blueprints(x)); return SEAM.between(items[0], [].concat(...items.slice(1)), { seed: seed || 1, rules }); });
  check('no rules, no openings', run([]).every((S) => !S.openings.length && !S.rule));
  const coin = [{ id: 'coin', a: ['house'], b: ['filler'], window: { p: 0.5, w: [1, 1] } }], sig = (L) => strip(L.map((S) => S.openings));
  // (a window coin: rolled with windows on for this check)
  const was = BR.TPL.WINDOWS;
  BR.TPL.WINDOWS = true;
  check('the dice are the seam\'s own: the same seed rolls the same, another seed rolls differently', sig(run(coin, 5)) === sig(run(coin, 5)) && sig(run(coin, 5)) !== sig(run(coin, 6)));
  BR.TPL.WINDOWS = was;
  const always = [{ id: 'always', a: ['house'], b: ['filler'], door: { p: 1, w: [1, 1] }, doors: 99 }];
  const got = run(always), houseSeams = got.filter((S) => S.rule === 'always'), withDoor = houseSeams.filter((S) => S.openings.length);
  check('a rule with chance 1 cuts a door wherever one fits', houseSeams.length > 0 && withDoor.length > 0 && withDoor.every((S) => S.openings[0].kind === 'door'), `${withDoor.length} of ${houseSeams.length} seams`);
  const ff = [{ id: 'filler-filler', a: ['filler'], b: ['filler'], window: { p: 1, w: [1, 1] } }];
  const W = hoods[0].W, s = W.cell(0, 0).sites.find((x) => x.kind === 'filler');
  const fs = W.neighbours(s).filter((n) => n.kind === 'filler').flatMap((n) => SEAM.between(W.blueprints(s), W.blueprints(n), { seed: 2, rules: ff }));
  check('a rule can pair any kinds, filler against filler included', fs.length === 0 || fs.some((S) => S.rule === 'filler-filler'), `${fs.length} seams`);
}

// ---- 6. inside a site: a template and the filler built round it
{
  let seams = 0, cut = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const b = TPL.generate({ archetype: 'ranch', seed, site: { w: 22, h: 14 } });
    const site = { rects: [[0, 0, 32, 24]] };
    const L = LOT.build({ seed, site, filler: 'warren', connections: BR.FILL.sampleConnections(site, 2, seed), buildings: [{ id: 'b', b, origin: [5, 5] }] });
    const S = SEAM.within([SEAM.item('s', L.setting, L.at, 'x'), SEAM.item('b0', b, [5, 5], 'x', 'b')], { seed });
    seams += S.length; cut += S.reduce((t, x) => t + x.openings.length, 0);
  }
  check('a house inside a filler shares walls with it, and the rules apply there too', seams > 0 && cut > 0, `${seams} seams, ${cut} openings`);
}

// ---- 7. drawing: each shared wall drawn once
{
  const S = all.find((x) => x.S.openings.length).S, cuts = SEAM.cuts([S]);
  const bCuts = cuts.get(S.b.key) || [], aCuts = cuts.get(S.a.key) || [];
  check('the b side leaves the whole seam to the a side; the a side leaves gaps for the openings', bCuts.some((k) => k.s0 === S.s0 && k.s1 === S.s1) && S.openings.every((op) => aCuts.some((k) => k.s0 === op.s0 && k.s1 === op.s1)));
}
finish();
