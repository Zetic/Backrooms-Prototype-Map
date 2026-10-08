# Elevation world and cutaway inspection

`BR.BandWorld` wraps the deterministic template world with independently seeded
horizontal reference bands above and below ground zero, joined by **journeys**
(milestone 4, [the plan](elevation.md)): in every 512 × 512 m region, one
territory per pair of neighbouring bands holds a stack of different fillers
climbing from the lower band's floor to the upper band's, 16 m up. Neighbouring
bands are one network. Every other template keeps its up/down potential:
exported layouts list their connection zones (ladder, stair, ramp),
unselected, and the lab builds connected variants of any of them.

## Inspect the map

- Band −/+ and the band menu inspect another horizontal network at the same XY.
  Switching bands resets the cut to that band's reference height.
- Cutaway height shows the highest floor at or below the chosen height at each
  XY within the active band's blueprints. Uncovered lower floors remain visible
  and become darker with depth. This is a schematic view, not a physical section
  through room ceilings.
- Click a template at detail zoom to open its actual local floor choices.
  Selecting a floor moves the cut to that height. Upper-floor ghosting applies
  only to the selected template. Clear selection removes this focus.
- Template JSON downloads the selected instance, its XY origin and explicit
  absolute floor/ceiling heights. It does not regenerate a sample approximation.
- Export this cell · 3 bands downloads spatial data for the centered cell in
  the active band and its two neighbors, joined wherever a journey's territory
  lies in the cell.
- Journey ↓ / Journey ↑ centre the view on the nearest journey down or up from
  the active band. At plan zoom journey territories are teal; hovering one names
  its bands, style and floors. At detail zoom the cutaway shows the journey's
  floor at the cut height: slide the cut to climb it, or switch band to see its
  top.
- Connection graph shows horizontal site connectivity in the active band.

Seed, XY/zoom, band, cut height and display toggles stay in the URL, for example
`#seed=7&band=1&cut=18.125&z=4`. Template selection is temporary and clears when
changing seed or band. Older `floor` offsets are read once as a height offset
from the band reference. Plan/far zoom still shows territory and biome context.

The standalone [elevation lab](../elevation.html) offers both continuous cutaway
and exact local floor inspection. Ramp/stair footprints use their width and XYZ
path; no extra floor entries are created by sloped paths or tall ceilings.
Connections show landing heights, continuation above the cut and the destination
outline in both directions. Clicking the footprint reveals its other landing.

## Current planning and reservations

| Policy | Value | Purpose |
| --- | --- | --- |
| Reference spacing | 16 m | Fits existing tall halls and slabs |
| Ordinary envelope | Reference −1.5 m to +14.5 m | Room/slab ownership: a sunken floor down to −1.25 m (plus its slab) up to a 14 m street ceiling; 16 m in all, so bands never overlap |
| World vertical journeys | One per band pair per 512 m region (4 × 4 cells) | A territory of 40-56 × 32-48 m in one cell; even pairs in the region's west half, odd pairs in its east half; three doors onto each band |
| Journey envelope | Lower reference −1.5 m to upper reference +14.5 m | The whole territory, through both bands |
| Export limit | 64 band cells | Bounds synchronous inspection |

These are initial policies, not required story heights. World blueprints keep
their own floors: houses of two and three storeys (to about +8.7 m), galleries,
sunken floors, each joined by its own real stair inside the band (their
navigation edges stay inside one band's network). Journeys are the only owners
across two bands.

## Journeys in the world

`journeyPlan(lower, ri, rj)` gives the journey between bands `lower` and
`lower + 1` in region (ri, rj): its cell, rectangle and seed, from (world seed,
region, band pair) alone, or null if no cell of its half has room clear of both
bands' border openings. Its doors come with it (`BR.JOURNEY.plan`), so
`plannedLots(n, i, j)` can hand a cell plan its journeys (one arriving from
below, one leaving above, at most) without building anything. The cell planner
cuts the cell round the rectangle and wires the doors into its network, as it
does a flush lot. The site is of kind `transition`, `owner` the journey's id,
`fillerOf` `'journey'`.

Building the site builds the journey (`journey(p)`, cached, up to four seeds),
the same blueprint in both bands. `buildTransition` clones it and binds only
the doors at the site's own band (portals keep their planned connection ids,
`low0..` and `high0..`, until bound). Its heights are absolute already, so
`spatial` returns it as built. If no seed fits, `standIn(p, n)` puts an
ordinary filler on the territory in each band behind the same doors: the
world stays valid, the bands stay apart there, and nothing pretends to climb.

