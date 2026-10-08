/*
 * biomes.js - the families of templates a growth draws from (growth design,
 * step 2: one house pillar and its branch).
 *
 * A growth takes the biome of the POI it starts from: a house that can carry
 * its stairwell on up starts a `houseroom` branch, so what stands over the
 * ground beside it is a district of house rooms, not generic backrooms.
 *
 *   anchors      an archetype says it can seed growth, and which biome it
 *                starts: `grows: { biome }` (archetypes/house.js)
 *   eligibility  templates and fillers carry `biomes: [...]`, and a branch
 *                draws only from its biome's pool; one can be in several.
 *                A lone room takes the tags of its catalogue entry
 *                (catalogue.js), so the house rooms the catalogue already
 *                makes into templates of their own are the first pool.
 *   a district   a branch site is a biome filler (the hallways and rooms
 *                between) with biome templates standing inside it, dense
 *                near the pillar and thinning with distance. No template
 *                repeats within a site; a pool is large enough that a
 *                district never reads as a grid of copies.
 *
 *   BIOME.DEFS[id]                       { label, rooms: [[min, max] rooms per site, by distance] }
 *   BIOME.anchorOf(arch)                 the biome an archetype starts, or null
 *   BIOME.templates(id), BIOME.fillers(id)   the pool
 *   BIOME.furnish({ biome, site, conns, count, seed })   where its rooms stand in one site
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL, FILL = BR.FILL;
  const BIOME = BR.BIOME = {};
  const EPS = 1e-7, snap = (v) => Math.round(v * 2) / 2;

  BIOME.DEFS = {
    // rooms per site by its distance from the pillar (0: the site the landing
    // opens onto): dense beside it, thinning further out
    houseroom: { label: 'house rooms', rooms: [[2, 3], [1, 2], [0, 1]], margin: 1.5, gap: 1.5, doorClear: 3 }
  };
  const tagged = (x, id) => Array.isArray(x.biomes) && x.biomes.includes(id);
  BIOME.anchorOf = (arch) => (arch && arch.grows && BIOME.DEFS[arch.grows.biome] ? arch.grows.biome : null);
  /** the biome's templates (rooms that stand inside a branch site), in id order */
  BIOME.templates = (id) => Object.values(TPL.archetypes).filter((a) => tagged(a, id) && !a.grows).sort((a, b) => a.id.localeCompare(b.id));
  /** the biome's fillers (what fills a branch site round its rooms), in id order */
  BIOME.fillers = (id) => FILL.list().filter((F) => tagged(F, id)).sort((a, b) => a.id.localeCompare(b.id));
  /** weights for FILL.pick: the biome's fillers only (every other filler at 0) */
  BIOME.fillerWeights = (id) => Object.fromEntries(FILL.list().map((F) => [F.id, tagged(F, id) ? (F.weight || 1) : 0]));

  /**
   * Where `count` of the biome's rooms stand inside one site (its own frame):
   * [{ id, archetype, seed, approach, rects }] for LOT.build, at most `count`
   * (fewer where they do not fit). Each stays `margin` inside one of the
   * site's rects and `gap` from the others, its door facing into the site, and
   * keeps clear of the site's own doorways. No room type twice in one site.
   */
  BIOME.furnish = function furnish(o) {
    const D = BIOME.DEFS[o.biome], rng = new BR.Rng(BR.hash4(o.seed >>> 0, 0xb10e, o.count, 0)), out = [];
    if (!D || !(o.count > 0)) return out;
    const pool = BIOME.templates(o.biome), used = new Set(), placed = [];
    const bb = TG.bbox(o.site.rects), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const doors = (o.conns || []).map((c) => (c.side === 'N' || c.side === 'S' ? [c.at + c.width / 2, c.line] : [c.line, c.at + c.width / 2]));
    const far = (r, list, m) => list.every((q) => r[2] + m <= q[0] + EPS || q[2] + m <= r[0] + EPS || r[3] + m <= q[1] + EPS || q[3] + m <= r[1] + EPS);
    const clearOf = (r) => doors.every(([x, y]) => Math.max(r[0] - x, x - r[2], 0) ** 2 + Math.max(r[1] - y, y - r[3], 0) ** 2 >= D.doorClear ** 2);
    for (let k = 0; k < o.count; k++) {
      const left = pool.filter((a) => !used.has(a.id));
      if (!left.length) break;
      let got = null;
      for (let t = 0; t < 12 && !got; t++) {
        // every room of the pool alike: a district's variety is the point
        const arch = left[rng.int(0, left.length - 1)];
        const w = snap(rng.range(arch.site.w[0], arch.site.w[1])), h = snap(rng.range(arch.site.h[0], arch.site.h[1]));
        // spots on the whole metre inside a site rect, nearest the middle first
        const spots = [];
        for (const q of o.site.rects) {
          for (let y = Math.ceil(q[1] + D.margin); y + h <= q[3] - D.margin + EPS; y++) for (let x0 = Math.ceil(q[0] + D.margin); x0 + w <= q[2] - D.margin + EPS; x0++) {
            const r = [x0, y, x0 + w, y + h];
            if (far(r, placed, D.gap) && clearOf(r)) spots.push(r);
          }
        }
        if (!spots.length) { if (t > 6) left.splice(left.indexOf(arch), 1); if (!left.length) break; continue; }
        // a little way off the middle, by the seed: not every room in the same place
        spots.sort((p, q) => (Math.hypot((p[0] + p[2]) / 2 - cx, (p[1] + p[3]) / 2 - cy) - Math.hypot((q[0] + q[2]) / 2 - cx, (q[1] + q[3]) / 2 - cy)) || p[1] - q[1] || p[0] - q[0]);
        const r = spots[Math.min(spots.length - 1, rng.int(0, Math.min(spots.length - 1, 6)))];
        // its door faces into the site: the side towards the middle with the most room
        const mx = (r[0] + r[2]) / 2, my = (r[1] + r[3]) / 2, dx = cx - mx, dy = cy - my;
        const approach = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
        got = { id: 'h' + k, archetype: arch.id, seed: BR.hash4(o.seed >>> 0, k, t, 0xb10f), approach, rects: [r] };
        used.add(arch.id); placed.push(r);
      }
      if (got) out.push(got);
    }
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
