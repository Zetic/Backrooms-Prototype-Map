# POI placement milestone

This milestone puts points of interest on the infinite map. It covers steps 1–2
of the plan:

1. Make the world's areas smaller and more frequent.
2. Place POIs: a size mix, a density rhythm, clusters, and a site for each one,
   with every POI's template blueprint built on its site.

Sites are **not yet carved out of the fill**, and their entrances are not yet
connected to routes. The map shows each POI as an overlay above the fill, so the
density and mix can be judged first. Edge gates and routes come next, then
carving sites and stitching them into the fill.

## World scale

Areas (district manifestations) are now about half their former size, so a
walk passes through several moods instead of spending minutes in one.

| Setting | Before | Now |
|---|---|---|
| District cell (`AREA_CFG.districtCell`) | 380 m | 180 m |
| District chance per cell (`districtP`) | 0.74 | 0.85 |
| Manifestation radii (`MANIFESTATION_SCALES`) | small 58–92 … regional 190–262 m | small 29–46 … regional 95–131 m |
| Field warp | 42 m over 280 m | 28 m over 180 m |
| Base-area DNA region | 760 m | 320 m |
| Backrooms colour drift | 200 / 260 m | 120 / 150 m |

Territory sizes (14–84 m pieces) and every pattern rule are unchanged.

The table below is measured over a 2.4 km square for seed 31337. The median
patch is a connected run of territories with the same area; "side" is the side
of a square with that area.

| Area | Patches before | Median before | Patches now | Median now |
|---|---:|---:|---:|---:|
| Offices | 12 | 144 m side | 69 | 68 m side |
| Hotel | 1 | 196 m side | 27 | 56 m side |
| Poolrooms | 8 | 294 m side | 34 | 84 m side |
| Parking | 9 | 201 m side | 34 | 119 m side |

Backrooms stays the base fill, at about 70% of the floor. All five canonical
seeds still pass the determinism and circulation suites. The review
coordinates in `ARCHITECTURAL_PATTERNS.md` and `WORLD_SPACE_CIRCULATION.md`
refer to the earlier scale.

## The POI plan layer (`src/poi.js`)

POIs are decided per **planning cell** (128 m square), from `(seed, i, j)` only.
A site never leaves its cell: it stays `margin` (3 m) inside, and sites stay
`gap` (4 m) apart. So neighbouring cells can never conflict, any part of the
infinite map can be asked for in any order, and the fill always has room to
pass between sites.

```
cell (i, j) ─► density (rhythm) ─► per tier, biggest first:
                                     count = perHa × hectares × density
                                     each: position (anywhere, or beside a bigger POI)
                                           ─► template (weight × area fit)
                                           ─► site size from the template's ranges, main side, shape
                                           ─► kept if it fits the cell and clears the others
```

### Tiers

A template's tier is its size class (`TPL.sizeClass`, from its site ranges).
Tiers with no templates in the catalogue are skipped.

| Tier | Per hectare at density 1 | Clusters | Current templates |
|---|---:|---:|---|
| tiny | 2.0 | 55% beside a bigger POI | closet |
| small | 1.8 | 45% | storage room, restroom, mechanical room, storage units |
| medium | 0.9 | — | ranch, bungalow, split ranch, suburban |
| large | 0.04 | — | (none yet) |
| huge | 0.004 | — | (none yet) |

### What it gives, measured

Measured over a 1.6 km square (256 ha) for each of the five canonical seeds:

- 3.2–4.4 POIs per hectare: per hectare, about 1.4–1.8 tiny, 1.3–1.7 small and
  0.6–0.8 medium;
- the median distance to the nearest POI is 17–19 m, and to the nearest house
  60–74 m;
- about 45% of the tiny and small POIs sit in clusters beside a bigger one;
- about 6% of sites are irregular, which is a third of the houses;
- every POI built a valid blueprint on its site: 0 failures in about 3,500, at
  about 2 ms each.

### Rhythm

Each cell's density comes from slow noise (a 420 m scale), between 0.3 and 1.7.
In addition, 12% of cells are quiet, at 0.15 of their density. In a 10 × 10
cell sample, about a fifth of the cells have two POIs or fewer. That leaves
long empty stretches between the busy pockets.

### Sites

The size comes from the template's own `site` ranges, in whole metres. The main
side faces one of N, E, S or W (for now at random; later it will face the
route).

Sites whose short side is at least 12 m are sometimes irregular:

