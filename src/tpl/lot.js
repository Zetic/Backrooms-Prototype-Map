/*
 * tpl/lot.js - how a template meets the world: its lot, its setting, and
 * templates inside bigger templates.
 *
 * Every template takes connections on its site edges, the way fillers do.
 * A template sits in the world in one of three ways (docs/world.md):
 *
 *   yard    its own lot, built round what the template built (houses):
 *           solid round the back and sides of the house, and only a front
 *           yard: one room across the front, a little wider than the house
 *           so it stands half way into it, and a lane from it out to the
 *           lot's front edge, where it meets the rest of the backrooms. A
 *           door on another side is a connection on the lot edge, at the end
 *           of a short passage (an adapter) from the door to the edge.
 *   flush   its own lot and nothing else (templates at least one block
 *           across). The door is the edge: the world puts its connection
 *           exactly on the template's door.
 *   inside  inside a bigger template (templates smaller than a block): in a
 *           filler's site. The filler builds round it and takes its doors as
 *           connections.
 *
 *   LOT.setting(arch)                  the recipe's setting, with defaults
 *   LOT.margins(arch, rng, openness)   a yard's measures (m)
 *   LOT.yard(b, approach, m)           the lot round a built house: size, yard, doors
 *   LOT.template(spec)                 one building, a few seeds tried
 *   LOT.build(spec)                    buildings + whatever surrounds them
 *
 * LOT.build is the connection adapter. Each building is built by its own
 * template and keeps choosing its own doors; its footprint leaves the
 * surrounding site, and its ground-floor portals become connections that the
 * surrounding filler (a pool filler, or the yard) must honour along with the
 * site's own edge connections, unless a door is itself one of the site's
 * edge connections. Where one lands on solid, the filler engine carves a
 * passage to the nearest floor. The filler is built on what the buildings
 * leave, in that space's own frame; out.at is where its origin sits in the
 * site.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL, FILL = BR.FILL, { mix32 } = BR;
  const LOT = BR.LOT = BR.LOT || {};
  LOT.SCHEMA = 'br.lot/0.1';
  const G = TG.GRID, U = (m) => Math.round(m / G);
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

  // ------------------------------------------------------------ setting
  /**
   * A house's front yard, metres, from a deep warren to an open stretch:
   * apron (how deep the yard runs across the front of the house), reach (how
   * far it runs past each side of the house), wrap (how far back along the
   * sides), lane (the length of the way out to the lot edge) and laneW (its
   * width), solid (the solid kept round the rest of the house).
   */
  const YARD = { kind: 'yard', apron: [2, 4], reach: [1, 2], wrap: 1, lane: [2, 8], laneW: [4, 7], solid: 1 };
  LOT.YARD = YARD;
  /** The recipe's setting: archetype.setting, else a yard for houses and flush for the rest. */
  LOT.setting = (arch) => arch.setting || (arch.engine === 'house' ? YARD : { kind: 'flush' });

  /**
   * A yard's measures (metres; the depths whole metres): front (house front
   * to lot edge, apron + lane), side and back (lot margins), apron, reach,
   * wrap, laneW. Open stretches get bigger yards, deep warrens tight ones. A
   * flush lot has none.
   */
  LOT.margins = (arch, rng, openness) => {
    const S = LOT.setting(arch);
    if (S.kind !== 'yard') return { front: 0, side: 0, back: 0 };
    const t = () => clamp01((openness === undefined ? 0.5 : openness) + rng.range(-0.15, 0.15));
    const m = (r) => Math.round(r[0] + (r[1] - r[0]) * t());
    const apron = m(S.apron), reach = m(S.reach), lane = m(S.lane), laneW = Math.round((S.laneW[0] + (S.laneW[1] - S.laneW[0]) * t()) * 2) / 2;
    return { front: apron + lane, side: reach + S.solid, back: S.solid, apron, reach, wrap: S.wrap, laneW };
  };

  /**
   * The lot round a built house (b in its site frame) facing `approach`, with
   * measures m (LOT.margins). Solid closes round the back and sides of the
   * house. In front of it is the front yard: one room across the front of the
   * house, a little wider than it and reaching a little back along its
   * sides, so the house stands half way into it, and a lane from it out to
   * the lot's front edge, where it meets the rest of the backrooms. The lot
   * is whole metres (any half metre goes to the front and one side).
   * Returns, in the lot frame (metres):
   *   { w, h, origin (the house's site frame in the lot), yard: [rects],
   *     doors: [{ portal, side, o, c, s0, s1, main, adapter }]: doors that
   *       are connections on the lot edge (adapter: the passage from the door
   *       to the edge, or null when the door is on the edge),
   *     into: [portal ids]: doors onto the front yard }
   */
  LOT.yard = (b, approach, m) => {
    const f = approach, back = TG.opposite(f), fp = b.footprint[0].rects, fb = TG.bbox(fp);
    const ns = f === 'N' || f === 'S', lat = ns ? ['W', 'E'] : ['N', 'S'];
    const ext = { N: 0, E: 0, S: 0, W: 0 };
    ext[f] = m.front; ext[back] = m.back || 0; ext[lat[0]] = m.side; ext[lat[1]] = m.side;
    const frac = (v) => Math.abs(v - Math.round(v)) > 1e-9;
    if (frac(ns ? fb[2] - fb[0] : fb[3] - fb[1])) { ext[lat[1]] += 0.5; if (ext[lat[1]] < 1) ext[lat[1]] += 1; }
    if (frac(ns ? fb[3] - fb[1] : fb[2] - fb[0])) ext[f] += 0.5;
    const lot = [fb[0] - ext.W, fb[1] - ext.N, fb[2] + ext.E, fb[3] + ext.S];
    const w = lot[2] - lot[0], h = lot[3] - lot[1], ox = -lot[0], oy = -lot[1];
    const GW = U(w), GH = U(h), HOUSE = 1, YD = 2, R = new TG.Raster(GW, GH, 0);
    for (const q of fp) R.fill([U(q[0] + ox), U(q[1] + oy), U(q[2] + ox), U(q[3] + oy)], HOUSE);
    // u runs along the front, t back from the front edge
    const A = ns ? GW : GH, D = ns ? GH : GW, ef = U(ext[f]), eb = U(ext[back]);
    const at = (u, t) => (f === 'S' ? [u, GH - 1 - t] : f === 'N' ? [u, t] : f === 'E' ? [GW - 1 - t, u] : [t, u]);
    const hb = ns ? [U(fb[0] + ox), U(fb[2] + ox)] : [U(fb[1] + oy), U(fb[3] + oy)];
    const reach = Math.min(U(m.reach === undefined ? m.side : m.reach), hb[0]), u0 = hb[0] - reach, u1 = Math.min(A, hb[1] + reach);
    const t0 = Math.max(0, ef - U(m.apron === undefined ? m.front : m.apron));
    const paint = (u, ta, tb) => { for (let t = ta; t < tb; t++) { const [x, y] = at(u, t); if (R.get(x, y) === HOUSE) return; R.set(x, y, YD); } };
    // across the front of the house, up to it (into any recess), and a
    // little back along its sides
    for (let u = u0; u < u1; u++) paint(u, t0, u >= hb[0] && u < hb[1] ? D - eb : ef + U(m.wrap || 0));
    // the lane out to the lot edge, in front of the main door
    if (t0 > 0) {
      const main = b.portals.find((p) => p.main && !p.level && p.side === f), op = main && b.openings.find((x) => x.id === main.opening);
      const mid = op ? U((ns ? (op.a[0] + op.b[0]) / 2 + ox : (op.a[1] + op.b[1]) / 2 + oy)) : (hb[0] + hb[1]) / 2;
      const lw = Math.max(2, Math.min(u1 - u0, U(m.laneW || 4))), c0 = Math.max(u0, Math.min(u1 - lw, Math.round(mid - lw / 2)));
      for (let u = c0; u < c0 + lw; u++) paint(u, 0, t0);
    }
    const yard = TG.rectsWhere(R, (v) => v === YD).map((q) => q.map((v) => v * G));
    // doors: onto the yard, on the edge, or a short passage out to the edge
    const doors = [], into = [];
    for (const p of b.portals) {
      if (p.level) continue;
      const op = b.openings.find((x) => x.id === p.opening), horiz = op.a[1] === op.b[1];
      const line = horiz ? op.a[1] + oy : op.a[0] + ox, s0 = horiz ? Math.min(op.a[0], op.b[0]) + ox : Math.min(op.a[1], op.b[1]) + oy, s1 = s0 + op.width;
      const d = p.side, edge = d === 'N' ? 0 : d === 'S' ? h : d === 'W' ? 0 : w;
      const door = { portal: p.id, side: d, o: horiz ? 'h' : 'v', c: edge, s0, s1, main: !!p.main, adapter: null };
      if (line === edge) { doors.push(door); continue; }
      // the cells from the door out to the edge
      const sg = DIR[d][0] + DIR[d][1], first = U(line) + (sg > 0 ? 0 : -1), last = sg > 0 ? U(edge) - 1 : 0;
      let yardHit = false, blocked = false;
      for (let t = first; sg > 0 ? t <= last : t >= last; t += sg) for (let s = U(s0); s < U(s1); s++) {
        const v = horiz ? R.get(s, t) : R.get(t, s);
        if (v === YD) yardHit = true; else if (v === HOUSE) blocked = true;
      }
      const len = Math.abs(edge - line);
      if (yardHit || blocked || len < 1) { into.push(p.id); continue; }
      door.adapter = horiz ? [s0, Math.min(line, edge), s1, Math.max(line, edge)] : [Math.min(line, edge), s0, Math.max(line, edge), s1];
      doors.push(door);
    }
    return { w, h, origin: [ox, oy], yard, doors, into };
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
   *        buildings: [{ id, archetype, seed, approach, rects, flush?, wrongness?,
   *                      b? (prebuilt), origin? (where a prebuilt b's site frame sits),
   *                      edge? ({ portalId: connId }: doors that are themselves
   *                      edge connections of the site, not the filler's) }],
   *        hint? (passed to the filler: the yard's { yard: [rects], adapters: [rects] }) }
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
      const sb = S.rects ? TG.bbox(S.rects) : null, b = S.b || LOT.template({ archetype: S.archetype, seed: S.seed, approach: S.approach, rects: S.rects.map((q) => [q[0] - sb[0], q[1] - sb[1], q[2] - sb[0], q[3] - sb[1]]), flush: S.flush, wrongness: S.wrongness });
      if (b.error) { out.issues.push((TPL.archetypes[S.archetype] || {}).name + ': no layout fit its site'); continue; }
      const px = S.origin ? S.origin[0] : sb[0], py = S.origin ? S.origin[1] : sb[1];
      const B = { id: S.id, origin: [px, py], b, conns: {} };
      for (const q of b.footprint[0].rects) R.fill([U(q[0] + px), U(q[1] + py), U(q[2] + px), U(q[3] + py)], 0);
      for (const p of b.portals) {
        if (p.level) continue;
        if (S.edge && S.edge[p.id]) { B.conns[p.id] = S.edge[p.id]; continue; }
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
    const left = out.buildings.length ? TG.rectsWhere(R, (v) => v === 1).map((q) => q.map((v) => v * G)) : rects;
    // the filler works in the frame of what is left (origin at its bbox
    // corner), which a building flush with the site edge moves: out.at
    const fb = TG.bbox(left), dx = fb[0], dy = fb[1];
    const move = (q) => [q[0] - dx, q[1] - dy, q[2] - dx, q[3] - dy];
    const shift = (c) => { const h = c.side === 'N' || c.side === 'S'; return Object.assign({}, c, { at: c.at - (h ? dx : dy) }, c.line === undefined ? {} : { line: c.line - (h ? dy : dx) }); };
    const site = { rects: left.map(move) }, ok = [], use = [];
    for (const c of (spec.connections || []).concat(inner)) { const m = shift(c), e = FILL.checkConnection(site, m); if (e) out.issues.push(e); else { ok.push(c); use.push(m); } }
    const rectList = (v) => Array.isArray(v) && v.every((q) => Array.isArray(q) && q.length === 4);
    const hint = spec.hint ? Object.fromEntries(Object.entries(spec.hint).map(([k, v]) => [k, rectList(v) ? v.map(move) : v])) : null;
    const fid = spec.filler || FILL.pick({ seed: spec.seed, site: { rects }, weights: spec.weights });
    let f = FILL.generate({ filler: fid, seed: spec.seed, site, connections: use, hint });
    if (f.error) { out.issues.push(f.error); f = FILL.generate({ filler: 'warren', seed: spec.seed, site, connections: use }); }
    out.setting = f;
    out.at = [dx, dy];
    out.conns = ok.filter((c) => inner.indexOf(c) < 0);
    for (const x of (f.meta && f.meta.issues) || []) out.issues.push(x);
    out.ms = now() - t0;
    return out;
  };

  // ------------------------------------------------------------ the yard
  FILL.TYPES.yard = { zone: 'public', tags: ['backrooms', 'large', 'yard'], ceil: [3.2, 4.8] };
  FILL.register({
    id: 'yard', name: 'Yard', feel: 'open', weight: 0, pieces: true,
    blurb: 'The front yard a house stands behind: one room in front of its front door, out to the lot edge, and short passages from its other doors to the lot edge. Built for yard lots (src/tpl/lot.js); not in the pool.',
    doors: { opening: 0.7, door: 0.2, wide: 0.1 }, loops: 0.2,
    fits: () => true,
    site: { w: [20, 50], h: [20, 50] },
    layout(P) {
      // the front yard is one room, each door's passage to the lot edge its
      // own; everything else in the lot stays solid. Built in pieces: the
      // front yard and each passage have connections of their own
      const H = P.hint || {};
      if (!H.yard) { P.paint(P.inner, P.add('yard', ['yard'])); return; }
      const v = P.add('yard', ['yard']);
      for (const q of H.yard) P.paint(q, v);
      for (const q of H.adapters || []) P.paint(q, P.add('passage', ['adapter']));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
