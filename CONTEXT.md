# Map procedural generation: agent handoff

Snapshot: 2026-10-07. This is implementation context; the durable design and
milestones live in [docs/elevation.md](docs/elevation.md). Read that document and
[docs/elevation-world.md](docs/elevation-world.md) before changing vertical
generation. This handoff documents the next work; it does not implement it.

## Repository and starting point

- Repository: [Zetic/Backrooms-Prototype-Map](https://github.com/Zetic/Backrooms-Prototype-Map).
- Milestone 1, [PR #16](https://github.com/Zetic/Backrooms-Prototype-Map/pull/16),
  is merged. Its merge commit is `343ffdc5fb97cacb5896a0a0105ca1bc7d9c8495`;
  implementation commit is `37781f10e830fcbc5ea3956a624cbd82d8b8e48d`.
- This documentation follow-up is on `codex/verticality-handoff`, based on that
  merged version. Check current `main` and open PRs before starting: another
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

Keep the atrium retired for the next milestone. Its large reserved box, repeated
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
| Elevation contract | `br.elevation/0.1`: explicit floors/ceilings, surfaces, connectors, holes, volumes, capabilities and navigation |
| Local generation | `BR.ELEV.prepare(source)` adapts an existing blueprint without mutating it; `ladderVariant(source, {direction})` adds a real ladder, small destination landing and shaft reservation |
| Available connection types | Lab-generated variants are ladders only. Ramp validation and generic full-width path drawing remain; selectable stair/ramp generators and connection zones do not exist yet |
| Existing template levels | Preserved at their actual elevations. Tall ceilings do not automatically create additional floors; legacy abstract links between differing floors remain unresolved |
| Main world | `BR.BandWorld` wraps independently seeded horizontal networks. There are currently no generated physical connections between bands |
| World policy | Reference spacing 16 m; ordinary site envelope from band reference -0.25 m to +15.5 m. These are current planning policies, not universal floor heights |
| Cutaway | Highest actual floor at or below the chosen height at each XY, uncovered lower floors shaded by depth, explicit floor holes reveal lower geometry |
| Inspection | Continuous cut height plus exact local floor choices. Main-map upper ghosts are limited to the selected template. Clicking/exporting retains that instance's geometry and world placement |
| Ramp drawing | Occupied-width XYZ strips, bends and continuation above the cut. Ramps do not create artificial floor entries at every height they cross |
| Reservations | Atomic owner-level prism index with protected voids. Current physical connectors have one bounding reservation prism; slope-following collections are future work |
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
6. A ramp should eventually reserve its slope and clearance locally rather than
   block its full bounding XY footprint from bottom to top. Structures beneath
   a high section are valid only where their whole volume and clearance fit.

Blueprint XY is local to its site; world exports supply an `origin`. World export
Z values are already absolute. Keep derived walls, openings, portals, surfaces,
levels, volumes, paths and landings in agreement when placing a blueprint.

## Next milestone: simple connection zones

Implement milestone 2 from the design, starting with small, inspectable examples
in existing templates/fillers:

- Add opportunities describing the connection area, entry/exit locations and
  elevations, allowed/preferred types, width and clearance. Keep available zones
  separate from selected physical connectors.
- Generate valid ladder, stair and ramp alternatives where an area fits them.
  Preserve the all-template up/down ladder fallback; preferences cannot force
  a physically invalid choice.
- Bind selected endpoints to real floors, emit physical openings/cutouts and
  navigation, and show/export the variants in the lab/workshop.
- Replace overly broad ramp reservations with slope-following occupied and
  clearance volumes. Update all reservation/export/placement consumers if the
  connector shape changes from one prism to several.
- Verify both upward/downward presentation and under-ramp coexistence without
  introducing artificial floor slices.

Authored multi-floor layouts are milestone 3. World journeys joining bands by
matching successive templates are milestone 4. Those dependencies need planning,
but should not be represented as already implemented by a local demonstration.

## Known visual issue from the latest review

The user compared an empty-lot variant at ground floor 0 m going down to -8 m
and going up to +10.9 m. The explanations below are from the current code;
there has been no visual fix following that discussion.

- Down cuts the host floor; the upper ground surface hides the destination
  below except at the hatch. The connection footprint's clipping can leave
  detached corner strokes.
- Up cuts the host ceiling; the ground floor stays intact. The full gold ladder
  reservation footprint is painted, and the upper destination gets a dashed
  outline. It can look like an additional room on the host floor.
- Destination-outline cues are asymmetric: `drawConnections` adds that extra
  outline only above the cut. Compact endpoint labels can overlap.
- Up/down default distances also differ. Down uses 8 m; up uses
  `max(8, host.ceiling + 0.25 slab + 0.25 allowance)` to clear a tall host. A
  requested explicit rise stays exact and can fail validation. This lab fallback
  must not silently move a world destination or redefine reference-band spacing.

Recommended presentation follow-up: distinguish hatch, occupied connection area
and hidden destination in both directions while preserving correct floor
occlusion. This is an identified issue/recommendation, not an implemented change.

## Code entry points

| File | Responsibility |
| --- | --- |
| `src/world.js`, `src/poi.js` | Deterministic horizontal cell/site plans and POI placement/building |
| `src/tpl/framework.js`, `src/tpl/grid.js` | Blueprint pipeline and 0.5 m geometry kit |
| `src/tpl/catalogue.js`, `src/tpl/archetypes/` | Room/zone definitions and template recipes |
| `src/tpl/fillers/`, `src/tpl/lot.js`, `src/tpl/composite.js` | Fill generation, lot integration and nested templates |
| `src/tpl/elevation.js` | Adapter, capabilities, ladder variants, derived spatial contract, reservations and validation |
| `src/tpl/elevation-view.js` | Cutaway plans/cache, floor visibility, full-width connection drawing and route profile |
| `src/elevation-lab.js`, `elevation.html` | Variant selection, height/exact-floor controls, reports and export |
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

PR #16 passed the full suite, including five horizontal-world seeds, all 80
template/filler families' up/down potential and 264 generated physical variants.
Native canvas pixel checks and actual-map tile reuse were also checked. DOM and
canvas adapters exercise controllers; they are not complete browser-layout QA.

For vertical changes, begin with `tests/elevation.test.js`, `tests/cutaway.test.js`,
`tests/elevation-ui.test.js`, `tests/band-world.test.js` and
`tests/band-render.test.js`. Use the full runner before publishing generation
changes. Add meaningful cases for actual zones/types, endpoint failures and
space beneath ramps rather than tests that merely echo field assignments.

- [Verticality design and acceptance criteria](docs/elevation.md)
- [Current world inspection, ownership and export](docs/elevation-world.md)
- [Horizontal world planning](docs/world.md)
- [Template contract and integration](docs/templates.md)
- [Filler contract and architectural curves](docs/fillers.md)
- [Current compact elevation export](docs/elevation-example.json)

Recent discussion only requested explanations of up/down rendering and connection
types, followed by this documentation handoff. No generation or rendering changes
were made after milestone 1 for those questions.