| Shape | Chance |
|---|---:|
| rect | 50% |
| L | 22% |
| notched | 16% |
| U | 12% |

An irregular site adds a ragged band behind the template's own rectangle. The
main side and the room the template asked for always stay whole, so an
irregular site never makes a template fail. The House engine builds in the
largest inner rectangle. The unused band goes back to the fill once sites are
carved.

### Data hooks

All hooks are optional:

```js
// a template only in some areas (relative weights; '*' = everywhere else)
BR.TPL.registerArchetype({ ...recipe, areas: { poolrooms: 3, '*': 0 } });
// a template's frequency within its tier
recipe.weight = 2;
// fewer or more POIs inside an area, overall or per tier
BR.AREAS.parking.poi = { density: 0.6, tiers: { medium: 0 } };
// keep a template out of the world (workbench only)
recipe.poi = false;
```

Every number above is in `BR.POI_CFG`.

## API

```js
W.poiCell(i, j);              // { i, j, density, area, rect, pois: [...] }
W.poisIn(x0, y0, x1, y1);     // POIs whose site bbox intersects the rect
W.poiAt(x, y);                // the POI whose site contains the point
W.poi(id);                    // by id ('i,j:k')
W.poiBuilding(P);             // br.building in the site frame (origin = P.bbox corner), or { error }
```

A POI record contains:

- identity: `id`, `i`, `j`, `k`;
- the template: `tier`, `archetype`, `name`, `engine`;
- context: `area` (the semantic area at its centre), `cluster` (the id of the
  POI it sits beside, or null);
- the site: `approach`, `shape`, `w × h` (the canonical size), `bbox` and
  `rects` (world metres), `cx`, `cy`;
- `seed`: the template seed.

If no template seed fits, `poiBuilding` tries two more and then returns an
error. None failed in testing.

Both caches are bounded and evictable: `poiCells` (3,000) and `buildings` (900).

## Viewer

POIs are on by default. Use **Points of interest → POIs**, or stage
**9 · Points of interest**:

| Zoom | Shows |
|---|---|
| below 0.25 px/m | nothing (too far out) |
| 0.25–0.7 | a dot per POI, coloured by tier |
| 0.7–1.4 | site footprints, with names for medium POIs |
| 1.4–6 | each blueprint at map detail: floors, walls, windows, entrance/exit markers |
| 6 and closer | the full blueprint drawing: doors, portals with clearance, room labels from 9 |

Blueprints are built nearest-first within the frame budget. The unbuilt part of
a site has a dark backing, because it is not carved into the fill yet.

Hover a site to see:

- the template and its tier;
- the site's size, shape and main side;
- its area and any cluster;
- the room and portal counts, the plan, the score and any mutations.

**Planning cells** draws the 128 m grid with each cell's density and POI count.
The HUD shows the POIs in view, their density and blueprint build times.

## Tests

`tests/poi.test.js` runs from `run-all.js` for seeds 31337 and 7. It checks:

- **Determinism:** placement is identical under unrelated visits, reverse cell
  order, tiled queries with a 3-cell cache, and far negative coordinates. A
  different seed differs.
- **Sites:**
  - each site stays inside its cell, in whole metres, with rects that fill
    its bbox;
  - every pair keeps the gap, across cells too;
  - ids resolve, and `poiAt` finds each POI.
- **Density and variety:**
  - 2–7 POIs per hectare;
  - every tier and template appears;
  - irregular shapes and all four main sides appear;
  - clusters exist;
  - a busy/quiet ratio above 3, with quiet cells present.
- **Blueprints:**
  - every POI in a 640 m square builds;
  - rooms stay inside the site, and the main entrance faces the planned side;
  - a blueprint is identical whatever was built before.
- **Hooks:** `archetype.areas` and `AREAS[...].poi.density` work, and removing
  them restores placement.
- **Cost:** planning a cell takes about 0.1 ms.

## Next

1. **Edge gates and routes.** Give each planning-cell edge deterministic
   crossing points. Join each cell's POI entrances and gates with a backbone (a
   tree plus a few loops), reusing the existing circulation where it fits.
   Point each POI's main side at its route.
2. **Carve and stitch.**
   - Sites become holes in the territory ownership.
   - Exterior walls become boundaries, and portals become the shared entrances.
   - Portal clearance boxes stay open.
   - Unused site cells go back to the fill.
   - Home pockets can then be replaced by houses.
3. **POIs larger than a cell** (mall, street, tower), with a claim on
   neighbouring cells that they check before placing.
