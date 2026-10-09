/*
 * space/space.js - the reserved-floor house generator (a test bed, apart
 * from the template engines in src/tpl).
 *
 * Rooms come first and walls come last:
 *
 *   1. program   the room list from a recipe (space/recipes.js), each room
 *                with a target floor area, CLEAR (walls not included)
 *   2. modules   each room is a module: a rectangle of reserved floor whose
 *                sides and area stay inside its own ranges
 *   3. tree      a plan arranges modules in rows and columns. Inside a
 *                container, neighbours are one interior wall apart, and a
 *                face that meets another part of the house is flush; a face
 *                on the outside may jog. The solver sizes the modules (inside
 *                their ranges) until every flush face lines up
 *   4. placement the plan puts its parts together (the hallway opening into
 *                the public rooms, the garage beside a service room)
 *   5. check     two rooms that face each other are exactly one interior
 *                wall apart (0.15 m), or far enough apart for two outer
 *                walls (0.6 m or more); nothing in between is allowed, so no
 *                wall is ever thicker or thinner than its type
 *   6. doors     every link the rooms want (space/recipes.js LINKS) that has
 *                room for its door; then the front, garage and back doors;
 *                every room must be reached from the front door
 *   7. walls     ONE wall builder, after everything is placed: interior walls
 *                in the gaps between rooms, the outer shell laid outside the
 *                rooms, and any leftover nook too narrow to use filled as a
 *                solid pocket. No part draws its own walls
 *
 * Many candidates are tried and the best valid one is kept.
 *
 * Internally every length is a whole number of centimetres on a 5 cm step;
 * the output is in metres.
 *
 *   BR.SPACE.generate({ recipe: 'ranch', seed, site?: { w, h } })
 *     -> { schema: 'br.space/0.1', spaces, walls, openings, solids, ... }
 *        or { error, why }
 */
