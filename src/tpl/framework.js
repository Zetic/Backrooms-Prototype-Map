/*
 * tpl/framework.js - the shared template pipeline (blueprints).
 *
 *   generate(spec) -> building (contract: docs/templates.md, br.building/0.2)
 *
 *   1. site       the allowance the world gives the template (any rectilinear
 *                 shape), turned into a canonical frame (main side = bottom)
 *   2. program    engine.program(archetype)      what to build
 *   3. candidates engine.layout(program) x N     different plans for it
 *   4. pre-score  engine.quickScore              cheap: sizes, shapes, adjacency
 *   5. resolve    best K candidates, per level:  walls, doors, portals
 *                 (entrances / exits), windows, reachability
 *   6. score      generic + engine terms         keep the best valid one
 *   7. output     metres, turned to face the main side
 *
 * Templates produce architecture only: rooms (type + tags), walls, doors,
 * windows, portals and vertical links. Furnishing is left to a later tool,
 * which reads the room types and tags.
 *
 * Engines work in integer kit units (TG.GRID metres) in a canonical frame:
 * x across, y from the back (0) to the main side (H). Everything decided
 * here is integer and seeded: the same spec always gives the same building.
 */
(function (root) {
  'use strict';
  const BR = root.BR;
  const TG = BR.TG;
  const { Rng, hash4 } = BR;

  const TPL = BR.TPL = BR.TPL || {};
  TPL.SCHEMA = 'br.building/0.2';
  TPL.OUTSIDE = -1;                       // 'the backrooms around the template' as a connection target
  TPL.engines = TPL.engines || {};
  TPL.archetypes = TPL.archetypes || {};
  TPL.registerEngine = (e) => { TPL.engines[e.id] = e; };
  TPL.registerArchetype = (a) => { TPL.archetypes[a.id] = a; };
  TPL.listArchetypes = (engine) => Object.keys(TPL.archetypes).map((k) => TPL.archetypes[k]).filter((a) => !engine || a.engine === engine);

  const G = TG.GRID, OUT = -1;
  const PASS = { door: 1, double: 1, opening: 1, slider: 1, vehicle: 1 };     // walkable openings
  const SWING = { door: 1, double: 1, false: 1 };                              // openings with a door leaf
  const SALT = { PROGRAM: 1, MUT: 2, SITE: 4, LAYOUT: 10, RESOLVE: 20 };
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

  // ------------------------------------------------------------ helpers
  /** which side of room `ri` a wall lies on */
  function wallSideOf(w, ri) {
    if (w.o === 'h') return w.lo === ri ? 'S' : 'N';     // room above the line -> wall on its south side
    return w.lo === ri ? 'E' : 'W';
  }
  function swingRect(w, s, len, into, depth) {
    const c = w.c;
    if (w.o === 'h') return w.lo === into ? [s, c - depth, s + len, c] : [s, c, s + len, c + depth];
    return w.lo === into ? [c - depth, s, c, s + len] : [c, s, c + depth, s + len];
  }
  const pk = (lv, a, b) => lv + '|' + (a < b ? a + '|' + b : b + '|' + a);

  /** Pick mutations ('wrongness') for this building. */
  function pickMutations(engine, arch, spec, rng) {
    if (Array.isArray(spec.mutations)) return spec.mutations.slice();
    const w = spec.wrongness !== undefined && spec.wrongness !== null ? spec.wrongness : (arch.wrongness || 0);
    const cat = engine.mutations || {}, keys = Object.keys(cat).filter((k) => !cat[k].requires || cat[k].requires(arch));
    const out = [];
    if (!keys.length) return out;
    const weights = {};
    for (const k of keys) weights[k] = cat[k].weight || 1;
    if (rng.f() < w) out.push(rng.weighted(weights));
    if (out.length && rng.f() < w * 0.6) {
      delete weights[out[0]];
      if (Object.keys(weights).length) out.push(rng.weighted(weights));
    }
    return out;
  }

  // ============================================================ site
  /**
   * The site is the space the world allots the template: spec.site is
   * { w, h } (a rectangle) or { rects: [[x0, y0, x1, y1], ...] } (any
   * rectilinear union), metres, real frame. Without one, the archetype's
   * site ranges are used. Engines get it in canonical units:
   *   { W, H, mask (1 = may build), inner (largest rect), bbox, area }
   */
  function makeSite(spec, arch, seed, ah, approach) {
    let site = spec.site;
    if (!site) {
      const r = new Rng(hash4(seed, ah, SALT.SITE, 0));
      const S = arch.site || { w: [10, 20], h: [10, 20] };
      const sw = Math.round(r.range(S.w[0], S.w[1]) / G) * G, sh = Math.round(r.range(S.h[0], S.h[1]) / G) * G;
      // archetype ranges are canonical (w along the main side)
      site = approach === 'E' || approach === 'W' ? { w: sh, h: sw } : { w: sw, h: sh };
    }
    let rects = site.rects ? site.rects.map((q) => q.slice()) : [[0, 0, site.w, site.h]];
    const bb = TG.bbox(rects);
    rects = rects.map((q) => [q[0] - bb[0], q[1] - bb[1], q[2] - bb[0], q[3] - bb[1]]);
    const rw = Math.round((bb[2] - bb[0]) / G), rh = Math.round((bb[3] - bb[1]) / G);
    const real = new TG.Raster(rw, rh, 0);
    for (const q of rects) real.fill(q.map((v) => Math.round(v / G)), 1);
    const EW = approach === 'E' || approach === 'W';
    const W = EW ? rh : rw, H = EW ? rw : rh;
    const O = TG.orient(approach, W, H);
    const mask = new TG.Raster(W, H, 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = O.pt(x + 0.5, y + 0.5);
      if (real.get(Math.floor(p[0]), Math.floor(p[1])) === 1) mask.set(x, y, 1);
    }
    const inner = TG.largestRect(mask, (v) => v === 1) || [0, 0, 0, 0];
    return { W, H, mask, inner, bbox: [0, 0, W, H], area: mask.count(1), realRects: rects, real: { w: bb[2] - bb[0], h: bb[3] - bb[1] } };
  }

  // ============================================================ resolve
  /**
   * Engine plan -> walls, openings, portals, windows; reachability.
   *
   * plan = { W, H, levels: n (default 1), levelHeights: [m],
   *          rooms: [{ type, zone, level, rects, parent, target, ceiling, tags }],
   *          conns: [{ a, b (room or TPL.OUTSIDE), kind, w, align, near, into,
   *                    side, role, clear, main, margin, minW, prio, required }],
   *          verticals: [{ kind, rooms: [room per level, bottom up], dead }],
   *          meta }
   * Connections to TPL.OUTSIDE are portals: entrances / exits onto the
   * surrounding backrooms, on the room's exterior wall (on `side` if given).
   */
  function resolve(plan, ctx, rng) {
    const E = ctx.engine, T = E.types, rooms = plan.rooms, W = plan.W, H = plan.H;
    const L = plan.levels || 1;
    const res = { plan, W, H, L, rooms, walls: [], openings: [], links: [], portals: [], issues: [], auto: [], failed: [], R: [] };
    // ---- rasters per level
    for (let lv = 0; lv < L; lv++) res.R.push(new TG.Raster(W, H, OUT));
    let overlap = 0, offsite = 0;
    rooms.forEach((rm, i) => {
      const R = res.R[rm.level || 0];
      for (const r of rm.rects) for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) { offsite++; continue; }
        if (R.get(x, y) >= 0) overlap++;
        R.set(x, y, i);
        if (ctx.site.mask.get(x, y) !== 1) offsite++;
      }
    });
    if (overlap) res.issues.push({ hard: true, msg: overlap + ' cells claimed by two rooms' });
    if (offsite) res.issues.push({ hard: true, msg: offsite + ' cells outside the site' });

    // ---- walls
    const byPair = new Map();
    for (let lv = 0; lv < L; lv++) {
      for (const s of TG.boundaries(res.R[lv], OUT)) {
        const kind = s.a >= 0 && s.b >= 0 ? 'interior' : 'exterior';
        const w = { id: res.walls.length, level: lv, kind, o: s.o, c: s.c, s0: s.s0, s1: s.s1, lo: s.a, hi: s.b };
        res.walls.push(w);
        const k = pk(lv, s.a, s.b);
        if (!byPair.has(k)) byPair.set(k, []);
        byPair.get(k).push(w);
      }
    }
    res.byPair = byPair;
    const lineOpenings = new Map();
    const clearances = rooms.map(() => []);
    const privacy = (i) => (i >= 0 && T[rooms[i].type] ? T[rooms[i].type].privacy || 0 : -1);
    const lineKey = (w) => w.level + w.o + w.c;
    function addOpening(w, s, len, kind, conn) {
      const lk = lineKey(w);
      if (!lineOpenings.has(lk)) lineOpenings.set(lk, []);
      lineOpenings.get(lk).push([s, s + len]);
      const op = { id: res.openings.length, wall: w.id, level: w.level, kind, s0: s, s1: s + len, conn: conn || null, into: null, hinge: null };
      if (SWING[kind]) {
        const a = w.lo, b = w.hi;
        let into = conn && conn.into !== undefined ? conn.into : a < 0 ? b : b < 0 ? a : privacy(a) >= privacy(b) ? a : b;
        if (into !== a && into !== b) into = a >= 0 ? a : b;
        op.into = into;
        op.hinge = s - w.s0 <= w.s1 - (s + len) ? 's0' : 's1';
        if (into >= 0) clearances[into].push(swingRect(w, s, len, into, len));
      }
      res.openings.push(op);
      return op;
    }
    function lineFree(w, s, len, gap) {
      const Lo = lineOpenings.get(lineKey(w));
      if (!Lo) return true;
      for (const [a, b] of Lo) if (s < b + gap && a < s + len + gap) return false;
      return true;
    }
    /** Place one connection; returns the opening (or true for 'open'), or null. */
    function place(cn) {
      const lv = rooms[cn.a].level || 0;
      const toOut = cn.b === OUT;
      let ws = (byPair.get(pk(lv, cn.a, cn.b)) || []).slice();
      if (!ws.length) return null;
      if (cn.kind === 'open') {
        for (const w of ws) w.kind = 'open';
        res.links.push({ a: cn.a, b: cn.b, kind: 'open', opening: null });
        return true;
      }
      // portals: keep to the requested side when possible
      let sidePenalty = 0;
      if (toOut && cn.side) {
        const on = ws.filter((w) => wallSideOf(w, cn.a) === cn.side);
        if (on.length) ws = on; else if (cn.strictSide) return null; else sidePenalty = 25;
      }
      const doorish = cn.kind !== 'opening';
      const margin = cn.margin !== undefined ? cn.margin : doorish ? 1 : 0;
      const minW = cn.minW || (cn.kind === 'vehicle' ? 5 : 2);
      let want = cn.w || (cn.kind === 'opening' ? 4 : 2);
      if (cn.kind === 'opening') want = Math.min(want, Math.max(...ws.map((w) => w.s1 - w.s0)) - 2 * margin);
      const margins = doorish && margin > 0 && cn.margin === undefined ? [margin, 0] : [margin];
      for (let len = want; len >= minW; len--) for (const mg of margins) {
        let best = null;
        for (const w of ws) {
          if (w.kind === 'open') continue;
          for (let s = w.s0 + mg; s + len <= w.s1 - mg; s++) {
            if (!lineFree(w, s, len, cn.gap !== undefined ? cn.gap : doorish ? 1 : 0)) continue;
            const mid = s + len / 2, wm = (w.s0 + w.s1) / 2;
            let sc = sidePenalty;
            const align = cn.align || (doorish ? 'end' : 'center');
            if (align === 'center') sc += Math.abs(mid - wm);
            else if (align === 'end') sc += Math.min(s - w.s0, w.s1 - s - len);
            if (cn.near) {
              const p = w.o === 'h' ? [mid, w.c] : [w.c, mid];
              sc += Math.abs(p[0] - cn.near[0]) + Math.abs(p[1] - cn.near[1]);
            }
            if (SWING[cn.kind]) {
              const into = cn.into !== undefined ? cn.into : w.lo < 0 ? w.hi : w.hi < 0 ? w.lo : (privacy(w.lo) >= privacy(w.hi) ? w.lo : w.hi);
              if (into >= 0) {
                const sr = swingRect(w, s, len, into, len);
                for (const c of clearances[into]) if (TG.roverlap(sr, c)) sc += 6;
              }
            }
            sc -= (w.s1 - w.s0) * 0.02;
            sc += rng.f() * 0.4;
            if (!best || sc < best.sc) best = { w, s, sc };
          }
        }
        if (best) {
          const op = addOpening(best.w, best.s, len, cn.kind, cn);
          res.links.push({ a: cn.a, b: cn.b, kind: cn.kind, opening: op.id });
          if (toOut) {
            op.portal = res.portals.length;
            res.portals.push({ opening: op.id, room: cn.a, level: lv, role: cn.role || 'both', kind: cn.kind,
              side: wallSideOf(best.w, cn.a), clear: cn.clear !== undefined ? cn.clear : 1.5, main: !!cn.main, tags: cn.tags || [] });
          }
          return op;
        }
      }
      return null;
    }

    // ---- connections: explicit (by priority), then adjacency rules
    const conns = plan.conns.slice().sort((p, q) => (q.prio || 0) - (p.prio || 0));
    const have = new Set(conns.map((c) => pk(rooms[c.a] ? rooms[c.a].level || 0 : 0, c.a, c.b)));
    const keys = [...byPair.keys()].sort();
    const derived = [];
    for (const k of keys) {
      if (have.has(k)) continue;
      const parts = k.split('|').map(Number), a = parts[1], b = parts[2];
      if (a < 0 || b < 0) continue;
      const rule = E.connRule ? E.connRule(rooms[a], rooms[b], ctx, rng) : null;
      if (rule) derived.push(Object.assign({ a, b, derived: true }, rule));
    }
    derived.sort((p, q) => (q.prio || 0) - (p.prio || 0));
    for (const cn of conns.concat(derived)) {
      if (!place(cn)) {
        res.failed.push(cn);
        if (cn.required) res.issues.push({ hard: cn.b === OUT && !!cn.main, msg: 'could not place ' + cn.kind + ' ' + rooms[cn.a].type + '-' + (cn.b === OUT ? 'outside' : rooms[cn.b].type) });
      }
    }

    // ---- reachability from the outside (through portals and verticals)
    const verts = plan.verticals || [];
    const reach = () => {
      const N = rooms.length, adj = rooms.map(() => []);
      adj.push([]);
      const link = (a, b) => { const x = a < 0 ? N : a, y = b < 0 ? N : b; adj[x].push(y); adj[y].push(x); };
      for (const Lk of res.links) if (Lk.kind === 'open' || PASS[Lk.kind]) link(Lk.a, Lk.b);
      for (const v of verts) for (let k = 1; k < v.rooms.length; k++) link(v.rooms[k - 1], v.rooms[k]);
      const seen = new Uint8Array(N + 1), st = [N];
      seen[N] = 1;
      while (st.length) { const u = st.pop(); for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; st.push(v); } }
      return seen;
    };
    let seen = reach();
    const bad = new Set();
    for (let guard = 0; guard < rooms.length * 2; guard++) {
      const lost = rooms.map((_, i) => i).filter((i) => !seen[i]);
      if (!lost.length) break;
      let best = null;
      for (const k of keys) {
        if (bad.has(k)) continue;
        const parts = k.split('|').map(Number), a = parts[1], b = parts[2];
        if (a < 0 || b < 0 || seen[a] === seen[b]) continue;
        const u = seen[a] ? a : b, v = u === a ? b : a;
        const pen = E.autoPenalty ? E.autoPenalty(rooms[u], rooms[v], ctx) : 5;
        if (!isFinite(pen)) continue;
        if (!best || pen < best.pen) best = { k, u, v, pen };
      }
      if (!best) break;
      if (place({ a: best.u, b: best.v, kind: 'door', w: 2, auto: true, into: best.v })) { res.auto.push({ a: best.u, b: best.v, pen: best.pen }); seen = reach(); }
      else bad.add(best.k);
    }
    const lost = rooms.map((_, i) => i).filter((i) => !seen[i]);
    if (lost.length) res.issues.push({ hard: true, msg: 'unreachable: ' + lost.map((i) => rooms[i].type).join(', ') });
    res.reached = seen;

    // ---- engine hook (false doors, oddities), then windows
    if (E.postResolve) E.postResolve(res, { addOpening, lineFree, rng, ctx, rooms });
    const windows = ctx.arch.windows === undefined ? 1 : ctx.arch.windows;
    if (!ctx.mut.has('windowless') && windows > 0) {
      for (const w of res.walls) {
        if (w.kind !== 'exterior') continue;
        const r = w.lo >= 0 ? w.lo : w.hi, rule = T[rooms[r].type] && T[rooms[r].type].win;
        if (!rule) continue;
        const len = w.s1 - w.s0, wmin = rule.w[0], wmax = rule.w[1];
        if (len < wmin + 2) continue;
        const n = Math.max(1, Math.min(rule.max || 3, Math.floor(len / (rule.every || 8))));
        const part = len / n;
        for (let k = 0; k < n; k++) {
          if (windows < 1 && rng.f() > windows) continue;
          const ww = Math.min(rng.int(wmin, wmax), Math.floor(part) - 1);
          if (ww < wmin) continue;
          let s = Math.round(w.s0 + part * k + (part - ww) / 2);
          s = Math.max(w.s0 + 1, Math.min(w.s1 - 1 - ww, s));
          if (s < w.s0 + 1 || !lineFree(w, s, ww, 1)) continue;
          const op = addOpening(w, s, ww, 'window', null);
          op.sill = rule.sill !== undefined ? rule.sill : 0.9;
          op.head = rule.head !== undefined ? rule.head : 2.1;
        }
      }
    }
    res.clearances = clearances;
    return res;
  }

  // ============================================================ scoring
  function scoreResolved(res, ctx) {
    const E = ctx.engine, T = E.types, rooms = res.rooms, t = {};
    const add = (k, v) => { if (v) t[k] = (t[k] || 0) + v; };
    let area = 0, circ = 0, nT = 0, errSum = 0;
    rooms.forEach((rm, i) => {
      const A = TG.rectsArea(rm.rects), ty = T[rm.type] || {};
      area += A;
      if (ty.zone === 'circulation') circ += A;
      if (rm.target) { nT += rm.target; errSum += Math.abs(A - rm.target); }
      const big = rm.rects.reduce((b, r) => (TG.rarea(r) > TG.rarea(b) ? r : b), rm.rects[0]);
      const asp = TG.rlong(big) / Math.max(1, TG.rshort(big));
      if (ty.maxAsp && asp > ty.maxAsp) add('proportion', (asp - ty.maxAsp) * 4);
      if (ty.win && ty.win.need && !ctx.mut.has('windowless') && ctx.arch.windows !== 0) {
        const has = res.openings.some((o) => o.kind === 'window' && (res.walls[o.wall].lo === i || res.walls[o.wall].hi === i));
        if (!has) add('noWindow', ty.win.need === 2 ? 10 : 3);
      }
    });
    if (nT) add('roomSizes', (errSum / nT) * 25);
    const circMax = ctx.arch.circulation !== undefined ? ctx.arch.circulation : 0.12;
    if (area) add('circulation', Math.max(0, circ / area - circMax) * 60);
    for (const a of res.auto) add('extraDoors', a.pen);
    for (const f of res.failed) add('missingLinks', f.required ? 8 : 1.5);
    if (E.score) { const et = E.score(res, ctx); for (const k in et) add(k, et[k]); }
    let pen = 0;
    for (const k in t) { t[k] = Math.round(t[k] * 10) / 10; pen += t[k]; }
    return { penalty: Math.round(pen * 10) / 10, score: Math.max(0, Math.round((100 - pen) * 10) / 10), terms: t };
  }

  // ============================================================ validate
  function validate(res) {
    const issues = res.issues.slice(), rooms = res.rooms, T = res.ctx.engine.types;
    rooms.forEach((rm) => {
      const ty = T[rm.type];
      if (!ty) { issues.push({ hard: true, msg: 'unknown room type ' + rm.type }); return; }
      if (!rm.rects.length) { issues.push({ hard: true, msg: rm.type + ' has no floor' }); return; }
      for (const r of rm.rects) if (!TG.rvalid(r)) issues.push({ hard: true, msg: rm.type + ' has an empty rect' });
      const big = rm.rects.reduce((b, r) => (TG.rarea(r) > TG.rarea(b) ? r : b), rm.rects[0]);
      if (ty.minW && TG.rshort(big) < ty.minW) issues.push({ hard: true, msg: rm.type + ' narrower than ' + ty.minW * G + ' m' });
      if ((rm.level || 0) >= res.L || (rm.level || 0) < 0) issues.push({ hard: true, msg: rm.type + ' on a level that does not exist' });
    });
    const byLine = new Map();
    for (const op of res.openings) {
      const w = res.walls[op.wall];
      if (op.s0 < w.s0 || op.s1 > w.s1 || op.s1 <= op.s0) issues.push({ hard: true, msg: 'opening outside its wall' });
      const k = w.level + w.o + w.c;
      if (!byLine.has(k)) byLine.set(k, []);
      byLine.get(k).push(op);
    }
    for (const Lo of byLine.values()) {
      Lo.sort((a, b) => a.s0 - b.s0);
      for (let i = 1; i < Lo.length; i++) if (Lo[i].s0 < Lo[i - 1].s1) issues.push({ hard: true, msg: 'overlapping openings' });
    }
    if (!res.portals.some((p) => p.role === 'entrance' || p.role === 'both')) issues.push({ hard: true, msg: 'no entrance' });
    for (const v of res.plan.verticals || []) {
      for (let k = 1; k < v.rooms.length; k++) {
        const a = rooms[v.rooms[k - 1]], b = rooms[v.rooms[k]];
        if (!a || !b || (b.level || 0) !== (a.level || 0) + 1) { issues.push({ hard: true, msg: 'vertical ' + v.kind + ' skips a level' }); break; }
        if (!a.rects.some((p) => b.rects.some((q) => TG.roverlap(p, q)))) { issues.push({ hard: true, msg: 'vertical ' + v.kind + ' is not stacked' }); break; }
      }
    }
    return issues;
  }

  // ============================================================ output
  function output(res, ctx, meta) {
    const spec = ctx.spec, rooms = res.rooms, W = res.W, H = res.H;
    const O = TG.orient(spec.approach || 'S', W * G, H * G);
    const m = (v) => Math.round(v * G * 1000) / 1000;
    const P = (x, y) => O.pt(x, y).map((v) => Math.round(v * 1000) / 1000);
    const Rm = (r) => O.rect(r.map(m));
    const id = (i) => (i >= 0 ? 'r' + i : null);
    const T = ctx.engine.types;
    const counts = {};
    const heights = res.plan.levelHeights || [];
    const levels = [];
    let elev = 0;
    for (let lv = 0; lv < res.L; lv++) { const h = heights[lv] || 3; levels.push({ index: lv, elevation: Math.round(elev * 100) / 100, height: h }); elev += h; }
    const outRooms = rooms.map((rm, i) => {
      counts[rm.type] = (counts[rm.type] || 0) + 1;
      const ty = T[rm.type] || {};
      return {
        id: id(i), type: rm.type, name: (ty.label || rm.type.replace(/_/g, ' ')) + (counts[rm.type] > 1 ? ' ' + counts[rm.type] : ''),
        zone: rm.zone || ty.zone || null, level: rm.level || 0,
        rects: rm.rects.map(Rm), area: Math.round(TG.rectsArea(rm.rects) * G * G * 100) / 100,
        ceiling: rm.ceiling || 2.5,
        tags: (ty.tags || []).concat(rm.tags || []),
        parent: rm.parent !== undefined && rm.parent !== null ? id(rm.parent) : null
      };
    });
    const THICK = { exterior: 0.3, interior: 0.15, open: 0 };
    const walls = res.walls.map((w) => ({
      id: 'w' + w.id, level: w.level, kind: w.kind,
      a: w.o === 'h' ? P(m(w.s0), m(w.c)) : P(m(w.c), m(w.s0)),
      b: w.o === 'h' ? P(m(w.s1), m(w.c)) : P(m(w.c), m(w.s1)),
      rooms: [id(w.lo), id(w.hi)], thickness: THICK[w.kind] || 0
    }));
    const openings = res.openings.map((op) => {
      const w = res.walls[op.wall];
      const pa = w.o === 'h' ? [op.s0, w.c] : [w.c, op.s0], pb = w.o === 'h' ? [op.s1, w.c] : [w.c, op.s1];
      const o = {
        id: 'o' + op.id, level: w.level, wall: 'w' + w.id, kind: op.kind, a: P(m(pa[0]), m(pa[1])), b: P(m(pb[0]), m(pb[1])),
        width: m(op.s1 - op.s0), rooms: [id(w.lo), id(w.hi)]
      };
      if (op.into !== null && op.into !== undefined) { o.swingInto = id(op.into); o.hinge = op.hinge === 's0' ? o.a : o.b; }
      if (op.kind === 'window') { o.sill = op.sill; o.head = op.head; }
      else o.height = op.kind === 'vehicle' ? 2.25 : op.kind === 'opening' ? 2.2 : 2.1;
      if (op.portal !== undefined) o.portal = 'p' + op.portal;
      if (op.tags) o.tags = op.tags;
      return o;
    });
    const portals = res.portals.map((p, i) => ({
      id: 'p' + i, opening: 'o' + p.opening, level: p.level, room: id(p.room), role: p.role, kind: p.kind,
      side: O.side(p.side), width: m(res.openings[p.opening].s1 - res.openings[p.opening].s0), clear: p.clear, main: p.main, tags: p.tags
    }));
    const verticals = (res.plan.verticals || []).map((v, i) => ({ id: 'v' + i, kind: v.kind, rooms: v.rooms.map(id), dead: !!v.dead, tags: v.tags || [] }));
    const footprint = [];
    for (let lv = 0; lv < res.L; lv++) footprint.push({ level: lv, rects: TG.rectsWhere(res.R[lv], (v) => v >= 0).map(Rm) });
    const graph = { nodes: outRooms.map((r) => r.id).concat('outside'), edges: [] };
    for (const Lk of res.links) graph.edges.push([id(Lk.a) || 'outside', id(Lk.b) || 'outside', Lk.kind, Lk.opening !== null ? 'o' + Lk.opening : null]);
    for (const v of verticals) for (let k = 1; k < v.rooms.length; k++) graph.edges.push([v.rooms[k - 1], v.rooms[k], v.kind, null]);
    const S = ctx.site;
    return {
      schema: TPL.SCHEMA, engine: ctx.engine.id, archetype: ctx.arch.id, name: ctx.arch.name || ctx.arch.id,
      seed: spec.seed >>> 0, approach: spec.approach || 'S', grid: G,
      site: { w: S.real.w, h: S.real.h, rects: S.realRects },
      levels, footprint, rooms: outRooms, walls, openings, portals, verticals, graph,
      meta
    };
  }

  // ============================================================ generate
  /**
   * spec: { archetype, seed, site: { w, h } | { rects } (metres, real frame;
   *         default from the archetype), approach: 'S'|'N'|'E'|'W' (the side
   *         the main entrance faces), wrongness (0..1), mutations: [ids],
   *         candidates, resolveTop }
   * Returns a building (docs/templates.md) with .meta, and a non-enumerable
   * ._debug (canonical resolved plan) for tools.
   */
  function generate(spec) {
    const t0 = now();
    const arch = typeof spec.archetype === 'string' ? TPL.archetypes[spec.archetype] : spec.archetype;
    if (!arch) throw new Error('unknown archetype ' + spec.archetype);
    const engine = TPL.engines[arch.engine];
    if (!engine) throw new Error('unknown engine ' + arch.engine);
    const seed = spec.seed >>> 0, ah = TG.hashStr(arch.id);
    const approach = spec.approach || 'S';
    const site = makeSite(spec, arch, seed, ah, approach);
    const base = hash4(seed, ah, site.W * 4096 + site.H, site.area);
    const rs = (salt, i) => new Rng(hash4(base, salt, i | 0, 0x51));
    const mutations = pickMutations(engine, arch, spec, rs(SALT.MUT));
    const ctx = { arch, engine, site, spec: Object.assign({}, spec, { approach, seed }), mutations, mut: new Set(mutations), why: {} };
    const program = engine.program(arch, rs(SALT.PROGRAM), ctx);
    ctx.program = program;
    const N = spec.candidates || arch.candidates || 36, K = spec.resolveTop || 6;
    const cands = [];
    for (let i = 0; i < N; i++) {
      const plan = engine.layout(program, ctx, rs(SALT.LAYOUT, i));
      if (!plan) continue;
      const qs = engine.quickScore ? engine.quickScore(plan, ctx) : { total: 0 };
      cands.push({ i, plan, quick: qs.total });
    }
    cands.sort((a, b) => a.quick - b.quick || a.i - b.i);
    let best = null, tried = 0, valid = 0;
    const tryCand = (c) => {
      tried++;
      const res = resolve(c.plan, ctx, rs(SALT.RESOLVE, c.i));
      res.ctx = ctx;
      const hard = validate(res).filter((x) => x.hard);
      res.score = scoreResolved(res, ctx);
      if (hard.length) { const k = 'invalid: ' + hard[0].msg.replace(/^[0-9]+ /, ''); ctx.why[k] = (ctx.why[k] || 0) + 1; return; }
      valid++;
      if (!best || res.score.penalty < best.res.score.penalty) best = { c, res };
    };
    for (let k = 0; k < cands.length && k < K; k++) tryCand(cands[k]);
    for (let k = K; !best && k < cands.length; k++) tryCand(cands[k]);
    if (!best && engine.fallback) {
      const plan = engine.fallback(program, ctx, rs(SALT.LAYOUT, 9999));
      if (plan) tryCand({ i: 9999, plan, quick: 0 });
    }
    if (!best) {
      return { schema: TPL.SCHEMA, error: 'no valid layout', engine: engine.id, archetype: arch.id, name: arch.name || arch.id, seed, approach,
        site: { w: site.real.w, h: site.real.h, rects: site.realRects }, meta: { candidates: cands.length, tried, mutations, layoutFailures: ctx.why, ms: Math.round((now() - t0) * 10) / 10 } };
    }
    const res = best.res;
    const issues = validate(res);
    const meta = {
      plan: best.c.plan.meta || {}, score: res.score.score, penalty: res.score.penalty, terms: res.score.terms,
      candidates: cands.length, resolved: tried, valid, chosen: best.c.i, mutations, layoutFailures: ctx.why,
      program: program.summary || null,
      issues: issues.map((x) => (x.hard ? 'ERROR ' : '') + x.msg),
      autoDoors: res.auto.map((a) => res.rooms[a.a].type + '-' + res.rooms[a.b].type),
      ms: 0
    };
    const b = output(res, ctx, meta);
    meta.ms = Math.round((now() - t0) * 10) / 10;
    Object.defineProperty(b, '_debug', { value: { res, ctx }, enumerable: false });
    return b;
  }

  /** Size class of an archetype from its site ranges (for tools): tiny / small / medium / large / huge. */
  function sizeClass(arch) {
    const S = arch.site;
    if (!S) return 'medium';
    const a = ((S.w[0] + S.w[1]) / 2) * ((S.h[0] + S.h[1]) / 2);
    return a < 12 ? 'tiny' : a < 150 ? 'small' : a < 1500 ? 'medium' : a < 15000 ? 'large' : 'huge';
  }

  /**
   * An irregular site outline for a cw x ch site (canonical: cw along the main
   * side). Cuts come out of the back, so the main side always stays whole.
   * shape: rect | L | U | notched | random. step: the snap (default the kit
   * grid; the world uses whole metres). Returns rects in the real frame, turned
   * to face `approach`, origin (0, 0).
   */
  function siteShape(cw, ch, shape, rng, approach, step) {
    step = step || G;
    const snap = (v) => Math.max(step, Math.round(v / step) * step);
    const f = (a, b) => snap(rng.range(a, b));
    let rects = [[0, 0, cw, ch]];
    const cut = (q) => { const out = []; for (const a of rects) for (const p of TG.rsub(a, q)) out.push(p); rects = out; };
    if (shape === 'L') { const w = f(cw * 0.3, cw * 0.5), h = f(ch * 0.3, ch * 0.55); cut(rng.f() < 0.5 ? [cw - w, 0, cw, h] : [0, 0, w, h]); }
    else if (shape === 'U') { const w = f(cw * 0.25, cw * 0.45), h = f(ch * 0.3, ch * 0.5), x = snap((cw - w) / 2); cut([x, 0, x + w, h]); }
    else if (shape === 'notched') { const n = rng.int(1, 3); for (let k = 0; k < n; k++) { const w = f(step, cw * 0.25), h = f(step, ch * 0.3), x = snap(rng.range(0, cw - w)); cut([x, 0, x + w, h]); } }
    else if (shape === 'random') {
      cut([0, 0, snap(rng.range(0, cw * 0.4)), f(ch * 0.2, ch * 0.7)]);
      cut([cw - snap(rng.range(0, cw * 0.4)), 0, cw, f(ch * 0.2, ch * 0.7)]);
      if (rng.f() < 0.5) { const w = f(step, cw * 0.2), x = f(cw * 0.3, cw * 0.6); cut([x, 0, x + w, f(step, ch * 0.4)]); }
    }
    rects = rects.filter((q) => q[2] - q[0] >= step && q[3] - q[1] >= step);
    const O = TG.orient(approach || 'S', cw, ch);
    return rects.map((q) => O.rect(q));
  }

  Object.assign(TPL, { generate, resolve, scoreResolved, validate, pickMutations, makeSite, sizeClass, siteShape });
})(typeof window !== 'undefined' ? window : globalThis);
