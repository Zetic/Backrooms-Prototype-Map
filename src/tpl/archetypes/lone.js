/*
 * Lone archetypes - a template for every catalogued room and zone, on its
 * own (generated from tpl/catalogue.js; pure data).
 *
 * A lone room is the room as the catalogue says it is, and nothing a house or
 * any other template would add: a kitchen with no dining room beside it and a
 * door of its own, a stall with nothing round it. Built by the Room engine
 * ('single' layout, filling its site); a lone zone by the Zone engine.
 *
 * Every template is in a pool (archetype.pool): `expected` (the default: what
 * the backrooms are made of) or `weird` (out of place, and rarer: the world
 * scales its weight down, BR.POI_CFG.pools). Weird lone rooms are tagged
 * 'wrong:lone', every lone room 'lone'. A catalogue entry that already has a
 * template of its own (lone.template: the closet, the storage room, the
 * mechanical room, the park) gets no second one.
 */
(function (root) {
  'use strict';
  const TPL = root.BR.TPL, CAT = TPL.CAT;
  const snap = (v) => Math.round(v * 2) / 2;
  const nice = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** a site range from the catalogue: explicit, or from the room's floor area and width */
  function siteFor(e) {
    if (e.lone.site) return e.lone.site;
    const a = e.area || [6, 10], min = (e.minW || 2) * 0.5;
    const lo = snap(Math.max(min, Math.sqrt(a[0]) * 0.8)), hi = snap(Math.max(lo + 0.5, Math.sqrt(a[1]) * 1.2));
    return { w: [lo, hi], h: [lo, hi] };
  }
  const tagsFor = (pool) => (pool === 'weird' ? ['lone', 'wrong:lone'] : ['lone']);
  const an = (w) => (/^[aeiou]/.test(w) ? 'an ' : 'a ') + w;

  for (const [type, e] of Object.entries(CAT.ROOMS)) {
    if (!e.lone || e.lone.template) continue;
    const L = e.lone, pool = L.pool || 'expected', label = e.label || type.replace(/_/g, ' '), kind = L.door || 'door';
    const portals = [{ role: 'both', kind, side: 'S', w: L.doorW || (kind === 'vehicle' ? 2.5 : 1) }];
    if (L.exit) portals.push({ role: 'exit', kind, side: 'back', w: L.doorW || 1, p: L.exit });
    TPL.registerArchetype({
      id: 'lone_' + type, engine: 'room', name: nice(label) + ', alone', category: 'lone room', pool, weight: L.weight || 1, rarity: pool === 'weird' ? 'rare' : 'common',
      blurb: (pool === 'weird' ? 'Out of place: ' + an(label) : nice(an(label))) + ' on its own, with a door of its own and nothing a house would put round it.',
      layout: 'single', room: type, roomTags: tagsFor(pool), tight: true,
      circulation: 1,                                   // alone, a corridor is all circulation, and fine
      site: siteFor(e), portals, windows: 0, wrongness: 0.15,
      ...(e.biomes ? { biomes: e.biomes.slice() } : {})          // growth biomes (biomes.js)
    });
  }
  for (const [type, z] of Object.entries(CAT.ZONES)) {
    if (!z.lone) continue;
    const L = z.lone, pool = L.pool || 'weird';
    TPL.registerArchetype({
      id: 'lone_zone_' + type, engine: 'zone', name: nice(z.label) + ', alone', category: 'lone zone', pool, weight: L.weight || 1, rarity: pool === 'weird' ? 'rare' : 'common',
      blurb: (pool === 'weird' ? 'Out of place: ' + an(z.label) : nice(an(z.label))) + ' walled in on its own, its whole floor that zone.',
      zoneType: type, roomTags: tagsFor(pool), site: L.site, door: L.door || 'opening', doorW: L.doorW || 2, exit: L.exit || 0,
      wrongness: 0
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
