# The template-first world

Every site on the infinite plane is built by a template from its outline and
its connections. Nothing else draws floor or walls. Plain Backrooms sites are
built by **fillers** ([docs/fillers.md](fillers.md)). Points of interest are
built by their own **templates** (House, Rooms; [docs/templates.md](templates.md))
inside a host hall.

![The connection graph over a few cells](world-graph.png)

*Orange is the route (a spanning tree), cyan the loops, pink the openings across
a cell border, and green a POI's doors onto its hall.*

The old world-first fill is gone: its areas, manifestations, patterns, zones,
traversal, interiors and boundaries, along with the offices, pools, parking and
hotel areas. The map is Backrooms only.

## A cell's plan (`src/world.js`)

The plane is cut into 128 m cells. Each cell is planned from `(seed, i, j)` and
its four borders alone. It never looks at another cell's plan, so any part of
the map comes out the same in any order.

1. **Borders.** Every cell border has 2–4 openings, 1.5–2.5 m wide and at least
   8 m from the corners. The border decides them by itself, so the two cells on
   either side agree without asking each other.
2. **POIs.** POIs claim their sites first (`src/poi.js`, below).
3. **Blocks.** The cell is cut into blocks of 8–32 m, in whole metres, by
   recursive cuts. No cut comes within 2 m of a POI or within 1 m of a border
   opening. So every POI sits whole inside one block (a *host* block), and every
   border opening lies inside one block's edge.
4. **Sites.** About 30% of the small blocks merge into a neighbour, making L, T
   and Z sites (up to 900 m² and 40 m). Every block belongs to exactly one site,
   so a cell has no gaps and no overlaps.
5. **The connection graph.** Two sites are neighbours where they share an edge.
   A random spanning tree over the neighbours is the route, and each other
   neighbour pair is opened as a loop with 10–30% chance (more in open
   stretches). Each edge is an exact opening on the shared line: 1–3 m wide, at
   least 1 m from the ends of the shared run, on the 0.5 m grid. The border
   openings join each cell to its neighbours, so the whole plane is one
   connected graph. It is route-shaped: mostly chains, with branches, dead ends
   and a few loops.

Measured over 8 × 8 cells for three seeds:

| | per cell |
|---|---|
| sites | 72–78 (median filler site 144 m²; 10% are under 80 m², 10% over 400 m²) |
| irregular sites | about a quarter |
| POIs, in 5–7 host sites | 5.5–7.5 |
| connections | about 105, of which about 12 cross a border; about 20% are loops |
| plan | about 3 ms |
| build | about 150 ms (2 ms per site) |

## Building a site

`W.build(site)` returns the site's blueprints. It is cached, and the result
depends only on the site.

* **A filler site.** The biome's weights pick a filler from the pool
  (`FILL.pick`). The filler builds the site from the site's connections, given
  in its own frame.
* **A host site.** Each POI is built first with its own template
  (`buildPOI`: three seeds, then it is dropped). The buildings' footprints come
  out of the host's site, along with any courtyard a building closes off. Every
  ground-floor portal of a building becomes one of the host's connections, at
  the exact place and width of the door. Then the `host` filler builds what is
  left. It is a big hall over the POI's site (plus 1–3 m), with a warren
  beyond, partly solid, and sometimes columns in the hall. Houses get windows
  onto the hall.

This is the rule from the design notes: the more specific template places the
shared opening, and the other side adapts. Houses still choose their own
doors; the hall honours them.

Before building, every connection is checked against the site
(`FILL.checkConnection`). A connection the site cannot honour is dropped and
reported in `issues`. None was dropped over about 15,000 sites on three seeds.

Cells a filler leaves unbuilt are solid. About two thirds of the plane is
floor. About 30% of that floor is in rooms of 80 m² or more (open halls and
host halls); the rest is the enclosed warren.

## The biome

One slow noise field, **openness** (0 to 1, on a 380 m scale), tilts the
filler weights and sets how big blocks may grow (18 m in a deep warren up to
32 m in an open stretch):

| feel | weight multiplier |
|---|---|
| enclosed (warren, passage, enfilade, cells, ring) | 1.3 − 0.6 × openness |
| mixed (broken room) | 0.5 + openness |
| open (ragged hall, pillar hall) | 0.15 + 2.2 × openness |

Even in an open stretch, enclosed fillers have about half the weight. Over a
region, enclosed fillers cover 64–77% of the filler area, mixed 18–25% and
open 5–10%. Hover the map to see a place's biome: *deep warren* (under 0.3),
*backrooms*, or *open stretch* (over 0.7).

## POIs (`src/poi.js`)

POIs are decided per 128 m cell (the same grid), from `(seed, i, j)` only. A
POI site stays 3 m inside its cell and 4 m from other POI sites.

