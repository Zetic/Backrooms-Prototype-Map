/*
 * tpl/connections.js - connection zones: where a template can climb or
 * descend, and the stairs, ramps and ladders that fit there.
 *
 * A connection zone is an opportunity, not a connection. It records an area
 * of one room's floor, where a route would start and arrive, its height
 * change, type, width and headroom. An unselected zone cuts no floor, reserves
 * no space and adds no traversal edge. connectionVariant() selects one: it
 * builds the route's destination landing, the explicit floor/ceiling cutouts
 * its space passes through, its navigation edge, and a reservation that
 * follows its slope.
 *
 *   ladder  the compact fallback every template has (elevation.js)
 *   stair   a flight at about 35 degrees, 1 m wide, a metre of landing each end
 *   ramp    at most 1 in 4, 1.5 m wide, 1.5 m of landing each end
 *
 * Two shapes, both laid along a room wall:
 *
 *   straight     [entry ][ flight ............ ][landing]
 *
 *   switchback   [entry ][ flight 1 .... ][turn]       lane A
 *                [landng][ flight 2 .... ][    ]       lane B
 *
 * Rules (what a stair or ramp is) come from the catalogue (CAT.CONNECTIONS).
 * What a template prefers is its own (`vertical: { prefer: [...] }` on a recipe
 * or filler); preference never overrides physics: a type that does not fit is
 * refused, and `auto` falls back down the list to the ladder.
 *
 * A route's reservation is a run of short prisms, one per half metre of
 * flight, each from just under its walking surface to its headroom. Space
 * under the high end of a flight stays free for whatever fits there.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, E = BR.ELEV, TPL = BR.TPL, CAT = TPL.CAT;
  const G = 0.5, EPS = 1e-7, LANDING_CEIL = 2.2, DEFAULT_PREFER = ['stair', 'ramp', 'ladder'];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const round = (n) => Math.round(n * 1000) / 1000;
  const up05 = (v) => Math.ceil(v / G - EPS) * G;
  const overlap = (a, b) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;

  /** what this template prefers, most preferred first; the ladder always closes the list */
  function preferenceOf(b) {
    const id = (b.source && b.source.archetype) || b.archetype || b.filler;
    const A = TPL.archetypes[id] || (BR.FILL && BR.FILL.fillers && BR.FILL.fillers[id]);
    const list = ((A && A.vertical && A.vertical.prefer) || DEFAULT_PREFER).filter((t) => CAT.CONNECTIONS[t]);
    return list.includes('ladder') ? list : list.concat('ladder');
  }

  /**
   * The height a route climbs or descends by default. Up: its landing floor
   * must clear the host room's ceiling and slab. Down: the landing's own
   * headroom and slab must fit under the host floor. An explicit rise is kept
   * exactly and refused if it cannot fit.
   */
  function riseFor(dir, host, explicit) {
    if (explicit !== undefined && explicit !== null) return explicit;
    const need = dir === 'up' ? host.ceilingZ - host.floorZ + E.SLAB : LANDING_CEIL + E.SLAB;
    return Math.max(3, round(Math.ceil(need * 20 - EPS) / 20));
  }
  const minRise = (dir, host) => (dir === 'up' ? host.ceilingZ - host.floorZ + E.SLAB : LANDING_CEIL + E.SLAB);

  // ------------------------------------------------------------ geometry
  /**
   * The layout of one route in its own frame: u along the run, v across it.
   * Returns { len, W, pieces: [{ u0, u1, v0, v1, z0, z1, part }], landing (u/v
   * rect of the destination), arrival (the landing edge the route arrives
   * over: { u, v0, v1 }), path: [[u, v, z]] }. z is relative to the host floor.
   */
  function layout(type, shape, dz) {
    const R = CAT.CONNECTIONS[type], w = R.width, e = R.landing, rise = Math.abs(dz);
    const pieces = [], step = (u0, u1, v0, v1, za, zb, part) => {
      // a flight in half-metre pieces, each with its own heights
      const n = Math.max(1, Math.round(Math.abs(u1 - u0) / G)), dir = u1 >= u0 ? 1 : -1;
      for (let k = 0; k < n; k++) {
        const a = u0 + dir * k * G, b = a + dir * G, ha = round(za + (zb - za) * (k / n)), hb = round(za + (zb - za) * ((k + 1) / n));
        pieces.push({ u0: Math.min(a, b), u1: Math.max(a, b), v0, v1, z0: Math.min(ha, hb), z1: Math.max(ha, hb), part, from: ha, to: hb });
      }
    };
    if (shape === 'straight') {
      const L = up05(rise / R.design);
      pieces.push({ u0: 0, u1: e, v0: 0, v1: w, z0: 0, z1: 0, part: 'entry', from: 0, to: 0 });
      step(e, e + L, 0, w, 0, dz, 'flight');
      return { len: e + L + e, W: w, run: L, pieces, landing: [e + L, 0, e + L + e, w], arrival: { u: e + L, v0: 0, v1: w },
        path: [[e / 2, w / 2, 0], [e, w / 2, 0], [e + L, w / 2, dz], [e + L + e / 2, w / 2, dz]] };
    }
    // switchback: two flights side by side, a turn landing at half height
    const L = up05(rise / R.design / 2), zm = round(dz / 2);
    pieces.push({ u0: 0, u1: e, v0: 0, v1: w, z0: 0, z1: 0, part: 'entry', from: 0, to: 0 });
    step(e, e + L, 0, w, 0, zm, 'flight');
    pieces.push({ u0: e + L, u1: e + L + w, v0: 0, v1: 2 * w, z0: zm, z1: zm, part: 'turn', from: zm, to: zm });
    step(e + L, e, w, 2 * w, zm, dz, 'flight');
    return { len: e + L + w, W: 2 * w, run: 2 * L, pieces, landing: [0, w, e, 2 * w], arrival: { u: e, v0: w, v1: 2 * w },
      path: [[e / 2, w / 2, 0], [e, w / 2, 0], [e + L, w / 2, zm], [e + L + w / 2, w / 2, zm], [e + L + w / 2, 1.5 * w, zm], [e + L, 1.5 * w, zm], [e, 1.5 * w, dz], [e / 2, 1.5 * w, dz]] };
    void s;
  }
  /** placement: (ox, oy) is where u = 0, v = 0 sits; axis 'h' runs along x, 'v' along y; sign which way */
  const toXY = (pl, u, v) => (pl.axis === 'h' ? [pl.ox + pl.sign * u, pl.oy + v] : [pl.ox + v, pl.oy + pl.sign * u]);
  function toRect(pl, q) {
    const a = toXY(pl, q[0], q[1]), b = toXY(pl, q[2], q[3]);
    return [round(Math.min(a[0], b[0])), round(Math.min(a[1], b[1])), round(Math.max(a[0], b[0])), round(Math.max(a[1], b[1]))];
  }

  // ------------------------------------------------------------ the host room
  /** a room's floor as a grid of half-metre cells, with what must stay clear */
  function hostGrid(b, s) {
    const room = b.rooms.find((r) => r.id === s.room), bb = TG.bbox(s.rects);
    const W = Math.round((bb[2] - bb[0]) / G), H = Math.round((bb[3] - bb[1]) / G), cell = new Uint8Array(W * H);
    const at = (x, y) => [Math.floor((x - bb[0]) / G + EPS), Math.floor((y - bb[1]) / G + EPS)];
    const fill = (q, v, arr) => { for (let y = q[1]; y < q[3] - EPS; y += G) for (let x = q[0]; x < q[2] - EPS; x += G) { const [i, j] = at(x, y); if (i >= 0 && j >= 0 && i < W && j < H) arr[j * W + i] = v; } };
    for (const q of s.rects) fill(q, 1, cell);
    const solid = []; // columns and existing floor cutouts: nobody walks there
    for (const c of b.columns || []) if (c.room === s.room) solid.push(c.rect);
    for (const h of b.holes || []) if (h.surface === s.id && h.face === 'floor') solid.push(h.rect);
    const keep = []; // zones a route must keep off (paths, playgrounds, pads), though people walk them
    for (const z of b.zones || []) if (z.room === s.room && !(CAT.ZONES[z.type] && CAT.ZONES[z.type].routes)) keep.push(...z.rects);
    const open = b.walls.filter((w) => w.kind === 'open' && (w.rooms || []).includes(s.room)).map((w) => [Math.min(w.a[0], w.b[0]), Math.min(w.a[1], w.b[1]), Math.max(w.a[0], w.b[0]), Math.max(w.a[1], w.b[1])]);
    const partitions = b.walls.filter((w) => w.kind === 'partition' && (w.rooms || []).includes(s.room)).map((w) => [Math.min(w.a[0], w.b[0]), Math.min(w.a[1], w.b[1]), Math.max(w.a[0], w.b[0]), Math.max(w.a[1], w.b[1])]);
    // a metre clear inside every way into the room: doors, openings, open boundaries
    const doors = [], inRoom = (p) => s.rects.some((q) => p[0] > q[0] && p[0] < q[2] && p[1] > q[1] && p[1] < q[3]);
    const gaps = b.openings.filter((o) => (o.rooms || []).includes(s.room) && !['window', 'false'].includes(o.kind) && (o.floorZ === undefined || o.floorZ === s.floorZ)).map((o) => [o.a, o.b])
      .concat(b.walls.filter((w) => w.kind === 'open' && (w.rooms || []).includes(s.room)).map((w) => [w.a, w.b]));
    for (const [a, c] of gaps) {
      const horiz = Math.abs(a[1] - c[1]) < EPS, m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const d = horiz ? (inRoom([m[0], m[1] + 0.25]) ? 1 : -1) : (inRoom([m[0] + 0.25, m[1]]) ? 1 : -1);
      doors.push(horiz ? [Math.min(a[0], c[0]), Math.min(m[1], m[1] + d), Math.max(a[0], c[0]), Math.max(m[1], m[1] + d)] : [Math.min(m[0], m[0] + d), Math.min(a[1], c[1]), Math.max(m[0], m[0] + d), Math.max(a[1], c[1])]);
    }
    /** how much of a line along the room's edge is a real wall: not this room's floor beyond it, not an open boundary */
    const walled = (x0, y0, x1, y1, ox, oy) => {
      let n = 0, k = 0;
      for (let t = 0.25; t < Math.hypot(x1 - x0, y1 - y0); t += G) {
        const f = t / Math.hypot(x1 - x0, y1 - y0), x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f; k++;
        if (inRoom([x + ox, y + oy])) continue;
        if (open.some((q) => x >= q[0] - EPS && x <= q[2] + EPS && y >= q[1] - EPS && y <= q[3] + EPS)) continue;
        n++;
      }
      return k ? n / k : 0;
    };
    return { s, room, bb, W, H, cell, at, solid, keep, partitions, doors, walled };
  }
  /** can a 1 m walker still reach every way in, and the route's entry, on what is left of the floor? */
  function walkable(g, blocked, entry) {
    const { W, H, bb } = g, free = g.cell.slice();
    const mark = (q) => { for (let y = q[1]; y < q[3] - EPS; y += G) for (let x = q[0]; x < q[2] - EPS; x += G) { const [i, j] = g.at(x, y); if (i >= 0 && j >= 0 && i < W && j < H) free[j * W + i] = 0; } };
    for (const q of blocked.concat(g.solid)) mark(q);
    const stand = (i, j) => i >= 0 && j >= 0 && i + 1 < W && j + 1 < H && free[j * W + i] && free[j * W + i + 1] && free[(j + 1) * W + i] && free[(j + 1) * W + i + 1];
    const seen = new Uint8Array(W * H);
    const touches = (q) => { const out = []; for (let j = 0; j + 1 < H; j++) for (let i = 0; i + 1 < W; i++) { const x = bb[0] + i * G, y = bb[1] + j * G; if (x < q[2] - EPS && x + 1 > q[0] + EPS && y < q[3] - EPS && y + 1 > q[1] + EPS && stand(i, j)) out.push(j * W + i); } return out; };
    const goals = g.doors.concat([entry]).map(touches);
    if (goals.some((l) => !l.length)) return false;
    const todo = [goals[0][0]]; seen[goals[0][0]] = 1;
    while (todo.length) {
      const k = todo.pop(), i = k % W, j = (k - i) / W;
      for (const [a, c] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (stand(a, c) && !seen[c * W + a]) { seen[c * W + a] = 1; todo.push(c * W + a); }
    }
    return goals.every((l) => l.some((k) => seen[k]));
  }
  const segHits = (q, r) => q[0] < r[2] - EPS && q[2] > r[0] + EPS && q[1] < r[3] - EPS && q[3] > r[1] + EPS;

  /**
   * The route's prisms in world space: each piece from just under its walking
   * surface to its headroom. A piece at or above an endpoint floor rests on it.
   */
  function prisms(pl, lay, host, dz, clearance) {
    const out = [], floors = [host.floorZ, host.floorZ + dz];
    const pieces = lay.pieces.concat([{ u0: lay.landing[0], u1: lay.landing[2], v0: lay.landing[1], v1: lay.landing[3], z0: dz, z1: dz, part: 'landing' }]);
    for (const p of pieces) {
      const lo = host.floorZ + p.z0, hi = host.floorZ + p.z1;
      let z0 = lo - E.SLAB;
      for (const f of floors) if (f <= lo + EPS && f > z0) z0 = f;
      out.push({ rect: toRect(pl, [p.u0, p.v0, p.u1, p.v1]), z0: round(z0), z1: round(hi + clearance), part: p.part, lo, hi });
    }
    return out;
  }

  /** every candidate placement along the walls of one room, cheapest checks first */
  function* placements(g, lay) {
    for (const q of g.s.rects) for (const axis of ['h', 'v']) {
      const span = axis === 'h' ? [q[0], q[2]] : [q[1], q[3]], across = axis === 'h' ? [q[1], q[3]] : [q[0], q[2]];
      if (span[1] - span[0] < lay.len - EPS || across[1] - across[0] < lay.W - EPS) continue;
      for (const side of [0, 1]) for (const sign of [1, -1]) {
        const o = side ? across[1] - lay.W : across[0];
        for (let t = span[0]; t + lay.len <= span[1] + EPS; t += G) {
          const start = sign > 0 ? t : t + lay.len;
          yield axis === 'h' ? { axis, sign, ox: start, oy: o } : { axis, sign, ox: o, oy: start };
        }
      }
    }
  }

  /** the best spot for one type and shape in one room, or null */
  function fit(b, g, type, shape, dir, rise, why) {
    const R = CAT.CONNECTIONS[type], host = g.s, dz = dir === 'up' ? rise : -rise;
    if (host.ceilingZ - host.floorZ < R.clearance - EPS) { why.push(type + ': ' + host.id + ' too low'); return null; }
    if (rise < minRise(dir, host) - EPS) { why.push(type + ': a ' + rise + ' m ' + dir + ' route cannot clear ' + host.id); return null; }
    const lay = layout(type, shape, dz), others = b.surfaces.filter((s) => s.id !== host.id);
    const cands = [];
    for (const pl of placements(g, lay)) {
      const all = lay.pieces.map((p) => toRect(pl, [p.u0, p.v0, p.u1, p.v1])), dest = toRect(pl, lay.landing);
      const foot = all.concat([dest]);
      // the whole footprint is this room's floor
      let ok = true;
      for (const r of foot) for (let y = r[1]; ok && y < r[3] - EPS; y += G) for (let x = r[0]; x < r[2] - EPS; x += G) { const [i, j] = g.at(x, y); if (i < 0 || j < 0 || i >= g.W || j >= g.H || !g.cell[j * g.W + i]) { ok = false; break; } }
      if (!ok || foot.some((r) => g.solid.some((q) => overlap(q, r)) || g.keep.some((q) => overlap(q, r)) || g.partitions.some((q) => segHits(q, r)))) continue;
      // laid along a real wall: one long side of the route mostly against it
      const box = TG.bbox(foot), along = pl.axis === 'h';
      const sides = along ? [[box[0], box[1], box[2], box[1], 0, -0.25], [box[0], box[3], box[2], box[3], 0, 0.25]] : [[box[0], box[1], box[0], box[3], -0.25, 0], [box[2], box[1], box[2], box[3], 0.25, 0]];
      if (Math.max(...sides.map((q) => g.walled(...q))) < 0.75) continue;
      // at the host's floor, the parts of the route nobody can walk on: the
      // flights, unless (going down) they already run beneath the floor
      const P = prisms(pl, lay, host, dz, R.clearance);
      const blocked = P.filter((p) => p.part !== 'entry' && p.part !== 'landing' && p.z0 < host.floorZ + R.clearance - EPS && p.z1 > host.floorZ - E.SLAB + EPS).map((p) => p.rect);
      if (blocked.concat(all.slice(0, 1)).some((r) => g.doors.some((d) => overlap(d, r)))) continue;
      const c = [(foot[0][0] + dest[2]) / 2, (foot[0][1] + dest[3]) / 2];
      const score = g.doors.length ? Math.min(...g.doors.map((d) => Math.hypot(c[0] - (d[0] + d[2]) / 2, c[1] - (d[1] + d[3]) / 2))) : 0;
      cands.push({ pl, lay, P, blocked, entry: all[0], dest, score });
    }
    cands.sort((a, c) => c.score - a.score);
    for (const k of cands.slice(0, 40)) {
      // nothing else in the template occupies the route's space
      if (others.some((s) => k.P.some((p) => E.volumeOverlap({ rects: [p.rect], z0: p.z0, z1: p.z1 }, E.prism(s.rects, s.floorZ - s.slab, s.ceilingZ))))) continue;
      if (!walkable(g, k.blocked, k.entry)) continue;
      return k;
    }
    why.push(type + ' (' + shape + '): no ' + round(lay.len) + ' × ' + round(lay.W) + ' m area along a wall of ' + host.id + ' keeps its doors reachable');
    return null;
  }

  /** a zone record from a fitted placement */
  function zoneOf(b, g, type, shape, dir, rise, k) {
    const R = CAT.CONNECTIONS[type], host = g.s, dz = dir === 'up' ? rise : -rise;
    const path = k.lay.path.map(([u, v, z]) => { const p = toXY(k.pl, u, v); return [round(p[0]), round(p[1]), round(host.floorZ + z)]; });
    return {
      id: 'zone:' + dir + ':' + type + ':' + host.id, kind: 'connection-zone', owner: b.fillId, direction: dir, type, shape, state: 'available',
      surface: host.id, room: host.room, rects: k.lay.pieces.map((p) => toRect(k.pl, [p.u0, p.v0, p.u1, p.v1])).concat([k.dest]),
      entry: path[0].slice(), exit: path[path.length - 1].slice(), floorZ: host.floorZ, targetZ: round(host.floorZ + dz), rise: round(rise),
      width: R.width, clearance: R.clearance, run: round(k.lay.run), slope: round(rise / k.lay.run), destination: k.dest, path,
      plan: { axis: k.pl.axis, sign: k.pl.sign, ox: k.pl.ox, oy: k.pl.oy }
    };
  }

  /**
   * Every connection zone of a prepared blueprint: one per direction and type
   * that fits, in the best room for it (straight before switchback). The
   * ladder's zone is its compact hatch. opts: { rise, direction, types }.
   * Unselected zones change nothing else in the blueprint.
   */
  function findZones(b, caps, opts) {
    const o = opts || {}, zones = [], notes = { up: [], down: [] };
    for (const dir of o.direction ? [o.direction] : ['up', 'down']) {
      const lad = caps && caps[dir] && caps[dir].candidates[0];
      if (lad && (!o.types || o.types.includes('ladder'))) {
        const s = b.surfaces.find((x) => x.id === lad.surface);
        zones.push({ id: 'zone:' + dir + ':ladder:' + s.id, kind: 'connection-zone', owner: b.fillId, direction: dir, type: 'ladder', shape: 'shaft', state: 'available',
          surface: s.id, room: s.room, rects: [lad.landing.slice()], hatch: lad.hatch.slice(), entry: lad.at.slice(), exit: [lad.at[0], lad.at[1], round(lad.at[2] + (dir === 'up' ? 8 : -8))],
          floorZ: s.floorZ, targetZ: round(s.floorZ + (dir === 'up' ? 8 : -8)), rise: 8, width: CAT.CONNECTIONS.ladder.width, clearance: CAT.CONNECTIONS.ladder.clearance, destination: lad.landing.slice() });
      }
      // the floors a route may leave from: the top floor going up, the bottom going down
      const ext = dir === 'up' ? Math.max(...b.surfaces.map((s) => s.floorZ)) : Math.min(...b.surfaces.map((s) => s.floorZ));
      const hosts = b.surfaces.filter((s) => Math.abs(s.floorZ - ext) < EPS && !String(s.room).startsWith('elev:'))
        .sort((p, q) => TG.rectsArea(q.rects) - TG.rectsArea(p.rects) || p.id.localeCompare(q.id)).slice(0, 5);
      const grids = new Map();
      for (const type of ['stair', 'ramp']) {
        if (o.types && !o.types.includes(type)) continue;
        let found = null;
        for (const shape of ['straight', 'switchback']) {
          for (const s of hosts) {
            const rise = riseFor(dir, s, o.rise);
            if (!grids.has(s.id)) grids.set(s.id, hostGrid(b, s));
            const k = fit(b, grids.get(s.id), type, shape, dir, rise, notes[dir]);
            if (k) { found = zoneOf(b, grids.get(s.id), type, shape, dir, rise, k); break; }
          }
          if (found) break;
        }
        if (found) zones.push(found);
      }
    }
    Object.defineProperty(zones, 'notes', { value: notes, enumerable: false });
    return zones;
  }

  // ------------------------------------------------------------ selecting a zone
  /** a stair or ramp variant of the blueprint, built in its zone */
  function build(b, z) {
    const trial = clone(b), R = CAT.CONNECTIONS[z.type], host = trial.rooms.find((r) => r.id === z.room), dir = z.direction, dz = z.targetZ - z.floorZ;
    const pl = { axis: z.plan.axis, sign: z.plan.sign, ox: z.plan.ox, oy: z.plan.oy }, lay = layout(z.type, z.shape, dz);
    const id = 'elev:' + z.type + ':' + dir;
    const target = { id: 'elev:landing:' + dir, type: 'landing', name: (dir === 'up' ? 'Upper' : 'Lower') + ' landing', zone: 'circulation', floorZ: z.targetZ, ceiling: LANDING_CEIL, ceilingZ: round(z.targetZ + LANDING_CEIL), band: dir,
      rects: [z.destination.slice()], area: TG.rarea(z.destination), tags: ['vertical-landing', z.type] };
    trial.rooms.push(target); trial.bands.push({ id: dir, elevation: z.targetZ });
    const hs = trial.surfaces.find((s) => s.room === host.id);
    const P = prisms(pl, lay, hs, dz, R.clearance);
    const c = { id, kind: z.type, shape: z.shape, zone: z.id, from: 's:' + host.id, to: 's:' + target.id, state: 'connected', direction: 'both', width: R.width, clearance: R.clearance,
      slope: z.slope, rise: z.rise, landings: [z.path[0].slice(), z.path[z.path.length - 1].slice()], path: z.path.map((p) => p.slice()),
      reservations: P.map((p, k) => E.prism([p.rect], p.z0, p.z1, 'connector', 'volume:' + id + ':' + k)) };
    trial.connectors.push(c);
    trial.graph.nodes.push(target.id); trial.graph.edges.push([host.id, target.id, z.type, id]);
    // cut the host's floor (going down) or ceiling (going up) wherever the
    // route's space passes through it, merged into as few rects as possible
    const bb = TG.bbox(hs.rects), ras = { floor: new TG.Raster(Math.round((bb[2] - bb[0]) / G), Math.round((bb[3] - bb[1]) / G), 0), ceiling: null };
    ras.ceiling = new TG.Raster(ras.floor.W, ras.floor.H, 0);
    for (const p of P) {
      const q = [Math.round((p.rect[0] - bb[0]) / G), Math.round((p.rect[1] - bb[1]) / G), Math.round((p.rect[2] - bb[0]) / G), Math.round((p.rect[3] - bb[1]) / G)];
      if (p.z0 < hs.floorZ - EPS && p.z1 > hs.floorZ - hs.slab + EPS) ras.floor.fill(q, 1);
      if (p.z0 < hs.ceilingZ - EPS && p.z1 > hs.ceilingZ + EPS) ras.ceiling.fill(q, 1);
    }
    for (const face of ['floor', 'ceiling']) TG.rectsWhere(ras[face], (v) => v === 1).forEach((q, k) => {
      trial.holes.push({ id: id + ':' + face + ':' + k, connector: id, surface: hs.id, face, rect: [bb[0] + q[0] * G, bb[1] + q[1] * G, bb[0] + q[2] * G, bb[1] + q[3] * G].map(round) });
    });
    // the landing: walled on three sides, open where the route arrives
    const d = z.destination, arr = lay.arrival, ends = [toXY(pl, arr.u, arr.v0), toXY(pl, arr.u, arr.v1)].map((p) => p.map(round));
    const corners = [[d[0], d[1]], [d[2], d[1]], [d[2], d[3]], [d[0], d[3]]];
    for (let k = 0; k < 4; k++) {
      const a = corners[k], e = corners[(k + 1) % 4], wid = 'elev:w:' + target.id + ':' + k;
      const isArrival = [a, e].every((p) => ends.some((q) => Math.abs(q[0] - p[0]) < EPS && Math.abs(q[1] - p[1]) < EPS));
      trial.walls.push({ id: wid, kind: 'exterior', a: a.slice(), b: e.slice(), rooms: [target.id, null], thickness: 0.3, floorZ: target.floorZ, ceilingZ: target.ceilingZ });
      if (isArrival) trial.openings.push({ id: 'elev:o:' + target.id, wall: wid, kind: 'opening', a: a.slice(), b: e.slice(), width: round(Math.hypot(e[0] - a[0], e[1] - a[1])), rooms: [target.id, null], height: LANDING_CEIL, floorZ: target.floorZ, tags: ['arrival', z.type] });
    }
    trial.kind = z.type + '-variant';
    trial.route = c.path.map((p) => p.slice());
    const zones = clone(b.connectionZones || []), caps = clone(b.capabilities);
    E.refresh(trial, { zones, capabilities: caps });
    trial.capabilities[dir].selected = true; trial.capabilities[dir].connection = id; trial.capabilities[dir].type = z.type;
    return trial;
  }

  /**
   * A connected variant of any template: { direction: 'up' | 'down', type:
   * 'auto' (the template's preference, falling back to the ladder) | 'ladder'
   * | 'stair' | 'ramp', rise (m, exact; default: the least that clears),
   * reservations (a ReservationIndex to claim the space in) }. An explicit type
   * that does not fit is refused with the reason.
   */
  function connectionVariant(source, options) {
    const o = Object.assign({ direction: 'up', type: 'auto' }, options || {}), dir = o.direction;
    if (!['up', 'down'].includes(dir)) throw new Error('connection direction must be up or down');
    if (o.type !== 'auto' && !CAT.CONNECTIONS[o.type]) throw new Error('unknown connection type ' + o.type);
    const b = E.prepare(source, o), order = o.type === 'auto' ? preferenceOf(b) : [o.type], tried = [];
    for (const type of order) {
      if (type === 'ladder') {
        try { return E.ladderVariant(source, Object.assign({}, o, { direction: dir, rise: o.rise === undefined ? undefined : o.rise })); } catch (err) { tried.push('ladder: ' + err.message); continue; }
      }
      const zones = o.rise === undefined ? b.connectionZones : findZones(b, b.capabilities, { rise: o.rise, direction: dir, types: [type] });
      const z = zones.find((x) => x.direction === dir && x.type === type);
      if (!z) { tried.push(...((zones.notes && zones.notes[dir]) || []).filter((n) => n.startsWith(type)).slice(0, 2)); if (!zones.notes) tried.push(type + ': no zone'); continue; }
      if (o.rise !== undefined) { b.connectionZones = (b.connectionZones || []).filter((x) => x.id !== z.id).concat(z); }
      const v = build(b, z), check = E.validate(v);
      if (check.errors.length) { tried.push(type + ': ' + check.errors[0]); continue; }
      if (o.reservations) {
        const claim = o.reservations.reserve(v.fillId, v.volumes);
        if (!claim.ok) { tried.push(type + ': reservation conflicts with ' + claim.conflicts[0].owner); continue; }
      }
      return v;
    }
    throw new Error('no ' + (o.type === 'auto' ? '' : o.type + ' ') + dir + ' connection fits this instance: ' + tried.join('; '));
  }

  Object.assign(E, { findZones, connectionVariant, preferenceOf, riseFor, layoutRoute: layout, DEFAULT_PREFER });
})(typeof window !== 'undefined' ? window : globalThis);
