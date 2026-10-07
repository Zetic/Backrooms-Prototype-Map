/*
 * tpl/room.js - the Room engine: the small end of the POI range.
 *
 * Layouts (archetype.layout):
 *   single   one room filling the site (closet, storage room, cell...)
 *   stalls   a restroom: optional vestibule, open area, a row of stalls
 *            along the back wall, maybe a janitor closet
 *   L        one L-shaped room (a corner cut out): mechanical / utility
 *   units    a corridor from the main side with rooms off both sides
 *            (storage units, cells, cubicles), an exit at the far end
 *
 * Portals come from the archetype: portals: [{ role, kind, side, w, p }].
 * roomTags: tags every room of the layout gets (a lone room is tagged 'lone');
 * tight: the room fills its site, no half metre left at its edges.
 * side 'S' is the main side; 'any' takes any exterior wall.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL;
  const U = (m) => Math.round(m / TG.GRID);
  const why = (ctx, k) => { if (ctx.why) ctx.why[k] = (ctx.why[k] || 0) + 1; return null; };

  // Room types come from the shared catalogue (tpl/catalogue.js): every
  // catalogued room, so any of them can be built on its own. Here only how
  // private each is in this engine's small buildings (doors swing into the
  // more private room); a room with none here sits in the middle (5).
  const PRIVACY = { closet: 6, storage: 4, restroom: 4, stall: 8, vestibule: 1, janitor: 7, mechanical: 5, corridor: 0, unit: 5, cell: 6 };
  const T = TPL.CAT.types(true, Object.fromEntries(Object.keys(TPL.CAT.ROOMS).map((t) => [t, { privacy: PRIVACY[t] !== undefined ? PRIVACY[t] : 5 }])));

  function program(arch, rng) {
    return { summary: [arch.layout + ' layout'].concat(arch.room ? [arch.room] : []) };
  }

  /** inner rect, sometimes a half metre shy of the site edge (never when flush: its lot edge is its walls, nor for a tight recipe: a lone room fills its site) */
  function region(ctx, rng) {
    const r = ctx.site.inner, m = () => (!ctx.spec.flush && !ctx.arch.tight && rng.f() < 0.25 ? 1 : 0);
    const q = [r[0] + m(), r[1] + m(), r[2] - m(), r[3]];
    return TG.rvalid(q) ? q : r.slice();
  }
  function make(ctx) {
    const rooms = [], conns = [];
    return {
      rooms, conns,
      add: (type, rects, extra) => { rooms.push(Object.assign({ type, zone: T[type].zone, level: 0, rects }, extra || {})); return rooms.length - 1; },
      conn: (a, b, kind, o) => conns.push(Object.assign({ a, b, kind }, o || {}))
    };
  }
  /** the archetype's portals on room i (the first entrance is the main one) */
  function portals(B, arch, rng, i, mainSide) {
    const list = arch.portals || [{ role: 'both', kind: 'door', side: 'S' }];
    let first = true;
    for (const p of list) {
      if (p.p !== undefined && rng.f() >= p.p) continue;
      const side = p.side === 'any' ? undefined : p.side === 'back' ? 'N' : p.side === 'flank' ? (rng.f() < 0.5 ? 'E' : 'W') : p.side || mainSide;
      const main = first && (p.role === 'entrance' || p.role === 'both');
      const kind = typeof p.kind === 'object' ? rng.weighted(p.kind) : p.kind || 'door';
      B.conn(p.room !== undefined ? p.room : i, TPL.OUTSIDE, kind, {
        role: p.role || 'both', side, w: U(p.w || (kind === 'double' ? 1.5 : kind === 'vehicle' ? 2.5 : 1)), clear: p.clear !== undefined ? p.clear : 1.2,
        main, align: 'center', prio: main ? 10 : 7, required: main, into: kind === 'door' || kind === 'double' ? i : undefined, tags: p.tags || []
      });
      if (main) first = false;
    }
  }
  function finish(B, ctx, rng, meta) {
    for (const rm of B.rooms) {
      for (const r of rm.rects) if (!ctx.site.mask.all(r, 1)) return why(ctx, 'site:outside');
      const c = T[rm.type].ceil;
      rm.ceiling = Math.round(rng.range(c[0], c[1]) * 10) / 10;
    }
    if (ctx.mut.has('ceiling')) { const rm = rng.pick(B.rooms); rm.ceiling = rng.f() < 0.5 ? 1.8 : Math.round(rng.range(4.5, 7) * 10) / 10; rm.tags = (rm.tags || []).concat('wrong:ceiling'); }
    return { W: ctx.site.W, H: ctx.site.H, levels: 1, rooms: B.rooms, conns: B.conns, verticals: [], meta };
  }

  const LAYOUTS = {
    single(arch, ctx, rng) {
      const r = region(ctx, rng), B = make(ctx);
      if (TG.rshort(r) < T[arch.room].minW) return why(ctx, 'single:small');
      const i = B.add(arch.room, [r], arch.roomTags ? { tags: arch.roomTags.slice() } : undefined);
      portals(B, arch, rng, i, 'S');
      return finish(B, ctx, rng, { type: 'single' });
    },

    stalls(arch, ctx, rng) {
      const r = region(ctx, rng), B = make(ctx);
      const w = TG.rw(r), h = TG.rh(r);
      const vest = arch.vestibule && rng.f() < arch.vestibule && h >= 10 ? rng.int(3, 4) : 0;
      const sd = 3;                                         // stall depth 1.5 m
      if (h - vest - sd < 3 || w < 6) return why(ctx, 'stalls:small');
      const yS = r[1], yA = r[1] + sd, yV = r[3] - vest;
      // stalls along the back wall, maybe a janitor closet at one end
      const jan = arch.janitor && rng.f() < arch.janitor && w >= 10 ? rng.int(3, 4) : 0;
      const janLeft = rng.f() < 0.5;
      const sx0 = r[0] + (janLeft ? jan : 0), sx1 = r[2] - (janLeft ? 0 : jan);
      const n = Math.max(1, Math.min(arch.stalls ? arch.stalls[1] : 6, Math.floor((sx1 - sx0) / 2)));
      // leftover width widens the stall at the far end from the janitor (an
      // accessible stall) instead of leaving a sliver of washroom
      const sw = Math.floor((sx1 - sx0) / n), widths = new Array(n).fill(sw);
      let extra = (sx1 - sx0) - sw * n;
      const acc = janLeft ? n - 1 : 0;
      if (extra) { const a = Math.min(extra, 2); widths[acc] += a; extra -= a; }
      for (let k = 0; extra > 0; k++, extra--) widths[janLeft ? k : n - 1 - k] += 1;
      const area = B.add('restroom', [[r[0], yA, r[2], yV]]);
      for (let k = 0, x = sx0; k < n; x += widths[k], k++) {
        const s = B.add('stall', [[x, yS, x + widths[k], yA]], { parent: area, tags: k === acc && widths[k] > sw ? ['accessible'] : undefined });
        B.conn(area, s, 'door', { into: s, w: 2, margin: 0, gap: 0, align: 'center', prio: 6, required: true });
      }
      if (jan) {
        const jx = janLeft ? r[0] : r[2] - jan;
        const j = B.add('janitor', [[jx, yS, jx + jan, yA]]);
        B.conn(area, j, 'door', { into: j, margin: 0, prio: 5, required: true });
      }
      if (vest) {
        const v = B.add('vestibule', [[r[0], yV, r[2], r[3]]]);
        B.conn(v, area, rng.f() < 0.5 ? 'opening' : 'door', { w: rng.int(2, 4), prio: 6, required: true, into: area });
        portals(B, arch, rng, v, 'S');
      } else portals(B, arch, rng, area, 'S');
      return finish(B, ctx, rng, { type: 'stalls', stalls: n });
    },

    L(arch, ctx, rng) {
      const r = region(ctx, rng), B = make(ctx);
      const w = TG.rw(r), h = TG.rh(r);
      const minW = T[arch.room].minW;
      if (w < 2 * minW || h < 2 * minW) return why(ctx, 'L:small');
      // cut a corner away from the main side so the entrance wall stays whole
      const cw = rng.int(Math.max(minW, Math.round(w * 0.3)), Math.max(minW, Math.round(w * 0.6))), ch = rng.int(Math.max(minW, Math.round(h * 0.3)), Math.max(minW, Math.round(h * 0.55)));
      const left = rng.f() < 0.5;
      const keep = left ? [[r[0] + cw, r[1], r[2], r[1] + ch], [r[0], r[1] + ch, r[2], r[3]]] : [[r[0], r[1], r[2] - cw, r[1] + ch], [r[0], r[1] + ch, r[2], r[3]]];
      if (keep.some((q) => TG.rshort(q) < minW)) return why(ctx, 'L:thin');
      // largest rect first (the main floor)
      keep.sort((a, b) => TG.rarea(b) - TG.rarea(a));
      const i = B.add(arch.room, keep);
      portals(B, arch, rng, i, 'S');
      return finish(B, ctx, rng, { type: 'L' });
    },

    units(arch, ctx, rng) {
      const r = region(ctx, rng), B = make(ctx);
      const w = TG.rw(r), h = TG.rh(r);
      const cw = U(arch.corridor || 1.5), ut = arch.room;
      const minW = T[ut].minW;
      if (w < cw + minW || h < minW * 2) return why(ctx, 'units:small');
      // corridor from the main side going back; units either side
      const dbl = w >= cw + 2 * minW && rng.f() < 0.85;
      const cx = dbl ? r[0] + Math.round((w - cw) / 2) + rng.int(-1, 1) : (rng.f() < 0.5 ? r[0] : r[2] - cw);
      const cor = B.add('corridor', [[cx, r[1], cx + cw, r[3]]]);
      const sides = [];
      if (cx - r[0] >= minW) sides.push([r[0], cx]);
      if (r[2] - (cx + cw) >= minW) sides.push([cx + cw, r[2]]);
      if (!sides.length) return why(ctx, 'units:noside');
      const [a, b] = arch.unit || [2, 4];
      for (const [x0, x1] of sides) {
        for (let y = r[1]; y < r[3];) {
          let len = U(rng.range(a, b));
          len = Math.max(minW, len);
          if (r[3] - y - len < minW) len = r[3] - y;
          const k = B.add(ut, [[x0, y, x1, y + len]]);
          B.conn(cor, k, 'door', { into: k, prio: 5, required: true });
          y += len;
        }
      }
      portals(B, arch, rng, cor, 'S');
      return finish(B, ctx, rng, { type: 'units' });
    }
  };

  function layout(P, ctx, rng) {
    const f = LAYOUTS[ctx.arch.layout];
    return f ? f(ctx.arch, ctx, rng) : why(ctx, 'unknown layout ' + ctx.arch.layout);
  }
  function quickScore(plan) {
    let t = 0;
    for (const rm of plan.rooms) {
      const big = rm.rects.reduce((b, r) => (TG.rarea(r) > TG.rarea(b) ? r : b), rm.rects[0]);
      const asp = TG.rlong(big) / Math.max(1, TG.rshort(big)), ty = T[rm.type];
      if (ty.maxAsp && asp > ty.maxAsp) t += (asp - ty.maxAsp) * 4;
    }
    return { total: t };
  }
  const autoPenalty = (u, v) => (v.type === 'stall' || v.type === 'janitor' ? Infinity : 4);

  const MUTATIONS = {
    falseDoors: { weight: 1, label: 'doors that open onto walls' },
    ceiling: { weight: 1, label: 'a ceiling at the wrong height' }
  };
  function postResolve(res, api) {
    if (!api.ctx.mut.has('falseDoors')) return;
    const rng = api.rng;
    const walls = res.walls.filter((w) => w.s1 - w.s0 >= 4);
    const n = Math.min(walls.length, rng.int(1, 2));
    for (let k = 0; k < n; k++) {
      const w = walls.splice(rng.int(0, walls.length - 1), 1)[0];
      const s = w.s0 + 1 + rng.int(0, Math.max(0, w.s1 - w.s0 - 4));
      if (!api.lineFree(w, s, 2, 1)) continue;
      const into = w.lo >= 0 ? w.lo : w.hi;
      const op = api.addOpening(w, s, 2, 'false', { into });
      op.tags = ['wrong:falseDoor'];
    }
  }

  TPL.registerEngine({ id: 'room', name: 'Rooms & small POIs', types: T, mutations: MUTATIONS, program, layout, quickScore, autoPenalty, postResolve });
})(typeof window !== 'undefined' ? window : globalThis);
