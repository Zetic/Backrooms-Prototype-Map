/*
 * claims.js - several owners stacked in one column (milestone 5).
 *
 * A column of the world is not one owner's any more. A claim is a volume with
 * a bottom and a top; claims in the same column touch but never overlap, and
 * the slab of the claim above is the ceiling of the claim below. A ground site
 * with something over it keeps its floor and has its ceiling capped
 * (E.capCeilings); the owner above starts at its own floor slab.
 *
 * Two mechanics live here, both pure functions of the blueprints they are
 * given, so the world (band-world.js) and the lab can use the same ones:
 *
 *   raiseStair  a template's own stairwell carried on up: a landing one
 *               storey above its top floor, on the same footprint, run out
 *               to the edge of its lot on the side its stairwell wall faces,
 *               with a door there. The template's own stair (tpl/floors.js,
 *               tpl/connections.js) climbs the new flight; nothing on the
 *               ground floor moves, so the ground plan is unchanged.
 *   pit         a drop drilled from a raised floor straight down into the
 *               next exposed volume: a cutout in the floor above, a cutout
 *               in the ceiling below, and one `drop` record on each
 *               blueprint naming the other. A pit is never a way up: the
 *               world reads the pair as one directed edge down (no ladder,
 *               no rope).
 *
 *   CLAIM.stairTop(b)                      its top stairwell and the sides it faces
 *   CLAIM.raiseStair(b, { z, side, reach, width })
 *   CLAIM.pitSpot(top, bottom, opts)       where a pit can drill through
 *   CLAIM.drill(top, bottom, spot, id)     cut it, both sides
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG;
  const CLAIM = BR.CLAIM = {};
  const EPS = 1e-7, round = (n) => Math.round(n * 1000) / 1000, clone = (v) => JSON.parse(JSON.stringify(v));
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const overlap = (a, b) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;
  const contains = (r, q) => q[0] >= r[0] - EPS && q[1] >= r[1] - EPS && q[2] <= r[2] + EPS && q[3] <= r[3] + EPS;
  const grow = (r, m) => [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
  const segRect = (w) => [Math.min(w.a[0], w.b[0]), Math.min(w.a[1], w.b[1]), Math.max(w.a[0], w.b[0]), Math.max(w.a[1], w.b[1])];
  const touches = (a, b) => a[0] <= b[2] + EPS && a[2] >= b[0] - EPS && a[1] <= b[3] + EPS && a[3] >= b[1] - EPS;
  const extend = (q, side, d) => side === 'N' ? [q[0], q[1] - d, q[2], q[3]] : side === 'S' ? [q[0], q[1], q[2], q[3] + d]
    : side === 'W' ? [q[0] - d, q[1], q[2], q[3]] : [q[0], q[1], q[2] + d, q[3]];
  const edgeOf = (q, side) => side === 'N' ? [[q[0], q[1]], [q[2], q[1]]] : side === 'S' ? [[q[0], q[3]], [q[2], q[3]]]
    : side === 'W' ? [[q[0], q[1]], [q[0], q[3]]] : [[q[2], q[1]], [q[2], q[3]]];
  const nextId = (list, prefix) => { const used = new Set(list.map((x) => x.id)); let k = list.length; while (used.has(prefix + k)) k++; return prefix + k; };

  /**
   * A template's top stairwell: the highest room of a real stair of its own,
   * if it is on the template's top floor, with the elevation of that floor,
   * the room's clear height and the sides whose walls are exterior (where a
   * landing above it could run out of the building). null if it has none.
   */
  CLAIM.stairTop = function stairTop(b) {
    if (!b || b.error || !b.levels || b.schema === (BR.ELEV && BR.ELEV.SCHEMA)) return null;
    const lv = (k) => (b.levels.find((l) => l.index === (k || 0)) || b.levels[0]).elevation;
    const topLevel = Math.max(...b.levels.map((l) => l.index));
    let best = null;
    for (const v of b.verticals || []) {
      if (v.dead || v.kind !== 'stair' || !Array.isArray(v.rooms) || v.rooms.length < 2) continue;
      const rooms = v.rooms.map((id) => b.rooms.find((r) => r.id === id)).filter(Boolean);
      const room = rooms.sort((p, q) => (p.level || 0) - (q.level || 0))[rooms.length - 1];
      if (!room || (room.level || 0) !== topLevel || room.rects.length !== 1) continue;
      if (best && (best.room.level || 0) >= (room.level || 0)) continue;
      const q = room.rects[0], sides = [];
      for (const side of ['N', 'E', 'S', 'W']) {
        const [a, c] = edgeOf(q, side);
        const on = (b.walls || []).filter((w) => (w.level || 0) === (room.level || 0) && (w.rooms || []).includes(room.id)
          && Math.abs(w.a[0] - w.b[0]) < EPS === (Math.abs(a[0] - c[0]) < EPS) && touches(segRect(w), grow([a[0], a[1], c[0], c[1]], EPS)));
        if (on.length && on.every((w) => w.kind === 'exterior' && (w.rooms || []).includes(null))) sides.push(side);
      }
      best = { vertical: v, room, rect: q.slice(), floorZ: round(lv(room.level)), ceilingZ: round(lv(room.level) + (room.ceiling || 2.5)), sides };
    }
    return best;
  };

  /**
   * Carry a template's stairwell on up to a landing at `z` (metres above its
   * ground floor): the stairwell's footprint again, run out by `reach` metres
   * through the wall on `side` (so it reaches the edge of its lot), with a
   * door of `width` on that far edge. The template's own stair lays out the
   * new flight where it fits (E.bakeStairs), and nothing below it moves.
   * Returns { b (a copy), room, portal, opening, door: { o, c, s0, s1 },
   * rect, z } or null when it does not fit.
   */
  CLAIM.raiseStair = function raiseStair(src, opts) {
    const E = BR.ELEV, o = opts || {}, z = o.z, side = o.side, reach = o.reach === undefined ? 2 : o.reach;
    if (!Number.isFinite(z) || !OPP[side] || !(reach >= 0)) throw new Error('a raised landing needs a height, a side and a reach');
    const stair = CLAIM.stairTop(src);
    if (!stair || !stair.sides.includes(side)) return null;
    // the landing needs the floor below it to end under its own slab
    if (stair.ceilingZ > z - E.SLAB + EPS || z - stair.floorZ < 3 - EPS) return null;
    const b = clone(src), room = b.rooms.find((r) => r.id === stair.room.id), v = (b.verticals || []).find((x) => x.id === stair.vertical.id);
    if (!room || !v) return null;
    const rect = extend(stair.rect, side, reach).map(round), ceiling = o.ceiling === undefined ? 2.4 : o.ceiling;
    if (rect[0] < -EPS || rect[1] < -EPS) return null;              // a landing never leaves its own frame
    b.site = { ...b.site, w: Math.max(b.site.w, rect[2]), h: Math.max(b.site.h, rect[3]) };
    b.site.rects = [[0, 0, b.site.w, b.site.h]];
    const id = nextId(b.rooms, 'r'), level = Math.max(...b.levels.map((l) => l.index)) + 1;
    b.levels.push({ index: level, elevation: round(z), height: ceiling });
    b.rooms.push({ id, type: 'stairwell', name: 'raised landing', zone: 'circulation', level, rects: [rect.slice()],
      area: Math.round((rect[2] - rect[0]) * (rect[3] - rect[1]) * 100) / 100, ceiling, tags: ['circulation', 'stair', 'vertical', 'raised'], parent: null });
    (b.footprint = b.footprint || []).push({ level, rects: [rect.slice()] });
    const pts = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];
    const walls = pts.map((p, k) => ({ id: nextId(b.walls, 'w') + ':' + k, level, kind: 'exterior', a: p.slice(), b: pts[(k + 1) % 4].slice(), rooms: [id, null], thickness: 0.3 }));
    b.walls.push(...walls);
    // the door out, centred on the far edge
    const [a, c] = edgeOf(rect, side), horiz = Math.abs(a[1] - c[1]) < EPS, run = horiz ? c[0] - a[0] : c[1] - a[1];
    const width = Math.min(o.width === undefined ? 2 : o.width, Math.max(1, run - 1));
    if (width < 1 - EPS) return null;
    // on the half metre, as every connection in the world is, so the floor it
    // opens onto can put its own opening in exactly the same place
    const s0 = round(Math.round(((horiz ? a[0] : a[1]) + (run - width) / 2) * 2) / 2), s1 = round(s0 + width);
    if (s0 < (horiz ? a[0] : a[1]) - EPS || s1 > (horiz ? c[0] : c[1]) + EPS) return null;
    const same = (p, q) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS;
    const wall = walls.find((w) => (same(w.a, a) && same(w.b, c)) || (same(w.a, c) && same(w.b, a)));
    if (!wall) return null;
    const oid = nextId(b.openings, 'o'), pid = nextId(b.portals, 'p');
    b.openings.push({ id: oid, level, wall: wall.id, kind: 'opening', a: horiz ? [s0, a[1]] : [a[0], s0], b: horiz ? [s1, a[1]] : [a[0], s1],
      width, rooms: [id, null], height: 2.2, portal: pid, tags: ['raised'] });
    b.portals.push({ id: pid, opening: oid, level, room: id, role: 'exit', kind: 'opening', side, width, clear: width, main: false, tags: ['raised branch'] });
    b.graph.nodes.push(id);
    b.graph.edges.push([id, 'outside', 'opening', oid]);
    v.rooms = v.rooms.concat(id);
    // the new flight: laid out and kept on the template, as its other stairs are
    const had = (src.stairs && src.stairs.links.length) || 0;
    E.bakeStairs(b);
    if (!b.stairs || b.stairs.links.length <= had || !b.stairs.links.some((l) => l.connector.to === 's:' + id)) return null;
    return { b, room: id, portal: pid, opening: oid, rect, z: round(z), ceiling,
      door: { o: horiz ? 'h' : 'v', c: horiz ? a[1] : a[0], s0, s1, width, side } };
  };

  // ------------------------------------------------------------ pits
  /** is `rect` (blueprint frame) floor of surface `s` that nothing else uses? */
  function freeFloor(b, s, rect, keep) {
    const E = BR.ELEV;
    if (!s.rects.some((q) => contains(q, rect))) return false;
    if ((b.walls || []).some((w) => w.kind !== 'open' && (w.rooms || []).includes(s.room) && touches(segRect(w), grow(rect, keep)))) return false;
    if ((b.columns || []).some((c) => overlap(c.rect, grow(rect, keep)))) return false;
    if ((b.holes || []).some((h) => overlap(h.rect, grow(rect, keep)))) return false;
    for (const c of b.connectors || []) for (const v of E.reservationsOf(c)) for (const q of v.rects) if (overlap(q, grow(rect, keep))) return false;
    for (const d of b.drops || []) if (overlap(d.rect, grow(rect, keep))) return false;
    return true;
  }
  /** everything a blueprint holds that a shaft may not pass through */
  function solidOf(b) {
    const E = BR.ELEV, out = [];
    for (const s of b.surfaces) out.push({ id: s.id, rects: s.rects, z0: s.floorZ - (s.slab || E.SLAB), z1: s.ceilingZ });
    for (const c of b.connectors || []) for (const v of E.reservationsOf(c)) out.push(v);
    for (const v of b.voids || []) out.push(v);
    return out;
  }
  const crosses = (list, rect, z0, z1, skip) => list.some((v) => v.id !== skip && v.z0 < z1 - EPS && z0 < v.z1 - EPS && v.rects.some((q) => overlap(q, rect)));
  /**
   * Where a pit can drill from `top` down into `bottom`: a square of
   * `opts.size` metres that is clear floor on a surface of the top blueprint,
   * drills straight down through whatever solid lies between (templates put
   * no openings in their roofs), and comes out in the ceiling of a surface of
   * the bottom one, at least `opts.fall` metres below. Nothing else may stand
   * in the shaft. Both blueprints are spatial (absolute Z) and sit at their
   * own world origins. The spot furthest from the ways into the top blueprint
   * wins, so a pit is something you come across rather than fall into at the
   * door. Deterministic: the scan and the order are fixed.
   * Returns { rect (world), fall, shaft: { z0, z1 },
   *           top: { surface, rect, floorZ }, bottom: { surface, rect, floorZ, ceilingZ } } or null.
   */
  CLAIM.pitSpot = function pitSpot(top, bottom, opts) {
    const o = opts || {}, size = o.size === undefined ? 2 : o.size, fall = o.fall === undefined ? 3 : o.fall;
    const to = o.topOrigin || [0, 0], bo = o.bottomOrigin || [0, 0], keep = o.keep === undefined ? 0.3 : o.keep;
    const doors = (top.portals || []).map((p) => [p.at[0] + to[0], p.at[1] + to[1]]);
    const above = solidOf(top), below = solidOf(bottom);
    let best = null;
    for (const s of top.surfaces.slice().sort((a, c) => a.id.localeCompare(c.id))) {
      for (const q of s.rects) for (let y = Math.ceil(q[1] * 2) / 2; y + size <= q[3] + EPS; y += 0.5) for (let x = Math.ceil(q[0] * 2) / 2; x + size <= q[2] + EPS; x += 0.5) {
        const rect = [round(x), round(y), round(x + size), round(y + size)];
        if (!freeFloor(top, s, rect, keep)) continue;
        const world = [rect[0] + to[0], rect[1] + to[1], rect[2] + to[0], rect[3] + to[1]];
        const low = [round(world[0] - bo[0]), round(world[1] - bo[1]), round(world[2] - bo[0]), round(world[3] - bo[1])];
        // the floor it comes out in: the highest one far enough below whose
        // ceiling the shaft can reach without crossing anything
        const under = bottom.surfaces.filter((v) => s.floorZ - v.floorZ >= fall - EPS && freeFloor(bottom, v, low, keep)
          && !crosses(below, low, v.ceilingZ, s.floorZ - (s.slab || BR.ELEV.SLAB), v.id)
          && !crosses(above, rect, s.floorZ - (s.slab || BR.ELEV.SLAB), s.floorZ, s.id))
          .sort((a, c) => c.floorZ - a.floorZ || a.id.localeCompare(c.id))[0];
        if (!under) continue;
        const centre = [(world[0] + world[2]) / 2, (world[1] + world[3]) / 2];
        const away = doors.length ? Math.min(...doors.map((p) => Math.hypot(centre[0] - p[0], centre[1] - p[1]))) : 0;
        if (!best || away > best.away + EPS) best = { away, rect: world, fall: round(s.floorZ - under.floorZ),
          shaft: { z0: round(under.ceilingZ), z1: round(s.floorZ - (s.slab || BR.ELEV.SLAB)) },
          top: { surface: s.id, rect, floorZ: s.floorZ }, bottom: { surface: under.id, rect: low, floorZ: under.floorZ, ceilingZ: round(under.ceilingZ) } };
      }
    }
    if (!best) return null;
    delete best.away;
    return best;
  };

  /**
   * Cut a pit: the floor of the surface above and the ceiling of the surface
   * below, and a `drop` record on each blueprint naming the pit. Nothing is
   * added to climb it. Either blueprint may be left out (the world cuts each
   * side where it owns it). Returns the pit's id.
   */
  /** half of a pit named on a blueprint, with no cutout: what a template-shaped
   * blueprint carries, so the map can draw the pit before anything is adapted */
  CLAIM.markDrop = function markDrop(b, spot, id, role) {
    const part = role === 'top' ? spot.top : spot.bottom;
    b.drops = (b.drops || []).filter((d) => !(d.id === id && d.role === role))
      .concat([{ id, role, surface: part.surface, rect: part.rect.slice(), kind: 'pit', fall: spot.fall }]);
    if (BR.ELEV.invalidateView) BR.ELEV.invalidateView(b);
    return id;
  };
  CLAIM.drill = function drill(top, bottom, spot, id) {
    if (!spot || !id) throw new Error('a pit needs a spot and an id');
    const cut = (b, part, face, role) => {
      if (!b) return;
      b.holes = (b.holes || []).filter((h) => h.connector !== id || h.face !== face);
      b.holes.push({ id: id + ':' + face, connector: id, surface: part.surface, face, rect: part.rect.slice(), kind: 'pit' });
      // the same half again, now with the shaft it reserves
      b.drops = (b.drops || []).filter((d) => !(d.id === id && d.role === role));
      b.drops.push({ id, role, surface: part.surface, rect: part.rect.slice(), kind: 'pit', fall: spot.fall, z0: spot.shaft.z0, z1: spot.shaft.z1 });
      if (BR.ELEV.invalidateView) BR.ELEV.invalidateView(b);
    };
    cut(top, spot.top, 'floor', 'top');
    cut(bottom, spot.bottom, 'ceiling', 'bottom');
    // the shaft itself is the lower claim's to protect: solid it has given up,
    // which nothing else may build in
    if (bottom && spot.shaft.z1 > spot.shaft.z0 + EPS && !(bottom.voids || []).some((v) => v.id === 'void:' + id)) {
      const v = BR.ELEV.prism([spot.bottom.rect], spot.shaft.z0, spot.shaft.z1, 'pit', 'void:' + id);
      bottom.voids = (bottom.voids || []).concat([v]);
      bottom.volumes = (bottom.volumes || []).concat([clone(v)]);
    }
    return id;
  };
})(typeof window !== 'undefined' ? window : globalThis);
