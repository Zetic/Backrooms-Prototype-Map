/* Presentation reads blueprint geometry; it never changes generation. */
(function (root) {
  'use strict';
  const BR = root.BR, E = BR.ELEV, TG = BR.TG, EPS = 1e-7, viewCache = new WeakMap();
  const zLabel = (z) => (z > 0 ? '+' : '') + Math.round(z * 1000) / 1000 + ' m';
  const bigRect = (rs) => rs.reduce((a, b) => TG.rarea(b) > TG.rarea(a) ? b : a);
  // (a template's room: its level's height, plus its own `floor` offset - a sunken floor sits lower)
  const roomZ = (b, r, base) => Number.isFinite(r.floorZ) ? r.floorZ : Math.round(((base || 0) + (b.levels.find((l) => l.index === (r.level || 0)) || b.levels[0]).elevation + (r.floor || 0)) * 1000) / 1000;
  /**
   * The connections a drawing shows, the cutouts they make and the floors they
   * join: a spatial blueprint's own, or a template's kept stairs (b.stairs,
   * elevation.js) lifted to its base height. Map painting never adapts a
   * template, so this is how it shows the way up to a gallery, a storey or
   * down into a sunken floor.
   */
  const partsCache = new WeakMap();
  function partsOf(b, base) {
    if (b.schema === E.SCHEMA || !b.stairs) return { connectors: b.connectors || [], holes: b.holes || [], surfaces: b.surfaces || [] };
    base = base || 0;
    let m = partsCache.get(b);
    if (!m) { m = new Map(); partsCache.set(b, m); }
    if (!m.has(base)) {
      const links = E.keptStairs ? E.keptStairs(b) || [] : [];
      m.set(base, { connectors: links.map((l) => E.liftConnector(l.connector, base)), holes: links.flatMap((l) => l.holes),
        surfaces: links.length ? b.rooms.map((r) => ({ id: 's:' + r.id, rects: r.rects, floorZ: roomZ(b, r, base) })) : [] });
      while (m.size > 4) m.delete(m.keys().next().value);
    }
    return m.get(base);
  }
  const inRect = (r, x, y) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
  const subtract = (rs, cuts) => cuts.reduce((rs, q) => rs.flatMap((r) => TG.rsub(r, q)), rs);
  function union(rs) { const out = []; for (const r of rs) out.push(...subtract([r], out)); return out; }
  function floorRecords(b, base) {
    const all = partsOf(b, base).holes;
    return b.rooms.map((r) => {
      const holes = all.filter((h) => h.surface === 's:' + r.id && h.face === 'floor').map((h) => h.rect);
      return { room: r, level: r.level || 0, floorZ: roomZ(b, r, base), rects: subtract(r.rects, holes), holes };
    });
  }
  function floorElevations(b, base) { return [...new Set(b.rooms.map((r) => roomZ(b, r, base)))].sort((a, c) => a - c); }
  // Visibility changes only at real floors. Cache at most eight such plans per
  // blueprint, rather than a new geometry plan for every slider position.
  function cutawayPlan(b, height, base) {
    base = base || 0;
    let cache = viewCache.get(b);
    if (!cache || cache.base !== base) { cache = { base, records: floorRecords(b, base), floors: floorElevations(b, base), plans: new Map() }; viewCache.set(b, cache); }
    const index = cache.floors.filter((z) => z <= height + EPS).length - 1;
    if (cache.plans.has(index)) return cache.plans.get(index);
    const groups = [], visible = [], cover = [];
    for (let k = index; k >= 0; k--) {
      const z = cache.floors[k], records = cache.records.filter((r) => r.floorZ === z);
      const parts = records.map((r) => ({ ...r, rects: subtract(r.rects, cover) })).filter((r) => r.rects.length);
      if (parts.length) groups.push({ level: records[0].level, floorZ: z, records: parts, occluders: union(cover.concat(records.flatMap((r) => r.holes))) });
      visible.push(...parts); cover.push(...subtract(records.flatMap((r) => r.rects), cover));
    }
    const plan = { groups: groups.reverse(), visible }; cache.plans.set(index, plan);
    while (cache.plans.size > 8) cache.plans.delete(cache.plans.keys().next().value);
    return plan;
  }
  function hitCutaway(b, x, y, height, base) { return cutawayPlan(b, height, base).visible.find((r) => r.rects.some((q) => inRect(q, x, y))) || null; }
  function exclude(g, b, rs, X, Y, S) {
    if (!rs.length) return;
    g.beginPath(); g.rect(X(-1), Y(-1), (b.site.w + 2) * S, (b.site.h + 2) * S);
    for (const r of rs) g.rect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S);
    g.clip('evenodd');
  }
  const interpolate = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function strip(a, b, width) {
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]); if (run < EPS) return null;
    const nx = -(b[1] - a[1]) / run * width / 2, ny = (b[0] - a[0]) / run * width / 2;
    return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
  }
  const reservedOf = (c) => (E.reservationsOf ? E.reservationsOf(c) : c.reservation ? [c.reservation] : []);
  /** a generated stair or ramp: its half-metre pieces, each with its walking height */
  const piecesOf = (c) => {
    const vs = reservedOf(c);
    if (c.kind === 'ladder' || vs.length < 2 || !vs.every((v) => v.rects.length === 1)) return null;
    return vs.map((v) => ({ rect: v.rects[0], pts: [[v.rects[0][0], v.rects[0][1]], [v.rects[0][2], v.rects[0][1]], [v.rects[0][2], v.rects[0][3]], [v.rects[0][0], v.rects[0][3]]], z: v.z1 - c.clearance }));
  };
  function connectionAreas(c, height, floors) {
    const pieces = piecesOf(c);
    if (pieces) return pieces.map((p) => ({ pts: p.pts, above: p.z > height + EPS, z: p.z }));
    if (c.kind === 'ladder') return reservedOf(c).flatMap((v) => v.rects).map((r) => ({ pts: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], above: Math.min(...c.path.map((p) => p[2])) > height + EPS, z: Math.min(...c.path.map((p) => p[2])) }));
    const areas = [];
    for (let k = 1; k < c.path.length; k++) {
      const a = c.path[k - 1], b = c.path[k], ts = [0, 1];
      if (a[2] !== b[2]) for (const z of [height].concat(floors || [])) { const t = (z - a[2]) / (b[2] - a[2]); if (t > EPS && t < 1 - EPS) ts.push(t); }
      const sorted = [...new Set(ts)].sort((a, b) => a - b);
      for (let j = 1; j < sorted.length; j++) {
        const A = interpolate(a, b, sorted[j - 1]), B = interpolate(a, b, sorted[j]), pts = strip(A, B, c.width);
        if (pts) areas.push({ pts, above: (A[2] + B[2]) / 2 > height + EPS, z: (A[2] + B[2]) / 2 });
      }
    }
    return areas;
  }
  function pointInPolygon(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; }
    return inside;
  }
  function connectionAt(b, x, y, height, ghost, base) { return partsOf(b, base).connectors.find((c) => (ghost || Math.min(...c.path.map((p) => p[2])) <= height + EPS) && connectionAreas(c, height).some((a) => pointInPolygon(a.pts, x, y))) || null; }
  function tag(g, text, x, y, align, color) {
    g.save(); g.font = '11px system-ui'; const w = g.measureText(text).width;
    const left = align === 'right' ? x-w : align === 'center' ? x-w/2 : x;
    g.fillStyle = 'rgba(28,27,25,0.86)'; g.fillRect(left-3,y-11,w+6,15);
    g.fillStyle = color || '#e5cc9b'; g.textAlign = 'left'; g.fillText(text,left,y); g.restore();
  }
  // Colours: what the route is made of, and which way its far end lies.
  const INK = { ladder: '#d6bd84', stair: '#b99f78', ramp: '#c8b69a', edge: '#705b3e', hatch: '#262421', above: '#b5a4c5', below: '#86acd0' };
  const rectPts = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  function poly(g, pts, X, Y) { g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.closePath(); }
  /** is this XY under a visible floor higher than z (so whatever is at z is hidden from above)? */
  const coveredAbove = (plan, x, y, z) => plan.visible.some((r) => r.floorZ > z + EPS && r.rects.some((q) => x > q[0] && x < q[2] && y > q[1] && y < q[3]));
  /** the visible floor at an XY, if any, with the ceiling of its room */
  const floorAt = (plan, x, y) => plan.visible.find((r) => r.rects.some((q) => x > q[0] && x < q[2] && y > q[1] && y < q[3])) || null;
  const ceilingOf = (rec) => (Number.isFinite(rec.room.ceilingZ) ? rec.room.ceilingZ : rec.floorZ + (rec.room.ceiling || 2.5));
  /**
   * A vertical connection at the cut: the area it occupies at its width, where
   * it climbs or descends, and its far landing.
   *   visible       solid, at its width (stairs show a line every half metre)
   *   above the cut faint and dashed: its continuation overhead
   *   hidden below  a dashed outline over the floor that covers it
   *   ladder        its footprint outlined, its hatch a dark square (solid
   *                 when the hatch is in the floor you look at, dashed when it
   *                 is overhead) - never painted like a room
   * The far landing is outlined in both directions: violet above, blue below.
   */
  function drawConnections(g, b, o, plan, X, Y, S) {
    const parts = partsOf(b, o.baseZ);
    for (const c of parts.connectors) {
      const zs = c.path.map((p) => p[2]), lo = Math.min(...zs), hi = Math.max(...zs);
      if (lo > o.cutZ + EPS && !o.ghost) continue;
      const far = c.landings[0][2] <= o.cutZ + EPS && c.landings[1][2] > o.cutZ + EPS ? 1 : c.landings[1][2] <= o.cutZ + EPS && c.landings[0][2] > o.cutZ + EPS ? 0
        : Math.abs(c.landings[0][2] - o.cutZ) <= Math.abs(c.landings[1][2] - o.cutZ) ? 1 : 0;
      const farZ = c.landings[far][2], farUp = farZ > c.landings[1 - far][2];
      // (layer 'labels': only the tags, drawn last over every blueprint's walls)
      if (o.layer === 'labels') {} else if (c.kind === 'ladder') {
        if (o.layer === 'walls' || o.layer === undefined) {
          const foot = reservedOf(c).flatMap((v) => v.rects), hole = parts.holes.find((h) => h.connector === c.id) || null;
          g.save(); g.strokeStyle = INK.edge; g.lineWidth = Math.max(1, S * 0.05);
          for (const r of foot) { poly(g, rectPts(r), X, Y); g.stroke(); }
          if (hole) {
            const open = hi <= o.cutZ + EPS;          // the hatch is in the floor you see
            poly(g, rectPts(hole.rect), X, Y);
            if (open) { g.fillStyle = INK.hatch; g.fill(); }
            g.setLineDash(open ? [] : [3, 3]); g.strokeStyle = farUp ? INK.above : INK.below; g.stroke(); g.setLineDash([]);
            // rungs
            const r = hole.rect, n = 3; g.strokeStyle = open ? '#8d7a5b' : INK.edge; g.lineWidth = 1; g.beginPath();
            for (let k = 1; k <= n; k++) { const y = r[1] + (r[3] - r[1]) * k / (n + 1); g.moveTo(X(r[0] + 0.06), Y(y)); g.lineTo(X(r[2] - 0.06), Y(y)); }
            g.stroke();
          }
          g.restore();
        }
      } else for (const area of connectionAreas(c, o.cutZ, plan.visible.map((r) => r.floorZ))) {
        const cx = area.pts.reduce((n, p) => n + p[0], 0) / area.pts.length, cy = area.pts.reduce((n, p) => n + p[1], 0) / area.pts.length;
        // a piece is in view while it is inside the room you look into: below
        // that room's ceiling and not under a floor nearer the cut
        if (piecesOf(c)) { const rec = floorAt(plan, cx, cy); area.above = rec ? area.z >= ceilingOf(rec) - EPS && area.z > o.cutZ + EPS : area.z > o.cutZ + EPS; }
        const hidden = !area.above && coveredAbove(plan, cx, cy, area.z);
        g.save(); poly(g, area.pts, X, Y);
        if (area.above || hidden) {
          if (o.layer !== 'floors') { g.globalAlpha *= area.above ? 0.35 : 0.6; g.setLineDash(area.above ? [5, 4] : [2, 3]); g.strokeStyle = area.above ? INK.above : INK.below; g.lineWidth = Math.max(1, S * 0.05); g.stroke(); }
        } else {
          if (o.layer !== 'walls') { g.fillStyle = INK[c.kind] || INK.ramp; g.fill(); }
          if (o.layer !== 'floors') {
            g.strokeStyle = INK.edge; g.lineWidth = Math.max(1, S * 0.05); g.stroke();
            if (c.kind === 'stair' && S >= 8 && !piecesOf(c)) {
              // a line across the flight every half metre: it reads as a stair without modelling steps
              const p = area.pts, len = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), n = Math.floor(len / 0.5);
              g.lineWidth = 1; g.strokeStyle = 'rgba(80,64,42,0.55)'; g.beginPath();
              for (let k = 1; k <= n; k++) { const t = k * 0.5 / len, a = [p[0][0] + (p[1][0] - p[0][0]) * t, p[0][1] + (p[1][1] - p[0][1]) * t], d = [p[3][0] + (p[2][0] - p[3][0]) * t, p[3][1] + (p[2][1] - p[3][1]) * t]; g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(d[0]), Y(d[1])); }
              g.stroke();
            }
          }
        }
        g.restore();
      }
      if (o.layer === 'floors' || (o.deferLabels && o.layer !== 'labels')) continue;
      // the far landing, in either direction
      const dest = parts.surfaces.find((s) => s.id === (far ? c.to : c.from));
      if (dest && o.focus !== false && Math.abs(farZ - o.cutZ) > EPS) {
        g.save(); g.strokeStyle = farUp ? INK.above : INK.below; g.setLineDash([4, 3]); g.lineWidth = Math.max(1, S * 0.05);
        const inset = c.kind === 'ladder' ? 0.08 : 0;
        for (const r of dest.rects) g.strokeRect(X(r[0] + inset), Y(r[1] + inset), (r[2] - r[0] - 2 * inset) * S, (r[3] - r[1] - 2 * inset) * S);
        g.restore();
        if (S >= 5 && c.kind !== 'ladder') { const r = dest.rects[0]; tag(g, (farUp ? '↑ ' : '↓ ') + 'landing ' + zLabel(farZ), X((r[0] + r[2]) / 2), Y(r[1]) - 4, 'center', farUp ? INK.above : INK.below); }
      }
      if (S >= 5) {
        // one label per connection: what it is, and the two heights it joins
        const a = c.path[0], d = c.path[c.path.length - 1];
        const segments = c.path.slice(1).map((p, k) => ({ a: c.path[k], b: p, run: Math.hypot(p[0] - c.path[k][0], p[1] - c.path[k][1]) })).sort((p, q) => q.run - p.run);
        const segment = segments[0], mid = c.kind === 'ladder' ? [a[0], a[1]] : [(segment.a[0] + segment.b[0]) / 2, (segment.a[1] + segment.b[1]) / 2];
        const mx = X(mid[0]), my = Y(mid[1]);
        g.save(); g.font = '11px system-ui';
        if (segment.run > EPS && c.kind !== 'ladder') {
          const ux = (segment.b[0] - segment.a[0]) / segment.run, uy = (segment.b[1] - segment.a[1]) / segment.run, climbs = segment.b[2] > segment.a[2] ? 1 : -1;
          g.strokeStyle = '#473a29'; g.lineWidth = 1.5; g.beginPath();
          g.moveTo(mx - ux * 7, my - uy * 7); g.lineTo(mx + ux * 7, my + uy * 7);
          // the arrow points uphill
          g.moveTo(mx + ux * 2 * climbs - uy * 4, my + uy * 2 * climbs + ux * 4); g.lineTo(mx + ux * 7 * climbs, my + uy * 7 * climbs); g.lineTo(mx + ux * 2 * climbs + uy * 4, my + uy * 2 * climbs - ux * 4);
          g.stroke();
        }
        tag(g, c.kind + ' ' + zLabel(a[2]) + ' → ' + zLabel(d[2]), mx, my + (c.kind === 'ladder' ? -12 : 21), 'center'); g.restore();
      }
    }
  }
  /**
   * Pits (claims.js): a square drilled straight down, never climbed. In the
   * floor you look at it is a dark square outlined in blue (what is below);
   * from the room underneath, the way it is open overhead is dashed and
   * faint. A pit has no route to draw: nothing goes up it.
   */
  function drawPits(g, b, o, plan, X, Y, S) {
    for (const d of (b.drops || []).slice().sort((p, q) => (p.id + p.role).localeCompare(q.id + q.role))) {
      const room = b.rooms.find((r) => 's:' + r.id === d.surface);
      if (!room) continue;
      const z = roomZ(b, room, o.baseZ), top = d.role === 'top';
      const seen = top ? z <= o.cutZ + EPS : z <= o.cutZ + EPS && o.cutZ < z + (d.fall || 0) - EPS;
      if (!seen) continue;
      if (o.layer !== 'labels') {
        g.save(); poly(g, rectPts(d.rect), X, Y);
        if (top) { g.fillStyle = INK.hatch; g.fill(); g.setLineDash([]); } else { g.globalAlpha *= 0.5; g.setLineDash([3, 3]); }
        g.strokeStyle = top ? INK.below : INK.above; g.lineWidth = Math.max(1, S * 0.06); g.stroke();
        g.restore();
      }
      if (o.layer === 'floors' || (o.deferLabels && o.layer !== 'labels') || S < 5) continue;
      const r = d.rect;
      tag(g, (top ? '↓ pit ' + zLabel(-(d.fall || 0)).replace('-', '') : '↑ pit above'), X((r[0] + r[2]) / 2), Y(r[1]) - 4, 'center', top ? INK.below : INK.above);
    }
  }
  /** unselected opportunities (connection zones), for inspection: dashed areas, one label each */
  function drawZones(g, b, o, X, Y, S) {
    // the zones of the storey in view: from the highest floor at or below the
    // cut, and floors within a storey of it (not those of the floors below)
    const seen = (b.surfaces || []).map((x) => x.floorZ).filter((z) => z <= o.cutZ + EPS), top = seen.length ? Math.max(...seen) : o.cutZ;
    const zones = (b.connectionZones || []).filter((z) => z.state !== 'connected' && Math.abs(z.floorZ - o.cutZ) < EPS + (o.exact ? 0 : 1e9) && z.floorZ <= o.cutZ + EPS && z.floorZ >= top - ((BR.ELEV && BR.ELEV.STOREY) || 1.5) - EPS);
    const placed = [];
    for (const z of zones) {
      g.save(); g.strokeStyle = z.direction === 'up' ? INK.above : INK.below; g.setLineDash([3, 3]); g.lineWidth = 1;
      for (const r of z.rects) g.strokeRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * S, (r[3] - r[1]) * S);
      g.restore();
      if (S >= 5) {
        // labels never sit on top of each other: shift down until clear
        const r = TG.bbox(z.rects), text = (z.direction === 'up' ? '↑ ' : '↓ ') + z.type + (z.shape && z.shape !== 'shaft' ? ' · ' + z.shape : '') + ' ' + zLabel(z.targetZ - z.floorZ);
        g.save(); g.font = '11px system-ui'; const w = g.measureText(text).width + 6; g.restore();
        let x = X((r[0] + r[2]) / 2), y = Y((r[1] + r[3]) / 2) + 4;
        while (placed.some((p) => Math.abs(p[0] - x) < (p[2] + w) / 2 && Math.abs(p[1] - y) < 15)) y += 15;
        placed.push([x, y, w]);
        tag(g, text, x, y, 'center', z.direction === 'up' ? INK.above : INK.below);
      }
    }
  }
  function drawCutaway(g, b, o) {
    o = o || {};
    const S = o.scale || 20, X = (x) => (o.ox || 0) + x * S, Y = (y) => (o.oy || 0) + y * S;
    const height = Number.isFinite(o.cutZ) ? o.cutZ : floorElevations(b, o.baseZ)[0];
    const plan = o.exact ? { groups: [], visible: [] } : cutawayPlan(b, height, o.baseZ);
    if (o.exact) { const records = floorRecords(b, o.baseZ).filter((r) => Math.abs(r.floorZ - height) < EPS); if (records.length) { plan.groups.push({ level: records[0].level, floorZ: height, records, occluders: union(records.flatMap((r) => r.holes)) }); plan.visible.push(...records); } }
    g.save();
    // the connections' tags alone, over everything else drawn (map tiles draw them after every wall)
    if (o.layer === 'labels') { drawConnections(g, b, { ...o, cutZ: height }, plan, X, Y, S); drawPits(g, b, { ...o, cutZ: height }, plan, X, Y, S); g.restore(); return plan; }
    if (o.ghost) for (const z of floorElevations(b, o.baseZ)) {
      if (o.exact ? z === height : z <= height + EPS) continue;
      const r = b.rooms.find((r) => roomZ(b, r, o.baseZ) === z); g.save(); g.globalAlpha *= 0.08;
      BR.TPL.drawBuilding(g, b, { ...o, level: r.level || 0, site: false, portals: false, labels: false }); g.restore();
    }
    const avoid = partsOf(b, o.baseZ).connectors.flatMap((c) => connectionAreas(c,height).map((a) => [Math.min(...a.pts.map((p)=>p[0])),Math.min(...a.pts.map((p)=>p[1])),Math.max(...a.pts.map((p)=>p[0])),Math.max(...a.pts.map((p)=>p[1]))]));
    for (const group of plan.groups) {
      g.save(); exclude(g, b, group.occluders, X, Y, S);
      const opts = { ...o, labels: false, level: group.level, site: false, portals: o.portals !== false };
      if (o.layer !== 'walls') {
        g.save(); g.globalAlpha *= o.exact ? 1 : 1 - Math.min(0.28, Math.max(0, height - group.floorZ) * 0.025);
        BR.TPL.drawBuilding(g, b, { ...opts, layer: 'floors' }); g.restore();
      }
      if (o.layer !== 'floors') BR.TPL.drawBuilding(g, b, { ...opts, layer: 'walls' });
      if (o.layer !== 'floors' && o.labels !== false && S >= 6) for (const record of group.records) {
        const parts = subtract(record.rects,avoid), r = bigRect(parts.length ? parts : record.rects), label = 'floor ' + zLabel(group.floorZ), room = record.room;
        const width = (r[2]-r[0])*S, h = (r[3]-r[1])*S, fs = Math.max(8,Math.min(13,S*.42));
        g.textAlign = 'center'; g.font = '600 '+fs+'px system-ui'; g.fillStyle = '#60503a';
        const name = (room.name || room.type).replace(/ \d+$/,'');
        if (width >= g.measureText(name).width+8 && h >= fs*1.5) g.fillText(name,X((r[0]+r[2])/2),Y((r[1]+r[3])/2));
        g.font = '10px system-ui'; g.fillStyle = '#74634b';
        if (width >= g.measureText(label).width+8 && h >= 42) g.fillText(label,X((r[0]+r[2])/2),Y(r[3])-7);
      }
      g.restore();
    }
    if (o.zones && o.layer !== 'floors') drawZones(g, b, { ...o, cutZ: height }, X, Y, S);
    drawConnections(g, b, { ...o, cutZ: height }, plan, X, Y, S);
    drawPits(g, b, { ...o, cutZ: height }, plan, X, Y, S);
    g.restore(); return plan;
  }
  function draw(g, b, o) {
    o = o || {}; const home = b.bands && b.bands[0].elevation;
    const level = o.level === undefined ? (b.rooms.find((r) => r.floorZ === home) || b.rooms[0]).level || 0 : o.level;
    const z = Number.isFinite(o.floorZ) ? o.floorZ : (o.baseZ || 0) + b.levels.find((l) => l.index === level).elevation;
    return drawCutaway(g,b,{...o,cutZ:z,exact:true});
  }
  function profilePoints(b) {
    let distance = 0;
    return b.route.map((p, i) => {
      if (i) { const q = b.route[i - 1]; distance += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
      return { distance, z: p[2] };
    });
  }
  function drawProfile(g, b, width, height, selectedZ) {
    g.clearRect(0, 0, width, height);
    const ps = profilePoints(b);
    if (!ps.length) { g.fillStyle = '#a39d92'; g.font = '12px system-ui'; g.fillText('Select a vertical connection to inspect its route.', 12, 28); return; }
    const zs = b.surfaces.map((s) => s.floorZ).concat(b.bands.map((r) => r.elevation));
    const lo = Math.min(...zs) - 0.8, hi = Math.max(...zs) + 0.8, length = ps[ps.length - 1].distance || 1;
    const left = 64, right = width - 16, top = 20, bottom = height - 32;
    const X = (d) => left + d / length * (right - left), Y = (z) => bottom - (z - lo) / (hi - lo) * (bottom - top);
    g.save(); g.font = '12px system-ui'; g.textBaseline = 'middle';
    for (const band of b.bands) {
      g.strokeStyle = '#5b5750'; g.lineWidth = 1; g.beginPath(); g.moveTo(left, Y(band.elevation)); g.lineTo(right, Y(band.elevation)); g.stroke();
      g.fillStyle = '#a39d92'; g.textAlign = 'right'; g.fillText(zLabel(band.elevation), left - 10, Y(band.elevation));
    }
    g.strokeStyle = '#e5cc9b'; g.lineWidth = 3; g.beginPath(); ps.forEach((p, k) => k ? g.lineTo(X(p.distance), Y(p.z)) : g.moveTo(X(p.distance), Y(p.z))); g.stroke();
    g.fillStyle = '#e5cc9b';
    for (const p of ps) if (p.z === selectedZ) { g.beginPath(); g.arc(X(p.distance), Y(p.z), 4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#a39d92'; g.textAlign = 'left'; g.fillText('Entry', left, height - 13);
    g.textAlign = 'right'; g.fillText('Arrival · ' + Math.round(length) + ' m along route', right, height - 13);
    g.restore();
  }
  Object.assign(E, { draw, drawProfile, profilePoints, drawCutaway, cutawayPlan, hitCutaway, floorElevations, roomZ, connectionAreas, connectionAt, cutawayParts: partsOf, zLabel, drawPits, invalidateView: (b) => { viewCache.delete(b); partsCache.delete(b); } });
})(typeof window !== "undefined" ? window : globalThis);
