// The catalogue: every room and zone is defined once (tpl/catalogue.js), every
// template draws on it, and every one is also a template of its own, in an
// expected or a weird pool. run: node tests/catalogue.test.js
const { BR, harness } = require('./helpers');
const { check, finish } = harness(), TPL = BR.TPL, CAT = TPL.CAT;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. one definition, drawn on by every template
{
  // context a template may lay over a catalogued room; anything else must match the catalogue
  const CONTEXT = new Set(['privacy', 'win']);
  const allowed = { house: { closet: ['zone', 'maxAsp', 'ceil'] } };
  let n = 0, bad = [];
  for (const E of Object.values(TPL.engines)) {
    if (!E.types) continue;
    for (const [t, ty] of Object.entries(E.types)) {
      const c = CAT.ROOMS[t] || CAT.ZONES[t];
      if (!c) continue;
      n++;
      for (const k of new Set(Object.keys(ty).concat(Object.keys(c)))) {
        if (k === 'lone' || CONTEXT.has(k) || ((allowed[E.id] || {})[t] || []).indexOf(k) >= 0) continue;
        if (!same(ty[k], c[k])) bad.push(E.id + '.' + t + '.' + k);
      }
    }
  }
  check('every engine\'s rooms and zones are the catalogue\'s, plus only its own context', n > 40 && bad.length === 0, `${n} types in ${Object.keys(TPL.engines).length} engines` + (bad.length ? '; ' + bad.slice(0, 4).join(', ') : ''));
  // the same kitchen in a house and alone
  const house = TPL.generate({ archetype: 'ranch', seed: 3 }), alone = TPL.generate({ archetype: 'lone_kitchen', seed: 3 });
  const k = house.rooms.find((r) => r.type === 'kitchen'), l = alone.rooms[0];
  check('a kitchen is the same kitchen in a house and on its own', !!k && same(k.tags, l.tags.filter((t) => t !== 'lone' && t !== 'wrong:lone')) && k.zone === l.zone);
}

// ---- 2. every room and zone has a template of its own
{
  const missing = [];
  for (const [t, e] of Object.entries(CAT.ROOMS)) if (e.lone && !TPL.archetypes[e.lone.template || 'lone_' + t]) missing.push(t);
  for (const t of Object.keys(CAT.ZONES)) if (!TPL.archetypes['lone_zone_' + t]) missing.push('zone ' + t);
  const rooms = Object.values(CAT.ROOMS).filter((e) => e.lone).length;
  check('every catalogued room and zone is a template of its own', missing.length === 0, `${rooms} rooms, ${Object.keys(CAT.ZONES).length} zones` + (missing.length ? '; missing ' + missing.join(', ') : ''));
  let n = 0, bare = [];
  for (const a of TPL.listArchetypes().filter((x) => x.id.indexOf('lone_') === 0)) for (let s = 1; s <= 6; s++) {
    const b = TPL.generate({ archetype: a.id, seed: s, approach: 'SENW'[s % 4] });
    n++;
    if (b.error) { bare.push(a.id + ' no layout'); continue; }
    const rm = b.rooms;
    const tag = rm.every((r) => r.tags.indexOf('lone') >= 0) && (a.pool === 'weird') === rm.every((r) => r.tags.indexOf('wrong:lone') >= 0);
    // alone: one room and a way in, nothing a bigger template would add (no windows, no neighbours)
    const lone = rm.length === 1 && b.portals.length >= 1 && !b.openings.some((o) => o.kind === 'window');
    const zoned = a.engine !== 'zone' || (b.zones.length === 1 && b.zones[0].type === a.zoneType && Math.abs(b.zones[0].area - rm[0].area) < 1e-9);
    if (!tag || !lone || !zoned) bare.push(a.id + '#' + s);
  }
  check('a lone template is its room or zone alone: one room, a way in, tagged lone (and wrong:lone when weird)', bare.length === 0, `${n} builds` + (bare.length ? '; ' + bare.slice(0, 3).join(', ') : ''));
}

// ---- 3. pools
{
  const pools = new Set(TPL.listArchetypes().map((a) => a.pool || 'expected'));
  check('every template is in the expected or the weird pool', [...pools].every((p) => p === 'expected' || p === 'weird'), [...pools].join(', '));
  const weird = TPL.listArchetypes().filter((a) => a.pool === 'weird').map((a) => a.id);
  check('the out-of-place rooms are weird, the backrooms\' own expected', ['lone_kitchen', 'lone_bedroom', 'lone_stall', 'lone_zone_playground'].every((id) => weird.indexOf(id) >= 0) &&
    ['closet', 'storage_room', 'lone_janitor', 'lone_corridor', 'ranch', 'park'].every((id) => weird.indexOf(id) < 0));
  const W = new BR.World(7), ps = W.poisIn(-500, -500, 500, 500), w = ps.filter((P) => TPL.archetypes[P.archetype].pool === 'weird').length;
  check('weird templates are placed, but rarely', w > 0 && w / ps.length < 0.15, `${w} of ${ps.length} POIs`);
}
finish();
