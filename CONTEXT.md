# Map procedural generation: agent handoff

Snapshot: 2026-10-07. This is implementation context; the durable design and
milestones live in [docs/elevation.md](docs/elevation.md). Read that document and
[docs/elevation-world.md](docs/elevation-world.md) before changing vertical
generation. It was first written for milestone 2 (closed PR #17) and is now
refreshed with milestone 2 implemented; the next work is milestone 3.

## Repository and starting point

- Repository: [Zetic/Backrooms-Prototype-Map](https://github.com/Zetic/Backrooms-Prototype-Map).
- Milestone 1, [PR #16](https://github.com/Zetic/Backrooms-Prototype-Map/pull/16),
  is merged. Its merge commit is `343ffdc5fb97cacb5896a0a0105ca1bc7d9c8495`;
  implementation commit is `37781f10e830fcbc5ea3956a624cbd82d8b8e48d`.
- Milestone 2, simple connection zones, is on `claude/connection-zones`, based on
  that merge. It includes this handoff: the user closed the documentation-only
  PR #17 (`codex/verticality-handoff`) and PR #11 and asked for the fixes to land
  with the milestone. Check current `main` and open PRs before starting: another
  agent may advance the repository after this snapshot.
- Plain JavaScript, browser globals under `BR`, no build step or runtime package
  installation. Open `index.html` for the map, `workbench.html` for the template
  workshop, and `elevation.html` for the elevation lab. A local static server is
  useful for inspection.

## User's intended direction

The useful deliverable is architectural spatial data for an eventual Unreal
Engine procedural generator. The 2D map is an inspection aid, and cannot define
the geometry merely by how it looks in a slice.

Preserve the established horizontal generation rules. The map should sprawl
above and below ground zero through multiple stable reference bands. Ground
zero's main routes should remain particularly stable. Local depressed floors,
pits, raised rooms, mezzanines and compact stacks can vary inside a band's fills.
Reference bands are not compulsory building stories.

Major band transitions should be rarer than horizontal travel and normally feel
like exploring through a fill or a fill element dedicated to the journey.
Ordinary stairwells can occur, but should not become the default entire journey.
Fills can span multiple bands and coordinate changing footprints with those
above and below.

Every template, even a closet, must have optional up/down potential. A ladder is
the compact fallback. It need not be selected on every instance, and arbitrary
cramped layouts need not fit both directions simultaneously.

Later chains should use different layouts/templates and include horizontal
movement between arrival and the next departure. Ramp-heavy, ladder-heavy or
mixed influences are welcome; a repeated shaft at one XY or one theme through
the whole stack is not the desired default. Authored multi-floor templates are
still valuable: a three-floor house can reach about +8 m and connect to another
template at its top.

Connection zones only need the area occupied, endpoints, heights and enough
width/clearance information to fit a route. The user explicitly does not need
individual steps, rails or mesh detail at this stage. Draw stairs/ramps at their
occupied width, rather than as thin diagonal lines.

## Previous changes and rejected approaches

| PR | Result relevant to further work |
| --- | --- |
| [#12](https://github.com/Zetic/Backrooms-Prototype-Map/pull/12) | Replaced PR #10's organic `meander`, `tail`, `curved` fillers with architectural circles, semicircles and sectors |
| [#13](https://github.com/Zetic/Backrooms-Prototype-Map/pull/13) | Introduced the elevation contract, reservations and optional compact ladder variants |
| [#14](https://github.com/Zetic/Backrooms-Prototype-Map/pull/14) | Added band-world planning and the former atrium exploration example |
| [#15](https://github.com/Zetic/Backrooms-Prototype-Map/pull/15) | Tried to improve the atrium footprint/population; the resulting repetitive rooms did not satisfy the user |
| [#16](https://github.com/Zetic/Backrooms-Prototype-Map/pull/16) | Implemented continuous cutaway/local-floor inspection and removed the atrium from generation and the lab |
| `claude/connection-zones` | Milestone 2: connection zones, stair/ramp variants, slope-following reservations, the ladder-fallback fix, presentation in both directions |

Keep the atrium retired. Its large reserved box, repeated
same-size rooms and single theme across a tall stack were poor demonstrations
of the intended experience. Do not fill unused reservations with repetitive
rooms just to make an occupancy metric improve. Size reservations to meaningful
geometry, required clearance and intentionally protected voids.

The architectural curved fillers are `circular_hall`, `twin_domes`, `sector`
and `radial_suite`, implemented in `src/tpl/fillers/architectural.js`. Preserve
their constant radii/radial relationships and exact connection adapters; generic
spline smoothing and the removed organic layouts should not return.

## What actually works now

| Area | Implemented state and limits |
| --- | --- |
| Elevation contract | `br.elevation/0.2`: explicit floors/ceilings, surfaces, connectors with `reservations[]`, holes, volumes, capabilities, `connectionZones[]` and navigation. 0.1 blueprints (single `reservation`) are upgraded by `prepare` |
| Local generation | `BR.ELEV.prepare(source)` adapts without mutating. `connectionVariant(source, {direction, type, rise})` builds a ladder, stair or ramp with a real landing, cutouts, navigation and reservations; `ladderVariant` is the compact fallback |
| Connection zones | Every template/filler lists ladder zones, plus straight/switchback stair and ramp zones where its rooms fit them, both directions. Unselected zones change nothing |
| Types and preferences | Rules in `TPL.CAT.CONNECTIONS` (width, slope range, headroom, landings). Templates set `vertical: { prefer: [...] }`; auto falls back down the list to the ladder. Lawns allow routes; other zones keep them off |
| Existing template levels | Preserved at their actual elevations. Tall ceilings do not automatically create additional floors; legacy abstract links between differing floors remain unresolved |
| Main world | `BR.BandWorld` wraps independently seeded horizontal networks. There are no generated physical connections between bands. Exports carry every layout's zones, unselected |
| World policy | Reference spacing 16 m; ordinary site envelope from band reference -0.25 m to +15.5 m. These are current planning policies, not universal floor heights |
| Cutaway | Highest actual floor at or below the chosen height at each XY, uncovered lower floors shaded by depth, explicit floor holes reveal lower geometry |
| Inspection | Continuous cut height plus exact local floor choices; the lab has type/rise controls, a zones view and table; the workbench detail panel links to the lab |
| Route drawing | Stairs/ramps piece by piece at their width: solid in view, blue dashed hidden below, violet dashed above. Ladders are an outline and hatch. Far landings are outlined both ways |
| Reservations | Atomic owner-level prism index with protected voids. Stairs/ramps reserve one prism per 0.5 m of flight from just under the walking surface to headroom |
| World export | `br.world-elevation/0.1`, canonical ownership/reservations/navigation and exact matching of physical portals. Three exported bands currently contain three separate horizontal networks |

The ramp/overlap picture in `docs/cutaway-preview.png` uses
`tests/cutaway-fixture.js`, a presentation fixture. It is not a selectable
template, a house-floor generator, or evidence that world ramp chains exist.

## Essential spatial rules

1. Occupancy does not imply connectivity. A tall room can occupy another band's
   height without providing an entrance there. Ghosts and territory masks add
   no navigation edges.
2. Plan rooms, slabs, connection routes, headroom and protected voids together
   under their owner before fitting neighbors. Another owner cannot invade a
   protected void. Cache eviction must not change ownership.
3. A connected route requires real endpoint surfaces and usable landings,
   necessary openings/cutouts, clearance and successful reservations. An
   unselected capability creates no hole or traversal edge.
4. Actual `floorZ`/`ceilingZ` values are authoritative. Floor height is independent
   of room clear height, world-band identity and display controls. There is no
   compulsory 2 m vertical grid; the 0.5 m XY kit grid does not dictate risers.
5. Use `navigation` for physical elevation reachability. The legacy room graph's
   shared `outside` node cannot prove connectivity between bands. Horizontal
   portals match exact XYZ, width, opposing sides and usable headroom.
6. A ramp or stair reserves its slope and clearance locally, not its full
   bounding box. Structures beneath a high section are valid only where their
   whole volume and clearance fit; consumers read every prism in `reservations[]`.
7. Template preferences never override physics. A type that does not fit is
   refused with its reason; nothing is moved, shrunk or rounded to make it fit,
   and an explicit rise is kept exactly or refused.

Blueprint XY is local to its site; world exports supply an `origin`. World export
Z values are already absolute. Keep derived walls, openings, portals, surfaces,
levels, volumes, paths and landings in agreement when placing a blueprint.

## Milestone 2 as implemented

- `src/tpl/connections.js` finds zones and builds variants. A route is laid
  along a real wall (at least 75% walled), inside one room, off columns,
  existing holes, partitions, door boxes and non-route zones, with a 1 m walker
  still reaching every door and the route's entry. Shapes are straight and
  switchback; nothing curves yet, so curved-wall fillers (twin domes) keep
  ladders.
- `validate` checks stair/ramp physics (no vertical segments, slope range,
  minimum width, headroom inside the prisms along the whole path, landings on
  floors, cutouts wherever a prism crosses an endpoint's slab or ceiling) and
  that no hole belongs to an unselected connection.
- Ladder-fallback bug: validation used to start reachability at the main
  entrance only, so house wings behind a second door, and yard lots built in
  pieces, failed and lost their variants. It now starts at every portal.
- Default rises are lab conveniences: stairs/ramps the host clear height plus
  slab going up (at least 3 m), 2.45 m going down (at least 3 m); ladders 8 m or
  above a tall roof. The world planner must set real endpoint heights.
- Auto over every family at middle size, seeds 1–6, both directions: about 54%
  stairs, 43% ladders, 3% ramps, no failures. Ramps need a long straight wall: the park and
  pillar hall get them; the circular hall only from about 30 × 24 m.

Known limits worth knowing before milestone 3: routes stay inside a single
room, so narrow rooms with many doors often refuse ramps; zones are found per
direction and are not coordinated (selecting up and down together is not
offered); exports list zones but the world never selects one.

## Next milestone: template floors and authored vertical patterns

Milestone 3 from the design: give existing templates real local floors at
their own heights where the pattern matters (a house's floors with different
purposes, depressed floors, pits, mezzanines, compact stacks, offset exits),
joined by the connection variants above rather than abstract stair links.
Keep every template's optional up/down fallback and keep the patterns
inspectable in the workbench/lab. World journeys joining bands by matching
successive templates' zones are milestone 4; do not present a local
demonstration as a world journey.

## Presentation issue from the milestone-1 review (fixed)

The user compared an empty-lot ladder going down to -8 m and up to +10.9 m: the
down view left detached corner strokes, the up view painted the reservation like
a gold room, only upper destinations were outlined and labels overlapped. A
ladder is now an outlined footprint and hatch (dark opening when it is in the
floor you look at, dashed overhead), far landings are outlined in both
directions with their height, and each connector has one label. Occlusion still
follows actual floors.

## Code entry points

| File | Responsibility |
| --- | --- |
| `src/world.js`, `src/poi.js` | Deterministic horizontal cell/site plans and POI placement/building |
| `src/tpl/framework.js`, `src/tpl/grid.js` | Blueprint pipeline and 0.5 m geometry kit |
| `src/tpl/catalogue.js`, `src/tpl/archetypes/` | Room/zone definitions and template recipes |
| `src/tpl/fillers/`, `src/tpl/lot.js`, `src/tpl/composite.js` | Fill generation, lot integration and nested templates |
| `src/tpl/elevation.js` | Adapter, capabilities, ladder variants, derived spatial contract, reservations and validation |
| `src/tpl/connections.js` | Connection zones, stair/ramp layout, slope-following reservations, `connectionVariant` |
| `src/tpl/elevation-view.js` | Cutaway plans/cache, floor visibility, connection/zone drawing and route profile |
| `src/elevation-lab.js`, `elevation.html` | Direction/type/rise selection, height/exact-floor controls, capability/link/zone reports and export |
| `src/band-world.js` | Band networks, placement offsets, ownership, portal graph and canonical world export |
| `src/render.js`, `index.html` | Actual map tile painting/cache and map interaction/selected-template inspection |
| `workbench.html` | Template/filler workshop and local floor inspection |

Performance: ordinary map painting reads the original blueprints and band offset;
it does not run spatial adaptation or ladder candidate searches per draw.
`world.spatial(site)` caches explicit-Z adaptation for graph/export use. Candidate
enumeration is deferred during world adaptation and materialized for export.
Keep this boundary intact. Cutaway plans cache actual floor intervals (maximum
eight per blueprint); map tile keys include band, height, selection and ghost
state, with a maximum of 260 retained tiles. There is no measured universal
percentage for loading overhead in this handoff.

## Verification and useful references

Full regression command:

```sh
node tests/run-all.js
```

Milestone 2 passes the full suite, including five horizontal-world seeds, all 80
template/filler families' up/down potential (778 generated physical variants in
`tests/elevation.test.js`) and `tests/connections.test.js`.
Native canvas pixel checks and actual-map tile reuse were also checked. DOM and
canvas adapters exercise controllers; they are not complete browser-layout QA.

For vertical changes, begin with `tests/elevation.test.js`, `tests/connections.test.js`, `tests/cutaway.test.js`,
`tests/elevation-ui.test.js`, `tests/band-world.test.js` and
`tests/band-render.test.js`. Use the full runner before publishing generation
changes. Add meaningful cases for actual zones/types, endpoint failures and
space beneath ramps rather than tests that merely echo field assignments.

- [Verticality design and acceptance criteria](docs/elevation.md)
- [Current world inspection, ownership and export](docs/elevation-world.md)
- [Horizontal world planning](docs/world.md)
- [Template contract and integration](docs/templates.md)
- [Filler contract and architectural curves](docs/fillers.md)
- [Current elevation export (circular hall with an upward stair)](docs/elevation-example.json)

The user reviews visually: when changing vertical generation, check the lab in
both directions on a house, the park, a closet and a curved filler, and say
plainly what the picture shows.
