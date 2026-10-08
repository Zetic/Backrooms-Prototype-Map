# Elevation world and cutaway inspection

`BR.BandWorld` wraps the deterministic template world with independently seeded
horizontal reference bands above and below ground zero, joined by what **grows**
between them (growth step 3, [growth.md](growth.md), `src/growth.js`): a growth
starts at a pillar, spreads floors of its biome, climbs on by short legs, and
where it reaches the next band's floor lands in one of that band's landing
sites. The old journey plots (milestone 4) are gone from the world; the journey
generator stays in the [elevation lab](../elevation.html). Every other template
keeps its up/down potential: exported layouts list their connection zones
(ladder, stair, ramp), unselected, and the lab builds connected variants of any
of them.

A world column holds several owners stacked at different heights (milestone 5):
a ground site keeps its own floor with its ceiling capped, a **raised floor**
above it owns its column from its floor slab up to the next floor's slab (or
the band's ceiling), and a landing site of the band above owns what is over
that. See [Layered ownership](#layered-ownership-claims-raised-floors-and-pits).

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
  the active band and its two neighbors, joined wherever a growth's climb
  arrives in the cell.
- Way ↑ centres the view on where the nearest growth that reaches the band
  above starts (its house); Way ↓ on where the nearest climb
  from the band below arrives in this one. Both search outward ring by ring of
  cells, up to three cells away.
- Raised floors are painted with the ground at detail zoom, each at its own
  floor height: below its floor one shows nothing, at or above it the floors
  below show through its pit and round it. Hovering one names it `raised floor ·
  <filler>`, its level and how far it is from where its level is entered;
  hovering the ground under it says a growth stands over this ground, at what
  height, and where this site's own ceiling now is. Hovering a pillar's site
  (the house lot) lists the growth's floors and whether it
  reaches the band above; hovering a landing site says which climb comes up
  into it.
- In the band above, a climb from below is painted through the opening its
  landing site leaves round it: its landing at the band's floor and its flight
  below. At plan zoom raised floors are tinted lilac and arrivals teal (only
  growths already planned are shown there).
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
| Growth origins | One cell per block of 2 × 2 cells, by the seed; its ground plan places a growth house (two-storey or townhouse) whose stair carries on up | At most one growth per cell, and every pillar a house |
| Growth cells | Every cell belongs to the nearest origin among its own and the neighbouring blocks' (ties by the seed) | Needs no cell plan; cells and the old regions are no border to a district |
| Levels | First floor one flight over the house's top storey (+6.5 m two-storey, +9.5 m townhouse); then legs of 3-6.5 m on the half metre, the top floor at most +11.75 m | Every level keeps 2.75 m under the one above or the band's ceiling |
| Floors per level | 2-6 sites, 2,000 m² at most, over plain ground or the level below | A district of its biome (houseroom) |
| Ground under a floor | A plain site with nothing over its slab: a filler tagged `tall` is built and checked, an untagged one needs 4.5 m | Tall rooms are grown round, never cut down |
| Steering | Three growths in four always climb on and try to arrive; the rest climb each level by chance (50%) | Ways up spread over the world |
| Landing sites | The next band's plain sites within 36 m of a growth house below, less the next band's own growth houses' sites | Kept for arrivals from below: no growth of their own band stands over them |
| Ground claim | Reference −1.5 m up to the slab of the floor standing on it, else +14.5 m; less a climb's opening in a landing site | A ground site keeps its own floor; only its ceiling is capped |
| Raised claim | Its floor −0.25 m (its slab) to the next floor's slab, or reference +14.5 m; plus the climb it carries, to its landing's ceiling | Meets the claims below and above exactly at the slabs, never overlapping them |
| Pit | 2 × 2 m, at least 3 m of fall, one per growth at most | A drilled one-way drop from a first-level floor into the ground site under it |
| Export limit | 64 band cells | Bounds synchronous inspection |

These are initial policies, not required story heights. World blueprints keep
their own floors: houses of two and three storeys (to about +8.7 m), galleries,
sunken floors, each joined by its own real stair inside the band (their
navigation edges stay inside one band's network). The only owner reaching from
one band into the next is a growth's last climb: its landing stands on the band
above's floor, in a landing site built round it.

## Growth in the world

`growth(n, i, j)` is the growth from origin cell (i, j) of band n, or null:
`BR.GROWTH.plan` ([src/growth.js](../src/growth.js)), cached and pure.
`growthAt(n, i, j)` is the growth that may use a cell (its owner's, by
`GROWTH.owner`), and `raisedSites(n, i, j)` the floors of it standing in that
cell. Planning reads cell plans and raw builds (`World.buildRaw`, uncached and
unhooked) only, never a finished build, so a growth is the same in any order.
`growthReady(n, i, j)` says whether a cell's growths are planned yet and
`prepareGrowth` plans them, so the map can plan a few within each frame.

- **Origins.** `GROWTH.isOrigin` picks one cell per block of 2 × 2 cells by
  the seed alone. The world passes `plants` to each band's World, and the
  ground plan of an origin cell places a growth house first (`poi.js`: an
  archetype with `grows`, facing north or east, towards the middle of the
  cell), kept only when `GROWTH.raises` says its stair can carry a flight up
  with 3 m of headroom left; the house is marked `grows`. `GROWTH.candidate`
  gives an origin its priority from the seed, and `GROWTH.owner` gives every
  cell to the nearest origin among the 3 × 3 blocks round it, so growths
  never share a cell and ownership needs no cell plan.
- **Pillars.** The house carries its stair on up to a landing at its lot edge
  (claims.js, as in step 2). Failing the planted house, another house in the
  cell whose stair can carry on up is tried. The landing opens on a free side
  onto the growth's first floor.
- **Ground.** A floor stands only over a plain filler site (`GROWTH.growable`):
  no POI, no lot, not a landing site, and nothing it would cut. A filler tagged
  `tall` (a hall with a gallery) is built and stands under the floor only when
  no ceiling rises above the floor's slab (`keepsUnder`, `CLAIM.topOf`); an
  untagged one needs 4.5 m. Otherwise the district grows round it.
- **Levels.** `GROWTH.schedule(z1, rng, steered)` gives the floors: legs of
  3-6.5 m on the half metre, the top floor a storey under the band's ceiling
  and within one leg of the next band's floor (+9.5 to +11.75 m). Each level
  grows breadth first over 2-6 sites (2,000 m² at most): the first, then plain ground and the
  level below's floors sharing at least 5 m of edge. Every floor is a district
  site of the biome (`GROWTH.raisedSite`: a biome filler with the biome's rooms,
  every ceiling capped under the level above), and a floor that cannot be built
  goes with everything grown from it.
- **Legs.** A leg climbs from a floor of the level, furthest from where the
  level was entered first: that floor's own filler takes a stair or ramp (a
  ladder only where neither fits anywhere) with the exact rise to the next
  level. Its landing opens on a free side, and the next level's first floor
  stands over that site less the climb's footprint (`box`), entered through
  the landing's doorway. No climb stands over another: each next floor leaves
  the climb's footprint out.
- **Arrival.** From the top level, a last leg climbs to the next band's floor
  inside one of the landing sites that band keeps for the growth
  (`GROWTH.kept`: its plain sites within 36 m of the growth house, where the
  top floors stand, less the sites of its own growth houses' doors; no growth
  of their own band ever uses them, so planning band n never waits on band
  n + 1's growth). The climb keeps a metre inside the
  landing site; the landing site is rebuilt on its rects less the climb's
  footprint, with its own doors and one onto the landing (`afterBuild` swaps the
  build in). Where it means to arrive, the top level grows toward landing sites
  and the leg below it is put under them.
- **Steering.** Three growths in four, by the seed, are steered: they always plan every level and the arrival. The rest climb each
  level, and arrive, with a 50% chance. A steered growth that cannot arrive
  simply ends; there is no fallback plot.

Raised floors have ids `b<n>|<i>,<j>:raised<level>.<k>` (the cell they stand
in) and owners `growth:<n>:<i>,<j>:<level>.<k>`; their doors and climbs carry
ids `b<n>|<i>,<j>:x..`, `:l<level>` and `:up` minted on the origin cell, with
the `cells` of both ends. The floors that carry a climb are spatial
blueprints (absolute heights) already.

Ground zero keeps the original seed; other bands derive their seeds from the
world seed and band index. Ordinary site IDs include the band, such as
`b-1|-2,1:12`. `reservationPlan(i,j,minBand,maxBand)` reconstructs an atomic local
index from deterministic site ownership, so eviction does not free space for
another owner. Child POIs identify their containing site's `reservationOwner`.
An ordinary blueprint exceeding its envelope is rejected rather than shortened.

Map painting reads original blueprints with their band offset. It does not run
spatial adaptation or connection-zone searches; a template's own stairs come
kept on it from generation (`stairs`), so the cutaway draws them (to a
gallery, between storeys, into a sunken floor) without adapting anything, and
their tags are drawn after every wall of the tile. `world.spatial(site)` caches
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

## Layered ownership: claims, raised floors and pits

A claim is one owner's height range over a set of rectangles:
`{ owner, kind, rects, z0, z1 }`. `reservationPlan` emits each owner's claims,
so several owners can hold the same XY at different heights. A ground site's
claim runs from the band's floor limit to `ceilingOf(site)`: the floor slab of
the raised floor standing on it, or the band's ceiling limit where nothing
does (`claimOf`; a landing site's claim leaves out the climb that comes up
into it, ). A raised floor's
claim runs from that same slab up to its `top`: the next level's slab where a
floor stands over it, else the band's ceiling limit; a floor carrying a climb
adds the climb's footprint from its own slab to the landing's ceiling
(`raisedClaim`). Claims meet exactly at the slabs (6.25 m for a floor at
+6.5 m); touching is legal, overlapping is not, and a blueprint exceeding its
own claim is rejected rather than shortened. Under a growth's top floor and
band 1's landing site three owners share one column: the ground to +9.25 m,
the floor to +14.5 m, and the landing site from +14.5 m.

![A raised branch over the ground, on the map](raised-branch.png)

*The map at seed 31337, cell (−3, 2) of band 0, as milestone 5 placed it: the
ground at 0 m, and the same place at +6.5 m with the branch over it. Since
growth step 2 the house there no longer seeds one; see the next picture.*

![A branch of house rooms over the ground](house-branch.png)

*Growth step 2 at seed 7, cell (3, −2) of band 0, as that step placed it: a
two-storey house's stair carried up a flight, and a branch of four house-room
sites grown from its landing at +6.5 m. Since step 3 (with the journey plots
gone and landing sites kept free) that growth has two floors at +6.5 m and
three more at +11 m, reached by a stair from the first.*

`BR.CLAIM` ([src/claims.js](../src/claims.js)) holds the mechanics, shared by
the world and the elevation lab:

- `stairTop(b)` finds the highest room of a real stair of the blueprint's own,
  when it is on the template's top floor, with the sides whose walls are
  exterior.
- `raiseStair(b, { z, side, reach, … })` carries that stair on up: it extends
  the stairwell on one exterior side, adds a level and a `stairwell` room tagged
  `raised` with its four walls, a door snapped to the half metre and a portal
  tagged `raised branch`, appends the landing to the stair's own vertical, and
  rebakes. It refuses a landing with less than 3 m of climb or no room for the
  run, and returns the new blueprint, the landing and the door's world line.
- `pitSpot`, `markDrop` and `drill` place and cut a pit (below).

A house pillar is found as in step 2: the first yard lot in id order whose
house seeds growth and has a `stairTop` that can carry one flight up (to a floor
on the half metre at least `branch.rise` 3.3 m up and clear of the top storey's
ceiling, with 3 m of headroom left), the side and reach that reach the lot's
edge, and the plain filler site across that door, which keeps under the slab
(`keepsUnder`, a raw build and `E.capCeilings`). The growth's floors then grow
as described [above](#growth-in-the-world).

Building stays separate from planning: `World.buildRaw` builds a site without
the cache or the hook, so the planner can measure a ground build, and every
build-time change happens in `afterBuild` — capping ceilings with
`E.capCeilings` (which refuses a cap that would leave a room under 2.2 m),
swapping the anchor house for its landing build, swapping a stair pillar's
filler for its climbing one, rebuilding a landing site round a climb from
below, and marking the ground filler with the pit's lower half.

A pit is drilled, not authored: templates cut no openings in their own roofs.
`pitSpot` scans the branch's floors on a half-metre grid for a clear 2 × 2 m
square with a clear floor at least 3 m below it and nothing crossing the shaft
between them. `drill` cuts a `floor` hole above and a `ceiling` hole below, both
of kind `pit` and owned by the drop's id, and reserves the shaft as a void and a
volume on the lower claim, so no later blueprint fills it. Both blueprints carry
a `drop` record with the same id and rectangle and a `role` of `top` or
`bottom`; the graph pairs them into a single directed `forward` edge of kind
`pit` and emits no undirected edge, so nothing walks back up. A pit has no
ladder and no rope: it drops the player into what is below.

Growth adds nothing to the ground plan. Its floors stand over plain filler
sites (never a lot or a POI, never a landing site), `cell.sites` is never
touched, and the anchor house only gains rooms above its own top floor, so its
footprint, doors and yard are unchanged; a stair pillar and a landing site keep
their site, their doors and their floor, with a climb in them. The suite plans
a cell with growth disabled and with it enabled and compares both.

## Spatial graph and export

The experimental schema is now **`br.world-elevation/0.3`**, metres, XY
horizontal and Z up (0.1 carried neither claims nor pits; 0.2 had journeys and
one level of raised floors). Blueprint XY
coordinates are local to the supplied world `origin`; Z values are already
absolute. Portal matching uses world XYZ.

| Field | Meaning |
| --- | --- |
| `policy` | Reference spacing; `verticalJourneys: "grown"`; `layeredOwnership: "stacked-claims"`; `growth` (`pillars`, `block`, `steer`, `carry`, `landings` in metres, `rise`, `sites`, `area`, `tall`, `biomes`) |
| `growths` | Each growth using a cell of the region: id, band, origin, pillar (`house`), biome, steered, cells, levels (floor height and sites), legs (type, rise, connection), its arrival (band, floor it leaves, landing site, type, rise, connection) and pit |
| `pits` | Each drilled drop: id, the nodes it goes from and to, its world rectangle and its fall |
| `bands` | Requested reference IDs and elevations |
| `slices` | Per-band cell ownership and connection plans, not viewing slices; each site carries its `floorZ` and capped `ceilingZ`, and `raised[]` lists the floors standing in the cell with their `growth`, `level`, floor height, `ceilingZ` (their claim's top), `biome` and `hop`; `connections` adds the growth's doors and climbs with an end in the cell |
| `layouts` | Owner, reservation owner, XY origin and complete elevation blueprint |
| `reservations` | World XYZ envelopes |
| `navigation` | Authoritative surface nodes and directed traversal edges |
| `portalMatches` | Paired openings, world XYZ, width, facing and usable headroom |
| `frontier` | Horizontal openings leaving the exported region |
| `verticalFrontier` | A climb's doorway onto a band outside the export (`state: "outside-region"`, world XYZ) |
| `unresolved` | Legacy abstract links requiring authored physical paths |

Matching requires equal XYZ and width, opposite sides and at least 1.8 m
headroom. Export rejects missing internal endpoints and mismatched connections.
Ghosts and occupancy add no traversal edges. A climb between bands is matched
only when both its bands are asked for (`…:up` connections); otherwise its
doorway is a vertical frontier. Over a growth's cells and bands 0 and 1, the
graph walks from the house on the ground up through every level
to the landing site on band 1's floor, and back.

```js
const world = new BR.BandWorld(7);
const G = world.growth(0, 0, 2);               // a townhouse's growth, arriving in band 1
const data = world.exportRegion(0, 2, 1, 2, [0, 1]);
const graph = world.graph(0, 2, 1, 2, [0, 1]);
const way = world.nearestWay('up', 0, 0);       // { growth, at, band }
```

## Verification and next work

The suite checks exact cell tiling and one ground network per band cell with no
journey plots, floors inside the envelope of the band they are in, exact
portal matching and invalid inputs. For growth (`tests/band-world.test.js`):
a known townhouse growth (seed 7, cell (0, 2)) with its stair carried up, its
floors over capped ground, three owners stacked in one column with no claims
overlapping in 3D, a pit that is forward-only, an exact climb to band 1's
floor into a landing site built round it, and a walk from the ground to band 1
and back; a known two-storey growth (seed 7, (0, 1)) with a leg up from its
first level, no shafts and the same walk; a growth whose floors stand in two
cells with its doors matched across the border; the ground plan identical with
growth disabled, but for the house an origin cell places; identical canonical exports and growths in fresh and evicting
worlds in any order, with every layout fitting its claim; the level schedule;
and, over a window of cells, every growth's rules (own cells, floors over plain
ground or the floor below, its biome's pool, inside its claims, exact legs, no
shafts, arrivals into landing sites only, one origin a block and planted
houses only there, most growths steered and arriving, most blocks with a way
up, under a third of plain sites kept for landings), and that the tall fillers
are tagged and never grown over. `tests/claims.test.js` checks the claim mechanics and
`tests/journeys.test.js` the journey generator the lab still offers. Cutaway
tests exercise arbitrary/negative heights, overlapping floors, floor holes,
tall rooms, full-width diagonal paths, selected-only ghosts and bounded caches;
the tile renderer test checks raised floors at their own heights and a climb
from below painted in the band above. Actual map/lab controllers run with
DOM/canvas adapters. It is not browser layout QA.

Connection zones and slope-following reservations (milestone 2), template
floors with their own stairs (milestone 3), layered ownership with a drilled
pit (milestone 5), a house pillar with a branch of its biome (growth step 2)
and recursive growth between the bands (step 3) are in place. Houseroom
variety, emergent connections and linking growths come next
([growth.md](growth.md)); an Unreal consumer that rebuilds the data stays on
the plan.
