// The neighborhood: a composite template, built from other templates.
// run: node tests/neighborhood.test.js [seeds]
// (the br.building contract itself is checked for every archetype, this one
// included, by tests/templates.test.js)
const { BR, components, harness } = require('./helpers');
const { check, finish } = harness(), TPL = BR.TPL, TG = BR.TG;
const N = +(process.argv[2] || 24), SIDES = ['S', 'E', 'N', 'W'];
const strip = (x) => JSON.stringify(x, (k, v) => (k === 'ms' ? undefined : v));
const builds = [];
for (let s = 1; s <= N; s++) {
  const spec = { archetype: 'neighborhood', seed: s * 104729, approach: SIDES[s % 4] };
  if (s % 4 === 0) spec.wrongness = 1;
  builds.push({ spec, b: TPL.generate(spec) });
}
const ok = builds.filter((x) => !x.b.error);
check('the neighborhood builds on every seed and main side', ok.length === builds.length, `${ok.length} of ${builds.length}`);

// ---- 1. every house is its own template, built exactly as it would be on its own
{
  let parts = 0, same = 0, bad = [];
  for (const { b } of ok) for (const p of b.parts) {
    parts++;
    const base = TPL.archetypes[p.spec.archetype];
    const alone = TPL.generate({ archetype: Object.assign({}, base, p.spec.override || {}), seed: p.spec.seed, site: p.spec.site, approach: p.spec.approach, wrongness: p.spec.wrongness });
    if (alone.error) { bad.push(p.id + ' will not build alone'); continue; }
    // the same rooms (in the composite's frame, unturned: compare shapes and areas)
    const mine = b.rooms.filter((r) => r.part === p.id);
    const sig = (rs) => rs.map((r) => r.type + ':' + r.area + ':' + r.tags.join('/')).join(',');
    const doors = (bd) => bd.openings.filter((o) => o.kind !== 'window').length;
    const kept = b.openings.filter((o) => o.part === p.id && o.kind !== 'window').length;
    if (sig(mine) === sig(alone.rooms) && kept === doors(alone) && p.doors.length === alone.portals.length) same++;
    else bad.push(p.id + ' of ' + b.seed + ' differs');
  }
  check('every house is built by the house template, the same as it builds alone', parts > 0 && same === parts, `${same} of ${parts} houses` + (bad.length ? ': ' + bad.slice(0, 3).join('; ') : ''));
  const S = ok.find((x) => x.spec.approach === 'S');
  if (S) {
    // facing south nothing is turned: the rooms sit exactly where the part's site frame puts them
    const b = S.b, p = b.parts[0], at = p.site.rects[0];
    const alone = TPL.generate({ archetype: Object.assign({}, TPL.archetypes[p.spec.archetype], p.spec.override), seed: p.spec.seed, site: p.spec.site, approach: p.spec.approach, wrongness: p.spec.wrongness });
    const moved = alone.rooms.map((r) => r.rects.map((q) => [q[0] + at[0], q[1] + at[1], q[2] + at[0], q[3] + at[1]]));
    const mine = b.rooms.filter((r) => r.part === p.id).map((r) => r.rects);
    check('a house stands exactly where its part says, rooms and all', JSON.stringify(moved) === JSON.stringify(mine));
  }
}

// ---- 2. houses line both sides of the street and face it
{
  let n = 0, bothSides = 0, facing = 0, doorsOnYard = 0, doors = 0, apart = 0, endToEnd = 0, mainAtStreet = 0, walls = 0;
  for (const { b } of ok) {
    n++;
    const rooms = new Map(b.rooms.map((r) => [r.id, r])), street = b.rooms.find((r) => r.type === 'street'), st = street.rects[0];
    const along = b.approach === 'S' || b.approach === 'N';               // the street runs away from the main side
    if (along ? st[1] === 0 && st[3] === b.site.h : st[0] === 0 && st[2] === b.site.w) endToEnd++;
    const sides = new Set();
    for (const p of b.parts) {
      const box = TG.bbox(b.rooms.filter((r) => r.part === p.id).flatMap((r) => r.rects));
      const left = along ? box[2] <= st[0] : box[3] <= st[1];
      sides.add(left);
      const want = along ? (left ? 'E' : 'W') : (left ? 'S' : 'N');
      if (p.approach === want) facing++;
      for (const id of p.doors) {
        doors++;
        const op = b.openings.find((o) => o.id === id);
        if (op.rooms.some((r) => r && rooms.get(r).type === 'front_yard')) doorsOnYard++;
      }
    }
    if (sides.size === 2) bothSides++;
    // no two houses touch: every facade has a composite room on its other side
    const partOf = (id) => (id ? rooms.get(id).part : undefined);
    if (b.walls.every((w) => {
      const [a, c] = w.rooms.map(partOf);
      if (w.kind === 'exterior') return w.rooms.includes(null);
      if (w.kind === 'facade') return (a === null) !== (c === null);
      if (w.kind === 'open' && a === null && c === null) return true;
      return a === c && a !== null;
    })) walls++;
    if (b.parts.every((p, k) => b.parts.every((q, j) => j <= k || !TG.roverlap(p.site.rects[0], q.site.rects[0])))) apart++;
    const main = b.portals.find((p) => p.main);
    if (main && main.side === b.approach && main.room === street.id) mainAtStreet++;
  }
  const all = ok.reduce((s, x) => s + x.b.parts.length, 0);
  check('houses line both sides of the street', bothSides === n, `${bothSides} of ${n}, ${(all / n).toFixed(1)} houses each`);
  check('every house faces the street', facing === all, `${facing} of ${all}`);
  check('every door a house chose opens onto its front yard', doors > 0 && doorsOnYard === doors, `${doorsOnYard} of ${doors} doors`);
  check('walls: facades between a house and the hall, exterior only against the solid, open across the street and yards', walls === n);
  check('house sites never overlap', apart === n);
  check('the street runs end to end, entered on the main side', endToEnd === n && mainAtStreet === n);
}