In the spatial graph a journey's nodes are emitted once whichever band's slice
adds them, and its climbs are ordinary navigation edges (stair, ramp, ladder)
between its floors. Seams (seams.js: the doors and windows cut through a wall
two blueprints share) are not computed against a journey, whose floors stand
at several heights: its only ways in are its planned doors.

Ground zero keeps the original seed; other bands derive their seeds from the
world seed and band index. Ordinary site IDs include the band, such as
`b-1|-2,1:12`. `reservationPlan(i,j,minBand,maxBand)` reconstructs an atomic local
index from deterministic site ownership, so eviction does not free space for
another owner. Child POIs identify their containing site's `reservationOwner`.
An ordinary blueprint exceeding its envelope is rejected rather than shortened.

Map painting reads original blueprints with their band offset. It does not run
spatial adaptation or connection-zone searches. `world.spatial(site)` caches
explicit-Z adaptation when navigation/export needs it. Exports materialize
up/down capabilities and `connectionZones[]` (no cutouts or edges) and exclude
wall-clock timing diagnostics. Placing a blueprint in a band shifts every
connector reservation prism and every zone's entry, exit, heights and path with
it; a blueprint's `ground` band maps to its home band and any other to its
destination band, which must differ.

Band, cell, build and tile caches are bounded. Cutaway geometry plans are cached
by actual floor intervals, at most eight per blueprint; sliding between floors
reuses the visibility plan. Tile caches include height, band, selection and
ghost settings, including coarser detail fallbacks, and retain at most 260 tiles.

## Spatial graph and export

The experimental schema remains **`br.world-elevation/0.1`**, metres, XY
horizontal and Z up. Blueprint XY coordinates are local to the supplied world
`origin`; Z values are already absolute. Portal matching uses world XYZ.

| Field | Meaning |
| --- | --- |
| `policy` | Reference spacing; `verticalJourneys: "composed"`, `journeysPerRegion`, `regionCells` |
| `journeys` | Each journey whose territory is in the region: id, origin, bands, style, and its stages (filler, height, leg) |
| `bands` | Requested reference IDs and elevations |
| `slices` | Per-band cell ownership and horizontal connection plans, not viewing slices |
| `layouts` | Owner, reservation owner, XY origin and complete elevation blueprint |
| `reservations` | World XYZ envelopes |
| `navigation` | Authoritative surface nodes and directed traversal edges |
| `portalMatches` | Paired openings, world XYZ, width, facing and usable headroom |
| `frontier` | Horizontal openings leaving the exported region |
| `verticalFrontier` | Doors of a journey onto a band outside the export (`state: "outside-region"`, world XYZ) |
| `unresolved` | Legacy abstract links requiring authored physical paths |

Matching requires equal XYZ and width, opposite sides and at least 1.8 m
headroom. Export rejects missing internal endpoints and mismatched connections.
Ghosts and occupancy add no traversal edges. An export of three bands is one
network where the region holds the journeys between them: two neighbouring
cells holding the journey from band −1 and the one from band 0 already make
bands −1, 0 and +1 one network, walkable from bottom to top and back.

```js
const world = new BR.BandWorld(7);
world.setBand(-1);
const data = world.exportRegion(0, 0, 0, 0, [-1, 0, 1]);
const graph = world.graph(0, 0, 0, 0, [-1, 0, 1]);
```

## Verification and next work

The suite checks connected horizontal bands, exact cell tiling (journey sites
included), three bands made one walkable network by their journeys, each band
binding only its own doors, journey plans and slices identical in fresh and
evicting worlds whichever band comes first, cell plans that build no journey,
the stand-in for a journey that cannot be built, canonical exports after
reverse generation and eviction, physical geometry fitting planned envelopes,
vertical frontiers, exact portal matching, and invalid inputs.
`tests/journeys.test.js` checks the journeys themselves.
Cutaway tests exercise arbitrary/negative heights, overlapping floors, floor
holes, tall rooms, full-width diagonal paths, selected-only ghosts and bounded
caches. Actual map/lab controllers run with DOM/canvas adapters. The rendering
preview was produced and pixel-checked with a native canvas; it is not browser
layout QA.

Connection zones and slope-following reservations (milestone 2), template
floors with their own stairs (milestone 3) and journeys between the bands
(milestone 4) are in place. The [implementation plan](elevation.md) sets the
next milestone: an Unreal consumer that rebuilds this data.
