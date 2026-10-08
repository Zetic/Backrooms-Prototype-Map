/*
 * tpl/house.js - the House engine (blueprints).
 *
 * Architectural logic, in order:
 *   program   rooms + target sizes from the archetype (public / private /
 *             service zones), garage, open plan or not
 *   plan type how the zones sit in the site (bottom = the main side):
 *               bar    [garage][public][private] in one bar
 *               T      a bar whose public zone runs deeper
 *               L      public bar, private wing going back
 *               deep   public in front, private behind (narrow sites)
 *               split  [master suite][public][bedrooms]
 *               stack  two or three storeys over one footprint: public
 *                      rooms below, bedrooms above, a stair core up one
 *                      side (archetype.storeys)
 *   public    recursive slicing: entry-facing rooms (foyer, living) toward
 *             the main side, service rooms (mudroom, laundry, kitchen)
 *             toward the garage
 *   private   a hallway from the public zone with bedrooms / baths either
 *             side, the master suite capping the end (ensuite + walk-in
 *             closet), reach-in closets carved beside bedroom doors
 *   portals   front door (main entrance), garage door (vehicle), back exit,
 *             sometimes a side exit - all onto the surrounding backrooms
 *
 * Houses are buried in the backrooms: there is no yard, porch or drive, and
 * the site is used almost to its edge. Rooms carry types and tags only; a
 * later tool furnishes them.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL;
  const U = (m) => Math.round(m / TG.GRID);
  const A2 = (m2) => Math.round(m2 / (TG.GRID * TG.GRID));
  const rr = (rng, r) => (Array.isArray(r) ? rng.range(r[0], r[1]) : r);
  /** count a layout failure reason (shown in the workbench) */
  const why = (ctx, k) => { if (ctx.why) ctx.why[k] = (ctx.why[k] || 0) + 1; return null; };

  // ------------------------------------------------------------ room types
  // What each room is comes from the shared catalogue (tpl/catalogue.js);
  // what follows is only how rooms behave in a house: privacy (doors swing
  // into the more private room), the window each wants to the outside, and
  // that a closet in a house is a private, narrow, slightly taller one.
  // minW / maxAsp in units of the largest rect; win: window rule (units).
  const T = TPL.CAT.types(['foyer', 'living', 'family', 'dining', 'kitchen', 'office', 'bedroom', 'master', 'bath', 'ensuite', 'closet', 'wic', 'linen', 'hall', 'laundry', 'mudroom', 'pantry', 'utility', 'garage', 'stairwell'], {
    foyer: { privacy: 1 },
    living: { privacy: 1, win: { w: [3, 5], every: 9, max: 3, need: 1 } },
    family: { privacy: 1, win: { w: [3, 4], every: 9, max: 2, need: 1 } },
    dining: { privacy: 1, win: { w: [2, 4], every: 8, max: 2 } },
    kitchen: { privacy: 2, win: { w: [2, 3], every: 10, max: 1, sill: 1.05 } },
    office: { privacy: 4, win: { w: [2, 3], every: 8, max: 1, need: 1 } },
    bedroom: { privacy: 5, win: { w: [2, 3], every: 8, max: 2, need: 2 } },
    master: { privacy: 5, win: { w: [2, 4], every: 8, max: 2, need: 2 } },
    bath: { privacy: 6, win: { w: [1, 2], every: 12, max: 1, sill: 1.5 } },
    ensuite: { privacy: 7, win: { w: [1, 2], every: 12, max: 1, sill: 1.5 } },
    closet: { privacy: 8, zone: 'private', maxAsp: 8, ceil: [2.3, 2.4] },
    wic: { privacy: 8 },
    linen: { privacy: 8 },
    hall: { privacy: 0, win: { w: [2, 2], every: 99, max: 1 } },
    laundry: { privacy: 3, win: { w: [1, 2], every: 12, max: 1, sill: 1.2 } },
    mudroom: { privacy: 2 },
    pantry: { privacy: 6 },
    utility: { privacy: 4 },
    garage: { privacy: 2, win: { w: [2, 2], every: 16, max: 1, sill: 1.2 } },
    stairwell: { privacy: 0 }
  });
  const ORDER = ['foyer', 'living', 'family', 'dining', 'kitchen', 'pantry', 'laundry', 'mudroom', 'office', 'master', 'bedroom', 'bath', 'linen'];
  // slicing keys: toward the street / toward the service (garage) side
  const FRONT = { foyer: 3, living: 2, office: 1.2, dining: 1, family: 0.8, kitchen: 0.3, mudroom: 0.2, pantry: 0, laundry: -0.5, utility: -1 };
  const SVC = { mudroom: 3, laundry: 2.6, utility: 2.5, pantry: 2, kitchen: 1.6, dining: 0.8, family: 0.5, foyer: 0.3, office: 0.1, living: 0 };

  // ------------------------------------------------------------- program
  function count(spec, rng) {
    if (!spec) return 0;
    if (spec.p !== undefined && rng.f() >= spec.p) return 0;
    if (spec.n === undefined) return 1;
    if (Array.isArray(spec.n)) return rng.int(spec.n[0], spec.n[1]);
    return spec.n;
  }
  function program(arch, rng, ctx) {
    const R = arch.rooms || {}, P = { rooms: [] };
    for (const type of ORDER) {
      const spec = R[type];
      const n = count(spec, rng);
      for (let k = 0; k < n; k++) {
        const e = { type, area: A2(rr(rng, (spec && spec.area) || T[type].area)) };
        if (type === 'master') {
          e.ensuite = rng.f() < ((spec && spec.ensuite) || 0);
          e.wic = rng.f() < ((spec && spec.wic) || 0);
          e.ensuiteArea = A2(rng.range(4, 6.5)); e.wicArea = A2(rng.range(3, 5));
        }
        P.rooms.push(e);
      }
    }
    if (!P.rooms.some((e) => e.type === 'living')) P.rooms.unshift({ type: 'living', area: A2(18) });
    if (!P.rooms.some((e) => e.type === 'kitchen')) P.rooms.push({ type: 'kitchen', area: A2(10) });
    if (!P.rooms.some((e) => e.type === 'bath')) P.rooms.push({ type: 'bath', area: A2(5) });
    const g = arch.garage;
    P.garage = g && rng.f() < (g.p === undefined ? 1 : g.p) ? { cars: rng.int(g.cars[0], g.cars[1]), fwd: U(rr(rng, g.forward || 0)) } : null;
    P.openPlan = rng.f() < (arch.openPlan || 0);
    P.hallW = U(rr(rng, (arch.hall && arch.hall.w) || [1, 1.2]));
    P.closets = arch.closets === undefined ? 0.6 : arch.closets;
    P.backDoor = arch.backDoor === undefined ? 0.6 : arch.backDoor;
    P.sideDoor = arch.sideDoor === undefined ? 0.25 : arch.sideDoor;
    P.storeys = arch.storeys ? (Array.isArray(arch.storeys) ? rng.int(arch.storeys[0], arch.storeys[1]) : arch.storeys) : 1;
    // program-stage wrongness
    if (ctx.mut.has('twin')) {
      const pick = rng.pick(P.rooms.filter((e) => ['kitchen', 'bath', 'living', 'dining'].indexOf(e.type) >= 0));
      if (pick) P.rooms.push(Object.assign({}, pick, { tags: ['wrong:twin'] }));
    }
    if (ctx.mut.has('giant')) {
      const pick = rng.pick(P.rooms.filter((e) => ['living', 'kitchen', 'bath', 'bedroom', 'dining'].indexOf(e.type) >= 0));
      if (pick) { pick.area = Math.round(pick.area * rng.range(2.2, 3)); pick.tags = ['wrong:giant']; }
    }
    if (ctx.mut.has('endless')) {
      const n = rng.int(3, 5);
      for (let k = 0; k < n; k++) P.rooms.push({ type: k % 3 === 2 ? 'linen' : 'bedroom', area: A2(k % 3 === 2 ? 1.5 : rng.range(7.5, 9)), tags: ['wrong:endless'] });
    }
    P.summary = P.rooms.map((e) => e.type + ' ' + (e.area * TG.GRID * TG.GRID).toFixed(1) + ' m²' + (e.ensuite ? ' +ensuite' : '') + (e.wic ? ' +wic' : ''))
      .concat(P.garage ? [P.garage.cars + '-car garage'] : [], P.openPlan ? ['open plan'] : []);
    return P;
  }

  // ------------------------------------------------------------- helpers
  /** Shared boundary length between two rect lists. */
  function touch(A, B) {
    let n = 0;
    for (const a of A) for (const b of B) {
      if (a[2] === b[0] || b[2] === a[0]) n += Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
      if (a[3] === b[1] || b[3] === a[1]) n += Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    }
    return n;
  }
  function makeBuilder(ctx) {
    const rooms = [], conns = [];
    const add = (type, rects, extra) => {
      const t = T[type];
      rooms.push(Object.assign({ type, zone: t.zone, level: 0, rects: rects.filter(TG.rvalid) }, extra || {}));
      return rooms.length - 1;
    };
    const conn = (a, b, kind, o) => conns.push(Object.assign({ a, b, kind }, o || {}));
    return { rooms, conns, verticals: [], add, conn, ctx };
  }
  /**
   * The rect a plan may use: the site's largest inner rect (or its bbox for
   * plans that are checked against the mask afterwards). Houses are buried in
   * the backrooms, so they come right up to the site edge, with the odd half
   * metre left over.
   */
  function region(ctx, rng, bbox) {
    const r = bbox ? ctx.site.bbox : ctx.site.inner;
    const m = () => (rng.f() < 0.3 ? 1 : 0);
    return [r[0] + m(), r[1] + m(), r[2] - m(), r[3] - m()];
  }
  function groups(P) {
    const pub = [], priv = [];
    for (const e of P.rooms) (T[e.type].zone === 'public' || T[e.type].zone === 'service' ? pub : priv).push(e);
    return { pub, priv };
  }
  const sumA = (l) => l.reduce((s, e) => s + e.area, 0);
  function privArea(P, priv) {
    let a = sumA(priv);
    for (const e of priv) {
      if (e.type === 'master') a += (e.ensuite ? e.ensuiteArea : 0) + (e.wic ? e.wicArea : 0);
      if (e.type === 'bedroom') a += 7 * P.closets;
    }
    return Math.round(a * 1.08 + P.hallW * 6);
  }
  /** The strip behind a garage: the laundry or mudroom at its target size, the rest storage. */
  function behindGarage(B, pubItems, r, rng) {
    const li = pubItems.findIndex((e) => e.type === 'laundry' || e.type === 'mudroom');
    const d = TG.rh(r), w = TG.rw(r);
    if (li < 0) { B.add('utility', [r], { target: TG.rarea(r) }); return; }
    const e = pubItems.splice(li, 1)[0];
    const lw = Math.max(T[e.type].minW, Math.min(w, Math.round(e.area / d)));
    if (w - lw < T.utility.minW || d < T[e.type].minW) { B.add(d >= T[e.type].minW ? e.type : 'utility', [r], { target: TG.rarea(r), tags: e.tags }); if (d < T[e.type].minW) pubItems.push(e); return; }
    const left = rng.f() < 0.5;
    const a = left ? [r[0], r[1], r[0] + lw, r[3]] : [r[2] - lw, r[1], r[2], r[3]];
    const b = left ? [r[0] + lw, r[1], r[2], r[3]] : [r[0], r[1], r[2] - lw, r[3]];
    B.add(e.type, [a], { target: e.area, tags: e.tags });
    B.add('utility', [b], { target: TG.rarea(b) });
  }
  /** Rough smallest hall run (units) that fits a private room list in a zone Wd units across. */
  function runNeed(P, list, Wd) {
    const hw = Math.max(2, P.hallW), others = list.filter((x) => x.type !== 'master');
    const sumMin = others.reduce((a, x) => a + T[x.type].minW + (x.type === 'bedroom' ? 1 : 0), 0) + (list.length > others.length ? 8 : 0);
    return Wd - hw >= 12 ? Math.ceil(sumMin / 2) + 2 : sumMin + 1;
  }
  function garageDims(P, rng) {
    if (!P.garage) return null;
    const two = P.garage.cars >= 2;
    return { w: two ? rng.int(11, 13) : rng.int(7, 8), d: rng.int(11, 13), fwd: P.garage.fwd, door: two ? rng.int(9, 10) : rng.int(5, 6) };
  }

  // -------------------------------------------------------- public slicing
  /**
   * Recursive slicing of a zone rect between items (program entries). Cuts
   * across the longer side mostly; for a cut along x the more 'service' group
   * goes to the service side, for a cut along y the more 'front' group goes
   * to the street (bottom). Every leaf respects its type's min width.
   */
  function slice(r, items, svcSide, rng, out, depth) {
    if (items.length === 1) { out.push([items[0], r]); return true; }
    if (depth > 8) return false;
    const w = TG.rw(r), h = TG.rh(r);
    const vertFirst = w >= h ? rng.f() < 0.8 : rng.f() < 0.25;
    const minOf = (g) => g.reduce((m, e) => Math.max(m, T[e.type].minW || 2), 0);
    for (const orient of vertFirst ? ['v', 'h'] : ['h', 'v']) {
      const key = orient === 'v' ? (e) => e._svc : (e) => e._front;
      const sorted = items.slice().sort((a, b) => key(b) - key(a));
      const total = sumA(sorted);
      const ks = [];
      let acc = 0;
      for (let k = 1; k < sorted.length; k++) { acc += sorted[k - 1].area; ks.push({ k, d: Math.abs(acc - total / 2) + rng.f() * total * 0.08 }); }
      ks.sort((a, b) => a.d - b.d);
      for (const { k } of ks.slice(0, 2)) {
        const g1 = sorted.slice(0, k), g2 = sorted.slice(k);
        const a1 = sumA(g1), L = orient === 'v' ? w : h, other = orient === 'v' ? h : w;
        const m1 = minOf(g1), m2 = minOf(g2);
        if (other < Math.max(m1, m2)) continue;
        let cut = Math.round((L * a1) / total);
        cut = Math.max(m1, Math.min(L - m2, cut));
        if (cut < m1 || L - cut < m2) continue;
        let r1, r2;
        if (orient === 'v') {
          if (svcSide === 'W') { r1 = [r[0], r[1], r[0] + cut, r[3]]; r2 = [r[0] + cut, r[1], r[2], r[3]]; }
          else { r1 = [r[2] - cut, r[1], r[2], r[3]]; r2 = [r[0], r[1], r[2] - cut, r[3]]; }
        } else { r1 = [r[0], r[3] - cut, r[2], r[3]]; r2 = [r[0], r[1], r[2], r[3] - cut]; }
        const n0 = out.length;
        if (slice(r1, g1, svcSide, rng, out, depth + 1) && slice(r2, g2, svcSide, rng, out, depth + 1)) return true;
        out.length = n0;
      }
    }
    return false;
  }
  function layoutPublic(B, Z, items, svcSide, rng) {
    if (!items.length) return true;
    const it = items.map((e) => Object.assign({}, e, { _front: (FRONT[e.type] || 0) + rng.range(-0.7, 0.7), _svc: (SVC[e.type] || 0) + rng.range(-0.7, 0.7) }));
    const out = [];
    if (!slice(Z, it, svcSide, rng, out, 0)) return false;
    for (const [e, r] of out) B.add(e.type, [r], { target: e.area, tags: e.tags });
    return true;
  }

  // -------------------------------------------------------- private wing
  /**
   * A hallway running from the public zone into zone Z, rooms either side,
   * the master suite capping the far end. attach: the side of Z that touches
   * the public zone; span: [lo, hi] world coords along that side where the
   * hall may start.
   */
  function layoutPrivate(B, Z, attach, span, items, P, rng) {
    if (!items.length) return true;
    const EW = attach === 'E' || attach === 'W';
    const L = EW ? TG.rw(Z) : TG.rh(Z), Wd = EW ? TG.rh(Z) : TG.rw(Z);
    const toW = (a0, c0, a1, c1) => {
      if (attach === 'W') return [Z[0] + a0, Z[1] + c0, Z[0] + a1, Z[1] + c1];
      if (attach === 'E') return [Z[2] - a1, Z[1] + c0, Z[2] - a0, Z[1] + c1];
      if (attach === 'S') return [Z[0] + c0, Z[3] - a1, Z[0] + c1, Z[3] - a0];
      return [Z[0] + c0, Z[1] + a0, Z[0] + c1, Z[1] + a1];
    };
    const ptW = (a, c) => { const r = toW(a, c, a, c); return [r[0], r[1]]; };
    const cs0 = span[0] - (EW ? Z[1] : Z[0]), cs1 = span[1] - (EW ? Z[1] : Z[0]);
    const hw = Math.max(2, P.hallW);
    let master = items.find((e) => e.type === 'master');
    const suiteArea = master ? master.area + (master.ensuite ? master.ensuiteArea : 0) + (master.wic ? master.wicArea : 0) : 0;
    const lo = Math.max(0, cs0), hi = Math.min(Wd - hw, cs1 - hw);
    const minW = (x) => T[x.type].minW;
    // integer widths along a run for a side's rooms, or null
    const alloc = (list, d, run) => {
      const tw = list.map((x) => x.area / d), sum = tw.reduce((a, b) => a + b, 0);
      const goal = tw.map((v) => (v * run) / sum);
      const ws = goal.map((v, k) => Math.max(minW(list[k]), Math.round(v)));
      let tot = ws.reduce((a, b) => a + b, 0), guard = 0;
      while (tot > run && guard++ < 500) {
        let k = -1;
        for (let i2 = 0; i2 < ws.length; i2++) if (ws[i2] > minW(list[i2]) && (k < 0 || ws[i2] - goal[i2] > ws[k] - goal[k])) k = i2;
        if (k < 0) return null;
        ws[k]--; tot--;
      }
      while (tot < run && guard++ < 1000) {
        let k = 0;
        for (let i2 = 1; i2 < ws.length; i2++) if (goal[i2] - ws[i2] > goal[k] - ws[k]) k = i2;
        ws[k]++; tot++;
      }
      return tot === run ? ws : null;
    };
    // ---- search: master endcap or not x hall position x side assignment
    let best = null;
    for (const cap of master && Wd >= 10 ? [true, false] : [false]) {
      let sideRooms = items.filter((x) => !(cap && x === master));
      let suiteSide = false;
      if (cap && !sideRooms.length) {
        // only the master suite here: its bath and closet flank a short hallway
        if (master.ensuite) sideRooms.push({ type: 'ensuite', area: master.ensuiteArea, suite: true });
        sideRooms.push({ type: 'wic', area: master.wic ? master.wicArea : A2(3), suite: true });
        suiteSide = true;
      }
      if (!cap && !sideRooms.length) continue;
      for (let c = lo; c <= hi; c++) {
        const dA = c, dB = Wd - c - hw;
        if ((dA > 0 && dA < 2) || (dB > 0 && dB < 2)) continue;
        const sides = [];
        if (dA > 0) sides.push({ d: dA, c0: 0, c1: dA, hallC: dA, list: [], len: 0 });
        if (dB > 0) sides.push({ d: dB, c0: c + hw, c1: Wd, hallC: c + hw, list: [], len: 0 });
        if (!sides.length) continue;
        let ok = true;
        for (const x of sideRooms.slice().sort((p, q) => q.area - p.area)) {
          const el = sides.filter((sd) => sd.d >= minW(x));
          if (!el.length) { ok = false; why(B.ctx, 'pv:depth'); break; }
          let sd = el[0];
          for (const t of el) if (t.len + x.area / t.d < sd.len + x.area / sd.d) sd = t;
          sd.list.push(x); sd.len += x.area / sd.d;
        }
        if (!ok) continue;
        if (sides.length === 2) for (let it = 0; it < 6; it++) {
          let moved = false;
          for (const [sd, o] of [[sides[0], sides[1]], [sides[1], sides[0]]]) for (const x of sd.list.slice()) {
            if (sd.list.length < 2 || o.d < minW(x)) continue;
            const before = Math.abs(sd.len - o.len), after = Math.abs((sd.len - x.area / sd.d) - (o.len + x.area / o.d));
            if (after + 0.5 < before) { sd.list.splice(sd.list.indexOf(x), 1); o.list.push(x); sd.len -= x.area / sd.d; o.len += x.area / o.d; moved = true; }
          }
          if (!moved) break;
        }
        if (sides.some((sd) => !sd.list.length)) { why(B.ctx, 'pv:emptySide'); continue; }
        const need = Math.max(...sides.map((sd) => sd.len));
        const minRun = Math.max(...sides.map((sd) => sd.list.reduce((a, x) => a + minW(x), 0)));
        let Hn = L, e = 0;
        if (cap) {
          Hn = Math.max(minRun, Math.min(L - 7, Math.round(need)));
          e = L - Hn;
          if (e < 7) { why(B.ctx, 'pv:shortCap'); continue; }
        }
        if (minRun > Hn) { why(B.ctx, 'pv:minRun'); continue; }
        let cost = 0;
        const widths = [];
        for (const sd of sides) {
          const ws = alloc(sd.list, sd.d, Hn);
          if (!ws) { cost = Infinity; break; }
          widths.push(ws);
          sd.list.forEach((x, k) => {
            cost += Math.abs(ws[k] * sd.d - x.area) / x.area;
            const asp = Math.max(ws[k], sd.d) / Math.min(ws[k], sd.d);
            if (T[x.type].maxAsp && asp > T[x.type].maxAsp) cost += (asp - T[x.type].maxAsp) * 0.6;
          });
        }
        if (!isFinite(cost)) { why(B.ctx, 'pv:alloc'); continue; }
        if (cap) cost += Math.abs(e * Wd - suiteArea) / suiteArea;
        if (sides.length === 1 && sideRooms.length > 2) cost += 0.3;
        cost += rng.f() * 0.25;
        if (!best || cost < best.cost) best = { cost, c, Hn, e, sides, widths, suiteSide };
      }
    }
    if (!best) return !!why(B.ctx, 'private:nofit');
    const cH = best.c, Hn = best.Hn, e = best.e;
    const made = [];
    best.sides.forEach((sd, si) => {
      const idx = sd.list.map((_, k) => k);
      for (let i2 = idx.length - 1; i2 > 0; i2--) { const j2 = rng.int(0, i2); const t = idx[i2]; idx[i2] = idx[j2]; idx[j2] = t; }
      let a = 0;
      for (const k of idx) { const w = best.widths[si][k]; made.push({ x: sd.list[k], s: sd, a0: a, a1: a + w }); a += w; }
    });
    // ---- rooms, closets, ensuites
    const hall = B.add('hall', [toW(0, cH, Hn, cH + hw)]);
    const suiteKids = [];
    for (const m of made) {
      const { x, s, a0, a1 } = m, w = a1 - a0, d = s.d;
      if (x.suite) {
        const k = B.add(x.type, [toW(a0, s.c0, a1, s.c1)], { target: x.area });
        B.conn(hall, k, x.type === 'wic' && rng.f() < 0.5 ? 'opening' : 'door', { into: k, w: 2, prio: 6, required: true });
        suiteKids.push(k);
        continue;
      }
      const towardHallLow = s.hallC === s.c1;           // hall is at the high-c edge of this side
      const full = [a0, s.c0, a1, s.c1];
      const wantCloset = (x.type === 'bedroom' && rng.f() < P.closets) || (x.type === 'master' && !x.wic);
      const wantEnsuite = x.type === 'master' && x.ensuite;
      if ((wantCloset || wantEnsuite) && w >= 7 && d >= 8) {
        // carve at the hall side, at one end of the room's run
        const cw = wantEnsuite ? Math.min(w - 4, rng.int(4, 5)) : Math.min(w - 4, rng.int(3, 4));
        const cd = wantEnsuite ? Math.min(d - 6, rng.int(4, 5)) : 2;
        const atLow = rng.f() < 0.5;
        const ca0 = atLow ? a0 : a1 - cw, ca1 = ca0 + cw;
        const cc0 = towardHallLow ? s.c1 - cd : s.c0, cc1 = cc0 + cd;
        const main = towardHallLow ? [a0, s.c0, a1, s.c1 - cd] : [a0, s.c0 + cd, a1, s.c1];
        const strip = towardHallLow ? [atLow ? ca1 : a0, s.c1 - cd, atLow ? a1 : ca0, s.c1] : [atLow ? ca1 : a0, s.c0, atLow ? a1 : ca0, s.c0 + cd];
        if (TG.rshort(main) >= T[x.type].minW) {
          const ri = B.add(x.type, [toW(...main), toW(...strip)], { target: x.area, tags: x.tags });
          const ci = B.add(wantEnsuite ? 'ensuite' : 'closet', [toW(ca0, cc0, ca1, cc1)], { parent: ri });
          if (wantEnsuite) B.conn(ri, ci, 'door', { into: ci, prio: 6, required: true });
          else B.conn(ri, ci, 'door', { into: ci, w: Math.max(2, Math.min(4, cw - 1)), margin: 0, align: 'center', prio: 6, required: true });
          continue;
        }
      }
      B.add(x.type, [toW(...full)], { target: x.area, tags: x.tags });
    }
    // ---- master suite at the end of the hall
    if (e) {
      if (!best.suiteSide && e * Wd > suiteArea * 1.35) {
        if (!master.wic) master = Object.assign({}, master, { wic: true });
        if (e * Wd > suiteArea * 1.8 && !master.ensuite) master = Object.assign({}, master, { ensuite: true });
      }
      const sd = !best.suiteSide && (master.ensuite || master.wic) ? rng.int(4, 6) : 0;
      if (sd && e - sd >= 7) {
        const parts = [{ c0: 0, c1: cH }, { c0: cH + hw, c1: Wd }].filter((p) => p.c1 - p.c0 > 0).sort((p, q) => (q.c1 - q.c0) - (p.c1 - p.c0));
        const vest = [[Hn, cH, Hn + sd, cH + hw]];
        let ens = null, wic = null;
        for (const p of parts) {
          const wdt = p.c1 - p.c0;
          if (master.ensuite && !ens && wdt >= 4 && sd >= 4) { ens = [Hn, p.c0, Hn + sd, p.c1]; continue; }
          if (master.wic && !wic && wdt >= 3 && sd >= 3) { wic = [Hn, p.c0, Hn + sd, p.c1]; continue; }
          vest.push([Hn, p.c0, Hn + sd, p.c1]);
        }
        const mi = B.add('master', [toW(Hn + sd, 0, L, Wd)].concat(vest.map((v) => toW(...v))), { target: master.area, tags: master.tags });
        if (ens) { const k = B.add('ensuite', [toW(...ens)], { parent: mi }); B.conn(mi, k, 'door', { into: k, prio: 6, required: true }); }
        if (wic) { const k = B.add('wic', [toW(...wic)], { parent: mi }); B.conn(mi, k, rng.f() < 0.5 ? 'opening' : 'door', { into: k, w: 2, prio: 6, required: true }); }
        B.conn(hall, mi, 'door', { near: ptW(Hn, cH + hw / 2), align: 'center', margin: 0, prio: 6, required: true });
      } else {
        // shallow endcap: ensuite / closet as full-depth pieces at the outer ends
        const sideL = cH, sideR = Wd - cH - hw;
        let c0 = 0, c1 = Wd, ens = null, wic = null;
        const big = sideL >= sideR ? 'L' : 'R';
        const take = (want, minw, onLeft) => {
          const room = (onLeft ? sideL : sideR) - 1;
          const w = Math.max(minw, Math.min(room, Math.round(want / e)));
          if (w > room || (c1 - c0) - w < 7) return null;
          if (onLeft) { const r = [Hn, c0, L, c0 + w]; c0 += w; return r; }
          const r = [Hn, c1 - w, L, c1]; c1 -= w; return r;
        };
        if (!best.suiteSide) {
          if (master.ensuite) ens = take(master.ensuiteArea, 4, big === 'L');
          if (master.wic || e * Wd > suiteArea * 1.35) wic = take(master.wic ? master.wicArea : A2(3.5), 3, ens ? big !== 'L' : big === 'L');
        }
        const mi = B.add('master', [toW(Hn, c0, L, c1)], { target: master.area, tags: master.tags });
        B.conn(hall, mi, 'door', { near: ptW(Hn, cH + hw / 2), align: 'center', margin: 0, prio: 6, required: true });
        if (ens) { const k = B.add('ensuite', [toW(...ens)], { parent: mi }); B.conn(mi, k, 'door', { into: k, prio: 6, required: true }); }
        if (wic) { const k = B.add('wic', [toW(...wic)], { parent: mi }); B.conn(mi, k, rng.f() < 0.5 ? 'opening' : 'door', { into: k, w: 2, prio: 6, required: true }); }
        for (const k of suiteKids) B.rooms[k].parent = mi;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- portals
  /**
   * Entrances and exits onto the surrounding backrooms: the front door on
   * the main side (entrance), the garage door (vehicle, both ways), maybe a
   * back exit and a side exit.
   */
  function portals(B, P, ctx, rng, info) {
    const { W, H } = ctx.site, rooms = B.rooms, OUT = TPL.OUTSIDE;
    const R = new TG.Raster(W, H, -1), ground = (i) => !rooms[i].level;
    rooms.forEach((rm, i) => { if (ground(i)) for (const r of rm.rects) R.fill(r, i); });
    const clearRow = (x0, x1, y) => y < 0 || y >= H || R.all([x0, y, x1, y + 1], -1);
    const clearCol = (x, y0, y1) => x < 0 || x >= W || R.all([x, y0, x + 1, y1], -1);
    const yF = info.yF;
    // ---- front door
    let door = null;
    for (const type of ['foyer', 'living', 'family', 'dining', 'hall', 'office', 'kitchen']) {
      for (let i = 0; i < rooms.length && !door; i++) {
        if (rooms[i].type !== type || !ground(i)) continue;
        for (const r of rooms[i].rects) {
          if (r[3] !== yF || r[2] - r[0] < 4 || !clearRow(r[0], r[2], yF)) continue;
          const dw = r[2] - r[0] >= 9 && rng.f() < 0.2 ? 3 : 2;
          const xd = r[0] + 1 + Math.floor((r[2] - r[0] - dw - 2) * rng.range(0.25, 0.75));
          door = { room: i, x: xd, w: dw };
          break;
        }
      }
      if (door) break;
    }
    if (!door) return !!why(ctx, 'portals:front');
    B.conn(door.room, OUT, door.w === 3 ? 'double' : 'door', { role: 'entrance', side: 'S', w: door.w, near: [door.x + door.w / 2, yF], align: 'center',
      into: door.room, main: true, clear: 1.5, prio: 10, required: true, tags: ['front door'] });
    // ---- garage door
    if (info.garage >= 0) {
      B.conn(info.garage, OUT, 'vehicle', { role: 'both', side: 'S', w: info.garDoor, align: 'center', clear: 5, prio: 9, required: true, tags: ['garage door'] });
    }
    // ---- back exit
    if (rng.f() < P.backDoor) {
      let back = null;
      for (const type of ['kitchen', 'laundry', 'mudroom', 'dining', 'family', 'utility', 'living']) {
        for (let i = 0; i < rooms.length && !back; i++) {
          if (rooms[i].type !== type || !ground(i)) continue;
          for (const r of rooms[i].rects) if (r[2] - r[0] >= 4 && clearRow(r[0], r[2], r[1] - 1)) { back = i; break; }
        }
        if (back !== null) break;
      }
      if (back !== null) {
        const slider = ['dining', 'family', 'living'].indexOf(rooms[back].type) >= 0;
        B.conn(back, OUT, slider ? 'slider' : 'door', { role: 'exit', side: 'N', w: slider ? 4 : 2, into: back, clear: 1.5, prio: 7, tags: ['back door'] });
      }
    }
    // ---- side exit (garage / mudroom / laundry / kitchen)
    if (rng.f() < P.sideDoor) {
      for (const type of ['garage', 'mudroom', 'laundry', 'utility', 'kitchen']) {
        const i = rooms.findIndex((rm) => rm.type === type && !rm.level);
        if (i < 0) continue;
        const r = rooms[i].rects[0];
        const side = clearCol(r[0] - 1, r[1], r[3]) ? 'W' : clearCol(r[2], r[1], r[3]) ? 'E' : null;
        if (!side || r[3] - r[1] < 4) continue;
        B.conn(i, OUT, 'door', { role: 'exit', side, w: 2, into: i, clear: 1.5, prio: 6, tags: ['side door'] });
        break;
      }
    }
    return true;
  }

  // ------------------------------------------------------------- plan types
  function finish(B, P, ctx, rng, info, meta) {
    // everything inside the site
    for (const rm of B.rooms) for (const r of rm.rects) if (!ctx.site.mask.all(r, 1)) return why(ctx, 'site:outside');
    if (!portals(B, P, ctx, rng, info)) return null;
    // garage -> house door
    if (info.garage >= 0) {
      const g = B.rooms[info.garage];
      const pref = ['mudroom', 'laundry', 'utility', 'kitchen', 'hall', 'dining', 'family', 'foyer', 'pantry', 'living'];
      let best = null;
      B.rooms.forEach((rm, i) => {
        if (i === info.garage || rm.level) return;
        const k = pref.indexOf(rm.type);
        if (k < 0 || touch(g.rects, rm.rects) < 4) return;
        if (!best || k < best.k) best = { i, k };
      });
      if (best) B.conn(info.garage, best.i, 'door', { into: best.i, prio: 8, required: true });
    }
    // ceilings; a storey's rooms keep under the floor above (its slab included)
    const L = info.levels || 1, LH = info.levelHeights || [], top = L - 1;
    B.rooms.forEach((rm) => {
      const c = T[rm.type].ceil;
      if (c) rm.ceiling = Math.round(rng.range(c[0], c[1]) * 10) / 10;
      if ((rm.level || 0) < top) rm.ceiling = Math.min(rm.ceiling || 2.5, Math.round((LH[rm.level || 0] - 0.3) * 10) / 10);
    });
    if (ctx.mut.has('ceiling')) {
      // a tall one only where nothing stands above it
      const cands = B.rooms.filter((rm) => ['living', 'hall', 'bedroom', 'kitchen', 'dining', 'bath'].indexOf(rm.type) >= 0 && (rm.level || 0) === top);
      const rm = rng.pick(cands);
      if (rm) { rm.ceiling = rng.f() < 0.5 ? 1.9 : Math.round(rng.range(5, 7) * 10) / 10; rm.tags = (rm.tags || []).concat('wrong:ceiling'); }
    }
    if (ctx.mut.has('stairs')) {
      // a staircase that climbs into the ceiling: a vertical link with nothing above
      // (in a house of several storeys, on its top floor)
      const at = (type) => B.rooms.findIndex((rm) => rm.type === type && (rm.level || 0) === top);
      const i = at('hall') >= 0 ? at('hall') : at('living');
      if (i >= 0) { B.verticals.push({ kind: 'stair', rooms: [i], dead: true, tags: ['wrong:stairsToNowhere'] }); B.rooms[i].tags = (B.rooms[i].tags || []).concat('wrong:stairsToNowhere'); }
    }
    const out = { W: ctx.site.W, H: ctx.site.H, levels: L, rooms: B.rooms, conns: B.conns, verticals: B.verticals, meta: Object.assign({ front: info.yF }, meta) };
    if (info.levelHeights) out.levelHeights = info.levelHeights.slice();
    return out;
  }
  function garageRect(Rg, gar, x, yT, rng) {
    const top = Math.max(yT, Rg[3] - gar.d);
    return [x, top, x + gar.w, Rg[3]];
  }

  /** [garage][public][private] in one bar (T: the public zone runs deeper). */
  function planBar(P, ctx, rng) {
    const A = ctx.arch, Rg = region(ctx, rng, false);
    const BW = TG.rw(Rg), gar = garageDims(P, rng), gw = gar ? gar.w : 0;
    const rec = gar ? Math.max(0, Math.min(gar.fwd, TG.rh(Rg) - 14)) : 0;   // the garage sticks out past the house front
    const BD = TG.rh(Rg) - rec;
    const { pub, priv } = groups(P);
    const Apub = sumA(pub), Apriv = privArea(P, priv);
    let D = Math.min(BD, U(rr(rng, A.depth || [8, 11])));
    if (D < 14) return why(ctx, 'bar:shallow');
    let Wpub = Math.max(10, Math.ceil(Apub / D)), Wpriv = Math.max(8, Math.ceil(Apriv / D), runNeed(P, priv, D));
    if (Wpub + Wpriv + gw > BW) {
      D = Math.min(BD, Math.max(D, Math.ceil((Apub + Apriv) / Math.max(1, BW - gw))));
      Wpub = Math.max(10, Math.ceil(Apub / D)); Wpriv = Math.max(8, Math.ceil(Apriv / D), runNeed(P, priv, D));
      if (Wpub + Wpriv + gw > BW) {
        const k = (BW - gw) / (Wpub + Wpriv);
        if (k < 0.82) return why(ctx, 'bar:narrow');
        Wpub = Math.floor(Wpub * k); Wpriv = BW - gw - Wpub;
      }
    }
    let pubExtra = 0;
    if (BD - D >= 6 && rng.f() < (A.pubDeep === undefined ? 0.35 : A.pubDeep)) {
      pubExtra = rng.int(5, Math.min(12, BD - D));
      Wpub = Math.max(10, Math.ceil(Apub / (D + pubExtra)));
    }
    const total = Wpub + Wpriv + gw, privLeft = rng.f() < 0.5;
    const x0 = Rg[0] + Math.round((BW - total) * rng.range(0.2, 0.8));
    const yF = Rg[3] - rec, yT = yF - D;
    const B = makeBuilder(ctx);
    let x = x0, privR, pubR, gi = -1, garR = null;
    for (const s of privLeft ? ['priv', 'pub', 'gar'] : ['gar', 'pub', 'priv']) {
      if (s === 'priv') { privR = [x, yT, x + Wpriv, yF]; x += Wpriv; }
      else if (s === 'pub') { pubR = [x, yT - pubExtra, x + Wpub, yF]; x += Wpub; }
      else if (gar) { garR = garageRect(Rg, gar, x, yT, rng); x += gar.w; }
    }
    const pubItems = pub.slice();
    if (garR) {
      let behind = garR[1] - yT;
      if (behind > 7) { garR[1] = yT + rng.int(5, 7); behind = garR[1] - yT; }   // a deeper garage, service room behind
      if (behind >= 5) behindGarage(B, pubItems, [garR[0], yT, garR[2], garR[1]], rng);
      else if (behind > 0) garR[1] = yT;
      gi = B.add('garage', [garR]);
    }
    if (!layoutPublic(B, pubR, pubItems, privLeft ? 'E' : 'W', rng)) return why(ctx, 'bar:public');
    if (!layoutPrivate(B, privR, privLeft ? 'E' : 'W', [yT, yF], priv, P, rng)) return why(ctx, 'bar:private');
    return finish(B, P, ctx, rng, { yF, garage: gi, garDoor: gar ? gar.door : 0 }, { type: pubExtra ? 'T' : 'bar' });
  }

  /** Public bar on the main side, private wing going back at one end. */
  function planL(P, ctx, rng) {
    const A = ctx.arch, Rg = region(ctx, rng, true);
    const BW = TG.rw(Rg), gar = garageDims(P, rng), gw = gar ? gar.w : 0;
    const rec = gar ? Math.max(0, Math.min(gar.fwd, TG.rh(Rg) - 20)) : 0;
    const BD = TG.rh(Rg) - rec;
    const { pub, priv } = groups(P);
    const Apub = sumA(pub), Apriv = privArea(P, priv);
    const D1 = Math.min(BD - 8, U(rr(rng, A.depth || [8, 10])) - rng.int(0, 2));
    if (D1 < 12) return why(ctx, 'L:shallow');
    const room = BD - D1;
    let Ww = Math.max(14, Math.min(24, Math.ceil(Apriv / Math.max(8, Math.min(room, rng.int(16, 26))))));
    let Dw = Math.max(8, Math.ceil(Apriv / Ww), runNeed(P, priv, Ww));
    if (D1 + Dw > BD) { Ww = Math.min(24, Math.ceil(Apriv / Math.max(1, room))); Dw = Math.max(8, Math.ceil(Apriv / Ww), runNeed(P, priv, Ww)); }
    if (D1 + Dw > BD) return why(ctx, 'L:wing');
    const Wpub = Math.max(Ww + 4, Math.ceil(Apub / D1));
    if (Wpub + gw > BW) return why(ctx, 'L:narrow');
    const wingLeft = rng.f() < 0.5;
    const x0 = Rg[0] + Math.round((BW - Wpub - gw) * rng.range(0.2, 0.8));
    const yF = Rg[3] - rec, yB = yF - D1;
    const B = makeBuilder(ctx);
    const pubR = wingLeft ? [x0, yB, x0 + Wpub, yF] : [x0 + gw, yB, x0 + gw + Wpub, yF];
    let garR = gar ? garageRect(Rg, gar, wingLeft ? x0 + Wpub : x0, yB, rng) : null, gi = -1;
    const pubItems = pub.slice();
    if (garR) {
      if (garR[1] - yB > 0 && garR[1] - yB < 5) garR[1] = yB;
      if (garR[1] - yB > 7) garR[1] = yB + rng.int(5, 7);
      if (garR[1] - yB >= 5) behindGarage(B, pubItems, [garR[0], yB, garR[2], garR[1]], rng);
      gi = B.add('garage', [garR]);
    }
    const wx0 = wingLeft ? pubR[0] : pubR[2] - Ww;
    const wingR = [wx0, yB - Dw, wx0 + Ww, yB];
    if (!layoutPublic(B, pubR, pubItems, wingLeft ? 'E' : 'W', rng)) return why(ctx, 'L:public');
    if (!layoutPrivate(B, wingR, 'S', [wingR[0], wingR[2]], priv, P, rng)) return why(ctx, 'L:private');
    return finish(B, P, ctx, rng, { yF, garage: gi, garDoor: gar ? gar.door : 0 }, { type: 'L' });
  }

  /** Public in front, private behind - narrow, deep sites. */
  function planDeep(P, ctx, rng) {
    const Rg = region(ctx, rng, false);
    const BW = TG.rw(Rg), BD = TG.rh(Rg);
    const { pub, priv } = groups(P), gar = garageDims(P, rng);
    const Apub = sumA(pub), Apriv = privArea(P, priv);
    const gw = gar && BW - gar.w >= 14 ? gar.w : 0;
    const Wb = Math.min(BW - gw, Math.max(14, Math.round(Math.sqrt((Apub + Apriv) * rng.range(0.55, 0.9)))));
    if (Wb < 12) return why(ctx, 'deep:narrow');
    const Dp = Math.max(10, Math.ceil(Apub / Wb)), Dq = Math.max(8, Math.ceil(Apriv / Wb), runNeed(P, priv, Wb));
    if (Dp + Dq > BD) return why(ctx, 'deep:shallow');
    const garLeft = rng.f() < 0.5;
    const x0 = Rg[0] + Math.round((BW - Wb - gw) * rng.range(0.2, 0.8)) + (gw && garLeft ? gw : 0);
    const yF = Rg[3];
    const pubR = [x0, yF - Dp, x0 + Wb, yF], privR = [x0, yF - Dp - Dq, x0 + Wb, yF - Dp];
    const B = makeBuilder(ctx);
    let gi = -1;
    if (gw) {
      const gx = garLeft ? x0 - gw : x0 + Wb;
      gi = B.add('garage', [[gx, Math.max(yF - Dp - Dq, yF - gar.d), gx + gw, yF]]);
    }
    if (!layoutPublic(B, pubR, pub, gw ? (garLeft ? 'W' : 'E') : (rng.f() < 0.5 ? 'W' : 'E'), rng)) return why(ctx, 'deep:public');
    if (!layoutPrivate(B, privR, 'S', [privR[0], privR[2]], priv, P, rng)) return why(ctx, 'deep:private');
    return finish(B, P, ctx, rng, { yF, garage: gi, garDoor: gar ? gar.door : 0 }, { type: 'deep' });
  }

  /** [master suite][public][bedrooms]: the split-bedroom ranch. */
  function planSplit(P, ctx, rng) {
    const A = ctx.arch, Rg = region(ctx, rng, false);
    const BW = TG.rw(Rg), BD = TG.rh(Rg);
    const { pub, priv } = groups(P);
    const master = priv.find((e) => e.type === 'master');
    if (!master) return why(ctx, 'split:nomaster');
    const m = Object.assign({}, master, { ensuite: true });
    const office = priv.find((e) => e.type === 'office');
    const privA = [m].concat(office && rng.f() < 0.6 ? [office] : []);
    const privB = priv.filter((e) => e !== master && privA.indexOf(e) < 0);
    if (!privB.length) return why(ctx, 'split:nobedrooms');
    const D = Math.min(BD, U(rr(rng, A.depth || [8, 11])));
    if (D < 14) return why(ctx, 'split:shallow');
    const Wa = Math.max(8, Math.ceil(privArea(P, privA) / D), runNeed(P, privA, D)), Wb = Math.max(8, Math.ceil(privArea(P, privB) / D), runNeed(P, privB, D));
    const Wp = Math.max(10, Math.ceil(sumA(pub) / D));
    if (Wa + Wb + Wp > BW) return why(ctx, 'split:narrow');
    const aLeft = rng.f() < 0.5;
    const x0 = Rg[0] + Math.round((BW - Wa - Wb - Wp) * rng.range(0.2, 0.8)), yF = Rg[3], yT = yF - D;
    const ra = aLeft ? [x0, yT, x0 + Wa, yF] : [x0 + Wb + Wp, yT, x0 + Wb + Wp + Wa, yF];
    const rb = aLeft ? [x0 + Wa + Wp, yT, x0 + Wa + Wp + Wb, yF] : [x0, yT, x0 + Wb, yF];
    const rp = aLeft ? [x0 + Wa, yT, x0 + Wa + Wp, yF] : [x0 + Wb, yT, x0 + Wb + Wp, yF];
    const B = makeBuilder(ctx);
    if (!layoutPublic(B, rp, pub, rng.f() < 0.5 ? 'W' : 'E', rng)) return why(ctx, 'split:public');
    if (!layoutPrivate(B, ra, aLeft ? 'E' : 'W', [yT, yF], privA, P, rng)) return why(ctx, 'split:suite');
    if (!layoutPrivate(B, rb, aLeft ? 'W' : 'E', [yT, yF], privB, P, rng)) return why(ctx, 'split:bedrooms');
    return finish(B, P, ctx, rng, { yF, garage: -1, garDoor: 0 }, { type: 'split' });
  }

  /**
   * Two or three storeys over one footprint. A stair core runs front to back
   * up one side: the foyer at the front, a stairwell (2 m by 4.5 m: room for
   * a switchback, fitted by the elevation layer) behind it on the outer wall,
   * a hallway beside the stairwell. The stairwell and the hallway repeat on
   * every floor; upstairs the hallway also spans the foyer. The rest of the
   * footprint holds the public rooms on the ground floor and the bedrooms
   * above; a third floor takes the master suite (and a study) on a smaller
   * footprint against the core. A garage stays single-storey, beside.
   * Upper floors keep the ground floor's walls where they stand over them.
   */
  function planStack(P, ctx, rng) {
    const A = ctx.arch, Rg = region(ctx, rng, false), n = Math.max(2, Math.min(3, P.storeys));
    const BW = TG.rw(Rg), BD = TG.rh(Rg), gar = garageDims(P, rng);
    const { pub, priv } = groups(P);
    const pubItems = pub.filter((e) => e.type !== 'foyer');
    let up1 = priv, up2 = [];
    if (n === 3) {
      up2 = priv.filter((e) => e.type === 'master' || e.type === 'office');
      up1 = priv.filter((e) => up2.indexOf(e) < 0);
      if (!up2.length || !up1.length) return why(ctx, 'stack:floors');
    }
    const hw = Math.max(2, P.hallW), cw = 4 + hw;
    const D = Math.min(BD, U(rr(rng, A.depth || [8, 10])));
    if (D < 16) return why(ctx, 'stack:shallow');
    const Wz = Math.max(10, Math.ceil(sumA(pubItems) / D), Math.ceil(privArea(P, up1) / D), runNeed(P, up1, D));
    let gw = gar ? gar.w : 0;
    if (cw + Wz + gw > BW) gw = 0;
    if (cw + Wz > BW) return why(ctx, 'stack:narrow');
    const coreLeft = rng.f() < 0.5, garLeft = !coreLeft;
    const x0 = Rg[0] + Math.round((BW - cw - Wz - gw) * rng.range(0.2, 0.8)) + (gw && garLeft ? gw : 0);
    const yF = Rg[3], yT = yF - D;
    const core = coreLeft ? [x0, yT, x0 + cw, yF] : [x0 + Wz, yT, x0 + Wz + cw, yF];
    const Z = coreLeft ? [x0 + cw, yT, x0 + cw + Wz, yF] : [x0, yT, x0 + Wz, yF];
    // the core, front to back: foyer, stairwell (front end at the foyer), anything left behind it
    let fd = rng.int(4, 6), back = D - fd - 9;
    if (back > 0 && back < 3) { fd += back; back = 0; }
    if (back < 0 || fd > 8) return why(ctx, 'stack:core');
    const sx0 = coreLeft ? core[0] : core[2] - 4, hx0 = coreLeft ? core[0] + 4 : core[0], sY1 = yF - fd, sY0 = sY1 - 9;
    const S = [sx0, sY0, sx0 + 4, sY1], strip = [hx0, yT, hx0 + hw, sY1], front = [core[0], sY1, core[2], yF], behind = back ? [sx0, yT, sx0 + 4, sY0] : null;
    const B = makeBuilder(ctx), atLevel = (n0, lv) => { for (let k = n0; k < B.rooms.length; k++) B.rooms[k].level = lv; };
    const stairs = [], toEnd = [sx0 + 2, sY1];
    // ---- ground floor
    const foyer = B.add('foyer', [front]);
    stairs.push(B.add('stairwell', [S]));
    B.add('hall', [strip]);
    B.conn(stairs[0], foyer, 'opening', { w: 2, near: toEnd, prio: 8, required: true });
    if (behind) {
      const li = pubItems.findIndex((e) => ['laundry', 'mudroom', 'pantry'].indexOf(e.type) >= 0 && T[e.type].minW <= Math.min(4, back));
      if (li >= 0) { const e = pubItems.splice(li, 1)[0]; B.add(e.type, [behind], { target: e.area, tags: e.tags }); }
      else B.add('bath', [behind], { tags: ['powder room'] });
    }
    let gi = -1;
    if (gw) {
      const gx = garLeft ? x0 - gw : x0 + cw + Wz;
      gi = B.add('garage', [[gx, Math.max(yT, yF - gar.d), gx + gw, yF]]);
    }
    if (!layoutPublic(B, Z, pubItems, gw ? (garLeft ? 'W' : 'E') : (rng.f() < 0.5 ? 'W' : 'E'), rng)) return why(ctx, 'stack:public');
    // ---- upper floors: the stairwell and the hallway again, rooms beside them
    const attach = coreLeft ? 'W' : 'E';
    for (let lv = 1; lv < n; lv++) {
      const n0 = B.rooms.length, list = lv === 1 ? up1 : up2;
      const st = B.add('stairwell', [S]);
      const hall = B.add('hall', [strip, front]);
      if (behind) B.add(back >= 4 && lv === 1 ? 'bath' : 'linen', [behind]);
      B.conn(st, hall, 'opening', { w: 2, near: toEnd, prio: 8, required: true });
      stairs.push(st);
      // the top of a three-storey house is smaller: only what its rooms need, against the core
      let Zl = Z;
      if (lv === 2) {
        const need = Math.min(Wz, Math.max(8, Math.ceil(privArea(P, list) / D), runNeed(P, list, D)));
        Zl = coreLeft ? [Z[0], yT, Z[0] + need, yF] : [Z[2] - need, yT, Z[2], yF];
      }
      if (!layoutPrivate(B, Zl, attach, [yT, yF], list, P, rng)) return why(ctx, 'stack:floor' + lv);
      atLevel(n0, lv);
    }
    B.verticals.push({ kind: 'stair', rooms: stairs, shape: 'switchback', tags: ['stairwell'] });
    const heights = [3.2, 3, 3].slice(0, n);
    return finish(B, P, ctx, rng, { yF, garage: gi, garDoor: gar ? gar.door : 0, levels: n, levelHeights: heights }, { type: 'stack', storeys: n });
  }

  const PLANS = { bar: planBar, L: planL, deep: planDeep, split: planSplit, stack: planStack };
  function layout(P, ctx, rng) {
    if (P.storeys > 1) return planStack(P, ctx, rng);
    const w = Object.assign({}, ctx.arch.plans || { bar: 1 });
    const type = rng.weighted(w);
    return PLANS[type] ? PLANS[type](P, ctx, rng) : null;
  }
  function fallback(P, ctx, rng) {
    // trim the program to the essentials and try every plan type a few times
    const Q = Object.assign({}, P, { rooms: P.rooms.filter((e) => ['living', 'kitchen', 'bath', 'bedroom', 'master'].indexOf(e.type) >= 0).slice(0, 5), garage: null });
    for (let k = 0; k < 40; k++) for (const f of P.storeys > 1 ? [planStack] : [planDeep, planBar]) { const p = f(Q, ctx, rng); if (p) return p; }
    return null;
  }

  // ---------------------------------------------------------- connection rules
  const CONN = {
    'bedroom|hall': ['door', 5], 'hall|master': ['door', 5], 'bath|hall': ['door', 5], 'hall|linen': ['door', 5], 'hall|office': ['door', 5],
    'hall|laundry': ['door', 4], 'hall|utility': ['door', 3], 'hall|mudroom': ['door', 3], 'hall|pantry': ['door', 2],
    'foyer|hall': ['hallOpen', 4], 'dining|hall': ['hallOpen', 4], 'hall|living': ['hallOpen', 4], 'family|hall': ['hallOpen', 4], 'hall|kitchen': ['hallOpen', 2],
    'hall|hall': ['open', 5],
    'dining|living': ['plan', 3], 'dining|kitchen': ['planK', 3], 'kitchen|living': ['planOnly', 2], 'family|kitchen': ['open', 3],
    'foyer|living': ['opening', 3], 'dining|foyer': ['opening', 2], 'family|living': ['opening', 2], 'dining|family': ['opening', 2],
    'kitchen|pantry': ['door', 3], 'kitchen|laundry': ['door', 3], 'kitchen|mudroom': ['opening', 3], 'laundry|mudroom': ['opening', 3],
    'kitchen|utility': ['door', 3], 'laundry|utility': ['door', 2], 'foyer|office': ['door', 2], 'living|office': ['door', 1],
    'bath|foyer': ['door', 1], 'foyer|mudroom': ['door', 1]
  };
  function connRule(A, B, ctx, rng) {
    const k = A.type < B.type ? A.type + '|' + B.type : B.type + '|' + A.type;
    const r = CONN[k];
    if (!r) return null;
    const [kind, prio] = r, P = ctx.program;
    if (kind === 'hallOpen') return { kind: 'opening', w: P.hallW, margin: 0, prio };
    if (kind === 'plan') return P.openPlan ? { kind: 'open', prio } : { kind: 'opening', w: rng.int(4, 8), prio };
    if (kind === 'planK') return P.openPlan ? { kind: 'open', prio } : rng.f() < 0.6 ? { kind: 'opening', w: rng.int(3, 5), prio } : { kind: 'door', prio };
    if (kind === 'planOnly') return P.openPlan ? { kind: 'open', prio } : null;
    if (kind === 'opening') return { kind: 'opening', w: rng.int(3, 6), prio };
    return { kind, prio, required: kind === 'door' && prio >= 5 };
  }
  const CIRC = { hall: 1, foyer: 1, living: 2, dining: 2, family: 2, kitchen: 3, mudroom: 3, laundry: 4, utility: 4 };
  function autoPenalty(u, v) {
    if (u.type === 'stairwell' || v.type === 'stairwell') return Infinity;   // a stairwell opens where the stair arrives, nowhere else
    if (v.type === 'closet' || v.type === 'wic' || v.type === 'ensuite' || u.type === 'closet' || u.type === 'wic' || u.type === 'linen' || u.type === 'pantry') return Infinity;
    const cu = CIRC[u.type], cv = CIRC[v.type];
    if (u.type === 'garage' || v.type === 'garage') return (cu || cv) ? 5 : 14;
    if (cu && cv) return 2 + Math.min(cu, cv);
    if (cu) return 3 + cu;
    if (u.type === 'bath' || v.type === 'bath') return 9;
    return 10;
  }

  // ---------------------------------------------------------------- scoring
  /** length of a room's outline that does not touch another room */
  function exteriorLen(rm, rooms) {
    let per = 0;
    for (const r of rm.rects) per += 2 * (TG.rw(r) + TG.rh(r));
    per -= touch(rm.rects, rm.rects);
    for (const o of rooms) if (o !== rm && (o.level || 0) === (rm.level || 0)) per -= touch(rm.rects, o.rects);
    return per;
  }
  function quickScore(plan, ctx) {
    const rooms = plan.rooms;
    let t = 0;
    const byType = (ty) => rooms.filter((r) => r.type === ty);
    let err = 0, n = 0;
    for (const rm of rooms) {
      if (rm.target) { n += rm.target; err += Math.abs(TG.rectsArea(rm.rects) - rm.target); }
      const big = rm.rects.reduce((b, r) => (TG.rarea(r) > TG.rarea(b) ? r : b), rm.rects[0]);
      const ty = T[rm.type], asp = TG.rlong(big) / Math.max(1, TG.rshort(big));
      if (ty.maxAsp && asp > ty.maxAsp) t += (asp - ty.maxAsp) * 4;
      if (ty.win && ty.win.need && ctx.arch.windows !== 0 && exteriorLen(rm, rooms) < 2) t += ty.win.need === 2 ? 10 : 3;
    }
    if (n) t += (err / n) * 25;
    for (const k of byType('kitchen')) if (!byType('dining').concat(byType('family')).some((d) => touch(k.rects, d.rects) >= 4) && byType('dining').length) t += 6;
    for (const h of byType('hall')) {
      if (h.level) continue;                       // an upstairs hallway opens off the stair, not the living rooms
      const ok = rooms.some((r) => ['living', 'foyer', 'dining', 'family'].indexOf(r.type) >= 0 && !r.level && touch(h.rects, r.rects) >= 2);
      if (!ok) t += 5;
    }
    const lv = byType('living')[0];
    if (lv && exteriorLen(lv, rooms) < 4) t += 4;
    return { total: t };
  }
  function score(res, ctx) {
    const rooms = res.rooms, t = {};
    const linked = (i, types) => res.links.some((L) => (L.a === i && types.indexOf(rooms[L.b] ? rooms[L.b].type : '') >= 0) || (L.b === i && types.indexOf(rooms[L.a] ? rooms[L.a].type : '') >= 0));
    rooms.forEach((rm, i) => {
      if (rm.type === 'bedroom' || rm.type === 'bath' || rm.type === 'office') {
        if (linked(i, ['living', 'kitchen', 'dining', 'family'])) t.privacy = (t.privacy || 0) + 4;
      }
      if (rm.type === 'kitchen' && rooms.some((r) => r.type === 'dining') && !linked(i, ['dining', 'family'])) t.layout = (t.layout || 0) + 5;
      if (rm.type === 'bath' && !rm.parent && !linked(i, ['hall', 'foyer'])) t.privacy = (t.privacy || 0) + 3;
      if (rm.type === 'hall' && linked(i, ['kitchen']) && !linked(i, ['living', 'foyer', 'dining', 'family'])) t.layout = (t.layout || 0) + 3;
    });
    // respect the archetype's taste in plan types (T is a variant of bar)
    const pw = ctx.arch.plans || {}, ty = res.plan.meta && res.plan.meta.type === 'T' ? 'bar' : res.plan.meta && res.plan.meta.type;
    const wmax = Math.max(0, ...Object.values(pw));
    if (wmax > 0 && ty) t.planFit = Math.round((1 - (pw[ty] || 0) / wmax) * 6 * 10) / 10;
    const main = res.openings.find((o) => o.kind === 'entrance' && o.conn && o.conn.main);
    if (main) {
      const w = res.walls[main.wall], r = w.lo >= 0 ? w.lo : w.hi;
      if (['foyer', 'living'].indexOf(rooms[r].type) < 0) t.entry = 4;
    }
    return t;
  }

  // -------------------------------------------------------------- wrongness
  const MUTATIONS = {
    twin: { weight: 1, label: 'a room repeats' },
    giant: { weight: 1, label: 'one room is far too big' },
    endless: { weight: 0.8, label: 'the hallway keeps going' },
    windowless: { weight: 0.6, label: 'no windows anywhere' },
    stairs: { weight: 0.8, label: 'stairs up into the ceiling' },
    falseDoors: { weight: 0.9, label: 'doors that open onto walls' },
    ceiling: { weight: 0.8, label: 'a ceiling at the wrong height' }
  };
  function postResolve(res, api) {
    if (!api.ctx.mut.has('falseDoors')) return;
    const rooms = res.rooms, rng = api.rng;
    const walls = res.walls.filter((w) => w.kind === 'interior' && w.s1 - w.s0 >= 5 &&
      [w.lo, w.hi].some((i) => i >= 0 && ['hall', 'living', 'foyer', 'dining', 'family'].indexOf(rooms[i].type) >= 0));
    const n = Math.min(walls.length, rng.int(2, 4));
    for (let k = 0; k < n; k++) {
      const w = walls.splice(rng.int(0, walls.length - 1), 1)[0];
      const s = w.s0 + 1 + rng.int(0, w.s1 - w.s0 - 4);
      if (!api.lineFree(w, s, 2, 1)) continue;
      const circ = [w.lo, w.hi].find((i) => i >= 0 && ['hall', 'living', 'foyer', 'dining', 'family'].indexOf(rooms[i].type) >= 0);
      const op = api.addOpening(w, s, 2, 'false', { into: circ });
      op.tags = ['wrong:falseDoor'];
    }
  }

  TPL.registerEngine({
    id: 'house', name: 'House', types: T, mutations: MUTATIONS,
    program, layout, fallback, quickScore, score, connRule, autoPenalty, postResolve,
    _internal: { touch, slice, layoutPrivate, PLANS }
  });
})(typeof window !== 'undefined' ? window : globalThis);