// ---- 3. it looks like the reference: houses against the hall wall, short yards
{
  const backs = [], yards = [];
  for (const { b } of ok) {
    if (b.approach !== 'S' && b.approach !== 'N') continue;
    const st = b.rooms.find((r) => r.type === 'street').rects[0];
    for (const p of b.parts) {
      const box = TG.bbox(b.rooms.filter((r) => r.part === p.id).flatMap((r) => r.rects)), left = box[2] <= st[0];
      backs.push(left ? box[0] : b.site.w - box[2]);
      yards.push(left ? st[0] - box[2] : box[0] - st[2]);
    }
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  check('most houses stand against the hall wall', backs.filter((v) => v <= 1).length >= backs.length * 0.6, `median gap behind ${med(backs)} m`);
  check('front yards are short', med(yards) <= TPL.archetypes.neighborhood.yardMax && Math.min(...yards) >= TPL.archetypes.neighborhood.apron[0] - 0.5, `median ${med(yards)} m, ${Math.min(...yards)}-${Math.max(...yards)} m`);
}

// ---- 4. the recipe drives its children; wrongness
{
  const only = Object.assign({}, TPL.archetypes.neighborhood, { id: 'test_bungalow_row', houses: { bungalow: 1 } });
  TPL.registerArchetype(only);
  const b = TPL.generate({ archetype: 'test_bungalow_row', seed: 5 });
  check('a recipe chooses which house templates line its street', !b.error && b.parts.every((p) => p.archetype === 'bungalow'), b.error || b.parts.map((p) => p.archetype).join(','));
  delete TPL.archetypes.test_bungalow_row;
  const doorsOff = ok.every(({ b }) => b.parts.every((p) => p.spec.override && p.spec.override.backDoor === 0 && p.spec.override.sideDoor === 0));
  check('each house is built with the recipe\'s overrides (no back or side doors)', doorsOff);
  const t = TPL.generate({ archetype: 'neighborhood', seed: 77, mutations: ['twins'] });
  const sig = (p) => t.rooms.filter((r) => r.part === p.id).map((r) => r.type + ':' + r.area).join(',');
  check('twins: every house is the same house', !t.error && t.parts.length >= 4 && t.parts.every((p) => sig(p) === sig(t.parts[0]) && p.spec.seed === t.parts[0].spec.seed), t.error || t.parts.length + ' houses');
  const v = TPL.generate({ archetype: 'neighborhood', seed: 78, mutations: ['vacant'] });
  check('vacant: one lot stands empty', !v.error && v.rooms.some((r) => r.type === 'vacant_lot' && r.tags.indexOf('wrong:vacant') >= 0));
}

// ---- 5. deterministic, whatever was built before
{
  const spec = { archetype: 'neighborhood', seed: 4242, approach: 'W' };
  const a = strip(TPL.generate(spec));
  for (let k = 0; k < 3; k++) TPL.generate({ archetype: 'ranch', seed: 10 + k });
  check('same spec gives the same neighborhood, whatever was built before', a === strip(TPL.generate(spec)));
  const avg = ok.reduce((s, x) => s + x.b.meta.ms, 0) / ok.length;
  check('a neighborhood builds in reasonable time (under 300 ms)', avg < 300, avg.toFixed(0) + ' ms on average');
}

// ---- 6. on the map: its own lot, joined through its doors, part of one world
{
  let found = null;
  for (const seed of [31337, 7, 12345]) {
    const W = new BR.World(seed);
    for (let i = -4; i <= 4 && !found; i++) for (let j = -4; j <= 4 && !found; j++) {
      const P = W.cell(i, j).pois.find((x) => x.archetype === 'neighborhood');
      if (P) found = { W, i, j, P };
    }
    if (found) break;
  }
  check('the world places neighborhoods', !!found);
  if (found) {
    const { W, i, j, P } = found, site = W.siteAt(P.cx, P.cy), r = W.build(site), B = r.buildings[0];
    check('a neighborhood is a flush lot of its own, joined through its own doors', P.mode === 'flush' && site.kind === 'flush' && !!B &&
      Object.values(B.conns).length === site.conns.length && site.conns.length === B.b.portals.length, `${site.conns.length} doors`);
    const g = W.graph(i - 1, j - 1, i + 1, j + 1), comp = components(g.nodes, g.edges);
    const mine = [...g.nodes].filter((k) => k.indexOf(site.id + '/' + P.id + '/') === 0);
    check('every room of it, every house included, is reachable from the rest of the world', comp.sizes.length === 1 && mine.length === B.b.rooms.length, `${mine.length} rooms, ${comp.sizes.length} piece(s)`);
  }
}
finish();
