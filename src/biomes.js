/*
 * biomes.js - the families of templates a growth draws from (growth design,
 * steps 2 and 4).
 *
 * A growth takes the biome of the POI it starts from: a house that can carry
 * its stairwell on up starts a `houseroom` branch, so what stands over the
 * ground beside it is the inside of a house, not generic backrooms.
 *
 *   anchors      an archetype says it can seed growth, and which biome it
 *                starts: `grows: { biome }` (archetypes/house.js)
 *   eligibility  fillers and templates carry `biomes: [...]`, and a branch
 *                draws only from its biome's pool; one can be in several.
 *                Catalogue rooms carry the tag too: the room types the
 *                biome's floors are made of (catalogue.js).
 *   a district   a branch site is a biome filler: for house rooms, a floor
 *                of a house (fillers/house.js: bedrooms, bathrooms and
 *                closets down a hallway, the living rooms and kitchen, an
 *                upstairs hall), every room a house room. Now and then a
 *                whole house of the biome stands inside it too, likelier
 *                near the pillar.
 *
 *   BIOME.DEFS[id]                       { label, houses: [chance of a whole house per site, by distance], floors(rs): filler weights by level and distance }
 *   BIOME.anchorOf(arch)                 the biome an archetype starts, or null
 *   BIOME.templates(id), BIOME.fillers(id)   the pool
 *   BIOME.rooms(id)                      the catalogue's room types of the biome
 *   BIOME.furnish({ biome, site, conns, count, seed })   where its templates stand in one site
 */
(function (root) {
  'use strict';
  const BR = root.BR, TG = BR.TG, TPL = BR.TPL, FILL = BR.FILL;
  const BIOME = BR.BIOME = {};
  const EPS = 1e-7, snap = (v) => Math.round(v * 2) / 2;

  BIOME.DEFS = {
    // the chance a site has a whole house standing in it, by its distance
    // from the pillar (0: the site the landing opens onto)
    houseroom: { label: 'house rooms', houses: [0.7, 0.5, 0.35], margin: 1, gap: 1.5, doorClear: 2,
      // which floor of the house a site is, so a growth reads as one home: the
      // living rooms and kitchen where the first level is entered, an upstairs
      // hall (with its sitting room) where each level above is, bedroom wings
      // round them (the order the rest are tried in when that one cannot be built)
      floors: (rs) => rs.hop !== 0 ? { house_bedrooms: 1, house_upstairs: 1e-3 } : rs.level <= 1 ? { house_living: 1, house_bedrooms: 1e-3 } : { house_upstairs: 1, house_bedrooms: 1e-3 } }
  };
  const tagged = (x, id) => Array.isArray(x.biomes) && x.biomes.includes(id);
  BIOME.anchorOf = (arch) => (arch && arch.grows && BIOME.DEFS[arch.grows.biome] ? arch.grows.biome : null);
  /** the biome's templates (whole buildings that stand inside a branch site), in id order */
  BIOME.templates = (id) => Object.values(TPL.archetypes).filter((a) => tagged(a, id) && !a.grows).sort((a, b) => a.id.localeCompare(b.id));
  /** the biome's fillers (what a branch site is), in id order */
  BIOME.fillers = (id) => FILL.list().filter((F) => tagged(F, id)).sort((a, b) => a.id.localeCompare(b.id));
  /** the catalogue's room types of the biome */
  BIOME.rooms = (id) => Object.keys(TPL.CAT.ROOMS).filter((t) => tagged(TPL.CAT.ROOMS[t], id)).sort();
  /**
   * weights for FILL.pick: the biome's fillers only (every other filler at 0;
   * one kept out of the pool weighs `biomeWeight`); for a raised site `rs`,
   * those its biome gives that floor (`floors`), when it says
   */
  BIOME.fillerWeights = (id, rs) => {
    const D = BIOME.DEFS[id], plan = rs && D && D.floors ? D.floors(rs) : null;
    return Object.fromEntries(FILL.list().map((F) => [F.id, !tagged(F, id) ? 0 : plan ? plan[F.id] || 0 : F.biomeWeight || F.weight || 1]));
  };

  /**
   * Where `count` of the biome's templates stand inside one site (its own
   * frame): [{ id, archetype, seed, approach, rects, floors: false }] for
   * LOT.build, at most `count` (fewer where they do not fit). Each stays
   * `margin` inside one of the site's rects and `gap` from the others, its
   * front facing into the site (its size taken along that front), and keeps
   * clear of the site's own doorways. No template twice in one site; no
   * floors at other heights (a raised floor has none under it).
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
        const arch = left[rng.int(0, left.length - 1)];
        // the smaller half of its size range, more often than not: a branch site is small
        const size = (r) => snap(r[0] + (r[1] - r[0]) * rng.f() * (rng.f() < 0.7 ? 0.5 : 1));
        const front = size(arch.site.w), back = size(arch.site.h);
        // its front along x (facing north or south) or along y (east or west): whichever fits, by the seed
        let ns = rng.f() < 0.5, spots = [];
        for (let turn = 0; turn < 2 && !spots.length; turn++, ns = !ns) {
          const w = ns ? front : back, h = ns ? back : front;
          // spots on the whole metre inside a site rect, nearest the middle first
          for (const q of o.site.rects) {
            for (let y = Math.ceil(q[1] + D.margin); y + h <= q[3] - D.margin + EPS; y++) for (let x0 = Math.ceil(q[0] + D.margin); x0 + w <= q[2] - D.margin + EPS; x0++) {
              const r = [x0, y, x0 + w, y + h];
              if (far(r, placed, D.gap) && clearOf(r)) spots.push(r);
            }
          }
        }
        ns = !ns;
        if (!spots.length) { if (t > 6) left.splice(left.indexOf(arch), 1); if (!left.length) break; continue; }
        // a little way off the middle, by the seed: not every one in the same place
        spots.sort((p, q) => (Math.hypot((p[0] + p[2]) / 2 - cx, (p[1] + p[3]) / 2 - cy) - Math.hypot((q[0] + q[2]) / 2 - cx, (q[1] + q[3]) / 2 - cy)) || p[1] - q[1] || p[0] - q[0]);
        const r = spots[Math.min(spots.length - 1, rng.int(0, Math.min(spots.length - 1, 6)))];
        // its front faces into the site
        const mx = (r[0] + r[2]) / 2, my = (r[1] + r[3]) / 2;
        const approach = ns ? (cy >= my ? 'S' : 'N') : (cx >= mx ? 'E' : 'W');
        got = { id: 'h' + k, archetype: arch.id, seed: BR.hash4(o.seed >>> 0, k, t, 0xb10f), approach, rects: [r], floors: false };
        used.add(arch.id); placed.push(r);
      }
      if (got) out.push(got);
    }
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