(function (root) {
  'use strict';
  const BR = root.BR, SP = BR.SPACE = BR.SPACE || {};

  SP.SCHEMA = 'br.space/0.2';
  // all in cm. interior / exterior: wall thicknesses. margin: the least
  // wall left beside an opening. slot: an outside nook narrower than this
  // (after the outer walls) is filled solid. candidates: layouts tried.
  const CFG = SP.CFG = { step: 5, interior: 15, exterior: 30, margin: 15, slot: 90, candidates: 60 };
  const TI = () => CFG.interior, TE = () => CFG.exterior;
  const INF = 1e9;
  const cm = (m) => Math.round(m * 100);
  const snap = (v) => Math.round(v / CFG.step) * CFG.step;
  const snapUp = (v) => Math.ceil(v / CFG.step - 1e-9) * CFG.step;
  const snapDown = (v) => Math.floor(v / CFG.step + 1e-9) * CFG.step;
  const m = (v) => Math.round(v) / 100;
  const other = (a) => (a === 'x' ? 'y' : 'x');
  const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
  const keyOf = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  // ------------------------------------------------------------- program
  const ORDER = ['foyer', 'living', 'family', 'dining', 'kitchen', 'pantry', 'laundry', 'mudroom', 'utility', 'office', 'master', 'bedroom', 'bath', 'linen'];
  function count(spec, rng) {
    if (!spec) return 0;
    if (spec.p !== undefined && rng.f() >= spec.p) return 0;
    if (spec.n === undefined) return 1;
    return Array.isArray(spec.n) ? rng.int(spec.n[0], spec.n[1]) : spec.n;
  }
  const rr = (rng, r) => (Array.isArray(r) ? rng.range(r[0], r[1]) : r);
  function program(R, rng) {
    const rooms = [];
    // never less floor than the room's narrowest square
    const add = (type, area, extra) => { const e = Object.assign({ type, area: Math.round(Math.max(area, SP.MODULES[type].min ** 2) * 1e4) }, extra || {}); rooms.push(e); return e; };
    for (const type of ORDER) {
      const spec = R.rooms[type], n = count(spec, rng);
      for (let k = 0; k < n; k++) {
        const e = add(type, rr(rng, (spec && spec.area) || SP.MODULES[type].area));
        if (type === 'master') {
          e.suite = [];
          if (rng.f() < (spec.ensuite || 0)) e.suite.push(add('ensuite', rng.range(4, 6), { of: e }));
          if (rng.f() < (spec.wic || 0)) e.suite.push(add('wic', rng.range(3, 4.5), { of: e }));
        }
      }
    }
    if (!rooms.some((e) => e.type === 'living')) add('living', 18);
    if (!rooms.some((e) => e.type === 'kitchen')) add('kitchen', 10);
    if (!rooms.some((e) => e.type === 'bath')) add('bath', 5);
    const g = R.garage, P = { rooms, garage: null };
    if (g && rng.f() < (g.p === undefined ? 1 : g.p)) {
      const cars = rng.int(g.cars[0], g.cars[1]);
      P.garage = { type: 'garage', cars, w: cars >= 2 ? snap(rng.range(560, 640)) : snap(rng.range(320, 380)), d: snap(rng.range(580, 660)), door: cars >= 2 ? 480 : 250 };
    }
    P.hall = snap(cm(rr(rng, R.hall || [1.1, 1.3])));
    P.openPlan = rng.f() < (R.openPlan || 0);
    P.backDoor = rng.f() < (R.backDoor === undefined ? 0.6 : R.backDoor);
    return P;
  }

  // ------------------------------------------------------------- modules
  /** a room module: reserved floor, sx by sy (cm), inside its own ranges */
  function room(e, rng, opts) {
    const M = SP.MODULES[e.type], n = { kind: 'room', type: e.type, e, fill: null, fixed: {}, lock: {} };
    Object.assign(n, opts || {});
    if (e.type === 'hall' || e.type === 'garage') return n;
    n.amin = Math.round(e.area * 0.85); n.amax = Math.round(e.area * 1.25);
    // a sampled shape near the target: square-ish, sometimes longer
    const r = rng.range(1, Math.min(M.asp, 1.5)), long = snap(Math.sqrt(e.area * r)), short = snap(e.area / long);
    const flip = rng.f() < 0.5;
    n.sx = flip ? long : short; n.sy = flip ? short : long;
    const mn = cm(M.min);
    if (n.sx < mn) { n.sx = mn; n.sy = snap(e.area / mn); }
    if (n.sy < mn) { n.sy = mn; n.sx = snap(e.area / mn); }
    n.sx = Math.max(n.sx, mn); n.sy = Math.max(n.sy, mn);
    return n;
  }
  /**
   * The sizes room n may take along axis a. Once a side is set by the plan
   * (lock) it stays; while the other side is still free it follows, so the
   * area stays near the target.
   */
  function roomRange(n, a) {
    if (n.fill === a) return [0, INF];
    if (n.fixed[a] !== undefined) return [n.fixed[a], n.fixed[a]];
    if (n.lock[a]) return [size(n, a), size(n, a)];
    const M = SP.MODULES[n.type], mn = cm(M.min), b = other(a);
    if (n.lock[b] || n.fixed[b] !== undefined) {
      const o = size(n, b);
      return [snapUp(Math.max(mn, n.amin / o, o / M.asp)), snapDown(Math.min(n.amax / o, o * M.asp))];
    }
    const o = Math.max(mn, Math.sqrt(n.amax / M.asp));
    return [snapUp(Math.max(mn, Math.sqrt(n.amin / M.asp))), snapDown(Math.min(n.amax / o, o * M.asp))];
  }
  /** the other side's range when side a is t */
  function otherRange(n, a, t) {
    const M = SP.MODULES[n.type];
    return [snapUp(Math.max(cm(M.min), t / M.asp, n.amin / t)), snapDown(Math.min(t * M.asp, n.amax / t))];
  }
  const size = (n, a) => (a === 'x' ? n.sx : n.sy);
  const setSize = (n, a, v) => { if (a === 'x') n.sx = v; else n.sy = v; };

  // ------------------------------------------------------------- the tree
  // row: children left to right (axis x); col: top to bottom (axis y).
  // align (the other axis): 'start' / 'end' flush on that side, 'both' all
  // the same size. A child with fill on the other axis takes the full size.
  const row = (children, align) => ({ kind: 'box', axis: 'x', align, children: children.filter(Boolean).filter((c) => c.kind === 'room' || c.children.length) });
  const col = (children, align) => ({ kind: 'box', axis: 'y', align, children: children.filter(Boolean).filter((c) => c.kind === 'room' || c.children.length) });
  const solid = (n, a) => n.kind === 'box' || n.fill !== a;
  function ext(n, a) {
    if (n.kind === 'room') return n.fill === a ? 0 : size(n, a);
    if (a === n.axis) return n.children.reduce((s, c) => s + ext(c, a), 0) + TI() * Math.max(0, n.children.length - 1);
    return n.children.filter((c) => solid(c, a)).reduce((s, c) => Math.max(s, ext(c, a)), 0);
  }
  function range(n, a) {
    if (n.kind === 'room') return roomRange(n, a);
    const kids = n.children;
    if (a === n.axis) {
      const g = TI() * Math.max(0, kids.length - 1);
      return kids.reduce((r, c) => { const q = range(c, a); return [r[0] + q[0], r[1] + q[1]]; }, [g, g]);
    }
    const qs = kids.filter((c) => solid(c, a)).map((c) => range(c, a));
    if (!qs.length) return [0, INF];
    if (n.align === 'both') return qs.reduce((r, q) => [Math.max(r[0], q[0]), Math.min(r[1], q[1])], [0, INF]);
    return qs.reduce((r, q) => [Math.max(r[0], q[0]), Math.max(r[1], q[1])], [0, 0]);
  }
  /** make n exactly t along axis a, inside every module's range */
  function fit(n, a, t) {
    if (n.kind === 'room') {
      if (n.fill === a) return true;
      const [lo, hi] = roomRange(n, a), b = other(a);
      if (t < lo || t > hi) return false;
      if (n.fixed[a] === undefined && n.fixed[b] === undefined && !n.lock[b]) {
        const [olo, ohi] = otherRange(n, a, t);
        if (olo > ohi) return false;
        setSize(n, b, Math.min(ohi, Math.max(olo, snap(n.e.area / t))));
      }
      setSize(n, a, t);
      n.lock[a] = true;
      return true;
    }
    if (a !== n.axis) {
      const kids = n.children.filter((c) => solid(c, a));
      if (n.align === 'both') return kids.every((c) => fit(c, a, t));
      for (const c of kids) if (ext(c, a) > t && !fit(c, a, t)) return false;
      if (ext(n, a) < t) {
        const c = kids.slice().sort((p, q) => range(q, a)[1] - range(p, a)[1])[0];
        if (!c || !fit(c, a, t)) return false;
      }
      return ext(n, a) === t;
    }
    // along its own axis: share the difference by how much each child can give
    const kids = n.children, cur = kids.map((c) => ext(c, a)), rg = kids.map((c) => range(c, a));
    let need = t - ext(n, a);
    if (need === 0) return true;
    const sg = Math.sign(need), slack = kids.map((c, k) => Math.max(0, sg > 0 ? rg[k][1] - cur[k] : cur[k] - rg[k][0]));
    const total = slack.reduce((s, v) => s + v, 0);
    if (total < Math.abs(need)) return false;
    const give = slack.map((v) => Math.min(v, snapDown((Math.abs(need) * v) / total)));
    let left = Math.abs(need) - give.reduce((s, v) => s + v, 0);
    for (let k = 0; left > 0 && k < kids.length * 400; k++) {
      const i = k % kids.length;
      if (give[i] + CFG.step <= slack[i]) { give[i] += CFG.step; left -= CFG.step; }
    }
    if (left > 0) return false;
    return kids.every((c, k) => fit(c, a, cur[k] + sg * give[k]));
  }
  /** settle every 'both' box, deepest first */
  function solve(n) {
    if (n.kind === 'room') return true;
    if (!n.children.every(solve)) return false;
    if (n.align !== 'both') {
      // tidy the jagged side: a neighbour nearly as deep is made as deep
      const b = other(n.axis), kids = n.children.filter((c) => solid(c, b)), top = Math.max(...kids.map((c) => ext(c, b)));
      for (const c of kids) { const e = ext(c, b), r = range(c, b); if (e < top && top - e <= 45 && r[0] <= top && r[1] >= top) fit(c, b, top); }
      return true;
    }
    const b = other(n.axis), [lo, hi] = range(n, b);
    if (lo > hi) return false;
    const t = Math.min(hi, Math.max(lo, ext(n, b)));
    return fit(n, b, t);
  }
  /** positions: n's top-left at (x, y); every room gets .r = [x0, y0, x1, y1] */
  function place(n, x, y, out) {
    if (n.kind === 'room') { n.r = [x, y, x + n.sx, y + n.sy]; out.push(n); return; }
    const a = n.axis, b = other(a), cross = ext(n, b);
    let cur = a === 'x' ? x : y;
    for (const c of n.children) {
      if (c.kind === 'room' && c.fill === b) setSize(c, b, cross);
      const off = n.align === 'end' && solid(c, b) ? cross - ext(c, b) : 0;
      if (a === 'x') place(c, cur, y + off, out); else place(c, x + off, cur, out);
      cur += ext(c, a) + TI();
    }
  }
  function shift(list, dx, dy) { for (const n of list) n.r = [n.r[0] + dx, n.r[1] + dy, n.r[2] + dx, n.r[3] + dy]; }
  const W = (r) => r[2] - r[0], H = (r) => r[3] - r[1];
  const bboxOf = (list) => list.reduce((b, n) => [Math.min(b[0], n.r[0]), Math.min(b[1], n.r[1]), Math.max(b[2], n.r[2]), Math.max(b[3], n.r[3])], [INF, INF, -INF, -INF]);

  // ------------------------------------------------------------- plans
  const hallLink = (t) => SP.LINKS[keyOf(t, 'hall')] && SP.LINKS[keyOf(t, 'hall')].kind === 'hall';
  function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /** the private rooms in two lists for the two sides of a hallway, the master suite kept together at the far end */
  function wingSides(P, rng, rm) {
    const priv = P.rooms.filter((e) => SP.MODULES[e.type].zone === 'private' && !e.of);
    const master = priv.find((e) => e.type === 'master');
    const rest = shuffle(priv.filter((e) => e !== master), rng);
    const sides = [[], []], len = [0, 0];
    const est = (e) => Math.sqrt(e.area);
    for (const e of rest) { const k = len[0] <= len[1] ? 0 : 1; sides[k].push(rm(e)); len[k] += est(e); }
    if (master) {
      // the master in the middle of its suite, or at the near end of it
      const k = len[0] <= len[1] ? 0 : 1, parts = master.suite.map(rm), suite = parts.length === 2 ? [parts[0], rm(master), parts[1]] : [rm(master)].concat(parts);
      sides[k].push(...suite);
    }
    return sides;
  }
  function publicRooms(P, rng) {
    const pub = P.rooms.filter((e) => ['public', 'service'].includes(SP.MODULES[e.type].zone));
    const svc = shuffle(pub.filter((e) => SP.MODULES[e.type].zone === 'service'), rng);
    const of = (t) => pub.filter((e) => e.type === t);
    return { svc, kitchen: of('kitchen'), dining: of('dining'), family: of('family'), living: of('living'), foyer: of('foyer') };
  }

  /**
   * bar: [garage][public rooms][private wing] along the street. The public
   * rooms are two rows, back and front, meeting at one wall; the wing is a
   * hallway with rooms down both sides. Back walls and the front jog.
   */
  function planBar(P, rng) {
    const rm = (e) => room(e, rng), pr = publicRooms(P, rng);
    // back and front rows must come out the same length: share the rooms
    // that may go either way until they do
    let backRow, frontRow, pub;
    for (let k = 0; k < 24 && !pub; k++) {
      const back = [], front = [], svcB = [], svcF = [];
      for (const e of pr.svc) (rng.f() < 0.7 ? svcB : svcF).push(e);
      svcB.sort((a, b) => (a.type === 'pantry') - (b.type === 'pantry'));
      back.push(...svcB, ...pr.kitchen);
      const either = shuffle(pr.dining.concat(pr.family), rng);
      for (const e of either) (rng.f() < 0.6 ? back : front).push(e);
      front.unshift(...svcF);
      front.push(...pr.living);
      if (pr.foyer.length) { if (rng.f() < 0.75) front.push(...pr.foyer); else front.splice(svcF.length, 0, ...pr.foyer); }
      backRow = row(back.map(rm), 'end'); frontRow = row(front.map(rm), 'start');
      const p = col([backRow, frontRow], 'both');
      if (solve(p)) pub = p;
    }
    if (!pub) return { fail: 'public rooms' };
    const [s0, s1] = wingSides(P, rng, rm);
    const hall = room({ type: 'hall' }, rng, { fill: 'x', fixed: { y: P.hall }, sy: P.hall });
    const wing = col([row(s0, 'end'), hall, row(s1, 'start')], 'start');
    if (!solve(wing)) return { fail: 'wing' };
    const rooms = [];
    place(pub, 0, 0, rooms);
    const pubBox = bboxOf(rooms);
    // the hallway opens into a public room at the wing end
    const hosts = [frontRow.children[frontRow.children.length - 1], backRow.children[backRow.children.length - 1]]
      .filter((n) => n && hallLink(n.type) && H(n.r) >= P.hall + 2 * CFG.margin);
    if (!hosts.length) return { fail: 'hall entry' };
    const host = hosts.find((n) => n.type === 'foyer') || rng.pick(hosts);
    const wr = [];
    place(wing, 0, 0, wr);
    const hy = snap(host.r[1] + CFG.margin + rng.f() * (H(host.r) - P.hall - 2 * CFG.margin));
    shift(wr, pubBox[2] + TI(), hy - hall.r[1]);
    rooms.push(...wr);
    if (P.garage) {
      const g = garageNode(P), need = 90 + 2 * CFG.margin;
      if (rng.f() < 0.4) {
        // in front of the service end, its back one wall from the front row
        const fits = [];
        for (const x0 of [pubBox[0], frontRow.children[0].r[2] - g.sx]) {
          const over = frontRow.children.filter((n) => Math.min(n.r[2], x0 + g.sx) > Math.max(n.r[0], x0));
          const y0 = Math.max(...over.map((n) => n.r[3])) + TI();
          const ok = over.every((n) => y0 - n.r[3] === TI() || y0 - n.r[3] >= 2 * TE());
          const door = over.some((n) => y0 - n.r[3] === TI() && SP.GARAGE_INTO.includes(n.type) && Math.min(n.r[2], x0 + g.sx) - Math.max(n.r[0], x0) >= need);
          if (ok && door) fits.push([x0, y0]);
        }
        if (!fits.length) return { fail: 'garage in front' };
        const [x0, y0] = fits[0];
        g.r = [x0, y0, x0 + g.sx, y0 + g.sy];
        rooms.push(g);
        return { type: 'bar', rooms, hall, garage: 'front' };
      }
      // beside the service end, its door into a service room
      const target = [backRow.children[0], frontRow.children[0]].find((n) => n && SP.GARAGE_INTO.includes(n.type));
      if (!target) return { fail: 'garage entry' };
      const frontLine = Math.max(...frontRow.children.map((n) => n.r[3]));
      let y1 = frontLine + snap(rng.range(0, 120));
      if (Math.min(y1, target.r[3]) - Math.max(y1 - g.sy, target.r[1]) < need) y1 = target.r[1] + need + g.sy - CFG.step * 2;
      g.r = [pubBox[0] - TI() - g.sx, y1 - g.sy, pubBox[0] - TI(), y1];
      rooms.push(g);
    }
    return { type: 'bar', rooms, hall };
  }

  /**
   * deep: public rooms at the front, the private wing behind them with its
   * hallway running back from a public room. For narrow lots.
   */
  function planDeep(P, rng) {
    const rm = (e) => room(e, rng), pr = publicRooms(P, rng);
    // the back public row meets the wing along its whole top, so its rooms
    // share one depth; the rooms that cannot go to the front row instead
    let backRow, frontRow, pub, svcStack;
    for (let k = 0; k < 24 && !pub; k++) {
      const backE = pr.kitchen.slice(), frontE = pr.living.slice(), stackE = [];
      for (const e of pr.dining.concat(pr.family)) (rng.f() < 0.75 ? backE : frontE).push(e);
      for (const e of pr.svc) (rng.f() < 0.45 ? stackE : frontE).push(e);
      const depth = snap(Math.sqrt(backE.reduce((s, e) => s + e.area, 0) / backE.length) * rng.range(0.9, 1.15));
      const deep = (e) => { const n = rm(e); n.sy = depth; n.sx = Math.max(cm(SP.MODULES[e.type].min), snap(e.area / depth)); return n; };
      svcStack = stackE.length ? col(stackE.map(rm), 'both') : null;
      const backKids = shuffle(backE, rng).map(deep);
      if (svcStack) { if (rng.f() < 0.5) backKids.unshift(svcStack); else backKids.push(svcStack); }
      backRow = row(backKids, 'both');
      const front = shuffle(frontE, rng).map(rm), foyer = pr.foyer.map(rm);
      if (foyer.length) { if (rng.f() < 0.5) front.push(...foyer); else front.unshift(...foyer); }
      frontRow = row(front, 'start');
      const p = col([backRow, frontRow], 'start');
      if (solve(p)) pub = p;
    }
    if (!pub) return { fail: 'public rooms' };
    const [s0, s1] = wingSides(P, rng, rm);
    const hall = room({ type: 'hall' }, rng, { fill: 'y', fixed: { x: P.hall }, sx: P.hall });
    const wing = row([col(s0, 'end'), hall, col(s1, 'start')], 'end');
    if (!solve(wing)) return { fail: 'wing' };
    const rooms = [];
    place(pub, 0, 0, rooms);
    const pubBox = bboxOf(rooms);
    const hosts = backRow.children.filter((n) => n.kind === 'room' && hallLink(n.type) && W(n.r) >= P.hall + 2 * CFG.margin);
    if (!hosts.length) return { fail: 'hall entry' };
    const host = rng.pick(hosts);
    const wr = [];
    place(wing, 0, 0, wr);
    const wb = bboxOf(wr), hx = snap(host.r[0] + CFG.margin + rng.f() * (W(host.r) - P.hall - 2 * CFG.margin));
    shift(wr, hx - hall.r[0], pubBox[1] - TI() - wb[3]);
    rooms.push(...wr);
    if (P.garage) {
      // beside whichever end has a room it may open into
      const g = garageNode(P), need = 90 + 2 * CFG.margin, pubRooms = rooms.filter((n) => !wr.includes(n));
      const frontLine = Math.max(...frontRow.children.map((n) => n.r[3]));
      const sides = shuffle(['L', 'R'], rng);
      let done = false;
      for (const side of sides) {
        const t = pubRooms.filter((n) => (side === 'L' ? n.r[0] === pubBox[0] : n.r[2] === pubBox[2]) && SP.GARAGE_INTO.includes(n.type)).sort((p, q) => q.r[3] - p.r[3])[0];
        if (!t) continue;
        // its front at or past the front rooms, its door wall sharing enough of t
        const y1 = Math.max(t.r[1] + need, Math.min(t.r[3] - need + g.sy, frontLine + snap(rng.range(0, 60))));
        const x0 = side === 'L' ? pubBox[0] - TI() - g.sx : pubBox[2] + TI();
        g.r = [x0, y1 - g.sy, x0 + g.sx, y1];
        rooms.push(g);
        done = true;
        break;
      }
      if (!done) return { fail: 'garage entry' };
    }
    return { type: 'deep', rooms, hall };
  }
  function garageNode(P) {
    const g = P.garage;
    return { kind: 'room', type: 'garage', e: { type: 'garage', area: g.w * g.d }, sx: g.w, sy: g.d, fill: null, fixed: { x: g.w, y: g.d }, lock: {}, door: g.door };
  }
  const PLANS = { bar: planBar, deep: planDeep };

  // ------------------------------------------------------------- check
  /**
   * Every pair of rooms that face each other: exactly one interior wall
   * apart, or at least two outer walls apart. Returns the wall pairs, or
   * null with why[reason]++.
   */
  function pairs(rooms, why) {
    const out = [];
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i].r, B = rooms[j].r;
      const ox = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), oy = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
      if (ox > 0 && oy > 0) { why.overlap = (why.overlap || 0) + 1; return null; }
      for (const [o, ov, gap, lo] of [['h', ox, Math.max(A[1], B[1]) - Math.min(A[3], B[3]), A[1] < B[1] ? i : j], ['v', oy, Math.max(A[0], B[0]) - Math.min(A[2], B[2]), A[0] < B[0] ? i : j]]) {
        if (ov <= 0) continue;
        if (gap === TI()) {
          const a = rooms[lo], b = rooms[lo === i ? j : i];
          out.push(o === 'h' ? { o, a, b, c0: a.r[3], c1: b.r[1], s0: Math.max(A[0], B[0]), s1: Math.min(A[2], B[2]) }
            : { o, a, b, c0: a.r[2], c1: b.r[0], s0: Math.max(A[1], B[1]), s1: Math.min(A[3], B[3]) });
        } else if (gap < 2 * TE()) { why.gap = (why.gap || 0) + 1; return null; }
      }
    }
    return out;
  }
  function sizesOk(rooms, why) {
    for (const n of rooms) {
      if (n.type === 'hall' || n.type === 'garage') continue;
      const M = SP.MODULES[n.type], s = Math.min(W(n.r), H(n.r)), l = Math.max(W(n.r), H(n.r)), a = W(n.r) * H(n.r);
      if (s < cm(M.min) || l > s * M.asp + 1 || a < n.amin - CFG.step * l || a > n.amax + CFG.step * l) { why.size = (why.size || 0) + 1; return false; }
    }
    return true;
  }

  // ------------------------------------------------------------- doors
  function openings(rooms, walls, P, rng, why) {
    const ops = [], idx = new Map(rooms.map((n, i) => [n, i]));
    const M = CFG.margin;
    const put = (wall, kind, w, at) => {
      const ov = wall.s1 - wall.s0;
      if (kind !== 'open' && w + 2 * M > ov) return null;
      const s0 = kind === 'open' ? wall.s0 : at !== undefined ? at : snap(wall.s0 + M + rng.f() * (ov - w - 2 * M));
      const op = { kind, wall, s0, s1: kind === 'open' ? wall.s1 : s0 + w };
      ops.push(op); wall.opening = op;
      return op;
    };
    // ---- between rooms
    let garageDoor = null;
    for (const wl of walls) {
      const A = wl.a, B = wl.b;
      if (A.type === 'garage' || B.type === 'garage') {
        const o = A.type === 'garage' ? B : A, k = SP.GARAGE_INTO.indexOf(o.type);
        if (k >= 0 && wl.s1 - wl.s0 >= 90 + 2 * M && (!garageDoor || k < garageDoor.k)) garageDoor = { k, wl };
        continue;
      }
      const L = SP.LINKS[keyOf(A.type, B.type)];
      if (!L) continue;
      const ov = wl.s1 - wl.s0;
      if (L.kind === 'door') put(wl, 'door', cm(L.w));
      else if (L.kind === 'hall') put(wl, 'opening', snapDown(Math.min(ov - 2 * M, P.hall)));
      else if (L.kind === 'plan' && P.openPlan) put(wl, 'open');
      else if (ov - 2 * M >= 80) put(wl, 'opening', Math.min(snap(cm(rr(rng, L.w))), snapDown(ov - 2 * M)));
    }
    if (garageDoor) put(garageDoor.wl, 'door', 90);
    // ---- the outside: front door, garage door, back door
    const clear = (n, side) => !rooms.some((o) => o !== n && Math.min(o.r[2], n.r[2]) > Math.max(o.r[0], n.r[0]) && (side === 'S' ? o.r[1] >= n.r[3] : o.r[3] <= n.r[1]));
    const outside = [];
    const exit = (n, side, kind, w, role) => {
      const s = W(n.r);
      if (s < w + 2 * 30) return null;
      const s0 = snap(n.r[0] + 30 + rng.f() * (s - w - 60));
      const o = { kind, role, room: n, side, s0, s1: s0 + w, c: side === 'S' ? n.r[3] : n.r[1] };
      outside.push(o);
      return o;
    };
    let front = null;
    for (const t of ['foyer', 'living', 'family', 'dining', 'hall', 'kitchen']) {
      const n = rooms.filter((x) => x.type === t && clear(x, 'S')).sort((p, q) => q.r[3] - p.r[3])[0];
      if (n && (front = exit(n, 'S', 'entrance', 100, 'front door'))) break;
    }
    if (!front) { why.front = (why.front || 0) + 1; return null; }
    const g = rooms.find((n) => n.type === 'garage');
    if (g && (!clear(g, 'S') || !exit(g, 'S', 'vehicle', g.door, 'garage door'))) { why.garageDoor = (why.garageDoor || 0) + 1; return null; }
    if (P.backDoor) for (const t of ['kitchen', 'laundry', 'mudroom', 'dining', 'family']) {
      const n = rooms.find((x) => x.type === t && clear(x, 'N'));
      if (n && exit(n, 'N', ['dining', 'family'].includes(t) ? 'slider' : 'door', ['dining', 'family'].includes(t) ? 180 : 90, 'back door')) break;
    }
    // ---- every room reached from the front door, through the house
    const adj = rooms.map(() => []);
    const link = (op) => { const i = idx.get(op.wall.a), j = idx.get(op.wall.b); adj[i].push(j); adj[j].push(i); };
    ops.forEach(link);
    const reach = () => {
      const seen = new Uint8Array(rooms.length), st = [idx.get(front.room)];
      seen[st[0]] = 1;
      while (st.length) for (const v of adj[st.pop()]) if (!seen[v]) { seen[v] = 1; st.push(v); }
      return seen;
    };
    let seen = reach(), extra = 0;
    const NEVER = new Set(['linen', 'wic', 'ensuite', 'pantry', 'garage']);
    for (let guard = 0; guard < rooms.length && seen.some((v) => !v); guard++) {
      // a door of last resort from a reached circulation or public room
      const wl = walls.filter((x) => !x.opening && seen[idx.get(x.a)] !== seen[idx.get(x.b)] && !NEVER.has(x.a.type) && !NEVER.has(x.b.type)
        && ['hall', 'foyer', 'living', 'dining', 'family', 'kitchen'].includes((seen[idx.get(x.a)] ? x.a : x.b).type) && x.s1 - x.s0 >= 90 + 2 * M)
        .sort((p, q) => (q.s1 - q.s0) - (p.s1 - p.s0))[0];
      if (!wl) break;
      put(wl, 'door', 90);
      link(wl.opening); extra++;
      seen = reach();
    }
    if (seen.some((v) => !v)) { why.unreached = (why.unreached || 0) + 1; return null; }
    return { ops, outside, front, extra };
  }

  /** the hole an outside door makes in the outer wall on its side of the room */
  function exitRect(o) {
    return o.side === 'S' ? [o.s0, o.c, o.s1, o.c + TE()] : o.side === 'N' ? [o.s0, o.c - TE(), o.s1, o.c]
      : o.side === 'E' ? [o.c, o.s0, o.c + TE(), o.s1] : [o.c - TE(), o.s0, o.c, o.s1];
  }

  // ------------------------------------------------------------- walls
  /**
   * The one wall builder: from the placed rooms alone. Solid = the rooms
   * grown by an outer wall, narrow outside nooks closed, holes filled,
   * minus the rooms and the openings. Each solid cell is wall (within an
   * outer wall's thickness of a room) or pocket (deeper). On a 5 cm raster.
   */
  function compile(rooms, walls, ops, exits) {
    const S = CFG.step, pad = TE() + CFG.slot + 2 * S, bb = bboxOf(rooms);
    const X0 = bb[0] - pad, Y0 = bb[1] - pad, NX = Math.round((bb[2] - bb[0] + 2 * pad) / S), NY = Math.round((bb[3] - bb[1] + 2 * pad) / S);
    const at = (x, y) => y * NX + x, cell = (v, o) => Math.round((v - o) / S);
    const roomOf = new Int16Array(NX * NY).fill(-1);
    rooms.forEach((n, i) => { for (let y = cell(n.r[1], Y0); y < cell(n.r[3], Y0); y++) for (let x = cell(n.r[0], X0); x < cell(n.r[2], X0); x++) roomOf[at(x, y)] = i; });
    const grow = (src, r) => {
      // square dilation by r cells: rows, then columns
      const tmp = new Uint8Array(NX * NY), out = new Uint8Array(NX * NY);
      for (let y = 0; y < NY; y++) { let last = -INF; for (let x = 0; x < NX; x++) { if (src[at(x, y)]) last = x; if (x - last <= r) tmp[at(x, y)] = 1; } last = INF; for (let x = NX - 1; x >= 0; x--) { if (src[at(x, y)]) last = x; if (last - x <= r) tmp[at(x, y)] = 1; } }
      for (let x = 0; x < NX; x++) { let last = -INF; for (let y = 0; y < NY; y++) { if (tmp[at(x, y)]) last = y; if (y - last <= r) out[at(x, y)] = 1; } last = INF; for (let y = NY - 1; y >= 0; y--) { if (tmp[at(x, y)]) last = y; if (last - y <= r) out[at(x, y)] = 1; } }
      return out;
    };
    const inv = (a) => a.map((v) => (v ? 0 : 1));
    const isRoom = roomOf.map((v) => (v >= 0 ? 1 : 0));
    const shell = grow(isRoom, Math.round(TE() / S));
    const R = Math.round(CFG.slot / 2 / S), closed = inv(grow(inv(grow(shell, R)), R));
    for (let k = 0; k < closed.length; k++) if (shell[k]) closed[k] = 1;
    // holes: whatever the outside cannot reach
    const outside = new Uint8Array(NX * NY), st = [];
    for (let x = 0; x < NX; x++) for (const y of [0, NY - 1]) if (!closed[at(x, y)]) { outside[at(x, y)] = 1; st.push(at(x, y)); }
    for (let y = 0; y < NY; y++) for (const x of [0, NX - 1]) if (!closed[at(x, y)] && !outside[at(x, y)]) { outside[at(x, y)] = 1; st.push(at(x, y)); }
    while (st.length) {
      const k = st.pop(), x = k % NX, y = (k - x) / NX;
      for (const [u, v] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (u >= 0 && v >= 0 && u < NX && v < NY && !closed[at(u, v)] && !outside[at(u, v)]) { outside[at(u, v)] = 1; st.push(at(u, v)); }
    }
    // 0 outside, 1 room, 2 wall, 3 pocket, 4 opening (floor through a wall)
    const kind = new Uint8Array(NX * NY);
    for (let k = 0; k < kind.length; k++) kind[k] = roomOf[k] >= 0 ? 1 : outside[k] ? 0 : shell[k] ? 2 : 3;
    const cut = (r) => { for (let y = cell(r[1], Y0); y < cell(r[3], Y0); y++) for (let x = cell(r[0], X0); x < cell(r[2], X0); x++) if (kind[at(x, y)] >= 2) kind[at(x, y)] = 4; };
    for (const op of ops) { const w = op.wall; cut(w.o === 'h' ? [op.s0, w.c0, op.s1, w.c1] : [w.c0, op.s0, w.c1, op.s1]); }
    for (const o of exits) cut(exitRect(o));
    // as rects: runs of one kind per row, merged down while they repeat
    const rects = { 2: [], 3: [], 4: [] };
    let open = new Map();
    for (let y = 0; y <= NY; y++) {
      const runs = new Map();
      if (y < NY) for (let x = 0; x < NX;) {
        const k = kind[at(x, y)];
        let e = x + 1;
        while (e < NX && kind[at(e, y)] === k) e++;
        if (rects[k]) runs.set(k + ':' + x + ':' + e, [k, x, e]);
        x = e;
      }
      const next = new Map();
      for (const [key, run] of runs) next.set(key, open.has(key) ? open.get(key) : { k: run[0], x0: run[1], x1: run[2], y0: y });
      for (const [key, o] of open) if (!next.has(key)) rects[o.k].push([X0 + o.x0 * S, Y0 + o.y0 * S, X0 + o.x1 * S, Y0 + y * S]);
      open = next;
    }
    const foot = [];
    let fopen = new Map();
    for (let y = 0; y <= NY; y++) {
      const runs = new Map();
      if (y < NY) for (let x = 0; x < NX;) {
        const f = kind[at(x, y)] !== 0;
        let e = x + 1;
        while (e < NX && (kind[at(e, y)] !== 0) === f) e++;
        if (f) runs.set(x + ':' + e, [x, e]);
        x = e;
      }
      const next = new Map();
      for (const [key, run] of runs) next.set(key, fopen.has(key) ? fopen.get(key) : { x0: run[0], x1: run[1], y0: y });
      for (const [key, o] of fopen) if (!next.has(key)) foot.push([X0 + o.x0 * S, Y0 + o.y0 * S, X0 + o.x1 * S, Y0 + y * S]);
      fopen = next;
    }
    let pocketArea = 0;
    for (let k = 0; k < kind.length; k++) if (kind[k] === 3) pocketArea += S * S;
    return { walls: rects[2], pockets: rects[3], cuts: rects[4], footprint: foot, pocketArea };
  }

  // ------------------------------------------------------------- scoring
  function score(rooms, extra) {
    const t = {};
    const real = rooms.filter((n) => n.type !== 'hall' && n.type !== 'garage');
    t.sizes = Math.round((real.reduce((s, n) => s + Math.abs(W(n.r) * H(n.r) - n.e.area) / n.e.area, 0) / Math.max(1, real.length)) * 30 * 10) / 10;
    const bb = bboxOf(rooms), area = rooms.reduce((s, n) => s + W(n.r) * H(n.r), 0);
    t.compact = Math.round((1 - area / ((W(bb) + 2 * TE()) * (H(bb) + 2 * TE()))) * 25 * 10) / 10;
    const hall = rooms.filter((n) => n.type === 'hall').reduce((s, n) => s + W(n.r) * H(n.r), 0);
    t.circulation = Math.round(Math.max(0, hall / area - 0.12) * 80 * 10) / 10;
    t.extraDoors = extra * 4;
    return t;
  }

  // ------------------------------------------------------------- generate
  SP.generate = function generate(spec) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const R = SP.RECIPES[spec.recipe];
    if (!R) throw new Error('no such recipe: ' + spec.recipe);
    if (R.route) return SP.generateRoute(spec, t0);
    const seed = spec.seed >>> 0, salt = hashStr(spec.recipe);
    const srng = new BR.Rng(BR.hash4(seed, salt, 0x5ace, 1));
    const site = spec.site || { w: Math.round(srng.range(R.site.w[0], R.site.w[1]) * 2) / 2, h: Math.round(srng.range(R.site.h[0], R.site.h[1]) * 2) / 2 };
    const SW = cm(site.w), SH = cm(site.h);
    const why = {};
    let best = null, tried = 0;
    for (let k = 0; k < CFG.candidates; k++) {
      const rng = new BR.Rng(BR.hash4(seed, salt, 0x5ace, 100 + k));
      const P = program(R, new BR.Rng(BR.hash4(seed, salt, 0x5ace, 2)));
      const type = rng.weighted(R.plans), plan = PLANS[type](P, rng);
      tried++;
      if (plan.fail) { why[type + ': ' + plan.fail] = (why[type + ': ' + plan.fail] || 0) + 1; continue; }
      let rooms = plan.rooms;
      if (rng.f() < 0.5) { const bb = bboxOf(rooms); for (const n of rooms) n.r = [bb[0] + bb[2] - n.r[2], n.r[1], bb[0] + bb[2] - n.r[0], n.r[3]]; }
      // on the lot: inside it by an outer wall, the front at the street
      const bb = bboxOf(rooms), slackX = SW - 2 * TE() - W(bb), slackY = SH - 2 * TE() - H(bb);
      if (slackX < 0 || slackY < 0) { why.lot = (why.lot || 0) + 1; continue; }
      shift(rooms, TE() + snap(rng.f() * slackX) - bb[0], SH - TE() - bb[3]);
      if (!sizesOk(rooms, why)) continue;
      const walls = pairs(rooms, why);
      if (!walls) continue;
      const doors = openings(rooms, walls, P, rng, why);
      if (!doors) continue;
      const terms = score(rooms, doors.extra), pen = Object.values(terms).reduce((s, v) => s + v, 0);
      if (!best || pen < best.pen) best = { pen, terms, plan, rooms, walls, doors, P };
    }
    if (!best) return { schema: SP.SCHEMA, error: 'no valid layout', recipe: spec.recipe, seed, site, why, tried };
    return output(best, spec, seed, site, why, tried, t0);
  };

  function output(best, spec, seed, site, why, tried, t0) {
    const R = SP.RECIPES[spec.recipe];
    return emit({ recipe: spec.recipe, name: R.name, seed, site, rooms: best.rooms, walls: best.walls, ops: best.doors.ops, outside: best.doors.outside,
      meta: { plan: best.plan.type, score: Math.round((100 - best.pen) * 10) / 10, terms: best.terms, openPlan: best.P.openPlan, candidates: tried, why }, t0 });
  }

  /**
   * The output of any plan, in metres. rooms carry .floor (0 when left
   * out); walls are the pairs one wall apart (each pair on one floor);
   * outside: doors in the outer wall. Extra: verticals [{ kind, rooms: [lower,
   * upper] }], route (rooms in walking order), wrong (what is off).
   */
  function emit(o) {
    const { rooms, walls } = o, fl = (n) => n.floor || 0;
    const ids = new Map(rooms.map((n, i) => [n, 'r' + i])), counts = {};
    const floors = [...new Set(rooms.map(fl))].sort((p, q) => p - q);
    const levels = floors.map((f) => {
      const here = rooms.filter((n) => fl(n) === f);
      const solid = compile(here, null, o.ops.filter((op) => fl(op.wall.a) === f), o.outside.filter((x) => fl(x.room) === f));
      return { floor: f, solids: { walls: solid.walls.map((r) => r.map(m)), pockets: solid.pockets.map((r) => r.map(m)), openings: solid.cuts.map((r) => r.map(m)) },
        footprint: solid.footprint.map((r) => r.map(m)), pocketArea: Math.round(solid.pocketArea / 100) / 100 };
    });
    const spaces = rooms.map((n) => {
      counts[n.type] = (counts[n.type] || 0) + 1;
      const M = SP.MODULES[n.type], r = n.r.map(m);
      const name = n.name || (M.label || n.type) + (rooms.filter((x) => x.type === n.type && !x.name).length > 1 ? ' ' + counts[n.type] : '');
      return { id: ids.get(n), type: n.type, name, zone: M.zone, floor: fl(n), rect: r, poly: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]],
        size: [m(W(n.r)), m(H(n.r))], area: Math.round(W(n.r) * H(n.r) / 100) / 100, target: n.type === 'hall' || n.type === 'garage' || n.type === 'stair' ? null : Math.round(n.e.area / 100) / 100,
        parent: n.e.of ? ids.get(rooms.find((x) => x.e === n.e.of)) || null : null };
    });
    // walls: one per pair of rooms one wall apart, then each room's outer faces
    const out = [];
    for (const wl of walls) {
      const k = wl.opening && wl.opening.kind === 'open' ? 'open' : 'interior';
      const rect = wl.o === 'h' ? [wl.s0, wl.c0, wl.s1, wl.c1] : [wl.c0, wl.s0, wl.c1, wl.s1];
      const mid = (wl.c0 + wl.c1) / 2;
      out.push({ id: 'w' + out.length, kind: k, floor: fl(wl.a), rooms: [ids.get(wl.a), ids.get(wl.b)], thickness: k === 'open' ? 0 : m(TI()), rect: rect.map(m),
        line: wl.o === 'h' ? [[m(wl.s0), m(mid)], [m(wl.s1), m(mid)]] : [[m(mid), m(wl.s0)], [m(mid), m(wl.s1)]] });
    }
    for (const n of rooms) for (const side of ['N', 'E', 'S', 'W']) {
      const hz = side === 'N' || side === 'S', c = side === 'N' ? n.r[1] : side === 'S' ? n.r[3] : side === 'W' ? n.r[0] : n.r[2];
      const s0 = hz ? n.r[0] : n.r[1], s1 = hz ? n.r[2] : n.r[3];
      // the parts of this side not on an interior wall
      const taken = walls.filter((wl) => (wl.a === n && wl.o === (hz ? 'h' : 'v') && (side === 'S' || side === 'E')) || (wl.b === n && wl.o === (hz ? 'h' : 'v') && (side === 'N' || side === 'W'))).map((wl) => [wl.s0, wl.s1]).sort((p, q) => p[0] - q[0]);
      let cur = s0;
      const seg = (a, b) => {
        if (b - a <= 0) return;
        const dir = side === 'N' ? [0, -1] : side === 'S' ? [0, 1] : side === 'W' ? [-1, 0] : [1, 0];
        const rect = hz ? [a, Math.min(c, c + dir[1] * TE()), b, Math.max(c, c + dir[1] * TE())] : [Math.min(c, c + dir[0] * TE()), a, Math.max(c, c + dir[0] * TE()), b];
        out.push({ id: 'w' + out.length, kind: 'exterior', floor: fl(n), rooms: [ids.get(n), null], thickness: m(TE()), out: dir, rect: rect.map(m),
          line: hz ? [[m(a), m(c)], [m(b), m(c)]] : [[m(c), m(a)], [m(c), m(b)]] });
      };
      for (const [a, b] of taken) { seg(cur, a); cur = Math.max(cur, b); }
      seg(cur, s1);
    }
    const ops = o.ops.map((op, k) => {
      const wl = op.wall, rect = wl.o === 'h' ? [op.s0, wl.c0, op.s1, wl.c1] : [wl.c0, op.s0, wl.c1, op.s1];
      return { id: 'o' + k, kind: op.kind, floor: fl(wl.a), rooms: [ids.get(wl.a), ids.get(wl.b)], width: m(op.s1 - op.s0), rect: rect.map(m), o: wl.o };
    }).concat(o.outside.map((x, k) => ({ id: 'x' + k, kind: x.kind, role: x.role, floor: fl(x.room), rooms: [ids.get(x.room), null], width: m(x.s1 - x.s0),
      rect: exitRect(x).map(m), o: x.side === 'N' || x.side === 'S' ? 'h' : 'v', side: x.side })));
    const verticals = (o.verticals || []).map((v, k) => ({ id: 'v' + k, kind: v.kind, rooms: v.rooms.map((n) => ids.get(n)), floors: v.rooms.map(fl), rect: v.rooms[0].r.map(m), up: v.up }));
    const edges = ops.map((x) => [x.rooms[0], x.rooms[1] || 'outside', x.kind, x.id]).concat(verticals.map((v) => [v.rooms[0], v.rooms[1], v.kind, v.id]));
    const house = {
      schema: SP.SCHEMA, recipe: o.recipe, name: o.name, seed: o.seed, site: { w: o.site.w, h: o.site.h }, units: 'm', front: 'S',
      thickness: { interior: m(TI()), exterior: m(TE()) },
      floors: floors.length, spaces, walls: out, openings: ops, verticals, levels,
      graph: { nodes: spaces.map((s) => s.id).concat('outside'), edges },
      meta: Object.assign({ pocketArea: levels.reduce((t, l) => t + l.pocketArea, 0) }, o.meta, { ms: Math.round(((typeof performance !== 'undefined' ? performance : Date).now() - o.t0) * 10) / 10 })
    };
    if (o.route) house.route = o.route.map((n) => ids.get(n));
    if (o.wrong) house.wrong = o.wrong;
    return house;
  }

  /**
   * Checks a generated house from its output alone (metres), apart from the
   * generator: the promises this system makes. Returns a list of problems,
   * empty when the house keeps them all.
   */
  SP.verify = function verify(h) {
    const bad = [], c = (v) => Math.round(v * 100), sp = h.spaces, rs = sp.map((s) => s.rect.map(c));
    const ti = c(h.thickness.interior), te = c(h.thickness.exterior), fl = (x) => x.floor || 0;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      if (fl(sp[i]) !== fl(sp[j])) continue;
      const A = rs[i], B = rs[j], ox = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), oy = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
      if (ox > 0 && oy > 0) bad.push(sp[i].name + ' overlaps ' + sp[j].name);
      const gap = ox > 0 ? Math.max(A[1], B[1]) - Math.min(A[3], B[3]) : oy > 0 ? Math.max(A[0], B[0]) - Math.min(A[2], B[2]) : null;
      if (gap !== null && gap >= 0 && gap !== ti && gap < 2 * te) bad.push(sp[i].name + ' and ' + sp[j].name + ' are ' + gap + ' cm apart');
    }
    // walls never take reserved floor
    for (const L of h.levels) for (const w of L.solids.walls.concat(L.solids.pockets)) {
      const W = w.map(c);
      rs.forEach((R, i) => { if (fl(sp[i]) === L.floor && Math.min(R[2], W[2]) > Math.max(R[0], W[0]) && Math.min(R[3], W[3]) > Math.max(R[1], W[1])) bad.push('a wall is on the floor of ' + sp[i].name); });
    }
    for (const w of h.walls) {
      const W = w.rect.map(c), across = w.kind === 'exterior' ? w.out[0] === 0 : w.line[0][1] === w.line[1][1], t = across ? W[3] - W[1] : W[2] - W[0];
      if (w.kind === 'interior' && t !== ti) bad.push('an interior wall is ' + t + ' cm thick');
      if (w.kind === 'exterior' && t !== te) bad.push('an outer wall is ' + t + ' cm thick');
    }
    // sizes
    for (let i = 0; i < sp.length; i++) {
      const M = SP.MODULES[sp[i].type], w = rs[i][2] - rs[i][0], d = rs[i][3] - rs[i][1];
      if (Math.min(w, d) < c(M.min)) bad.push(sp[i].name + ' is narrower than ' + M.min + ' m');
      if (Math.max(w, d) > Math.min(w, d) * M.asp + 1) bad.push(sp[i].name + ' is too long for its width');
      if (rs[i][0] < te || rs[i][1] < te || rs[i][2] > c(h.site.w) - te || rs[i][3] > c(h.site.h) - te) bad.push(sp[i].name + ' is off the lot');
    }
    // stairs: the same floor area on both floors
    const byId = new Map(sp.map((s) => [s.id, s]));
    for (const v of h.verticals || []) {
      const [a, b] = v.rooms.map((id) => byId.get(id));
      if (!a || !b || fl(b) !== fl(a) + 1 || a.rect.join() !== b.rect.join()) bad.push('a stairwell does not line up between floors');
    }
    // every room reached from the front door, inside the house
    const adj = new Map(sp.map((s) => [s.id, []]));
    for (const o of h.openings) if (o.rooms[1]) { adj.get(o.rooms[0]).push(o.rooms[1]); adj.get(o.rooms[1]).push(o.rooms[0]); }
    for (const v of h.verticals || []) { adj.get(v.rooms[0]).push(v.rooms[1]); adj.get(v.rooms[1]).push(v.rooms[0]); }
    const front = h.openings.find((o) => o.role === 'front door');
    if (!front) bad.push('no front door');
    else {
      const seen = new Set([front.rooms[0]]), st = [front.rooms[0]];
      while (st.length) for (const v of adj.get(st.pop())) if (!seen.has(v)) { seen.add(v); st.push(v); }
      for (const s of sp) if (!seen.has(s.id)) bad.push(s.name + ' cannot be reached from the front door');
    }
    // a route: front door to the exit through rooms you pass through; every
    // other room a dead end off one room of the route
    if (h.route) {
      const on = new Set(h.route), exit = h.openings.find((o) => o.role === 'exit');
      if (!front || front.rooms[0] !== h.route[0]) bad.push('the route does not start at the front door');
      if (!exit || exit.rooms[0] !== h.route[h.route.length - 1]) bad.push('the route does not end at the exit');
      for (let k = 1; k < h.route.length; k++) if (!adj.get(h.route[k - 1]).includes(h.route[k])) bad.push('the route breaks between ' + byId.get(h.route[k - 1]).name + ' and ' + byId.get(h.route[k]).name);
      for (const id of h.route) if (!SP.PASS.has(byId.get(id).type)) bad.push(byId.get(id).name + ' is on the route but is not a room you pass through');
      const done = new Set();
      for (const s of sp) {
        if (on.has(s.id) || done.has(s.id)) continue;
        const group = new Set([s.id]), st = [s.id], touch = new Set();
        while (st.length) for (const v of adj.get(st.pop())) { if (on.has(v)) touch.add(v); else if (!group.has(v)) { group.add(v); st.push(v); } }
        group.forEach((g) => done.add(g));
        if (touch.size > 1) bad.push(s.name + ' makes a way around the route');
      }
    }
    return bad;
  };

  /** the rooms a route may pass through */
  SP.PASS = new Set(['foyer', 'living', 'family', 'dining', 'kitchen', 'hall', 'stair', 'loft', 'mudroom']);

  SP._internal = { room, row, col, solve, fit, place, ext, range, pairs, compile, program, emit, exitRect, cm, m, snap, snapUp, snapDown, rr, hashStr, keyOf, shuffle, bboxOf, W, H, CFG };
})(typeof window !== 'undefined' ? window : globalThis);
