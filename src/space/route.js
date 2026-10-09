/*
 * space/route.js - walk-through houses for the reserved-floor generator
 * (space/space.js): the house is built along the way you walk through it.
 *
 * The outline of the house does not have to make sense; walking through it
 * does, like a ride through a set. So the house is a ROUTE of rooms you pass
 * through (foyer, living room, stairwell, hallway, ...), from the front door
 * to an exit into another part of the backrooms, with the ordinary rooms of a
 * home off its sides (kitchen, garage, bathrooms, bedrooms, closets). Side
 * rooms are dead ends: you step in and back out, they never make a way
 * around the route.
 *
 *   1. script    the recipe's route (recipes.js), one room type per step
 *   2. wrong     the wrongness dial changes the script, never the walls: a
 *                hallway far too long, a room twice in a row, stairs that go
 *                up twice, a room off the wrong room, a bedroom reached only
 *                through another bedroom
 *   3. route     each step is placed against the one before, through a
 *                wall one interior wall thick, on any side but the one you
 *                came in by. A stairwell is a step to the floor above: its
 *                floor is reserved on both floors. The last step gets the
 *                exit, with clear space outside it
 *   4. sides     each side room is placed off the room it belongs with
 *                (HOSTS), on the ground floor or upstairs as fits
 *   5. doors     one between each two steps of the route, one into each side
 *                room, the front door, the exit, the garage door
 *   6. walls     the same single wall builder as every other plan
 *
 * Every placement keeps the system's rules: rooms at their own sizes, one
 * interior wall apart or two outer walls apart, never in between.
 */
