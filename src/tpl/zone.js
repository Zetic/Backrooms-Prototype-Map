/*
 * tpl/zone.js - the Zone engine: one zone on its own. A zone (tpl/catalogue.js)
 * is a marked area of a room's floor; alone, it is a room of its own whose
 * whole floor is that zone - a playground, a strip of lawn, a pit - walled in
 * somewhere in the backrooms. It is a composite engine with no parts
 * (tpl/composite.js), the way a park is: the same zone definitions, the same
 * output.
 *
 * Recipe: zoneType, site, doorW (m), door ('opening' | 'door'), exit (chance
 * of a way out on the far side), roomTags.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL;
  const U = (m) => Math.round(m / TG.GRID);
  const rr = (rng, r) => (Array.isArray(r) ? rng.range(r[0], r[1]) : r);
  const T = Object.assign(TPL.CAT.types(['patch']), TPL.CAT.zones(true));

  function program(arch) { return { summary: [(TPL.CAT.ZONES[arch.zoneType] || {}).label + ', alone'] }; }

  function plan(P, ctx, rng) {
    const A = ctx.arch, r = ctx.site.inner, Z = TPL.CAT.ZONES[A.zoneType];
    if (!Z) { ctx.why['unknown zone ' + A.zoneType] = 1; return null; }
    const w = TG.rw(r), h = TG.rh(r);
    if (w < 2 || h < 2) { ctx.why['site:small'] = (ctx.why['site:small'] || 0) + 1; return null; }
    const room = { type: 'patch', name: Z.label, rects: [r], ceiling: Math.round(rr(rng, TPL.CAT.ROOMS.patch.ceil) * 10) / 10, tags: (A.roomTags || []).slice() };
    const zones = [{ type: A.zoneType, room: 0, rects: [r], tags: Z.tags.slice() }];
    const portals = [], dw = Math.max(2, Math.min(w - 2, U(A.doorW || 2))), at = (c) => r[0] + 1 + rng.int(0, Math.max(0, w - 2 - dw));
    const kind = A.door || 'opening';
    portals.push({ room: 0, o: 'h', c: r[3], s0: at(), s1: 0, kind, role: 'both', main: true, clear: 1.2, tags: ['way in'] });
    if (rng.f() < (A.exit || 0)) portals.push({ room: 0, o: 'h', c: r[1], s0: at(), s1: 0, kind, role: 'exit', clear: 1.2, tags: ['way out'] });
    for (const p of portals) p.s1 = p.s0 + dw;
    return { rooms: [room], parts: [], portals, open: true, zones, columns: [], terms: {}, meta: { type: Z.label + ' alone' }, summary: [Z.label + ', alone, its whole floor one zone'] };
  }

  TPL.registerEngine({ id: 'zone', name: 'Zones, alone', types: T, mutations: {}, composite: true, program, plan });
})(typeof window !== 'undefined' ? window : globalThis);
