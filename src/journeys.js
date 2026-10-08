/*
 * journeys.js - vertical journeys between neighbouring bands (milestone 4).
 *
 * A journey climbs from one band's floor to the next band's, 16 m up, through
 * a territory the world reserves in both bands (band-world.js). It is not one
 * tall room: it is a stack of different templates, each a floor of its own,
 * joined by short climbs.
 *
 *   stage 0      a filler on the whole territory at the lower band's floor,
 *                its doors opening onto that band's network
 *   stages 1..m  smaller fillers at about 4 m steps, each built beside where
 *                the climb below arrives; you enter at one end and must cross
 *                it to where the next climb leaves (the connection zones of
 *                milestone 2 lay that climb as far from the doors as they can)
 *   top stage    a filler on the whole territory at the upper band's floor
 *                (less the opening the last climb comes up through), its doors
 *                opening onto that band's network
 *
 * Each climb (a leg) is a connection variant of the stage it leaves (a stair,
 * a ramp or a ladder, connections.js) with its rise set exactly, so it lands
 * on the next stage's floor height. Its landing gets a doorway on a free side,
 * and the next stage is built against that side with a connection there.
 * A journey's style tilts the legs: mostly stairs, ramps where they fit,
 * ladders, or each stage's own preference (mixed). Stages never repeat a
 * filler within a journey.
 *
 * The result is one br.elevation blueprint with absolute heights, owned by the
 * journey, validated as a whole: every floor reached from either band's doors,
 * no space shared, every cutout explicit.
 *
 *   BR.JOURNEY.plan({ seed, w, h, low, high })   its doors onto each band, decided
 *                                               before (and without) building it
 *   BR.JOURNEY.doors(connections)               those doors as spans on the edge
 *   BR.JOURNEY.generate({ id, seed, w, h, lower, doors: plan, style })
 *   BR.JOURNEY.doorsAt(blueprint, floorZ)       the doors it built at one band's floor
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, FILL = BR.FILL;
  const CFG = { spacing: 16, legs: [4, 4], legRise: [3.4, 4.6], inset: 2, stage: { min: 9, size: [11, 22] }, explore: 6, exploreBottom: 0.25, apart: 4, slab: 0.25, tries: 6 };
  // a journey's style: which climbs it reaches for first (null: each stage's own
  // preference), for how many fillers it insists on the first before falling
  // through, and for ramps (1 in 4 at most, so long) more, lower legs on bigger stages
  const STYLES = { mixed: { w: 4, prefer: null }, stairs: { w: 2, prefer: ['stair', 'ladder'], insist: 2 },
    ramps: { w: 1.5, prefer: ['ramp', 'stair', 'ladder'], insist: 4, legs: [5, 5], legRise: [2.9, 3.5], stage: [14, 24] }, ladders: { w: 1.5, prefer: ['ladder', 'stair'], insist: 2 } };
  const FEEL = { enclosed: 0.35, mixed: 1.3, open: 1.6 };
  const EPS = 1e-7, round = (n) => Math.round(n * 1000) / 1000, clone = (v) => JSON.parse(JSON.stringify(v));
  const J = BR.JOURNEY = { CFG, STYLES };

  // ------------------------------------------------------------ stages
  /** a filler for one stage: the pool, leaning to rooms big enough to climb from, none used twice */
  function stageFiller(seed, site, connections, used) {
    const w = {};
    // (a filler left out of the weights would keep its own weight: those used get 0)
    for (const F of FILL.list()) w[F.id] = F.weight > 0 && !used.has(F.id) ? F.weight * (FEEL[F.feel] || 1) : 0;
    for (let t = 0; t < 4; t++) {
      const s = BR.hash4(seed, t, 0x57a6, 0), id = FILL.pick({ seed: s, site, weights: Object.keys(w).length ? w : undefined });
      const b = FILL.generate({ filler: id, seed: s, site, connections, floors: false });
      if (!b.error) return b;
    }
    return null;
  }
  /** a stage stays under the next one: every ceiling below its floor slab */
  function clampCeilings(b, max) {
    const m = Math.floor(max * 20 + EPS) / 20;
    for (const r of b.rooms) r.ceiling = Math.min(r.ceiling || 2.5, m);
    for (const l of b.levels || []) l.height = Math.min(l.height || m, m);
    return b;
  }

  // ------------------------------------------------------------ a leg and where it arrives
  const edgeOf = (q, side) => (side === 'N' ? [[q[0], q[1]], [q[2], q[1]]] : side === 'S' ? [[q[0], q[3]], [q[2], q[3]]] : side === 'W' ? [[q[0], q[1]], [q[0], q[3]]] : [[q[2], q[1]], [q[2], q[3]]]);
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  /** does rect r lie just outside side `side` of q, touching it along that side? */
  function against(q, side, r) {
    if (side === 'N') return Math.abs(r[3] - q[1]) < EPS && r[0] < q[2] - EPS && r[2] > q[0] + EPS;
    if (side === 'S') return Math.abs(r[1] - q[3]) < EPS && r[0] < q[2] - EPS && r[2] > q[0] + EPS;
    if (side === 'W') return Math.abs(r[2] - q[0]) < EPS && r[1] < q[3] - EPS && r[3] > q[1] + EPS;
    return Math.abs(r[0] - q[2]) < EPS && r[1] < q[3] - EPS && r[3] > q[1] + EPS;
  }
  /** the climb a variant added: its connector, landing room, and footprint (stage frame) */
  function legOf(v) {
    const c = v.connectors.find((x) => String(x.id).startsWith('elev:')), landing = v.rooms.find((r) => String(r.id).startsWith('elev:landing:'));
    const rects = BR.ELEV.reservationsOf(c).flatMap((x) => x.rects);
    return { c, landing, L: landing.rects[0], rects, box: TG.bbox(rects.concat([landing.rects[0]])) };
  }
  const shift = (q, o) => [q[0] + o[0], q[1] + o[1], q[2] + o[0], q[3] + o[1]];
  const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  /**
   * Where the next stage goes: beyond a free side of the landing (not the side
   * the climb arrives over, not one the climb runs along), inside the
   * territory's inset, clear of the climb. Of the sides that fit, the one
   * whose stage is biggest less what it would sit over the earlier stages
   * (`prior`), so the journey wanders across its territory rather than
   * stacking floors in one footprint. Returns { side, R (territory frame) }.
   */
  function nextArea(leg, origin, T, rng, top, size, prior) {
    const L = shift(leg.L, origin), box = shift(leg.box, origin), pieces = leg.rects.map((q) => shift(q, origin));
    const I = [T[0] + CFG.inset, T[1] + CFG.inset, T[2] - CFG.inset, T[3] - CFG.inset];
    const sides = ['N', 'S', 'E', 'W'].filter((sd) => !pieces.some((q) => against(L, sd, q)));
    for (let k = sides.length - 1; k > 0; k--) { const j = rng.int(0, k); [sides[k], sides[j]] = [sides[j], sides[k]]; }
    let best = null;
    for (const side of sides) {
      // the strip just beyond that side must be territory, and not the climb
      const out = side === 'N' ? [L[0], L[1] - 1, L[2], L[1]] : side === 'S' ? [L[0], L[3], L[2], L[3] + 1] : side === 'W' ? [L[0] - 1, L[1], L[0], L[3]] : [L[2], L[1], L[2] + 1, L[3]];
      if (!TG.rcontains(top ? T : I, out) || TG.roverlap(out, box)) continue;
      if (top) { best = { side, R: null }; break; }
      const d = rng.int(size[0], size[1]), s = rng.int(size[0], size[1]);
      let R;
      if (side === 'E' || side === 'W') {
        const x0 = side === 'E' ? L[2] : Math.max(I[0], L[0] - d), x1 = side === 'E' ? Math.min(I[2], L[2] + d) : L[0];
        const y0 = Math.max(I[1], Math.min(L[1] - rng.int(0, Math.max(0, s - (L[3] - L[1]))), I[3] - s)), y1 = Math.min(I[3], y0 + s);
        R = [x0, y0, x1, y1];
      } else {
        const y0 = side === 'S' ? L[3] : Math.max(I[1], L[1] - d), y1 = side === 'S' ? Math.min(I[3], L[3] + d) : L[1];
        const x0 = Math.max(I[0], Math.min(L[0] - rng.int(0, Math.max(0, s - (L[2] - L[0]))), I[2] - s)), x1 = Math.min(I[2], x0 + s);
        R = [x0, y0, x1, y1];
      }
      R = R.map((v) => Math.round(v * 2) / 2);
      // big enough to be a floor of its own, holding the landing's whole doorway, clear of the climb
      if (R[2] - R[0] < CFG.stage.min || R[3] - R[1] < CFG.stage.min || TG.roverlap(R, box)) continue;
      const along = side === 'E' || side === 'W' ? [L[1], L[3], R[1], R[3]] : [L[0], L[2], R[0], R[2]];
      if (along[0] < along[2] - EPS || along[1] > along[3] + EPS) continue;
      const score = TG.rarea(R) - 2 * prior.reduce((a, q) => a + overlapArea(R, q), 0);
      if (!best || score > best.score) best = { side, R, score };
    }
    return best;
  }
  /** the connection a stage on rect R (its own frame) needs where the landing's doorway is */
  function arrival(L, side, R) {
    // the stage's floor starts at the landing's side: its boundary line is that side's coordinate
    const s = OPP[side], line = { E: L[2], W: L[0], S: L[3], N: L[1] }[side] - (s === 'W' || s === 'E' ? R[0] : R[1]);
    if (s === 'W' || s === 'E') return { id: 'arrive', side: s, at: round(L[1] - R[1]), width: round(L[3] - L[1]), line: round(line) };
    return { id: 'arrive', side: s, at: round(L[0] - R[0]), width: round(L[2] - L[0]), line: round(line) };
  }
  /** a doorway in the landing's wall on that side (stage frame) */
  function openLanding(v, leg, side) {
    const [a, b] = edgeOf(leg.L, side);
    const w = v.walls.find((x) => (x.rooms || []).includes(leg.landing.id) && [x.a, x.b].every((p) => [a, b].some((q) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS)));
    if (!w) return null;
    const op = { id: 'elev:o:exit', wall: w.id, kind: 'opening', a: a.slice(), b: b.slice(), width: round(Math.hypot(b[0] - a[0], b[1] - a[1])), rooms: [leg.landing.id, null], height: 2.2, floorZ: leg.landing.floorZ, tags: ['journey'] };
    v.openings.push(op);
    return op;
  }

  // ------------------------------------------------------------ composing the stages
  /** a stage's blueprint, moved into the territory (XY) and to its height (Z), its ids prefixed */
  function placed(src, k, o, base) {
    const b = clone(src), P = (id) => (id === null || id === undefined || id === 'outside' ? id : 'k' + k + '.' + id), S = (sid) => (typeof sid === 'string' && sid.startsWith('s:') ? 's:' + P(sid.slice(2)) : sid);
    const xy = (p) => { p[0] = round(p[0] + o[0]); p[1] = round(p[1] + o[1]); if (p.length > 2) p[2] = round(p[2] + base); };
    const rect = (q) => { q[0] = round(q[0] + o[0]); q[1] = round(q[1] + o[1]); q[2] = round(q[2] + o[0]); q[3] = round(q[3] + o[1]); };
    const z = (q) => { if (q.floorZ !== undefined) q.floorZ = round(q.floorZ + base); if (q.ceilingZ !== undefined) q.ceilingZ = round(q.ceilingZ + base); };
    for (const r of b.rooms) { r.id = P(r.id); r.parent = P(r.parent); r.rects.forEach(rect); z(r); }
    for (const w of b.walls) {
      w.id = P(w.id); w.rooms = w.rooms.map(P); xy(w.a); xy(w.b); z(w);
      const h = Math.abs(w.a[1] - w.b[1]) < EPS;
      for (const g of w.gaps || []) { g.from = round(g.from + (h ? o[0] : o[1])); g.to = round(g.to + (h ? o[0] : o[1])); g.connector = P(g.connector); }
    }
    for (const op of b.openings) { op.id = P(op.id); op.wall = P(op.wall); op.rooms = op.rooms.map(P); op.swingInto = P(op.swingInto); op.portal = P(op.portal); xy(op.a); xy(op.b); if (op.hinge) xy(op.hinge); z(op); }
    for (const p of b.portals) { p.id = P(p.id); p.opening = P(p.opening); p.room = P(p.room); if (p.at) xy(p.at); z(p); }
    for (const q of b.zones || []) { q.id = P(q.id); q.room = P(q.room); q.rects.forEach(rect); z(q); }
    for (const q of b.columns || []) { q.id = P(q.id); q.room = P(q.room); rect(q.rect); z(q); }
    for (const q of b.curves || []) { q.id = P(q.id); q.room = P(q.room); for (const p of (q.pts || []).concat(q.line || [])) { p[0] = round(p[0] + o[0]); p[1] = round(p[1] + o[1]); } if (q.center) { q.center[0] = round(q.center[0] + o[0]); q.center[1] = round(q.center[1] + o[1]); } z(q); }
    for (const q of b.outline || []) { for (const ring of q.rings || []) for (const p of ring) { p[0] = round(p[0] + o[0]); p[1] = round(p[1] + o[1]); } z(q); }
    for (const c of b.connectors) {
      c.id = P(c.id); c.from = S(c.from); c.to = S(c.to); c.zone = P(c.zone); c.vertical = P(c.vertical);
      c.path.forEach(xy); c.landings.forEach(xy); if (c.arrival) c.arrival.forEach((p) => { p[0] = round(p[0] + o[0]); p[1] = round(p[1] + o[1]); });
      for (const v of c.reservations) { v.id = P(v.id); v.rects.forEach(rect); v.z0 = round(v.z0 + base); v.z1 = round(v.z1 + base); }
    }
    for (const h of b.holes) { h.id = P(h.id); h.connector = P(h.connector); h.surface = S(h.surface); rect(h.rect); }
    for (const v of b.voids || []) { v.id = P(v.id); v.rects.forEach(rect); v.z0 = round(v.z0 + base); v.z1 = round(v.z1 + base); }
    b.graph.nodes = b.graph.nodes.map(P);
    b.graph.edges = b.graph.edges.map((e) => [P(e[0]), P(e[1]), e[2], P(e[3])]);
    for (const v of b.verticals || []) { v.id = P(v.id); v.rooms = v.rooms.map(P); }
    (b.route || []).forEach(xy);
    return b;
  }
  /**
   * A journey's doors, from its territory and seed alone: { low, high },
   * filler connections onto the lower and the upper band (ids low0.., high0..).
   * The world plans its cells round them before anything is built.
   */
  J.plan = function plan(spec) {
    const seed = spec.seed >>> 0, site = { w: spec.w, h: spec.h }, name = (pre) => (c, k) => Object.assign(c, { id: pre + k });
    return { low: FILL.sampleConnections(site, spec.low || 3, BR.hash4(seed, 1, 0x10ae, 1)).map(name('low')),
      high: FILL.sampleConnections(site, spec.high || 3, BR.hash4(seed, 2, 0x10ae, 1)).map(name('high')) };
  };
  /** connections on a territory's edge as door spans (territory frame): { portal (the connection id), o, c, s0, s1, main } */
  J.doors = (connections) => connections.map((c) => ({ portal: c.id, o: c.side === 'N' || c.side === 'S' ? 'h' : 'v', c: c.line, s0: c.at, s1: round(c.at + c.width), main: true }));
  /** the journey's doors at one band's floor, as built (territory frame): { portal, o, c, s0, s1, main } */
  J.doorsAt = function doorsAt(b, floorZ) {
    const out = [];
    for (const p of b.portals) {
      if (Math.abs(p.floorZ - floorZ) > EPS) continue;
      const op = b.openings.find((x) => x.id === p.opening), h = Math.abs(op.a[1] - op.b[1]) < EPS;
      out.push({ portal: p.id, o: h ? 'h' : 'v', c: h ? op.a[1] : op.a[0], s0: h ? Math.min(op.a[0], op.b[0]) : Math.min(op.a[1], op.b[1]), s1: h ? Math.max(op.a[0], op.b[0]) : Math.max(op.a[1], op.b[1]), main: true });
    }
    return out.sort((p, q) => p.portal.localeCompare(q.portal));
  };

  /**
   * One journey. spec: { id, seed, w, h (territory, m), lower (band), doors
   * (a plan from J.plan; by default this seed's), style (one of STYLES; by
   * default drawn from the seed) }. Every planned door is built. Returns a
   * br.elevation blueprint (absolute heights) or throws why it could not be.
   */
  const styleRng = (spec) => new BR.Rng(BR.hash4(spec.seed >>> 0, spec.w * 1000 + spec.h, 0x10ae, 0));
  const drawStyle = (rng) => rng.weighted(Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.w])));
  /** the style a journey of this spec takes when none is given */
  J.styleOf = (spec) => drawStyle(styleRng(spec));
  /** where a door (a connection on the territory's edge) is: the middle of its span */
  const doorAt = (c) => (c.side === 'N' || c.side === 'S' ? [c.at + c.width / 2, c.line] : [c.line, c.at + c.width / 2]);
  J.generate = function generate(spec) {
    const E = BR.ELEV, seed = spec.seed >>> 0, id = spec.id || 'journey', W = spec.w, H = spec.h, lower = spec.lower || 0, base = lower * CFG.spacing;
    const rng = styleRng(spec), T = [0, 0, W, H], drawn = drawStyle(rng);
    if (spec.style !== undefined && !STYLES[spec.style]) throw new Error('unknown journey style ' + spec.style);
    const style = spec.style || drawn;
    // the bottom floor is crossed too: from every door in to the first climb, at least this far
    // (on the top floor, which is the upper band's, the last landing only keeps clear of its doors)
    const apartDoors = Math.max(CFG.explore, CFG.exploreBottom * Math.max(W, H)), apartTop = CFG.explore;
    // the rises: about 4 m each, summing exactly to the band spacing
    const S = STYLES[style], legs = S.legs || CFG.legs, legRise = S.legRise || CFG.legRise, size = S.stage || CFG.stage.size, insist = S.insist || 0;
    const n = rng.int(legs[0], legs[1]), raw = [];
    for (let k = 0; k < n; k++) raw.push(rng.range(legRise[0], legRise[1]));
    const sum = raw.reduce((a, b) => a + b, 0), rises = raw.map((r) => Math.round((r * CFG.spacing / sum) * 20) / 20);
    rises[n - 1] = round(CFG.spacing - rises.slice(0, -1).reduce((a, b) => a + b, 0));
    const doors = clone(spec.doors || J.plan(spec)), low = doors.low;
    const used = new Set(), stages = [];
    let site = { w: W, h: H }, origin = [0, 0], conns = low, z = 0;
    for (let k = 0; k < n; k++) {
      let got = null;
      // (the first and last climbs have doors to keep away from: more fillers are tried for them)
      for (let t = 0; t < CFG.tries + insist + (k === 0 || k === n - 1 ? 4 : 0) && !got; t++) {
        const s = BR.hash4(seed, k, t, 0x5a6e);
        const f = stageFiller(s, site, conns, used);
        if (!f) continue;
        clampCeilings(f, rises[k] - CFG.slab);
        const order = t < insist ? [S.prefer[0]] : [...new Set((S.prefer || E.preferenceOf(f)).concat('ladder'))];
        for (const type of order) {
          let v;
          // (lean: only this type, up, at this rise, is searched for)
          try { v = E.connectionVariant(f, { direction: 'up', type, rise: rises[k], fillId: id + ':' + k, deferCapabilities: true }); } catch (err) { continue; }
          const leg = legOf(v), lrng = new BR.Rng(BR.hash4(s, 7, 0x5a6e, 1)), top = k === n - 1;
          // the floor between arrival and departure is crossed: they lie well apart
          if (k === 0 && low.some((c) => { const d = doorAt(c); return Math.hypot(leg.c.path[0][0] - d[0], leg.c.path[0][1] - d[1]) < apartDoors; })) continue;
          if (k > 0) {
            const a = conns.find((c) => c.id === 'arrive'), ap = a.side === 'N' || a.side === 'S' ? [a.at + a.width / 2, a.line] : [a.line, a.at + a.width / 2];
            if (Math.hypot(leg.c.path[0][0] - ap[0], leg.c.path[0][1] - ap[1]) < Math.max(CFG.explore, 0.35 * Math.max(site.w, site.h))) continue;
          }
          // never a shaft: no climb over (or under) an earlier one's footprint, nor starting near it
          const box = shift(leg.box, origin), start = [leg.c.path[0][0] + origin[0], leg.c.path[0][1] + origin[1]];
          if (stages.some((st) => TG.roverlap(st.box, box) || Math.hypot(st.start[0] - start[0], st.start[1] - start[1]) < CFG.apart)) continue;
          // the last climb comes up through the top stage's floor: clear of every door onto the upper band
          if (top) {
            const rest = { rects: BR.FLOORS && BR.FLOORS._internal ? BR.FLOORS._internal.subtract([[0, 0, W, H]], box) : [[0, 0, W, H]] };
            if (doors.high.some((c) => FILL.checkConnection(rest, c))) continue;
          }
          const next = nextArea(leg, origin, T, lrng, top, size, stages.slice(1).map((st) => [st.origin[0], st.origin[1], st.origin[0] + st.v.site.w, st.origin[1] + st.v.site.h]).concat(k ? [[origin[0], origin[1], origin[0] + site.w, origin[1] + site.h]] : []));
          if (!next) continue;
          if (top) {
            const [a, c] = edgeOf(shift(leg.L, origin), next.side), at = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
            if (doors.high.some((h) => { const d = doorAt(h); return Math.hypot(at[0] - d[0], at[1] - d[1]) < apartTop; })) continue;
          }
          const exit = openLanding(v, leg, next.side);
          if (!exit) continue;
          got = { k, filler: f.filler, origin, z, rise: rises[k], v, leg, next, type: leg.c.kind, box, start };
          used.add(f.filler);
          break;
        }
      }
      if (!got) throw new Error(id + ': no stage ' + k + ' with a climb that leaves room for the next');
      stages.push(got);
      z = round(z + rises[k]);
      // the next stage: beside the landing's doorway (or, at the top, the whole territory less the climb's opening)
      const L = shift(got.leg.L, origin);
      if (k < n - 1) {
        const R = got.next.R;
        site = { w: R[2] - R[0], h: R[3] - R[1] }; origin = [R[0], R[1]];
        conns = [arrival(L, got.next.side, R)];
      } else {
        const hole = shift(got.leg.box, origin);
        site = { rects: BR.FLOORS && BR.FLOORS._internal ? BR.FLOORS._internal.subtract([[0, 0, W, H]], hole) : [[0, 0, W, H]] }; origin = [0, 0];
        conns = [arrival(L, got.next.side, [0, 0, W, H])].concat(doors.high);
      }
    }
    // the top stage, at the upper band's floor
    let topF = null;
    for (let t = 0; t < CFG.tries && !topF; t++) topF = stageFiller(BR.hash4(seed, n, t, 0x5a6e), site, conns, used);
    if (!topF) throw new Error(id + ': no top stage');
    const top = { k: n, filler: topF.filler, origin, z, v: E.prepare(topF, { deferCapabilities: true }) };

    // ---- one blueprint: every stage at its place and height
    const parts = stages.concat([top]).map((st) => placed(st.v, st.k, st.origin, base + st.z));
    const b = { schema: E.SCHEMA, kind: 'journey', name: 'Journey · ' + style, fillId: id, seed, site: { w: W, h: H, rects: [[0, 0, W, H]] },
      source: { schema: 'br.journey/0.1', style, rises, stages: stages.concat([top]).map((st) => ({ k: st.k, filler: st.filler, z: st.z, rect: [st.origin[0], st.origin[1], st.origin[0] + (st.v.site.w || 0), st.origin[1] + (st.v.site.h || 0)], leg: st.type || null })) },
      bands: [{ id: 'band:' + lower, elevation: base }, { id: 'band:' + (lower + 1), elevation: base + CFG.spacing }],
      levels: [], footprint: [], rooms: [], walls: [], openings: [], portals: [], zones: [], columns: [], curves: [], outline: [], connectors: [], holes: [], voids: [],
      verticals: [], graph: { nodes: ['outside'], edges: [] }, route: [], connectionZones: [], meta: { style, rises } };
    for (const p of parts) for (const key of ['rooms', 'walls', 'openings', 'portals', 'zones', 'columns', 'curves', 'outline', 'connectors', 'holes', 'voids', 'verticals']) b[key].push(...(p[key] || []));
    for (const p of parts) { b.graph.nodes.push(...p.graph.nodes.filter((x) => x !== 'outside')); b.graph.edges.push(...p.graph.edges.filter((e) => e[0] !== 'outside' && e[1] !== 'outside')); }
    // each landing's doorway opens onto the stage built against it
    for (let k = 0; k < stages.length; k++) {
      const landing = 'k' + k + '.' + stages[k].leg.landing.id, next = 'k' + (k + 1) + '.';
      const p = b.portals.find((x) => x.id.startsWith(next) && x.connection === 'arrive');
      b.graph.edges.push([landing, p.room, 'opening', 'k' + k + '.elev:o:exit']);
      b.openings.find((o) => o.id === p.opening).portal = undefined;
      b.portals.splice(b.portals.indexOf(p), 1);
    }
    // a room belongs to the band whose envelope its floor is in
    const upperZ = base + CFG.spacing + (BR.BAND_CFG ? BR.BAND_CFG.floorLimit : -1.25);
    for (const r of b.rooms) r.band = r.floorZ >= upperZ - EPS ? 'band:' + (lower + 1) : 'band:' + lower;
    // the route through it, for profiles: door, each climb, door
    const first = b.portals.find((p) => p.connection === 'low0'), last = b.portals.find((p) => String(p.connection).startsWith('high'));
    for (const c of b.connectors.filter((x) => /^k\d+\.elev:/.test(x.id))) b.route.push(...c.path.map((p) => p.slice()));
    E.refresh(b, { deferCapabilities: true });
    if (first) b.route.unshift([first.at[0], first.at[1], first.floorZ]);
    if (last) b.route.push([last.at[0], last.at[1], last.floorZ]);
    const errs = E.validate(b).errors.filter((e) => !/^no physical/.test(e));
    if (errs.length) throw new Error(id + ': ' + errs[0]);
    return b;
  };
})(typeof window !== 'undefined' ? window : globalThis);