(function (root) {
  'use strict';
  const BR = root.BR, SP = BR.SPACE, I = SP._internal;
  const { CFG, cm, snap, rr, hashStr, keyOf, shuffle, bboxOf, W, H, pairs, emit } = I;
  const TI = () => CFG.interior, TE = () => CFG.exterior;
  const INF = 1e9;
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };

  // the rooms each kind of side room opens off, best first
  SP.HOSTS = {
    kitchen: ['living', 'family', 'dining', 'foyer', 'hall'], dining: ['kitchen', 'living', 'family', 'loft'],
    pantry: ['kitchen'], laundry: ['kitchen', 'mudroom', 'hall'], mudroom: ['kitchen', 'foyer'], utility: ['laundry', 'kitchen', 'hall'],
    garage: ['mudroom', 'laundry', 'kitchen', 'foyer'], powder: ['foyer', 'hall', 'living'], office: ['foyer', 'living', 'hall', 'loft'],
    family: ['kitchen', 'living'], living: ['foyer', 'hall'],
    master: ['hall', 'loft'], bedroom: ['hall', 'loft'], bath: ['hall', 'loft'], linen: ['hall']
  };
  // where a room should never open off: the wrongness dial picks from these
  const WRONG_HOST = { kitchen: ['hall', 'loft'], bath: ['living', 'kitchen', 'foyer'], bedroom: ['kitchen', 'living', 'foyer'], master: ['kitchen', 'foyer'], dining: ['hall'], laundry: ['living', 'loft'] };
  // these stay on the ground floor; these go upstairs when there is one
  const GROUND = new Set(['kitchen', 'dining', 'pantry', 'laundry', 'mudroom', 'utility', 'garage', 'powder', 'office', 'family']);
  const UP = new Set(['master', 'bedroom', 'bath', 'linen']);
  // side rooms in the order they are placed: the ones a home must have first
  const ORDER = ['kitchen', 'master', 'bedroom', 'bath', 'dining', 'mudroom', 'laundry', 'garage', 'pantry', 'utility', 'powder', 'office', 'family', 'living', 'ensuite', 'wic', 'closet', 'linen'];
  const REQUIRED = new Set(['kitchen', 'master', 'bath']);
  // rooms that may get a short hallway of their own when the route has no room for them
  const BRANCH = new Set(['master', 'bedroom', 'bath', 'office', 'linen', 'powder']);
  const STAIR = [130, 410];
  const NOUN = { living: 'living room', dining: 'dining room', family: 'family room' };
  const label = (t) => NOUN[t] || SP.MODULES[t].label || t;

  // ------------------------------------------------------------- program
  function count(spec, rng) {
    if (!spec) return 0;
    if (spec.p !== undefined && rng.f() >= spec.p) return 0;
    if (spec.n === undefined) return 1;
    return Array.isArray(spec.n) ? rng.int(spec.n[0], spec.n[1]) : spec.n;
  }
  const area = (R, t, rng) => Math.round(Math.max(rr(rng, (R.rooms[t] && R.rooms[t].area) || SP.MODULES[t].area), SP.MODULES[t].min ** 2) * 1e4);

  /** the route, the side rooms and what is wrong, all from the seed */
  function program(R, rng, wrongness) {
    const Q = R.route, path = [], sides = [], wrong = [];
    for (const step of Q.script) {
      const t = Array.isArray(step) ? rng.pick(step) : step;
      path.push({ type: t, len: t === 'hall' ? snap(cm(rr(rng, Q.hallLen))) : 0, area: t === 'hall' || t === 'stair' ? 0 : area(R, t, rng) });
    }
    // ---- the wrongness dial, on the script
    const w = Math.max(0, Math.min(1, wrongness));
    const halls = path.filter((s) => s.type === 'hall');
    if (halls.length && rng.f() < w * 0.8) { const s = rng.pick(halls); s.len = snap(cm(rng.range(9, 14))); s.wrong = 'long'; }
    const again = path.filter((s, k) => k > 0 && ['living', 'family', 'loft', 'kitchen', 'dining'].includes(s.type));
    if (again.length && rng.f() < w * 0.5) { const s = rng.pick(again); path.splice(path.indexOf(s) + 1, 0, { type: s.type, len: 0, area: s.area, wrong: 'again' }); }
    const st = path.findIndex((s) => s.type === 'stair');
    if (st >= 0 && rng.f() < w * 0.35) path.splice(st + 1, 0, { type: 'stair', len: 0, area: 0, wrong: 'up twice' });
    // ---- side rooms: every room of the recipe not already on the route
    const onPath = new Set(path.map((s) => s.type));
    for (const t of ORDER) {
      if (onPath.has(t) || ['ensuite', 'wic', 'closet', 'linen'].includes(t) && t !== 'linen') continue;
      if (t === 'garage') {
        const g = R.garage;
        if (g && rng.f() < (g.p === undefined ? 1 : g.p)) {
          const cars = rng.int(g.cars[0], g.cars[1]);
          sides.push({ type: 'garage', area: 0, w: cars >= 2 ? snap(rng.range(560, 640)) : snap(rng.range(320, 380)), d: snap(rng.range(580, 660)), door: cars >= 2 ? 480 : 250 });
        }
        continue;
      }
      const spec = R.rooms[t], n = count(spec, rng);
      for (let k = 0; k < n; k++) {
        const e = { type: t, area: area(R, t, rng) };
        sides.push(e);
        if (t === 'master') {
          if (rng.f() < (spec.ensuite || 0)) sides.push({ type: 'ensuite', area: Math.round(rng.range(4, 6) * 1e4), of: e });
          if (rng.f() < (spec.wic || 0)) sides.push({ type: 'wic', area: Math.round(rng.range(3, 4.5) * 1e4), of: e });
        }
        if (t === 'bedroom' && R.rooms.closet && rng.f() < (R.rooms.closet.p || 0)) sides.push({ type: 'closet', area: area(R, 'closet', rng), of: e });
      }
    }
    // the dial, on the side rooms
    const misplace = sides.filter((e) => WRONG_HOST[e.type]);
    if (misplace.length && rng.f() < w * 0.6) { const e = rng.pick(misplace); e.hosts = WRONG_HOST[e.type]; e.wrong = 'misplaced'; }
    const beds = sides.filter((e) => e.type === 'bedroom' && !e.wrong);
    if (beds.length >= 2 && rng.f() < w * 0.4) { beds[1].through = beds[0]; beds[1].wrong = 'through'; }
    return { path, sides, hall: snap(cm(rr(rng, R.hall || [1.1, 1.3]))), openPlan: rng.f() < (R.openPlan || 0), wrongness: w };
  }

  // ------------------------------------------------------------- placing
  /** the shapes a room may take (x size, y size, cm), a few near its target */
  function shapes(e, rng, P) {
    if (e.type === 'hall') return [[P.hall, e.len], [e.len, P.hall]];
    if (e.type === 'stair') return [STAIR, [STAIR[1], STAIR[0]]];
    if (e.type === 'garage') return [[e.w, e.d], [e.d, e.w]];
    const M = SP.MODULES[e.type], mn = cm(M.min), out = [];
    for (let k = 0; k < 2; k++) {
      const r = rng.range(1, Math.min(M.asp, 1.7));
      let long = Math.max(mn, snap(Math.sqrt(e.area * r))), short = Math.max(mn, snap(e.area / long));
      if (long < short) [long, short] = [short, long];
      if (long > short * M.asp) long = Math.floor(short * M.asp / CFG.step) * CFG.step;
      out.push([long, short], [short, long]);
    }
    return out;
  }
  function rectOn(face, h, a, L, D) {
    if (face === 'S') return [a, h[3] + TI(), a + L, h[3] + TI() + D];
    if (face === 'N') return [a, h[1] - TI() - D, a + L, h[1] - TI()];
    if (face === 'E') return [h[2] + TI(), a, h[2] + TI() + D, a + L];
    return [h[0] - TI() - D, a, h[0] - TI(), a + L];
  }
  /** room rect r on a floor: no overlap, and one wall or two outer walls from every room it faces */
  function fits(r, here, keep) {
    let touch = 0;
    for (const o of here) {
      const q = o.r, ox = Math.min(r[2], q[2]) - Math.max(r[0], q[0]), oy = Math.min(r[3], q[3]) - Math.max(r[1], q[1]);
      if (ox > 0 && oy > 0) return -1;
      for (const [ov, gap] of [[ox, Math.max(r[1], q[1]) - Math.min(r[3], q[3])], [oy, Math.max(r[0], q[0]) - Math.min(r[2], q[2])]]) {
        if (ov <= 0) continue;
        if (gap === TI()) touch += ov >= 60 ? 1 : 0;
        else if (gap < 2 * TE()) return -1;
      }
    }
    for (const q of keep) if (Math.min(r[2], q[2]) > Math.max(r[0], q[0]) && Math.min(r[3], q[3]) > Math.max(r[1], q[1])) return -1;
    return touch;
  }
  /**
   * Room e against host h, through a wall on one of faces. need: how much
   * of the wall the two must share. window(face, s0, s1): where on the
   * host's face the shared part may be. along: the room's short side along
   * the face (hallways and stairs run away from the room before them).
   * clear: depth of clear outside space the room needs on its far side.
   */
  function attach(e, h, ctx, o) {
    const here = ctx.rooms.filter((n) => n.floor === h.floor), keep = ctx.keep[h.floor] || [];
    let best = null;
    for (const face of o.faces) {
      const hz = face === 'N' || face === 'S', p0 = hz ? h.r[0] : h.r[1], p1 = hz ? h.r[2] : h.r[3];
      // where along the face: flush with the host's ends, centred, or in line with a neighbour
      const edges = [];
      for (const n of here) if (Math.max(n.r[0] - h.r[2], h.r[0] - n.r[2], n.r[1] - h.r[3], h.r[1] - n.r[3]) < 600) edges.push(hz ? n.r[0] : n.r[1], hz ? n.r[2] : n.r[3]);
      for (const [w, d] of o.shapes) {
        const L = hz ? w : d, D = hz ? d : w;
        if (o.along && L > D) continue;
        const at = new Set([p0, p1 - L, snap((p0 + p1 - L) / 2), p0 - L + o.need, p1 - o.need]);
        for (const x of edges) for (const v of [x, x - L, x + TI(), x - TI() - L]) at.add(v);
        for (let k = 0; k < 3; k++) at.add(snap(p0 - L + o.need + ctx.rng.f() * (p1 - p0 + L - 2 * o.need)));
        for (const a of at) {
          const s0 = Math.max(a, p0), s1 = Math.min(a + L, p1);
          if (s1 - s0 < o.need || (o.window && !o.window(face, s0, s1))) continue;
          const r = rectOn(face, h.r, a, L, D);
          const t = fits(r, here, keep);
          if (t < 0) continue;
          let far = null;
          if (o.clear) { far = clearOut(r, face, o.clear, here, keep); if (!far) continue; }
          const sc = t + ctx.rng.f() * 1.5;
          if (!best || sc > best.sc) best = { sc, r, face, far };
        }
      }
    }
    return best;
  }
  /** the strip of clear ground outside room r on side, depth deep, or null */
  function clearOut(r, side, deep, here, keep) {
    const q = side === 'S' ? [r[0] - 60, r[3], r[2] + 60, r[3] + deep] : side === 'N' ? [r[0] - 60, r[1] - deep, r[2] + 60, r[1]]
      : side === 'E' ? [r[2], r[1] - 60, r[2] + deep, r[3] + 60] : [r[0] - deep, r[1] - 60, r[0], r[3] + 60];
    for (const n of here) if (Math.min(q[2], n.r[2]) > Math.max(q[0], n.r[0]) && Math.min(q[3], n.r[3]) > Math.max(q[1], n.r[1])) return null;
    for (const k of keep) if (Math.min(q[2], k[2]) > Math.max(q[0], k[0]) && Math.min(q[3], k[3]) > Math.max(q[1], k[1])) return null;
    return { side, rect: q };
  }
  function node(e, r, floor, role) { return { type: e.type, e: Object.assign({}, e, { area: e.area || W(r) * H(r), src: e }), r, floor, role }; }
  /** a door in the outer wall: on side of room n, w wide, away from the corners */
  function outDoor(n, side, w, kind, role, rng, edge = 30) {
    const hz = side === 'N' || side === 'S', a = hz ? n.r[0] : n.r[1], b = hz ? n.r[2] : n.r[3];
    if (b - a < w + 2 * edge) return null;
    const s0 = snap(a + edge + rng.f() * (b - a - w - 2 * edge));
    return { kind, role, room: n, side, s0, s1: s0 + w, c: side === 'S' ? n.r[3] : side === 'N' ? n.r[1] : side === 'E' ? n.r[2] : n.r[0] };
  }

  /** one candidate house, or { fail } */
  function build(P, rng) {
    const ctx = { rooms: [], keep: {}, rng, links: [], outside: [], verticals: [], route: [], notes: [] };
    const keepOn = (f, q) => (ctx.keep[f] = ctx.keep[f] || []).push(q);
    // ---- the front door and the foyer
    const first = P.path[0], fs = shapes(first, rng, P)[0];
    const foyer = node(first, [0, 0, fs[0], fs[1]], 0, 'path');
    foyer.entry = 'S';
    ctx.rooms.push(foyer); ctx.route.push(foyer);
    const front = outDoor(foyer, 'S', 100, 'entrance', 'front door', rng);
    if (!front) return { fail: 'front door' };
    ctx.outside.push(front);
    keepOn(0, [foyer.r[0] - 100, foyer.r[3], foyer.r[2] + 100, foyer.r[3] + 500]);
    // ---- the route, one step against the last
    let prev = foyer, floor = 0;
    for (let k = 1; k < P.path.length; k++) {
      const e = P.path[k], need = e.type === 'hall' ? P.hall : 100 + 2 * CFG.margin;
      let faces = shuffle(['N', 'E', 'S', 'W'].filter((f) => f !== prev.entry), rng), window = null;
      if (prev.type === 'hall' || prev.type === 'stair') {
        // on along it: off its far end, or off a long side near the far end
        const far = OPP[prev.entry], hz = far === 'N' || far === 'S', len = hz ? H(prev.r) : W(prev.r);
        const reach = Math.max(need, len * 0.45);
        faces = prev.type === 'stair' ? [far] : [far].concat(faces.filter((f) => f !== far));
        window = (face, s0, s1) => {
          if (face === far) return true;
          const end = far === 'S' ? prev.r[3] : far === 'N' ? prev.r[1] : far === 'E' ? prev.r[2] : prev.r[0];
          return far === 'S' || far === 'E' ? s0 >= end - reach : s1 <= end + reach;
        };
      }
      // the last step keeps clear ground beyond it for the exit
      const lastStep = k === P.path.length - 1 && e.type !== 'stair';
      const got = attach(e, prev, ctx, { faces, need, window, shapes: shapes(e, rng, P), along: e.type === 'hall' || e.type === 'stair', clear: lastStep ? 260 : 0 });
      if (!got) return { fail: 'route: ' + e.type };
      const n = node(e, got.r, floor, 'path');
      n.entry = OPP[got.face];
      if (lastStep) n.exitSide = got.far.side;
      if (e.wrong) n.wrong = e.wrong;
      ctx.rooms.push(n); ctx.route.push(n);
      ctx.links.push({ a: prev, b: n, path: true });
      prev = n;
      if (e.type === 'stair') {
        // the same stairwell on the floor above, its head at the far end
        floor++;
        const up = node(e, n.r.slice(), floor, 'path');
        up.entry = n.entry; up.name = 'stairwell (top)';
        ctx.rooms.push(up); ctx.route.push(up);
        ctx.verticals.push({ kind: 'stair', rooms: [n, up], up: OPP[n.entry] });
        prev = up;
      }
    }
    // ---- the exit: off the last room, clear ground outside it
    const last = prev;
    let exit = null;
    const exitFaces = last.exitSide ? [last.exitSide] : last.type === 'hall' ? [OPP[last.entry]].concat(shuffle(['N', 'E', 'S', 'W'].filter((f) => f !== last.entry && f !== OPP[last.entry]), rng)) : shuffle(['N', 'E', 'S', 'W'].filter((f) => f !== last.entry), rng);
    for (const side of exitFaces) {
      const here = ctx.rooms.filter((n) => n.floor === last.floor && n !== last), c = clearOut(last.r, side, 250, here, ctx.keep[last.floor] || []);
      if (!c) continue;
      const ew = Math.floor(Math.min(110, (side === 'N' || side === 'S' ? W(last.r) : H(last.r)) - 2 * CFG.margin) / CFG.step) * CFG.step;
      exit = ew >= 80 ? outDoor(last, side, ew, 'portal', 'exit', rng, CFG.margin) : null;
      if (exit) { keepOn(last.floor, c.rect); break; }
    }
    if (!exit) return { fail: 'exit' };
    ctx.outside.push(exit);
    // ---- side rooms, each off a room it belongs with
    const floors = floor + 1, missing = [];
    for (const e of P.sides) {
      let hosts;
      if (e.of) hosts = ctx.rooms.filter((n) => n.e === e.of || n.e.src === e.of);
      else if (e.through) hosts = ctx.rooms.filter((n) => n.e.src === e.through);
      else {
        const list = e.hosts || SP.HOSTS[e.type] || ['hall'];
        hosts = ctx.rooms.filter((n) => list.includes(n.type) && n.type !== 'stair')
          .filter((n) => e.wrong === 'misplaced' || !GROUND.has(e.type) || n.floor === 0)
          .sort((p, q) => (UP.has(e.type) && floors > 1 ? q.floor - p.floor : p.floor - q.floor) || list.indexOf(p.type) - list.indexOf(q.type) || (p.role === 'path' ? -1 : 1));
        if (e.type === 'garage') hosts = hosts.filter((n) => n.floor === 0);
      }
      const door = e.type === 'garage' ? 90 : ['bath', 'ensuite', 'closet', 'powder', 'linen', 'pantry', 'wic'].includes(e.type) ? 80 : 90;
      const need = (e.type === 'linen' ? 60 : door) + 2 * CFG.margin;
      let placed = null, host = null;
      for (const h of hosts) {
        const got = attach(e, h, ctx, { faces: shuffle(['N', 'E', 'S', 'W'], rng), need, shapes: shapes(e, rng, P), clear: e.type === 'garage' ? 450 : 0 });
        if (got) { placed = got; host = h; break; }
      }
      if (!placed && BRANCH.has(e.type) && !e.of && !e.through && e.wrong !== 'misplaced') {
        // no room left along the way: a short hallway branches off it, a dead end with the room off it
        const from = ctx.rooms.filter((n) => ['hall', 'loft', 'living', 'family', 'foyer'].includes(n.type) && (e.wrong === 'misplaced' || !GROUND.has(e.type) || n.floor === 0))
          .sort((p, q) => (UP.has(e.type) && floors > 1 ? q.floor - p.floor : p.floor - q.floor) || (p.type === 'hall' ? -1 : 1));
        for (const h of from.slice(0, 6)) {
          const he = { type: 'hall', len: snap(cm(rng.range(2.4, 4))), area: 0 };
          const gh = attach(he, h, ctx, { faces: shuffle(['N', 'E', 'S', 'W'], rng), need: P.hall, shapes: shapes(he, rng, P), along: true });
          if (!gh) continue;
          const hn = node(he, gh.r, h.floor, 'side');
          hn.entry = OPP[gh.face]; hn.host = h;
          ctx.rooms.push(hn);
          const got = attach(e, hn, ctx, { faces: shuffle(['N', 'E', 'S', 'W'].filter((f) => f !== hn.entry), rng), need, shapes: shapes(e, rng, P) });
          if (got) { ctx.links.push({ a: h, b: hn, path: false }); placed = got; host = hn; break; }
          ctx.rooms.pop();
        }
      }
      if (!placed) {
        if (e.wrong === 'misplaced') { delete e.wrong; e.hosts = null; P.sides.splice(P.sides.indexOf(e) + 1, 0, Object.assign({}, e, { wrong: undefined })); continue; }
        if (REQUIRED.has(e.type) || (e.type === 'bedroom' && !ctx.rooms.some((n) => n.type === 'bedroom'))) return { fail: 'side: ' + e.type };
        missing.push(e.type);
        continue;
      }
      const n = node(e, placed.r, host.floor, 'side');
      n.host = host; n.entry = OPP[placed.face];
      if (e.wrong) n.wrong = e.wrong;
      ctx.rooms.push(n);
      ctx.links.push({ a: host, b: n, path: false });
      if (e.type === 'garage') {
        const d = outDoor(n, placed.far.side, Math.min(e.door, (placed.far.side === 'N' || placed.far.side === 'S' ? W(n.r) : H(n.r)) - 60), 'vehicle', 'garage door', rng);
        if (!d) return { fail: 'garage door' };
        ctx.outside.push(d); keepOn(0, placed.far.rect);
      }
    }
    // ---- doors: from the walls between the rooms, floor by floor
    const why = {}, walls = [], ops = [];
    for (let f = 0; f < floors; f++) {
      const here = ctx.rooms.filter((n) => n.floor === f), ws = pairs(here, why);
      if (!ws) return { fail: 'gap' };
      walls.push(...ws);
    }
    const M = CFG.margin;
    for (const l of ctx.links) {
      const wl = walls.find((x) => (x.a === l.a && x.b === l.b) || (x.a === l.b && x.b === l.a));
      if (!wl || wl.opening) return { fail: 'door: ' + l.a.type + '-' + l.b.type + (wl ? ' twice' : ' no wall') };
      const ov = wl.s1 - wl.s0, L = SP.LINKS[keyOf(l.a.type, l.b.type)];
      let kind, w;
      if (l.b.type === 'garage') { kind = 'door'; w = 90; }
      else if (l.a.type === 'hall' && l.b.type === 'hall') { kind = 'opening'; w = ov - 2 * M; }
      else if (L && L.kind === 'hall' || (l.path && (l.a.type === 'hall' || l.b.type === 'hall' || l.a.type === 'stair' || l.b.type === 'stair'))) { kind = 'opening'; w = Math.min(ov - 2 * M, Math.max(P.hall, 100)); }
      else if (L && L.kind === 'plan' && P.openPlan) { kind = 'open'; w = ov; }
      else if (L && L.kind === 'door') { kind = 'door'; w = cm(L.w); }
      else if (L) { kind = 'opening'; w = Math.min(snap(cm(rr(rng, L.w))), ov - 2 * M); }
      else if (l.path) { kind = 'opening'; w = Math.min(120, ov - 2 * M); }
      else { kind = 'door'; w = ['bath', 'ensuite', 'closet', 'powder', 'pantry', 'wic'].includes(l.b.type) ? 80 : l.b.type === 'linen' ? 60 : 90; }
      w = Math.floor(w / CFG.step) * CFG.step;
      if (kind !== 'open' && (w < 60 || w + 2 * M > ov)) return { fail: 'door: ' + l.a.type + '-' + l.b.type + ' ' + w + '/' + ov };
      const s0 = kind === 'open' ? wl.s0 : snap(wl.s0 + M + rng.f() * (ov - w - 2 * M));
      const op = { kind, wall: wl, s0, s1: kind === 'open' ? wl.s1 : s0 + w };
      wl.opening = op; ops.push(op);
    }
    return { rooms: ctx.rooms, walls, ops, outside: ctx.outside, verticals: ctx.verticals, route: ctx.route, missing, floors };
  }

  // ------------------------------------------------------------- what is off
  function notes(b) {
    const out = [], fname = (f) => (b.floors === 1 ? '' : f === 0 ? 'ground-floor ' : f === 1 ? 'upstairs ' : 'top-floor ');
    for (const n of b.rooms) {
      if (n.wrong === 'long') out.push('the ' + fname(n.floor) + 'hallway runs ' + (Math.max(W(n.r), H(n.r)) / 100).toFixed(1) + ' m');
      if (n.wrong === 'again') out.push('a second ' + label(n.type) + ' straight after the first');
      if (n.wrong === 'up twice') out.push('the stairs go up two floors');
      if (n.wrong === 'misplaced') out.push('the ' + label(n.type) + ' opens off the ' + fname(n.host.floor) + label(n.host.type));
      if (n.wrong === 'through') out.push('one bedroom is reached only through another');
    }
    return out;
  }

  function score(b) {
    const t = {}, real = b.rooms.filter((n) => !['hall', 'stair', 'garage'].includes(n.type));
    t.sizes = Math.round((real.reduce((s, n) => s + Math.abs(W(n.r) * H(n.r) - n.e.area) / n.e.area, 0) / Math.max(1, real.length)) * 30 * 10) / 10;
    t.missing = b.missing.length * 4;
    let c = 0;
    for (let f = 0; f < b.floors; f++) {
      const here = b.rooms.filter((n) => n.floor === f), bb = bboxOf(here), a = here.reduce((s, n) => s + W(n.r) * H(n.r), 0);
      c += 1 - a / (W(bb) * H(bb));
    }
    t.compact = Math.round((c / b.floors) * 10 * 10) / 10;
    return t;
  }

  // ------------------------------------------------------------- generate
  SP.ROUTE_CANDIDATES = 20;
  SP.generateRoute = function generateRoute(spec, t0) {
    const R = SP.RECIPES[spec.recipe], seed = spec.seed >>> 0, salt = hashStr(spec.recipe);
    const wrongness = spec.wrong !== undefined ? spec.wrong : R.route.wrong || 0;
    const why = {};
    let best = null, tried = 0;
    for (let k = 0; k < SP.ROUTE_CANDIDATES; k++) {
      const P = program(R, new BR.Rng(BR.hash4(seed, salt, 0x70a7, 2)), wrongness);
      const rng = new BR.Rng(BR.hash4(seed, salt, 0x70a7, 100 + k));
      const b = build(P, rng);
      tried++;
      if (b.fail) { why[b.fail] = (why[b.fail] || 0) + 1; continue; }
      const terms = score(b), pen = Object.values(terms).reduce((s, v) => s + v, 0);
      if (!best || pen < best.pen) best = Object.assign(b, { terms, pen, P });
    }
    if (!best) return { schema: SP.SCHEMA, error: 'no valid layout', recipe: spec.recipe, seed, why, tried };
    // the lot: around the house and the clear ground at its doors, the street below
    const b = best, bb = bboxOf(b.rooms);
    const pad = 200, dx = pad - bb[0], dy = pad - bb[1];
    for (const n of b.rooms) if (!b.verticals.some((v) => v.rooms[1] === n)) n.r = [n.r[0] + dx, n.r[1] + dy, n.r[2] + dx, n.r[3] + dy];
    for (const v of b.verticals) v.rooms[1].r = v.rooms[0].r.slice();
    for (const wl of b.walls) { const sh = wl.o === 'h' ? [dx, dy] : [dy, dx]; wl.s0 += sh[0]; wl.s1 += sh[0]; wl.c0 += sh[1]; wl.c1 += sh[1]; }
    for (const op of b.ops) { const sh = op.wall.o === 'h' ? dx : dy; if (op.kind === 'open') { op.s0 = op.wall.s0; op.s1 = op.wall.s1; } else { op.s0 += sh; op.s1 += sh; } }
    for (const o of b.outside) { const hz = o.side === 'N' || o.side === 'S'; o.s0 += hz ? dx : dy; o.s1 += hz ? dx : dy; o.c += hz ? dy : dx; }
    const site = { w: Math.ceil((W(bb) + 2 * pad) / 50) / 2, h: Math.ceil((H(bb) + 2 * pad + 200) / 50) / 2 };
    const wrong = notes(b);
    return emit({ recipe: spec.recipe, name: R.name, seed, site, rooms: b.rooms, walls: b.walls, ops: b.ops, outside: b.outside, verticals: b.verticals, route: b.route, wrong,
      meta: { plan: 'route', score: Math.round((100 - b.pen) * 10) / 10, terms: b.terms, wrongness, missing: b.missing, openPlan: b.P.openPlan, candidates: tried, why }, t0 });
  };
})(typeof window !== 'undefined' ? window : globalThis);
