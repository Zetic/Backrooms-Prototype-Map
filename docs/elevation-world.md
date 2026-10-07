# Elevation world and cutaway inspection

`BR.BandWorld` wraps the deterministic template world with independently seeded
horizontal reference bands above and below ground zero. The atrium and its
placement/reservation policy have been removed. **There are currently no
world-generated connections between bands.** Every template keeps up/down
potential: exported layouts list their connection zones (ladder, stair, ramp),
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
  the active band and its two neighbors. These are separate networks for now.
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
| Ordinary envelope | Reference −0.25 m to +15.5 m | Conservative room/slab ownership |
| World vertical journeys | None | Atrium retired; replacements are later milestones |
| Export limit | 64 band cells | Bounds synchronous inspection |

These are initial policies, not required story heights. Current ordinary world
blueprints keep their original local floors. Broader local floor variation,
shared multi-band footprints and composed vertical journeys are future work.

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
| `policy` | Reference spacing; `verticalJourneys: "none"` in this milestone |
| `bands` | Requested reference IDs and elevations |
| `slices` | Per-band cell ownership and horizontal connection plans, not viewing slices |
| `layouts` | Owner, reservation owner, XY origin and complete elevation blueprint |
| `reservations` | World XYZ envelopes |
| `navigation` | Authoritative surface nodes and directed traversal edges |
| `portalMatches` | Paired openings, world XYZ, width, facing and usable headroom |
| `frontier` | Horizontal openings leaving the exported region |
| `verticalFrontier` | Unrequested destination-band landings; currently empty |
| `unresolved` | Legacy abstract links requiring authored physical paths |

Matching requires equal XYZ and width, opposite sides and at least 1.8 m
headroom. Export rejects missing internal endpoints and mismatched connections.
Ghosts and occupancy add no traversal edges. An export of three bands currently
has three separate connected horizontal networks.

```js
const world = new BR.BandWorld(7);
world.setBand(-1);
const data = world.exportRegion(0, 0, 0, 0, [-1, 0, 1]);
const graph = world.graph(0, 0, 0, 0, [-1, 0, 1]);
```

## Verification and next work

The suite checks connected horizontal bands, exact cell tiling, removal of atrium
sites/routes, canonical exports after reverse generation and eviction, physical
geometry fitting planned envelopes, exact portal matching, and invalid inputs.
Cutaway tests exercise arbitrary/negative heights, overlapping floors, floor
holes, tall rooms, full-width diagonal paths, selected-only ghosts and bounded
caches. Actual map/lab controllers run with DOM/canvas adapters. The rendering
preview was produced and pixel-checked with a native canvas; it is not browser
layout QA.

Connection zones and slope-following reservations (milestone 2) are in place.
The [implementation plan](elevation.md) sets the next milestones: authored
template floors, then world journeys composed from different templates' zones.
