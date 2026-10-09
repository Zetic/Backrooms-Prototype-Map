/*
 * Opt-in shape study: complete joined-rectangle floors, before doors and walls.
 * BR.SPACE.generate({ recipe, seed, shapes: { hall: 'mixed', living: 'mixed' } })
 * Original generation is unchanged when shapes is absent. Geometry uses cm;
 * br.space/0.3 exports floorRects plus one true concave polygon per room.
 */
(function (root) {
  'use strict';
  const BR = root.BR, SP = BR.SPACE, I = SP._internal, RI = SP._routeInternal;
  const { CFG, snap, cm, hashStr, shuffle, bboxOf, W, H } = I;
  const SH = SP.SHAPES = {}, OPP = { N: 'S', S: 'N', E: 'W', W: 'E' }, TURN = { N: 'E', E: 'S', S: 'W', W: 'N' };
  const baseGenerate = SP.generate, baseVerify = SP.verify;
  const area = (r) => W(r) * H(r), sumArea = (parts) => parts.reduce((s, r) => s + area(r), 0);
  const overlap = (a, b) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
  const bounds = (parts) => [Math.min(...parts.map((r) => r[0])), Math.min(...parts.map((r) => r[1])), Math.max(...parts.map((r) => r[2])), Math.max(...parts.map((r) => r[3]))];
  const move = (parts, x, y) => parts.map((r) => [r[0] + x, r[1] + y, r[2] + x, r[3] + y]);
  const horizontal = (e) => e.side === 'N' || e.side === 'S';
  const outward = (side) => ({ N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] })[side];
  function subtract(lo, hi, cuts) {
    let out = [[lo, hi]];
    for (const [a, b] of cuts) out = out.flatMap(([x, y]) => b <= x || a >= y ? [[x, y]] : [[x, Math.max(x, a)], [Math.min(y, b), y]].filter(([p, q]) => q > p));
    return out;
  }
  function edges(parts) {
    const out = [];
    for (const r of parts) for (const side of ['N', 'E', 'S', 'W']) {
      const hz = side === 'N' || side === 'S', c = side === 'N' ? r[1] : side === 'S' ? r[3] : side === 'E' ? r[2] : r[0];
      const cuts = [];
      for (const q of parts) {
        if (q === r) continue;
        const back = side === 'N' ? q[3] : side === 'S' ? q[1] : side === 'E' ? q[0] : q[2];
        if (back === c) cuts.push(hz ? [q[0], q[2]] : [q[1], q[3]]);
      }
      for (const [s0, s1] of subtract(hz ? r[0] : r[1], hz ? r[2] : r[3], cuts)) out.push({ side, c, s0, s1 });
    }
    return out;
  }
  const point = (e, s) => horizontal(e) ? [s, e.c] : [e.c, s];
  function polygon(parts) {
    const es = edges(parts), next = new Map();
    for (const e of es) {
      const forward = e.side === 'N' || e.side === 'E', a = point(e, forward ? e.s0 : e.s1), b = point(e, forward ? e.s1 : e.s0);
      next.set(a.join(','), b);
    }
    const start = [...next.keys()].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0], out = [];
    let p = start;
    do { out.push(p); p = next.get(p.join(',')); if (!p || out.length > es.length) throw new Error('floor boundary is not one simple polygon'); } while (p.join(',') !== start.join(','));
    return out.filter((p, k) => { const a = out[(k + out.length - 1) % out.length], b = out[(k + 1) % out.length]; return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]); });
  }
  function rotate(shape, turns) {
    let parts = shape.parts, entrySide = shape.entrySide, exitSide = shape.exitSide;
    for (let k = 0; k < turns; k++) { parts = parts.map((r) => [-r[3], r[0], -r[1], r[2]]); if (entrySide) entrySide = TURN[entrySide]; if (exitSide) exitSide = TURN[exitSide]; }
    const bb = bounds(parts);
    return { ...shape, parts: move(parts, -bb[0], -bb[1]), entrySide, exitSide };
  }
  function profile(value, list, rng) { return value === 'mixed' ? rng.pick(list) : value; }
  function shapes(e, P, options, rng) {
    if (e.type === 'hall') {
      const w = P.hall, len = Math.max(w * 2 + 100, e.len || 400), kind = profile(options.hall, ['straight', 'L', 'T'], rng);
      let parts;
      if (kind === 'L') parts = [[0, 0, w, len], [w, 0, len, w]];
      else if (kind === 'T') { const x = snap((len - w) / 2); parts = [[0, 0, len, w], [x, w, x + w, len]]; }
      else parts = [[0, 0, w, len]];
      const shape = { kind, parts, entrySide: 'S', exitSide: kind === 'straight' ? 'N' : rng.pick(kind === 'T' ? ['E', 'W'] : ['E']) };
      return [0, 1, 2, 3].map((k) => rotate(shape, k));
    }
    if (['living', 'family', 'loft'].includes(e.type)) {
      const kind = profile(options.living, ['rectangle', 'L', 'alcove'], rng);
      if (kind !== 'rectangle') {
        const min = cm(SP.MODULES[e.type].min), wingW = kind === 'L' ? 240 : 180, wingD = 240;
        const coreW = min, coreD = Math.max(min, snap((e.area - wingW * wingD) / coreW));
        const y = kind === 'L' ? coreD - wingD : snap((coreD - wingD) / 2);
        const parts = [[0, 0, coreW, coreD], [coreW, y, coreW + wingW, y + wingD]];
        if (sumArea(parts) <= e.area * 1.25 + CFG.step * coreW) return [0, 1, 2, 3].map((k) => rotate({ kind, parts }, k));
      }
    }
    return RI.shapes(e, rng, P).map(([w, d]) => ({ kind: 'rectangle', parts: [[0, 0, w, d]] }));
  }
  function fits(parts, rooms, keep) {
    const bb = bounds(parts);
    for (const n of rooms) {
      if (n.r[0] - bb[2] >= 2 * CFG.exterior || bb[0] - n.r[2] >= 2 * CFG.exterior || n.r[1] - bb[3] >= 2 * CFG.exterior || bb[1] - n.r[3] >= 2 * CFG.exterior) continue;
      for (const r of parts) for (const q of n.parts) {
        const ox = Math.min(r[2], q[2]) - Math.max(r[0], q[0]), oy = Math.min(r[3], q[3]) - Math.max(r[1], q[1]);
        if (ox > 0 && oy > 0) return false;
        if (ox > 0) { const g = Math.max(r[1], q[1]) - Math.min(r[3], q[3]); if (g !== CFG.interior && g < 2 * CFG.exterior) return false; }
        if (oy > 0) { const g = Math.max(r[0], q[0]) - Math.min(r[2], q[2]); if (g !== CFG.interior && g < 2 * CFG.exterior) return false; }
      }
    }
    return !keep.some((q) => parts.some((r) => overlap(r, q)));
  }
  function contacts(a, b) {
    const out = [];
    for (const x of a.edges) for (const y of b.edges) {
      const dir = x.side === 'S' || x.side === 'E' ? 1 : -1;
      if (y.side !== OPP[x.side] || (y.c - x.c) * dir !== CFG.interior) continue;
      const s0 = Math.max(x.s0, y.s0), s1 = Math.min(x.s1, y.s1);
      if (s1 <= s0) continue;
      const first = dir > 0 ? a : b, second = first === a ? b : a;
      out.push({ o: horizontal(x) ? 'h' : 'v', a: first, b: second, c0: Math.min(x.c, y.c), c1: Math.max(x.c, y.c), s0, s1 });
    }
    return out;
  }
  function clear(edge, rooms, keep, depth = 260) {
    const d = outward(edge.side), pad = 60, q = horizontal(edge) ? [edge.s0 - pad, Math.min(edge.c, edge.c + d[1] * depth), edge.s1 + pad, Math.max(edge.c, edge.c + d[1] * depth)]
      : [Math.min(edge.c, edge.c + d[0] * depth), edge.s0 - pad, Math.max(edge.c, edge.c + d[0] * depth), edge.s1 + pad];
    return rooms.every((n) => n.parts.every((r) => !overlap(r, q))) && keep.every((r) => !overlap(r, q)) ? q : null;
  }
  function attach(e, host, ctx, P, options, rng, path, last) {
    const here = ctx.rooms.filter((n) => n.floor === host.floor), keep = ctx.keep[host.floor] || [], variants = shapes(e, P, options, rng);
    const need = (host.type === 'hall' || e.type === 'hall') ? P.hall : (['linen', 'closet'].includes(e.type) ? 60 : 90) + 2 * CFG.margin;
    let hostEdges = host.edges.filter((ed) => ed.side !== host.entrySide);
    if (path && (host.type === 'hall' || host.type === 'stair')) hostEdges = hostEdges.filter((ed) => ed.side === host.exitSide);
    let best = null;
    for (const edge of shuffle(hostEdges.slice(), rng)) for (const variant of variants) {
      if (variant.entrySide && variant.entrySide !== OPP[edge.side]) continue;
      for (const entry of edges(variant.parts).filter((ed) => ed.side === OPP[edge.side])) {
        if (entry.s1 - entry.s0 < need || edge.s1 - edge.s0 < need) continue;
        const offsets = new Set([edge.s0 - entry.s0, edge.s1 - entry.s1, snap((edge.s0 + edge.s1 - entry.s0 - entry.s1) / 2)]);
        for (const offset of offsets) {
          const axis = edge.c + (edge.side === 'S' || edge.side === 'E' ? CFG.interior : -CFG.interior) - entry.c;
          const parts = move(variant.parts, horizontal(edge) ? offset : axis, horizontal(edge) ? axis : offset);
          if (!fits(parts, here, keep)) continue;
          const n = { type: e.type, e, floor: host.floor, parts, r: bounds(parts), edges: edges(parts), shape: variant.kind, entrySide: entry.side, exitSide: variant.exitSide };
          const ws = contacts(host, n).filter((w) => w.s1 - w.s0 >= need);
          if (!ws.length) continue;
          const join = ws.find((w) => (w.o === 'h' ? edge.c === w.c0 || edge.c === w.c1 : edge.c === w.c0 || edge.c === w.c1)) || ws[0];
          if (e.type === 'stair') n.exitSide = OPP[n.entrySide];
          let exit = null, ground = null;
          if (last || e.type === 'garage') {
            for (const ex of n.edges.filter((ed) => ed.side !== n.entrySide && (!n.exitSide || ed.side === n.exitSide))) {
              if (ex.s1 - ex.s0 < (e.type === 'garage' ? e.door : 80) + 2 * CFG.margin) continue;
              const q = clear(ex, here, keep, e.type === 'garage' ? 450 : 260);
              if (q) { exit = ex; ground = q; break; }
            }
            if (!exit) continue;
          }
          // Prefer compact attachments, with a little seeded variation. No
          // geometry is clipped to the lot or painted over another room.
          const bb = bboxOf(here.concat(n)), score = -W(bb) * H(bb) / 1e6 + rng.f();
          if (!best || score > best.score) best = { n, join, exit, ground, score };
        }
      }
    }
    return best;
  }
  function roomProgram(R, recipe, seed, wrong) {
    const salt = hashStr(recipe);
    if (R.route) return RI.program(R, new BR.Rng(BR.hash4(seed, salt, 0x70a7, 2)), wrong === undefined ? R.route.wrong : wrong);
    const P = I.program(R, new BR.Rng(BR.hash4(seed, salt, 0x5ace, 2))), path = [];
    for (const type of ['foyer', 'living']) { const e = P.rooms.find((n) => n.type === type); if (e) path.push(e); }
    path.push({ type: 'hall', len: 450, area: 0 });
    return { ...P, path, sides: P.rooms.filter((e) => !path.includes(e)).concat(P.garage ? [P.garage] : []), wrongness: 0 };
  }
  function outside(n, edge, width, role, rng) {
    const w = Math.min(width, edge.s1 - edge.s0 - 2 * CFG.margin), s0 = snap(edge.s0 + CFG.margin + rng.f() * (edge.s1 - edge.s0 - w - 2 * CFG.margin));
    return { room: n, side: edge.side, c: edge.c, s0, s1: s0 + w, kind: role === 'garage door' ? 'vehicle' : role === 'exit' ? 'portal' : 'entrance', role };
  }
  function build(P, options, rng) {
    const ctx = { rooms: [], keep: {}, links: [], outside: [], route: [], verticals: [] };
    const first = P.path[0], shape = shapes(first, P, { ...options, living: 'rectangle' }, rng)[0];
    // A first living room may be shaped too; the front door uses an exposed edge.
    const firstShape = ['living', 'family'].includes(first.type) ? shapes(first, P, options, rng)[0] : shape;
    const n0 = { type: first.type, e: first, parts: firstShape.parts, r: bounds(firstShape.parts), edges: edges(firstShape.parts), shape: firstShape.kind, floor: 0, entrySide: 'S' };
    ctx.rooms.push(n0); ctx.route.push(n0);
    const frontEdge = n0.edges.filter((e) => e.side === 'S' && e.s1 - e.s0 >= 130)[0];
    if (!frontEdge) return null;
    ctx.outside.push(outside(n0, frontEdge, 100, 'front door', rng));
    ctx.keep[0] = [clear(frontEdge, [], [], 500)];
    let prev = n0;
    for (let k = 1; k < P.path.length; k++) {
      const e = P.path[k], got = attach(e, prev, ctx, P, options, rng, true, k === P.path.length - 1);
      if (!got) return null;
      const n = got.n; n.wrong = e.wrong;
      ctx.rooms.push(n); ctx.route.push(n); ctx.links.push({ a: prev, b: n, join: got.join, path: true });
      prev = n;
      if (got.exit) { ctx.outside.push(outside(n, got.exit, 100, 'exit', rng)); (ctx.keep[n.floor] ||= []).push(got.ground); }
      if (e.type === 'stair') {
        const up = { ...n, parts: n.parts.map((r) => r.slice()), r: n.r.slice(), floor: n.floor + 1, name: 'stairwell (top)' };
        ctx.rooms.push(up); ctx.route.push(up); ctx.verticals.push({ rooms: [n, up], up: n.exitSide, kind: 'stair' }); prev = up;
      }
    }
    for (const e of P.sides) {
      const hosts = e.of || e.through ? ctx.rooms.filter((n) => n.e === (e.of || e.through)) : ctx.rooms.filter((n) => (e.hosts || SP.HOSTS[e.type] || ['hall']).includes(n.type));
      const upper = ['master', 'bedroom', 'bath', 'linen'].includes(e.type), ground = e.type === 'garage';
      const allowed = hosts.filter((n) => !ground || n.floor === 0).sort((a, b) => (upper ? b.floor - a.floor : a.floor - b.floor) || (a.type === 'hall' ? -1 : b.type === 'hall' ? 1 : 0));
      let got = null, host = null;
      for (const h of allowed) { got = attach(e, h, ctx, P, options, rng, false, false); if (got) { host = h; break; } }
      if (!got) {
        // A short branch is useful only when its destination room can also fit.
        if (e.of || e.through) return null;
        for (const h of ctx.rooms.filter((n) => ['hall', 'living', 'loft', 'family'].includes(n.type)).sort((a, b) => upper ? b.floor - a.floor : a.floor - b.floor)) {
          const he = { type: 'hall', len: 300, area: 0 }, branch = attach(he, h, ctx, P, { ...options, hall: 'straight' }, rng, false, false);
          if (!branch) continue;
          ctx.rooms.push(branch.n);
          got = attach(e, branch.n, ctx, P, options, rng, false, false);
          if (got) { ctx.links.push({ a: h, b: branch.n, join: branch.join }); host = branch.n; break; }
          ctx.rooms.pop();
        }
      }
      if (!got) return null;
      got.n.host = host; got.n.wrong = e.wrong;
      ctx.rooms.push(got.n); ctx.links.push({ a: host, b: got.n, join: got.join });
      if (got.exit) { ctx.outside.push(outside(got.n, got.exit, e.door, 'garage door', rng)); (ctx.keep[0] ||= []).push(got.ground); }
    }
    if (!ctx.outside.some((o) => o.role === 'exit')) return null;
    return ctx;
  }
  function emit(ctx, spec, P, options, t0) {
    const all = ctx.rooms.flatMap(n => n.parts).concat(Object.values(ctx.keep).flat()), bb = bounds(all);
    const dx = 100 - bb[0], dy = 100 - bb[1];
    for (const n of ctx.rooms) { n.parts = move(n.parts, dx, dy); n.r = bounds(n.parts); n.edges = edges(n.parts); }
    for (const x of ctx.outside) { x.c += horizontal(x) ? dy : dx; x.s0 += horizontal(x) ? dx : dy; x.s1 += horizontal(x) ? dx : dy; }
    // outside objects store side; horizontal accepts those too.
    const walls = [];
    for (let i = 0; i < ctx.rooms.length; i++) for (let j = i + 1; j < ctx.rooms.length; j++)
      if (ctx.rooms[i].floor === ctx.rooms[j].floor) walls.push(...contacts(ctx.rooms[i], ctx.rooms[j]));
    const ops = ctx.links.map(link => {
      const candidates = walls.filter(w => (w.a === link.a && w.b === link.b) || (w.b === link.a && w.a === link.b));
      const w = candidates.sort((a,b) => (b.s1-b.s0)-(a.s1-a.s0))[0];
      const open = (link.path && (link.a.type === 'hall' || link.b.type === 'hall')) || (link.a.type === 'hall' && link.b.type === 'hall');
      const width = open ? w.s1-w.s0 : Math.min(90, w.s1-w.s0-30), s0 = snap((w.s0+w.s1-width)/2);
      const op = { wall:w, kind:open ? 'open':'door', s0:open?w.s0:s0, s1:open?w.s1:s0+width }; w.opening=op; return op;
    });
    const h = I.emit({ ...ctx, ops, walls, recipe:spec.recipe, name:SP.RECIPES[spec.recipe].name,
      seed:spec.seed, site:{ w:(bb[2]-bb[0]+200)/100, h:(bb[3]-bb[1]+200)/100 }, t0,
      meta:{ plan:'shape study', shapeOptions:options, hallWidth:P.hall/100, candidates:60, score:-Math.round(W(bboxOf(ctx.rooms))*H(bboxOf(ctx.rooms))/10000), terms:{}, wrongness:P.wrongness } });
    h.schema='br.space/0.3'; h.wrong=ctx.rooms.filter(n=>n.wrong).map(n=>n.type+': '+n.wrong);
    ctx.rooms.forEach((n,i) => { const sp=h.spaces[i]; sp.floorRects=n.parts.map(r=>r.map(v=>v/100)); sp.poly=polygon(n.parts).map(p=>p.map(v=>v/100)); sp.area=sumArea(n.parts)/10000; sp.shape=n.shape; });
    h.walls=h.walls.filter(w=>w.kind!=='exterior');
    ctx.rooms.forEach((n,i)=>{ for (const e of n.edges) {
      const taken=walls.filter(w=>(w.a===n||w.b===n)&&w.o===(horizontal(e)?'h':'v')&&(w.c0===e.c||w.c1===e.c)).map(w=>[w.s0,w.s1]);
      const d=outward(e.side);
      for(const [a,b] of subtract(e.s0,e.s1,taken)) {
        const r=horizontal(e)?[a,Math.min(e.c,e.c+d[1]*30),b,Math.max(e.c,e.c+d[1]*30)]:[Math.min(e.c,e.c+d[0]*30),a,Math.max(e.c,e.c+d[0]*30),b];
        h.walls.push({id:'w'+h.walls.length,kind:'exterior',floor:n.floor,rooms:[h.spaces[i].id,null],thickness:0.3,out:d,rect:r.map(v=>v/100),line:[point(e,a),point(e,b)].map(p=>p.map(v=>v/100))});
      }
    }});
    // Bounding-box route centers can lie outside a concave room. Hide the
    // route overlay until a clearance-aware interior path is exported.
    h.meta.routeOverlay=false;
    return h;
  }
  SP.generate=function(spec) {
    if (!spec.shapes) return baseGenerate(spec);
    const options={hall:'mixed',living:'mixed',...spec.shapes};
    if(!['mixed','straight','L','T'].includes(options.hall)||!['mixed','rectangle','L','alcove'].includes(options.living)) throw new Error('unknown shape profile');
    const R=SP.RECIPES[spec.recipe]; if(!R) throw new Error('unknown house recipe');
    const seed=spec.seed===undefined?1:spec.seed, t0=performance.now(), P=roomProgram(R,spec.recipe,seed,spec.wrong);
    let best=null, validCandidates=0;
    for(let k=0;k<60;k++) { const ctx=build(P,options,new BR.Rng(BR.hash4(seed,hashStr(spec.recipe),0x5a9e,k)));
      if(!ctx) continue; validCandidates++;
      const bb=bboxOf(ctx.rooms), score=W(bb)*H(bb);
      if(!best||score<best.score) best={ctx,score};
    }
    if(!best) return {schema:'br.space/0.3',recipe:spec.recipe,seed,error:'no valid shaped layout',meta:{ms:Math.round((performance.now()-t0)*10)/10}};
    const h=emit(best.ctx,{...spec,seed},P,options,t0);
    if(spec.site&&(h.site.w>spec.site.w||h.site.h>spec.site.h)) return {schema:h.schema,recipe:spec.recipe,seed,error:'shaped layout exceeds requested site'};
    h.meta.validCandidates=validCandidates;
    if(spec.site)h.site={w:spec.site.w,h:spec.site.h};
    return h;
  };
  SP.verify=function(h) {
    if(h.schema!=='br.space/0.3') return baseVerify(h);
    if(h.error) return [h.error];
    const errors=[], fail=(ok,msg)=>{if(!ok)errors.push(msg);};
    for(const sp of h.spaces) {
      const parts=sp.floorRects;
      fail(parts&&parts.length>0,sp.id+': missing floor'); if(!parts)continue;
      const connected=new Set([0]); let grew=true; while(grew){grew=false;for(let i=0;i<parts.length;i++)for(const j of connected){const a=parts[i],b=parts[j];if(!connected.has(i)&&(((a[2]===b[0]||a[0]===b[2])&&Math.min(a[3],b[3])>Math.max(a[1],b[1]))||((a[3]===b[1]||a[1]===b[3])&&Math.min(a[2],b[2])>Math.max(a[0],b[0])))){connected.add(i);grew=true;}}}
      fail(connected.size===parts.length,sp.id+': disconnected floor');
      const a=sumArea(parts), polyArea=Math.abs(sp.poly.reduce((s,p,i)=>{const q=sp.poly[(i+1)%sp.poly.length];return s+p[0]*q[1]-p[1]*q[0];},0))/2;
      fail(Math.abs(a-sp.area)<1e-6&&Math.abs(polyArea-a)<1e-6,sp.id+': incorrect floor area');
      fail(JSON.stringify(bounds(parts))===JSON.stringify(sp.rect),sp.id+': incorrect bounds');
      for(let i=0;i<parts.length;i++) {const r=parts[i];fail(W(r)>0&&H(r)>0&&r[0]>=0&&r[1]>=0&&r[2]<=h.site.w&&r[3]<=h.site.h,sp.id+': floor outside site');for(let j=i+1;j<parts.length;j++)fail(!overlap(r,parts[j]),sp.id+': overlapping floor parts');}
      if(sp.type==='hall') for(const r of parts)fail(Math.min(W(r),H(r))+1e-8>=h.meta.hallWidth,sp.id+': narrow hall');
      for(const other of h.spaces)if(other!==sp&&other.floor===sp.floor)for(const r of parts)for(const q of other.floorRects){fail(!overlap(r,q),sp.id+': overlapping rooms');const ox=Math.min(r[2],q[2])-Math.max(r[0],q[0]),oy=Math.min(r[3],q[3])-Math.max(r[1],q[1]);if(ox>1e-8){const g=Math.max(r[1],q[1])-Math.min(r[3],q[3]);fail(Math.abs(g-0.15)<1e-8||g>=0.6-1e-8,sp.id+': bad gap');}if(oy>1e-8){const g=Math.max(r[0],q[0])-Math.min(r[2],q[2]);fail(Math.abs(g-0.15)<1e-8||g>=0.6-1e-8,sp.id+': bad gap');}}
      const level=h.levels.find(l=>l.floor===sp.floor);
      for(const r of parts)for(const q of level.solids.walls.concat(level.solids.pockets))fail(!overlap(r,q),sp.id+': solid on floor');
    }
    const reached=new Set([h.openings.find(o=>o.role==='front door')?.rooms[0]]);
    let changed=true;while(changed){changed=false;for(const [a,b]of h.graph.edges)if(b!=='outside'&&reached.has(a)!==reached.has(b)){reached.add(a);reached.add(b);changed=true;}}
    fail(h.spaces.every(s=>reached.has(s.id)),'unreachable room');
    fail(h.openings.some(o=>o.role==='exit'),'missing exit');
    for(const v of h.verticals)fail(JSON.stringify(h.spaces.find(s=>s.id===v.rooms[0]).floorRects)===JSON.stringify(h.spaces.find(s=>s.id===v.rooms[1]).floorRects),'unaligned stairs');
    return [...new Set(errors)];
  };
  Object.assign(SH,{edges,polygon,shapes,fits,contacts,build,roomProgram});
})(typeof window !== 'undefined' ? window : globalThis);
