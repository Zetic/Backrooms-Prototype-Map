/*
 * tpl/lot.js - how a template meets the world: its lot, its setting, and
 * templates inside bigger templates.
 *
 * Every template takes connections on its site edges, the way fillers do.
 * A template sits in the world in one of three ways (docs/world.md):
 *
 *   yard    its own lot, with a setting its recipe designs (houses): the
 *           building toward the back, one big room round it with open floor
 *           in front of the front door, and that room's walls on the lot
 *           edge. The yard is built by the `yard` filler below.
 *   flush   its own lot and nothing else (templates at least one block
 *           across). The door is the edge: the world puts its connection
 *           exactly on the template's door.
 *   inside  inside a bigger template (templates smaller than a block): in a
 *           filler's site, or in a house's yard like a shed. The bigger
 *           template builds round it and takes its doors as connections.
 *
 *   LOT.setting(arch)                  the recipe's setting, with defaults
 *   LOT.margins(arch, rng, openness)   a yard's depth on each side (whole m)
 *   LOT.frame(cw, cd, m, approach)     the lot round a building, oriented
 *   LOT.template(spec)                 one building, a few seeds tried
 *   LOT.build(spec)                    buildings + whatever surrounds them
 *
 * LOT.build is the connection adapter. Each building is built by its own
 * template and keeps choosing its own doors; its footprint leaves the
 * surrounding site, and its ground-floor portals become connections that the
 * surrounding filler (a pool filler, or the yard) must honour along with the
 * site's own edge connections. Where one lands on solid, the filler engine
 * carves a passage to the nearest floor.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL, FILL = BR.FILL, { mix32 } = BR;
  const LOT = BR.LOT = BR.LOT || {};
  LOT.SCHEMA = 'br.lot/0.1';
  const G = TG.GRID, U = (m) => Math.round(m / G);
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // ------------------------------------------------------------ setting
  /** Yard depths in metres, deep warren .. open stretch. */
  const YARD = { kind: 'yard', front: [3, 14], side: [1, 6], back: [1, 3] };
  LOT.YARD = YARD;
  /** The recipe's setting: archetype.setting, else a yard for houses and flush for the rest. */
  LOT.setting = (arch) => arch.setting || (arch.engine === 'house' ? YARD : { kind: 'flush' });

  /**
   * How deep a yard is on each side, whole metres (at least 1, so every edge
   * of the lot has floor behind it). Open stretches get big yards, deep
   * warrens a tight apron. A flush lot has none.
   */
  LOT.margins = (arch, rng, openness) => {
    const S = LOT.setting(arch);
    if (S.kind !== 'yard') return { front: 0, back: 0, left: 0, right: 0 };
    const t = () => clamp01((openness === undefined ? 0.5 : openness) + rng.range(-0.15, 0.15));
    const m = (r) => Math.max(1, Math.round(r[0] + (r[1] - r[0]) * t()));
    return { front: m(S.front), back: m(S.back), left: m(S.side), right: m(S.side) };
  };

  /**
   * The lot round a building: the building's canonical cw x cd (main side at
   * the bottom) plus margins, turned to face `approach`. Returns { w, h (the
   * lot, real frame), place(r) (a canonical building rect -> real lot frame),
   * building (the building's bbox, real lot frame) }.
   */
  LOT.frame = (cw, cd, m, approach) => {
    const LW = m.left + cw + m.right, LH = m.back + cd + m.front, O = TG.orient(approach, LW, LH);
    const place = (r) => O.rect([r[0] + m.left, r[1] + m.back, r[2] + m.left, r[3] + m.back]);
    return { w: O.w, h: O.h, place, building: place([0, 0, cw, cd]) };
  };

  /**
   * The lot round a building site already in the real frame (rects, origin at
   * 0, 0), for tools: margins are canonical (front = the main side). Returns
   * { rects (the lot), building (the site's rects, moved into the lot) }.
   */
  LOT.around = (rects, approach, m) => {
    const bb = TG.bbox(rects), side = TG.orient(approach, 1, 1).side, real = {};
    real[side('S')] = m.front; real[side('N')] = m.back; real[side('W')] = m.left; real[side('E')] = m.right;
    const dx = real.W - bb[0], dy = real.N - bb[1];
    return { rects: [[0, 0, bb[2] - bb[0] + real.W + real.E, bb[3] - bb[1] + real.N + real.S]], building: rects.map((q) => [q[0] + dx, q[1] + dy, q[2] + dx, q[3] + dy]) };
  };

  // ------------------------------------------------------------ building
  /**
   * One building on its site (site frame, origin at the site's bbox corner):
   * spec { archetype, seed, approach, rects, flush?, wrongness?, tries? }. A few template
   * seeds are tried before giving up. Returns a br.building or { error }.
   */
  LOT.template = (spec) => {
    const tries = spec.tries || 3;
    let b = null;
    for (let t = 0; t < tries; t++) {
      b = TPL.generate({ archetype: spec.archetype, seed: t ? mix32(spec.seed + t) : spec.seed, site: { rects: spec.rects }, approach: spec.approach, flush: !!spec.flush, wrongness: spec.wrongness });
      if (!b.error) { b.try = t; return b; }
    }
    return { error: (b && b.error) || 'no layout', archetype: spec.archetype };
  };

  // ------------------------------------------------------------ build
  /**
   * Buildings and what surrounds them, in one site (metres, site frame):
   * spec { seed, site: { rects }, filler (id; picked from the pool with
   *        `weights` when omitted), weights?, connections (edge, filler form),
   *        buildings: [{ id, archetype, seed, approach, rects, flush?, wrongness?, b? (prebuilt),
   *                      toBack? (push it against the back of its site: a house in its yard) }],
   *        lots?: [{ rect, front, kind }] (the yard's hint) }
   * Returns { schema, site, setting (br.filler), buildings: [{ id, origin, b,
   * conns: { portalId: connId } }], conns (the edge connections honoured),
   * issues, ms }.
   */
  LOT.build = (spec) => {
    const t0 = now(), rects = spec.site.rects, bb = TG.bbox(rects);
    const out = { schema: LOT.SCHEMA, site: { w: bb[2], h: bb[3], rects }, setting: null, buildings: [], conns: [], issues: [], ms: 0 };
    const bw = U(bb[2]), bh = U(bb[3]), R = new TG.Raster(bw, bh, 0);
    for (const q of rects) R.fill(q.map(U), 1);
    const inner = [];
    for (const S of spec.buildings || []) {
      const sb = TG.bbox(S.rects), b = S.b || LOT.template({ archetype: S.archetype, seed: S.seed, approach: S.approach, rects: S.rects.map((q) => [q[0] - sb[0], q[1] - sb[1], q[2] - sb[0], q[3] - sb[1]]), flush: S.flush, wrongness: S.wrongness });
      if (b.error) { out.issues.push((TPL.archetypes[S.archetype] || {}).name + ': no layout fit its site'); continue; }
      let px = sb[0], py = sb[1];
      if (S.toBack) {
        // a template fills its site from the front, so a house that should
        // stand toward the back of its yard moves back by what it left unused
        const fb = TG.bbox(b.footprint[0].rects), back = TG.opposite(S.approach);
        if (back === 'N') py -= fb[1]; else if (back === 'S') py += sb[3] - sb[1] - fb[3]; else if (back === 'W') px -= fb[0]; else px += sb[2] - sb[0] - fb[2];
      }
      const B = { id: S.id, origin: [px, py], b, conns: {} };
      for (const q of b.footprint[0].rects) R.fill([U(q[0] + px), U(q[1] + py), U(q[2] + px), U(q[3] + py)], 0);
      for (const p of b.portals) {
        if (p.level) continue;
        const op = b.openings.find((x) => x.id === p.opening), horiz = op.a[1] === op.b[1];
        const s0 = horiz ? Math.min(op.a[0], op.b[0]) + px : Math.min(op.a[1], op.b[1]) + py;
        const id = 'P' + S.id + ':' + p.id;
        inner.push({ id, side: TG.opposite(p.side), at: s0, width: op.width, line: horiz ? op.a[1] + py : op.a[0] + px, kind: 'opening', route: !!p.main });
        B.conns[p.id] = id;
      }
      out.buildings.push(B);
    }
    // a courtyard a building closes off is not the surrounding site's floor
    const seen = new Uint8Array(bw * bh), st = [];
    const reach = (c) => { if (R.a[c] === 1 && !seen[c]) { seen[c] = 1; st.push(c); } };
    for (let x = 0; x < bw; x++) { reach(x); reach((bh - 1) * bw + x); }
    for (let y = 0; y < bh; y++) { reach(y * bw); reach(y * bw + bw - 1); }
    while (st.length) {
      const c = st.pop(), x = c % bw, y = (c - x) / bw;
      if (x > 0) reach(c - 1); if (x < bw - 1) reach(c + 1); if (y > 0) reach(c - bw); if (y < bh - 1) reach(c + bw);
    }
    for (let c = 0; c < bw * bh; c++) if (!seen[c]) R.a[c] = 0;
    const site = out.buildings.length ? { rects: TG.rectsWhere(R, (v) => v === 1).map((q) => q.map((v) => v * G)) } : { rects };
    const ok = [];
    for (const c of (spec.connections || []).concat(inner)) { const e = FILL.checkConnection(site, c); if (e) out.issues.push(e); else ok.push(c); }
    const fid = spec.filler || FILL.pick({ seed: spec.seed, site: { rects }, weights: spec.weights });
    const hint = spec.lots && spec.lots.length ? { lots: spec.lots } : null;
    let f = FILL.generate({ filler: fid, seed: spec.seed, site, connections: ok, hint });
    if (f.error) { out.issues.push(f.error); f = FILL.generate({ filler: 'warren', seed: spec.seed, site, connections: ok }); }
    out.setting = f;
    out.conns = ok.filter((c) => inner.indexOf(c) < 0);
    for (const x of (f.meta && f.meta.issues) || []) out.issues.push(x);
    out.ms = now() - t0;
    return out;
  };

  // ------------------------------------------------------------ the yard
  FILL.TYPES.yard = { zone: 'public', tags: ['backrooms', 'large', 'yard'], ceil: [3.2, 4.8] };
  FILL.register({
    id: 'yard', name: 'Yard', feel: 'open', weight: 0,
    blurb: 'The room a house stands in: open floor in front of its front door, the walls on the lot edge. Built for yard lots (src/tpl/lot.js); not in the pool.',
    doors: { opening: 0.7, door: 0.2, wide: 0.1 }, loops: 0.2,
    fits: () => true,
    site: { w: [20, 50], h: [20, 50] },
    layout(P) {
      // each yard lot is one room; its front runs on to the site edge. Anything
      // else in the site stays solid, and a connection that lands there gets a
      // passage carved to the yard
      const lots = P.hint && P.hint.lots ? P.hint.lots.filter((L) => L.kind === 'yard') : [];
      if (!lots.length) lots.push({ rect: [0, 0, P.W, P.H], front: 'S' });
      for (const L of lots) {
        const r = L.rect.slice(), f = L.front;
        if (f === 'S') r[3] = P.H; else if (f === 'N') r[1] = 0; else if (f === 'E') r[2] = P.W; else r[0] = 0;
        P.paint(r, P.add('yard', ['yard']));
      }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