| tier | per hectare at density 1 | clusters | templates |
|---|---:|---:|---|
| tiny | 2.0 | 55% beside a bigger POI | closet |
| small | 1.8 | 45% | storage room, restroom, mechanical room, storage units |
| medium | 0.9 | | ranch, bungalow, split ranch, suburban |
| large, huge | 0.04, 0.004 | | none yet |

* **Rhythm.** A slow field (420 m) sets each cell's density between 0.3 and
  1.7, and 12% of cells are quiet (at 0.15 of that). This gives about 3–4 POIs
  per hectare, with long empty stretches.
* **Sites.** A site is sized from its template's own ranges, in whole metres,
  and faces N, E, S or W. When its short side is at least 12 m it may be
  irregular: rect 50%, L 22%, notched 16%, U 12%. The extra band sits behind
  the template's rectangle, so the template never loses the room it asked for.
* **Hooks.** `archetype.weight` sets a template's frequency within its tier,
  and `archetype.poi = false` keeps it off the map (workbench only).

Every number is in `BR.POI_CFG` and `BR.WORLD_CFG`.

## Drawing (`src/render.js`)

The map is drawn into cached 256 px tiles at zoom levels 2^(k/2). Each frame
blits them and spends a 14 ms budget on the missing ones, nearest first.

| zoom | view |
|---|---|
| 1 px/m and closer | **Detail.** Every site's blueprints: the filler, then any POI buildings. All floors are drawn before any walls, so neighbours never paint over each other's walls. POI room labels appear from 7 px/m. |
| 0.12–1 px/m | **Plan.** The cell plans alone, with nothing built. Each site is a flat tone and POI sites are picked out. |
| under 0.12 px/m | **Far.** A raster of the biome and the POI density. |

The per-frame overlays are hover (the site's outline), *Site outlines* and
*Connection graph*.

## API

```js
const W = new BR.World(31337);
W.cell(i, j);              // { i, j, rect, density, openness, pois, borders, blocks, sites, conns, byId, connById }
W.sitesIn(x0, y0, x1, y1); // sites whose bbox meets the rect
W.siteAt(x, y);  W.site('0,0:12');
W.fillerOf(site);          // the filler the pool picks for it ('host' for a POI site)
W.build(site);             // { site, origin, filler (br.filler), buildings: [{ poi, origin, b (br.building), conns }], conns, issues, ms }
W.peer(site, conn);        // the site on the other side of a connection
W.graph(i0, j0, i1, j1);   // the room graph over those cells: { nodes, edges, dangling }
W.poisIn(x0, y0, x1, y1);  W.poiAt(x, y);
W.biomeAt(x, y);           // { openness, name }
```

* A **site** is `{ id ('i,j:k'), i, j, k, rects (world metres), bbox, area,
  pois, host, seed, openness, conns (ids) }`.
* A **connection** is `{ id, o ('h': the line y = c, 'v': x = c), c, s0, s1
  (world metres along the line), a, b (sites; a is west or north of b), route,
  cross }`. A border connection has the other cell's site as `null` and names
  that cell in `peerCell`; both cells use the same id.
* A **filler's portals** carry the connection id they honour. A POI's portals
  are mapped to the host's connection ids in `build(site).buildings[k].conns`.
  `W.graph` joins blueprints through those ids.

## Tests (`tests/world.test.js`, five seeds)

* Sites tile every cell exactly, with no gaps or overlaps, in whole metres.
  Ids are unique. Filler sites are room-cluster sized, and some are irregular.
* Every POI sits whole in one host site, 2 m clear of its edges.
* Every connection is an exact opening on the line its two sites share. Both
  cells agree on every border opening. Each cell is one connected graph,
  route-shaped.
* The plan is the same in reverse order, after unrelated visits, with a tiny
  cache and at far negative coordinates. Another seed gives another world.
* Every site in 3 × 3 cells builds with no problems. Every connection is cut on
  both sides, POI doors included. Every POI builds inside its site, facing its
  main side. The fill leans enclosed, and sites build in under 5 ms on
  average.
* Every room in 3 × 3 cells, POI rooms included, is reachable from every
  other. Only openings that leave the region are left dangling.
* A site builds the same whatever was built before, and a filler site matches
  `FILL.generate` on its own spec.
* POI density, variety, clusters and rhythm, and the biome's range.
* Planning a cell stays cheap.

## Next

* House and Rooms take their entrances from the connections they are given,
  instead of choosing doors that the hall then adapts to.
* Big POIs that claim across cells (a street in a hall, a mall). The cell plan
  already keeps POIs whole; a claim across a border needs the border openings
  to make way for it.
* More fillers and biome families, and wrongness for fillers.
* Shared walls drawn once. Today both sites draw the same line, which looks the
  same but is drawn twice.
