# Map procedural generation: agent handoff

## Mansion and room relationships (2026-10-09)

Load `src/space/house.js` after shapes.js for the current API. Default houses
require direct kitchen–dining and kitchen–pantry links; `relationships:false`
retains archived placement for comparisons. Canonical primary/secondary
connections refer to actual outside openings; vehicle access remains separate.
Mansion is a three-floor experiment with 1 ground-floor primary + 2–3 secondary
connections: passage endpoint on the top floor, another on the middle, and
an optional ground-floor branch. Its stairs reserve 1.5 × 4.5 m clear floor.
The inspector stacks large cropped floor plans vertically with wrapped labels.
Mansion passage links/endpoints and side-room bypasses are independently checked.
It has an expanded room pool, grouped suites/service rooms and complete
program placement. Its search is bounded and seed-dependent, never timed.
See [docs/space-mansion.md](docs/space-mansion.md) for API, support/overhang
limits, connection roles and tests. Archived speedup figures apply only to
the original placement solver, not this relationship/mansion solver.


## Room-first shape study (2026-10-09)

`src/space/shapes.js` wraps generation only when `spec.shapes` is supplied.
The test bed has shape controls and original/experimental comparisons. Actual
floors are joined rectangles with concave polygons (`br.space/0.3`); bounding
rectangles must not be used as floors. Original mode retains its exact output.
See [docs/space-shapes.md](docs/space-shapes.md) for the free-outline solver,
explicit failures, profile fallbacks and pending concave route overlay.
Geometry and controller tests are included in the full runner.


## Room-first performance follow-up (2026-10-09)

The separate `src/space` test bed now accelerates route placement with per-floor
spatial indexes, candidate-band queries, duplicate geometry caching, early
rejection of offsets that cannot share enough host wall, scalar gap checks,
and shared-wall records maintained during placement and branch rollback.
Final wall raster construction uses contiguous fills, scalar morphology loops,
and a typed flood-fill stack. The search still evaluates all 20 route attempts;
random draws, candidate order, scoring, room sizes and wall thicknesses remain.

`tests/space.test.js` and `tests/space-performance.test.js` are now in the full
runner and CI. Golden output hashes cover 468 original-revision cases, including
all seven house recipes and wrongness 0 / 0.35 / 1. Elapsed time is excluded.
`tools/benchmark-space.js` compares a supplied git revision with current code,
with optional placement-only or raster-only variants. See
`docs/space-performance.md` for measurements and reproduction commands.

The older snapshot below describes the world/template systems; this follow-up
changes only the separate room-first generator and its test/benchmark coverage.

Snapshot: 2026-10-08. This is implementation context for the next agent (or
person) picking the project up. The durable design and milestones live in
[docs/elevation.md](docs/elevation.md); world ownership, inspection and export in
[docs/elevation-world.md](docs/elevation-world.md). Read both before changing
vertical generation.

Milestones 1 to 5 of the elevation plan are done, plus a follow-up that puts a
template's own stairs on the map, and a tooling milestone, **fast test runs**
(a parallel runner with quick and full modes, and CI; see below). Since
milestone 5 the work follows the **growth design**, now in the repo as
[docs/growth.md](docs/growth.md) with its build order and the state of each
step. Step 1 is milestone 5, **layered ownership** (a column holds several
owners stacked at different heights, with a pit drilled back down). Step 2,
**one house pillar and its branch** (PR #25): a house that seeds growth
carries its stairwell on up, and a branch of its biome (`houseroom`) grows at
that floor. Step 3, **recursive growth** (PR #26, `src/growth.js`): growths
climb through floors of their biome to the next band, districts cross cell
borders, and the journey plots are gone from the world. Step 3b, **denser
growth** (PR #27): the ground plan plants a growth house in one cell
of every 2 × 2 block, branches are a little bigger, tall rooms are grown
round, the landing reserve is only the sites near each house, and the map
draws every growth without freezing. Step 4, **house rooms**: branch floors
are house hallways lined with bedrooms, living rooms, kitchens and the like,
often with a whole small house standing in them (PR #28). The map's cut view
then got **layering across claims** (PR #29): an upper floor hides everything
under it. Then **one home per growth** (step 4b, PR #30): floors no longer hold
several homes' worth of living rooms, kitchens and bathrooms. The Unreal consumer of the exported data is milestone 6.

## Repository state

- Repository: [Zetic/Backrooms-Prototype-Map](https://github.com/Zetic/Backrooms-Prototype-Map).
- Plain JavaScript, browser globals under `BR`, no build step and no runtime
  packages. `index.html` is the map, `workbench.html` the template workshop,
  `elevation.html` the elevation lab. Serve the folder statically to inspect
  (`python3 -m http.server 8765`).
- `main` holds everything up to the map layering fix (PR #29, merged
  2026-10-08). Step 4b (one home per growth, PR #30) is on
  `claude/fast-test-runs-l53vww` (the branch name is reused for every PR).
  The branches `claude/world-journeys`, `claude/kept-stairs`,
  `claude/house-branch` and `claude/recursive-growth` are merged and can be
  deleted.
- Lesson from #21: it was stacked on `claude/world-journeys` and merged into
  that branch after #20 had already merged, so it missed `main` until #22
  carried it over. Retarget a stacked PR to `main` before merging it.
- Check current `main` and open PRs before starting: another agent may have
  moved things on.

| PR | What it did |
| --- | --- |
| [#12](https://github.com/Zetic/Backrooms-Prototype-Map/pull/12) | Replaced the organic `meander`, `tail`, `curved` fillers with architectural circles, semicircles and sectors |
| [#13](https://github.com/Zetic/Backrooms-Prototype-Map/pull/13) | The elevation contract, reservations, optional compact ladder variants |
| [#14](https://github.com/Zetic/Backrooms-Prototype-Map/pull/14), [#15](https://github.com/Zetic/Backrooms-Prototype-Map/pull/15) | Band-world planning and the atrium example (since retired: see below) |
| [#16](https://github.com/Zetic/Backrooms-Prototype-Map/pull/16) | Milestone 1: continuous cutaway and local-floor inspection; atrium removed |
| [#18](https://github.com/Zetic/Backrooms-Prototype-Map/pull/18) | Milestone 2: connection zones; stair, ramp and ladder variants; slope-following reservations |
| [#19](https://github.com/Zetic/Backrooms-Prototype-Map/pull/19) | Milestone 3: houses of several storeys, sunken floors, galleries, a template's own stairs built for real |
| [#20](https://github.com/Zetic/Backrooms-Prototype-Map/pull/20) | Milestone 4: journeys between bands, stacks of different fillers joined by stairs, ramps and ladders |
| [#21](https://github.com/Zetic/Backrooms-Prototype-Map/pull/21), [#22](https://github.com/Zetic/Backrooms-Prototype-Map/pull/22) | Kept stairs: a template's stairs laid out once at generation and drawn on the map (#22 brought #21 to `main`) |
| [#23](https://github.com/Zetic/Backrooms-Prototype-Map/pull/23) | Fast test runs: parallel runner, quick and full modes, CI on every PR |
| [#24](https://github.com/Zetic/Backrooms-Prototype-Map/pull/24) | Milestone 5 (growth step 1): layered ownership, a hand-placed raised branch over the ground and a pit drilled back down |
| [#25](https://github.com/Zetic/Backrooms-Prototype-Map/pull/25) | Growth step 2: biomes, a house pillar, and a branch of house rooms grown from it |
| [#26](https://github.com/Zetic/Backrooms-Prototype-Map/pull/26) | Growth step 3: recursive growth between the bands; journey plots removed from the world |
| [#27](https://github.com/Zetic/Backrooms-Prototype-Map/pull/27) | Growth step 3b: an origin per 2 × 2 block with its house planted by the ground plan, bigger branches, tall rooms grown round, a smaller landing reserve, every growth on the zoomed-out map |
| [#28](https://github.com/Zetic/Backrooms-Prototype-Map/pull/28) | Growth step 4: house rooms in branches (house hallways, bedrooms, living rooms) and whole houses standing in branch floors |
| [#29](https://github.com/Zetic/Backrooms-Prototype-Map/pull/29) | Map: claims painted layer by layer, so nothing under a raised floor is drawn over it; deeper floors darker |
| [#30](https://github.com/Zetic/Backrooms-Prototype-Map/pull/30) | Growth step 4b: one home per growth (a role per site, one home's rooms per floor) |

## What the user wants

The deliverable is architectural spatial data for an eventual Unreal Engine
procedural generator. The 2D map and the lab are inspection tools; the data
must stand on its own and must not be defined by how a slice looks.

- Keep the established horizontal generation. The map sprawls above and below
  ground zero through stable reference bands (16 m apart). Ground zero's main
  routes stay especially stable. Bands are planning references, not compulsory
  storeys.
- Local height changes (sunken floors, galleries, storeys, pits) are common;
  major band transitions are rarer and should feel like exploring a fill made
  for the climb, not riding a stairwell.
- Every template, even a closet, has optional up and down potential, with a
  ladder as the compact fallback.
- A chain between bands uses different templates, with horizontal exploration
  between arriving on a floor and leaving it. Ramp-heavy, ladder-heavy or mixed
  influences are welcome; a shaft at one XY, or one template repeated up a
  stack, is not.
- Connection data needs the occupied area, endpoints, heights, width and
  clearance. No individual steps, rails or meshes yet. Stairs and ramps are
  drawn at their width, not as thin lines.
- The user reviews visually. When changing vertical generation, look at the lab
  and the map, and say plainly what the picture shows.

**The owner's decisions so far (Cody, 2026-10-08), keep them:**
- Growths start only at POIs: one growth house per 2 × 2 block of cells,
  planted by the ground plan. No stair cells from plain ground sites.
- Tall rooms (halls with a gallery) are grown round, never cut down to fit.
- "House rooms" means literal house rooms: house hallways, bedrooms, living
  rooms, kitchens, whole houses. Not backrooms layouts that feel like a house
  (the generic fillers left the house pool in step 4).
- A growth should read as one believable home, not several homes' rooms
  jumbled together (step 4b).
- The map's cut view shows, at each spot, the highest floor below the cut;
  an upper floor fully covers what is below it (only a pit shows through),
  and lower floors are drawn darker.

**How Cody likes to work:** Cody reads the main project chat only, not
threads. Report in plain language with no jargon (no ids, flags or file names
unless asked), with a picture where it helps. No timing measurements unless
asked.

**Rejected, keep retired:** the atrium (one large reserved box, filled with
repeated same-size rooms, one theme up a tall stack). Do not fill unused
reservations with repetitive rooms to improve an occupancy number; reserve
what geometry, clearance and intended voids need. The removed organic fillers
and generic spline smoothing should not return; the curved fillers
(`circular_hall`, `twin_domes`, `sector`, `radial_suite`) keep their constant
radii and exact connection adapters.

## What works now

| Area | State |
| --- | --- |
| Elevation contract | `br.elevation/0.2`: explicit `floorZ`/`ceilingZ`, surfaces, connectors with `reservations[]`, holes, volumes, voids, capabilities, `connectionZones[]`, navigation. 0.1 blueprints are upgraded by `prepare` |
| Adapter | `BR.ELEV.prepare(source)` adapts a template without mutating it. `connectionVariant(source, {direction, type, rise})` adds a ladder, stair or ramp with a real landing, cutouts, navigation and reservations; `ladderVariant` is the fallback |
| Connection zones (M2) | Every template lists ladder zones, plus straight or switchback stair and ramp zones where its rooms fit them, both directions. Unselected zones change nothing |
| Template floors (M3) | `two_storey` and `townhouse` houses (stairwell with a switchback per storey); floor patterns on finished buildings (`tpl/floors.js`): sunken floors with steps, galleries over an undercroft. A pattern is kept only if its stair can be built and the building still validates |
| Template stairs | Every source `vertical` becomes a real stair (`linkFloors`) or stays abstract with a warning where nothing fits. Never faked |
| Kept stairs (#22) | Laid out once at generation and kept on the template (`b.stairs = { key, links }`); `prepare` adopts them while the geometry fingerprint matches; the map draws them |
| Journeys (M4, lab only) | `src/journeys.js`: a stack of different fillers climbing 16 m in one territory, each climb a stair, ramp or ladder with an exact rise. Styles: mixed, stairs, ramps, ladders. No longer placed in the world |
| World | `BR.BandWorld`: independently seeded horizontal bands, joined by growth. Every growth is a pure function of (seed, band, origin cell); generation order and cache eviction change nothing |
| Layered ownership (M5) | `src/claims.js`: claims with height ranges in one column, ceilings capped under a claim above, a house's stairwell carried up to a raised landing, and pits found and drilled between two claims, one drilled from a branch down into the ground |
| Growth (steps 2-3b) | `src/biomes.js`: archetypes that seed growth (`grows`), biome tags, the `houseroom` pool, `furnish`. `src/growth.js`: origins (one per 2 × 2 block, its house planted by `poi.js`), cell ownership by nearest origin, house pillars, tall fillers grown round, the level schedule, district floors at each level with a leg (stair, ramp, ladder; exact rise) to the next, arrivals in the next band's landing sites, a pit from the first level |
| World export | `br.world-elevation/0.3`: layouts, reservations, navigation, exact portal matches, `policy.verticalJourneys: 'grown'`, `policy.layeredOwnership: 'stacked-claims'`, `policy.growth`, a `growths[]` summary, per-slice `raised[]` (growth, level, floor, claim top), growth connections per slice, `pits[]`, `verticalFrontier` for a climb onto an unexported band |
| Map | Raised floors of every level painted with the ground at their own heights; a climb from below painted in the band above through its landing site's opening; hover says what stands over what, which growth a pillar starts and whether it reaches the band above, and which climb comes up into a landing site; *Way ↓ / ↑* buttons; continuous cutaway by height, band switching; a template's stairs at their width with their heights; sunken floors at their depth |
| Lab | Any template or filler with direction/type/rise; zones view; "Carry its stair on up" for a house pillar's landing; milestone 4's journeys per style, for comparison |
| Workbench | Every template and filler, a tab per floor, real stairs drawn; biome tags shown and searchable (`houseroom`) |

## Essential spatial rules

1. Occupancy does not imply connectivity. A tall room can occupy another band's
   height without an entrance there. Ghosts and territory masks add no edges.
2. Plan rooms, slabs, routes, headroom and protected voids together under their
   owner before fitting neighbours. Cache eviction never changes ownership.
3. A connection needs real endpoint surfaces and landings, explicit cutouts,
   clearance and a successful reservation. An unselected zone cuts nothing.
4. `floorZ`/`ceilingZ` are authoritative. No compulsory vertical grid; the
   0.5 m XY kit grid does not dictate risers.
5. Use `navigation` for reachability, not the legacy room graph. Horizontal
   portals match exact XYZ, width, opposite sides and at least 1.8 m headroom.
6. A stair or ramp reserves one prism per 0.5 m of flight (its slope and
   headroom), not its bounding box.
7. Preferences never override physics: a type that does not fit is refused
   with its reason; an explicit rise is kept exactly or refused.
8. Blueprint XY is local to its site; exports supply an `origin`, and export Z
   is absolute. Keep walls, openings, portals, surfaces, volumes, paths and
   landings in agreement when moving a blueprint.
9. Map painting never adapts a blueprint (no `prepare`, no zone searches per
   draw). It reads kept stairs instead. Keep this boundary: it is what keeps
   the map fast.
10. One column can hold several owners, each with a bottom and a top. Claims
   may touch at a slab (a ground claim's top is the raised floor's slab) but
   never overlap, and a claim is never shortened to make room: the blueprint
   is rejected instead. Capping a ceiling is the only change a claim above
   makes to the ground below it.

## How each milestone works (short)

**Milestone 2, connection zones** (`src/tpl/connections.js`). A route is laid
along a real wall (at least 75% walled), inside one room, off columns, holes,
partitions, door boxes and non-route zones, with a 1 m walker still reaching
every door. Shapes are straight and switchback; nothing curves yet. Rules come
from `TPL.CAT.CONNECTIONS` (stair slope 0.45-0.84, ramp at most 0.25, widths,
headroom, landings). Ramps need long straight walls, so they are rare.

**Milestone 3, template floors.** Houses: `planStack` in `src/tpl/house.js`, a
2 × 4.5 m stairwell repeated on every storey, storeys 3.2 m then 3 m.
`linkFloors(b, low, high, opts)` fits a stair between two existing floors
(entry on real floor, landing on the higher one, doorways clear, both floors
walkable). Floor patterns (`src/tpl/floors.js`): `sink` and `raise`, each
proved by the elevation layer (`buildable`) before it is kept. Composite
children get `floors: null`. Band envelope: −1.5 m to +14.5 m round the
reference (`BAND_CFG.floorLimit` −1.25, `ceilingLimit` 14.5).

**Kept stairs** (`src/tpl/elevation.js`). `bakeStairs(b, proof?)` runs at the
end of `TPL.generate` and `FILL.generate`; `FLOORS.apply` passes the proof it
already made, so nothing is laid out twice. Composite children are generated
with `stairs: false` (their stairs are laid out in the whole). `stairsKey(b)`
fingerprints rooms, walls, openings, columns, zones and verticals; `prepare`
adopts kept stairs only while it matches, at any base height
(`liftConnector`). The cutaway draws them through `cutawayParts(b, base)`;
`connectionAt(b, x, y, cut, ghost, base)` finds them for clicks. Map tiles
draw connection tags in a last pass, after every wall.

**Milestone 4, journeys** (`src/journeys.js`, `src/band-world.js`).
- `JOURNEY.plan({seed, w, h})` decides the doors (three per band, `low0..`,
  `high0..`) before anything is built. `JOURNEY.generate({id, seed, w, h,
  lower, doors, style})` builds every planned door or throws.
- Stages: a bottom filler on the whole territory (40-56 × 32-48 m), 3-4 smaller
  fillers (sides 11-22 m, 14-24 m for ramps) each built against the doorway of
  the landing below, a top filler on the territory less the last climb. Rises
  sum to exactly 16 m (four of 3.2-5 m, or five of 2.75-3.7 m for ramps).
  Fillers never repeat within a journey and skip floor patterns.
- Rules: arrival to departure at least max(6 m, 0.35 × the floor's longer
  side); the first climb at least max(6 m, 0.25 × the territory's longer side)
  from every lower door; the last landing 6 m from every upper door; no climb
  over another's footprint, starts at least 4 m apart; the next floor goes
  where it overlaps earlier floors least.
- Composition (`placed`) prefixes ids `k<n>.`, shifts XY and Z, joins each
  landing to the next stage; the result is validated as one blueprint.
- World (until growth step 3 removed it): `journeyPlan(lower, ri, rj)` (region of 4 × 4 cells; even pairs in the
  region's west half, odd in its east half), `plannedLots` reserves the
  rectangle in both bands' cell plans without building anything,
  `journey(p)` builds lazily (cached, four seeds), `buildTransition` binds only
  the site's own band's doors, `standIn` puts an ordinary filler behind the
  same doors if no journey fits (never observed in about 300 tries),
  `nearestJourney`.
- Measured: styles stairs 90% stairs, ramps 72% ramps, ladders 99% ladders,
  mixed about two-thirds stairs. A journey takes 0.2-0.3 s to build on
  average, up to about 0.9 s.

**Milestone 5, layered ownership** (`src/claims.js`, `src/band-world.js`).
- `reservationPlan` emits one claim per site: ground `[floorLimit − slab,
  ceilingOf(site)]`, raised `[its floor − slab, ceilingLimit]`. `ceilingOf`
  returns the branch's floor slab where one stands over the site.
- Planning must not need a build and building must not need the plan:
  `World.buildRaw` builds a site uncached and without the hook (for the
  planner), and every build-time change happens in the new `afterBuild` hook
  (capping ceilings, swapping the anchor house for its landing build, marking
  the ground filler with the pit's lower half). The pit's lower cutout and its
  shaft are added in `spatial()`, after `prepare` (which wipes holes and voids
  on a template-schema blueprint).
- `CLAIM.stairTop` / `raiseStair` carry a template's own top stair one flight
  further: a level, a `stairwell` room tagged `raised` with its walls, a door
  snapped to the half metre and a portal tagged `raised branch`, the landing
  appended to the stair's own vertical, then `bakeStairs` again. It refuses
  less than 3 m of climb, a ceiling already above the landing, or a run that
  does not fit.
- `CLAIM.pitSpot` / `markDrop` / `drill`: a 2 × 2 m square clear of walls,
  columns, holes, connector reservations and other drops, with a clear floor at
  least 3 m below and nothing crossing the shaft; `drill` is idempotent and
  reserves the shaft as a void and a volume on the lower claim. Both halves
  carry a `drop` with one id and rectangle; `graph()` pairs them into one
  directed `forward` edge of kind `pit` and no undirected edge, so the drop is
  one way. No ladder, no rope.
- Milestone 5's known place (seed 31337, band 0, cell (−3, 2)) no longer has a
  branch since step 2: only a share of seeding houses grow one, and that house
  rolls out. The tests' known place is now seed 7, band 0, cell (3, −2).

**Growth step 2, one house pillar and its branch** (`src/biomes.js`,
`src/band-world.js`; [docs/growth.md](docs/growth.md)).
- Biome data: `grows: { biome: 'houseroom' }` on `two_storey` and `townhouse`;
  `biomes: ['houseroom']` on 13 catalogue rooms (copied onto their lone
  templates by `archetypes/lone.js`), the `closet` template and seven fillers
  (corridor_rooms, enfilade, cells, doors_nowhere, beads, ring, loop_hall).
  `BIOME.anchorOf`, `templates`, `fillers`, `fillerWeights`.
- `planBranch(n, i, j)`: the first yard lot in id order whose house seeds
  growth, passes the seeded share (`CFG.branch.share` 0.75, salt `0xba08`
  with the POI id), and whose stair can carry one flight up: `z` = the half
  metre at or above max(top floor + 3.3, top ceiling + slab), at most
  `ceilingLimit − 3`. Then `raiseStair` as in milestone 5, the plain site
  across the landing's door, and breadth-first growth over plain neighbours
  sharing ≥ 5 m of edge (seeded order, salt `0xba09`), to `sites` [1, 4] and
  `area` 1,200 m², each ground site checked with `keepsUnder` (a raw build and
  `capCeilings`). Raised sites carry `hop`, `parent`, `biome`; doors are minted
  to the landing and from each site to its parent.
- `raisedSite(rs)`: `BIOME.furnish` places 2-3 / 1-2 / 0-1 rooms by hop (1.5 m
  margins, 3 m clear of doorways, no type twice, uniform weights), then
  `LOT.build({ ..., floors: false })` with biome fillers only (four seeded
  picks, then each in turn; LOT's warren fallback is rejected), then without
  rooms. Every minted door must be honoured; everything must fit the claim.
  Result: `b` (the filler, placed), `fillerOrigin` (LOT's `at` moves it off
  the site origin: the pit uses this origin), `buildings` (rooms, placed, poi
  `{ id, archetype, name, biome }`). A site that fails is dropped with its
  subtree and the rest rewired and rebuilt.
- `seedsGrowth(n, i, j, P)` is the share roll; `CLAIM.pillarFloor(b, rise)`
  is the landing height rule, shared with the lab's "Carry its stair on up".
- `raisedBuild` returns the rooms as buildings, so render, graph, export and
  hover treat them as any POI building. The export adds `biome` and `hop` to
  `slices[].raised[]` and `policy.raisedBranches: 'house-pillars'`,
  `policy.growth`.

**Growth step 3, recursive growth** (`src/growth.js`, `src/band-world.js`;
[docs/growth.md](docs/growth.md); origins, stair pillars, branch size and
landing sites as described here were replaced in step 3b, below). The user's answers: not every region must
guarantee a way up, but some guaranteed ways up should be spread out overall
(there will be many ways up by the end); districts may cross into other
regions without limit; remove the old journey plots for now.
- Journey plots are removed from the world: `world.js` and `poi.js` lost the
  `plannedLots` / `buildTransition` hooks and the `reserved` / `transition`
  kinds, so every cell is planned as before milestone 4. `journeys.js` stays
  for the lab and its test.
- `GROWTH.candidate(W, n, i, j)` (cached in `W.candidates`, limit `claims`):
  the seeding houses in the cell (step 2's rule) and whether it is its block's
  stair cell (`stairCell`, salt `0xb10c`), with a priority (salt `0xb10b`).
  `owner` gives a cell to itself if it is a candidate, else to its
  top-priority candidate neighbour; `cells(origin)` are the cells it owns.
  Planning a growth reads the cell plans two cells round its origin.
- `GROWTH.plan`: the pillar (house first, else the stair cell's stair pillar:
  a plain site of the origin cell whose raw filler takes a climb to
  +4.5-6.5 m), `schedule(z1, rng, steered)` for the levels (legs 3-6.5 m, top
  ≤ +11.75 m, within 6.5 m of the next band; unsteered growths stop by chance,
  `carry` 0.5), then per level a BFS (1-4 sites, 1,200 m²) over plain ground
  in its cells and the level below's floors, `raisedSite` for each floor
  (ceilings capped to `clear`), a failed floor dropped with its subtree, then
  `upLeg` (the level's furthest floor first: its filler rebuilt with a climb,
  stairs/ramps anywhere before a ladder) and the next level's first floor over
  that site less the climb's box. Finally `arriveFrom`: from the top level, a
  climb to the next band's floor inside a landing site of that band
  (`landingSite`, 40% of plain sites by `s.seed`, salt `0xa441`, never grown
  over), and that site rebuilt round it (`FILL.generate` on its rects less the
  box, its own doors plus the arrival). Steered growths (stair cells; houses
  by `steer` 0.5, salt `0xb10d`) aim their top level at landing sites.
- `connectionVariant` / `ladderVariant` take `within` (route and landing inside
  one of the rects). The landing's doorway gets a portal bound to the
  connection (`elev:p:exit`), so it matches the next floor's door exactly.
- Ids: raised floors `b<n>|<i>,<j>:raised<level>.<k>` (their own cell),
  owners `growth:<n>:<oi>,<oj>:<level>.<k>`, connections minted on the origin
  (`:x<k>` doors, `:l<level>` climbs, `:up` the arrival) with `cells` of both
  ends; the graph treats a door leaving the region as frontier by `cells`, and
  an `:up` connection as a vertical frontier unless both bands are asked for.
- `BandWorld`: `growth(n, i, j)` (the origin's, cached in `growths`, limit
  `branches`), `growthAt` (the cell's owner's), `raisedSites`, `raisedIn`,
  `arrivalsIn`, `arrivalInto(site)`, `claimOf(site)`, `raisedClaim(rs)`,
  `nearestWay(direction, x, y)`. `afterBuild` caps, swaps the stair pillar's
  filler (spatial already), swaps the house for its landing build, rebuilds a
  landing site round a climb from below. `placeBlueprint` lists a home band
  once (a climb that stays in its band).
- Measured over 192 cells of three seeds (band 0): 20 growths, 16 reach band 1;
  of the steered ones about three in four arrive; 11 of 12 blocks have a way
  up. Floors cross cell borders rarely (1 growth in 40 over 432 cells), because
  districts are small and start near their origin; the rule allows it anywhere.

**Growth step 3b, denser growth** (`src/growth.js`, `src/poi.js`,
`src/band-world.js`, `src/render.js`). The user's asks: many more starting
points (the 2 × 2 plan), slightly bigger branches, tall templates never grown
over, every growth on the zoomed-out map, no freeze while planning.
- Origins: `GROWTH.isOrigin` / `originOf`, one cell per `block` 2 cells a side
  (salt `0xb10c`). `candidate` is the hash alone, `{ i, j, p }` (priority salt
  `0xb10b`); `owner` is the nearest origin of the 3 × 3 blocks round the cell
  (squared distance, then `p`), so no cell plan is read for ownership. Stair
  pillars are gone; `share` and `seedsGrowth` are gone.
- Planting: `BandWorld` passes `plants(i, j)` to each band's `World`; for an
  origin it returns `{ fits: (L) => GROWTH.raises(L).length > 0 }`. `poi.js`
  places a growth house first in that cell (`yardHouse`, its own rng, salt
  `PLANT 0x901b`, archetypes with `grows` by weight, approach N or E since
  `raiseStair` refuses N/W landings, towards the middle 40% of the cell) and
  marks it `P.grows`. Other cells consume the rng exactly as before.
- `GROWTH.raises(L)` is memoised on the lot (`L._raises`); `housePillar` tries
  the planted house first, then other houses in the cell that can raise.
- Ground: `growable` = plain ground (`plainGround`) and not a landing site;
  `fitsUnder` = (`!tall(s)` and rel ≥ 4.5) or `W.keepsUnder(s, rel)`, which
  builds the site raw and needs `CLAIM.topOf(b) <= rel` (no ceiling cut).
  `tall: true` is on `loop_hall`, `office`, `scattered_pillars` and
  `pillar_hall` (the gallery fillers; a test keeps that in step).
- Branch: `sites [2, 6]`, `area 2000`; `steer` 0.75 (salt `0xb10d`).
- Landing reserve: `GROWTH.kept(W, n, i, j)` = band n + 1's plain sites in the
  origin's owned cells overlapping ±`landings` (36 m) round the planted lot's
  centre, less `doorSites` of band n + 1's own growth houses; memoised in
  `W.memo`. `landingSite(W, n, s)` asks the band-below owner's `kept`. About
  10% of plain sites (it was 40%).
- Map: `growthReady` / `prepareGrowth`; `render.js` plans growths for the
  cells in view within the frame's deadline (`growthsReady`) and paints a
  draft for the rest. The plan view draws every growth from `footprints`
  (limit 4096: floors' rects and floor heights, and the arrival box), which
  outlive the growths' cache.
- Not done: lining branch floors up with gallery heights (+3.25-3.75 m vs a
  first floor at +6.5 / +9.5 m) is not a small change; left for later.
- Measured over 8 × 8 cells of three seeds (band 0): 48 origins, 46-47
  planted, 40-43 growths, 32-34 arrive (about 21 and 17 per 100 cells, twice
  step 3), about 7 sites a growth. The remaining failures are mostly a site
  past the landing door that is a POI or too small.

**Growth step 4b, one home per growth** (`src/biomes.js`,
`src/growth.js`, `src/tpl/fillers/house.js`). Cody's report: one +10.5 m floor
(seed 31337, around x −52, y 145) had about 9 living rooms, 3 kitchens, 9
bathrooms and 5 bedrooms, and a bathroom over a thin "living" strip with a
window between them. Causes found:
- A level is 2-6 sites, and each site was laid out as a whole house floor of
  its own, so each brought its own living room and kitchen (up to 5 kitchens
  and 12 living rooms on one level at that spot).
- Room caps scaled with the site's area (2 living rooms and 2 bathrooms per
  200 m²), and leftover pockets defaulted to offices and storage.
- The bathroom with the window belongs to a cottage standing in the floor:
  the blue mark is the cottage's exterior window; its door opens onto the
  cottage's own hallway. The thin living strip is a filler room squeezed
  between the hallway and the cottage (nothing stopped a 1.5 m deep room).
The fix (PR #30):
- Each site gets a role from its level and distance (`DEFS.houseroom.floors`,
  read by `BIOME.fillerWeights(id, rs)`): the first site of level 1 is the
  living floor, the first site of each higher level an upstairs hall, every
  other site a bedroom wing. `raisedSite` tries the role's filler and its
  fallback (bedroom wing, or upstairs hall for a wing) with three seeds each,
  and never a living floor out of turn; growth rates are unchanged.
- Caps no longer scale with area (`cap` in house.js): one each of living,
  dining, kitchen, family room and master; bedrooms 4 in a wing, 3 upstairs,
  2 on the living floor; a bathroom plus one per 3 bedrooms; a linen closet
  plus one per 3. What a home does not need stays solid; infill off the
  hallway only adds rooms the floor still wants.
- A room too shallow for its type becomes a smaller one or stays solid.
- `tests/band-world.test.js` checks every branch floor for one home's rooms
  and every level for at most one kitchen and one living room. Over two seeds:
  at most 1 kitchen and 1 living room a level (it was up to 5 and 12); 40 of 48
  origins grow and 32 arrive (as before).
Known since: a big floor now has long hallways with solid on both sides where
a home needs no more rooms. Open question for Cody: windows on whole houses
standing inside a floor (they face the hallway or solid now, never a room).

**Map layering across claims** (`src/render.js`). A map tile paints its
claims one layer at a time from the ground up: the ground's floors, walls,
seams and tags, then each raised floor at or under the cut, which first blanks
its whole claim (solid where its filler leaves cells unbuilt, open only at a
pit). Before, every claim's floors were painted, then every claim's walls, so
the ground's walls and columns were drawn over the floors above it, and a dimmed
raised floor let the ground show through. Floors further under the cut are
darker (5% a metre, at most 45%; it was 2.5%, at most 28%).

**Growth step 4, house rooms** (`src/tpl/fillers/house.js`, `src/biomes.js`,
`src/growth.js`; [docs/growth.md](docs/growth.md)). The user's ask: "literal
house themed rooms, so house hallways, living rooms, more houses", not rooms
that merely read like a house.
- Three fillers, weight 0 (never on the ground), `biomes: ['houseroom']`,
  `biomeWeight` for the pool (`fillerWeights` reads it): `house_bedrooms` (3),
  `house_living` (3), `house_upstairs` (2). They are the whole houseroom
  filler pool; the seven generic fillers lost their tag.
- Layout: 1-3 hallway spines (`n = round(CN / (cw + 2D))`, at an edge on a
  narrow site, joined by a cross hallway), an end room (60%; a master gets an
  ensuite and walk-in closet via `C.hang`), rooms packed along both sides by
  a per-filler program (`PROGRAMS`: `[weight, max per 200 m²]`; the `ONE` set,
  kitchen, dining, foyer, pantry, laundry, mudroom, never scales; `ALONE`
  types never repeat side by side), each with a required door onto the hall,
  open-plan pairs (living, dining, kitchen, family) sometimes wall-less, and
  `infill` turning solid pockets of 3 × 3 cells or more into closets, pantries,
  utility rooms or offices off their neighbour. Uses the corridor kit, now
  exported as `FILL.corridor`.
- Room types are `FILL.TYPES` entries mapped from catalogue rooms (`KINDS`,
  `FILL.HOUSE_TYPES`): zone, ceiling and name (`label`) from the catalogue,
  tags `house` + the catalogue's. The engine's added corridors use
  `P.passage` (`hallway` here; default `passage`).
- Whole houses: `houseroom.houses` [0.7, 0.5, 0.35] is the chance by hop that
  `raisedSite` asks `furnish` for one. The pool is the archetypes tagged
  `houseroom`: ranch, bungalow, split_ranch, suburban and the new `cottage`
  (`poi: false`). `furnish` biases sizes small (70%), tries both
  orientations, faces the door to the middle, `margin` 1, `doorClear` 2, and
  builds flat (`floors: false` through `LOT.build` to `TPL.generate`).
  Lone catalogue rooms and the closet left the pool; office, linen, utility
  and hall were tagged for `BIOME.rooms`.
- A `cabin` archetype was tried and dropped (the house engine failed 49 of
  60 seeds); the cottage builds 54 of 60.
- Measured over 8 × 8 cells of three seeds: 40 of 48 grow, 30 arrive (as in
  step 3b); 271 floors hold 64 whole houses and 17 kinds of house room.

## Known limits

- Growth goes up only; nothing grows down toward the band below yet.
- A steered growth that cannot arrive just ends (no fallback plot); a block
  whose growths all fail has no way up of its own.
- Districts are 2-6 sites a level; growths never link to each other (step 6).
- Planning a growth builds its floors (about 0.3 s each, cold). The map plans
  them a few per frame, so the zoomed-out view takes a while to fill in, and
  a frame that plans one can still run long (under a second).
- At each leg's landing, the landing and the next floor keep their own walls
  on the shared line (with matching openings).
- Ramps are rare; routes stay inside one room; nothing curves; curved-wall
  fillers keep ladders.
- Galleries need an 8 m straight wall (none on pier-jogged halls); at most one
  gallery and one sunken floor per building; no mezzanines open on several
  sides, split levels or composites with storeys of their own.
- Houses are the only seeding archetypes (`two_storey`, `townhouse`), and
  only the one the ground plan plants in an origin cell (or another house
  there that can raise) starts a growth. A growth never covers a lot, a POI,
  a landing site or a tall room it would cut.
- The houseroom pool is three house fillers and five house archetypes:
  literal houses, nothing strange yet (no attics, crawlspaces or wrong-way
  stairs).
- A raised site that cannot be built is dropped with its subtree; a parent
  that fails only because of a child's door is dropped too (rather than the
  child). In practice none fails: over 300 cells, 0 of 51 raised sites.
- A pit needs 3 m of fall, a clear 2 × 2 m square on both floors and a clear
  shaft between them, so a growth often has none; only first-level floors over
  a whole ground site drill one. Drilled walls (the
  horizontal counterpart) do not exist yet.
- Only a ceiling is capped under a claim: a ground room that would need a
  shorter ceiling than 2.2 m refuses the cap, and the branch moves on.
- The world's streaming check (under 5 ms a site) runs at 2-5 ms, closer to
  its limit when files run in parallel. It now takes the best of up to three
  passes and fails only over 6.25 ms (full mode), so a busy machine no longer
  fails it; a real slowdown still does.

## Code entry points

| File | Responsibility |
| --- | --- |
| `src/world.js`, `src/poi.js` | Horizontal cell and site plans, POI placement, the `afterBuild` hook and `buildRaw` |
| `src/tpl/framework.js`, `src/tpl/grid.js` | Template pipeline (floor patterns, then kept stairs, last) and the 0.5 m kit |
| `src/tpl/house.js`, `src/tpl/archetypes/` | House engine (`stack` plan for storeys) and recipes |
| `src/tpl/fillers/`, `src/tpl/lot.js`, `src/tpl/composite.js` | Fillers, lots, templates inside templates |
| `src/tpl/elevation.js` | Adapter, kept stairs, ladder variants, capabilities, reservations, validation |
| `src/tpl/connections.js` | Connection zones, stair/ramp layout, `connectionVariant`, `linkFloors` |
| `src/tpl/floors.js` | Sunken floors and galleries |
| `src/tpl/elevation-view.js` | Cutaway, connection drawing, kept-stair parts, route profile |
| `src/journeys.js` | Milestone 4's journeys (lab only) |
| `src/claims.js` | Layered ownership: capped ceilings, a stair carried up to a raised landing, pits found and drilled |
| `src/biomes.js` | Growth biomes: seeding archetypes, pools, `furnish` |
| `src/band-world.js` | Bands, growths over them (cached; caps, pillars and arrivals applied to builds), stacked claims, spatial graph, world export |
| `src/growth.js` | Recursive growth: origins, ownership, pillars, levels, legs, arrivals, pits |
| `src/render.js`, `index.html` | Map tiles and interaction |
| `src/scale.js` | Scale references over the map: the person cursor (0.5 m) and real-sized objects placed from the Scale panel; overlay only, kept in the browser (`localStorage`) |
| `src/elevation-lab.js`, `elevation.html`; `workbench.html` | Lab; workbench |

## Verification

```sh
node tests/run-all.js            # quick: while working, after each change
node tests/run-all.js --full     # full: before pushing or opening a PR; CI runs this
node tests/run-all.js floors world   # just those files (quick; add --full for full)
node tests/floors.test.js --full     # one file on its own
```

Quick mode runs every check on 2 world seeds and smaller samples; full mode is
the whole suite as it always was (5 world seeds, full samples, 400 checks).
Run quick after each change and full before a PR. GitHub Actions runs full on
every PR to `main`. See "Fast test runs" below for how it works.

For vertical work start with `tests/elevation.test.js`, `connections.test.js`,
`floors.test.js`, `journeys.test.js`, `claims.test.js`, `band-world.test.js`, `cutaway.test.js`,
`elevation-ui.test.js`, `band-render.test.js` and `ui-smoke.test.js`. The UI
tests run the real page controllers with stub DOM and canvas; they are not
browser layout QA, so also look at the pages (Playwright with the
pre-installed Chromium works well for screenshots). Add tests that check real
geometry and behaviour, not field assignments.

## Working conventions used so far

- Branch per piece of work (`claude/<name>`), one squashed commit per
  milestone, committed as Claude (`git -c user.name="Claude" -c
  user.email="noreply@anthropic.com" commit`), commit messages ending with the
  session's attribution lines.
- Pull requests opened with the GitHub MCP tools (`mcp__github__*`; no `gh`
  CLI in cloud sessions), as a draft first, marked ready once CI is green. PR
  bodies use a Before / After opening and end with the Claude Code
  attribution. No PR template in the repo.
- Progress goes to the main chat through the coordinator session: the draft
  link with a picture, then green, then merged.
- The user is often away: make reasonable calls, report them plainly, and stop
  only for decisions that cannot be undone.
- For big changes, an independent review agent checks the diff before the PR.
- Update `docs/elevation.md`, `docs/elevation-world.md`, `README.md` and this
  file with each milestone, with a picture of the result where it helps.

## Fast test runs (done)

The suite was one serial run of about 4.5 minutes on the 2-core cloud machine
(150 s on a 4-core one). Now:

- **Parallel runner** (`tests/run-all.js`). Files run as separate processes,
  one per core by default (`--jobs N`), slowest first. Each file's output is
  printed as one block when it ends, with its time; a table of times, the
  check count and the list of failed files end the run, and the exit code is
  non-zero if any file failed. Names after the options pick files.
- **Two modes** (`tests/mode.js`, read by every file; `--full` or
  `BR_TEST_MODE=full`). Quick is the default: world seeds 31337 and 7 instead
  of all five, and smaller samples where a check samples many seeds or sizes
  (templates, fillers, park, neighborhood, elevation, floors, journeys,
  band-world). The checks themselves are the same; thresholds that counted a
  sample (galleries built, top floors smaller, pits) are the same proportion
  of the smaller sample.
- **Known places instead of searches.** `floors` looks up houses of several
  storeys at seed 31337, cell -1, -2 instead of planning 81 cells, and exports
  that cell (the old 3 × 3 export held none of them); `neighborhood` and
  `park` look up their POI at a known cell; `seams` in quick mode looks at
  three known neighbourhoods (one holds the only seam door). Each falls back
  to the old search and says to update the place if the generator moves it.
- **Less repeated work.** The band-world fault checks share one world and undo
  each fault (the graph is worked out afresh on every call). The deliberate
  repeats (fresh versus evicting worlds, reverse-order re-plans) are kept.
- **Timing checks** (`MODE.timing`): best of up to three passes; quick mode
  reports a slow pass as `WARN`, full mode fails only over budget + 25%.
  Streaming (5 ms), cell planning (60 ms), fillers (5 ms), neighborhood
  (300 ms).
- **CI**: `.github/workflows/tests.yml`, Node 22, full mode on every PR to
  `main` and on pushes to `main`.

Measured on 2026-10-08 on a 4-core cloud machine (2 cores emulated with
`taskset -c 0,1`):

| Run | 4 cores | 2 cores |
| --- | --- | --- |
| Before this tooling, every file one after another (375 checks then) | 149 s | 176 s |
| Quick, `node tests/run-all.js` (275 checks) | 48 s | 92 s |
| Full, `node tests/run-all.js --full` (392 checks) | 82 s | 155 s |

Each run was made with no failure and no timing warning; the quick and full
numbers were re-measured with milestone 5's checks in them. The slowest files
in quick mode are band-world (about 32 s when sharing the machine) and the two
world seeds (about 20 s each). The quick target of about 60 s on 2 cores is not
met: see the next paragraph.

**What still costs time.** Node does a lot of its work on background threads
(TurboFan compiles optimised code concurrently): a world run uses about twice
as much CPU time as it takes, so pinning to fewer cores slows each file down
much more than the file count suggests. `--trace-opt` shows the cause: big
functions (`planCell`, `layoutPrivate`, `linkFloors`, `LOT.build`) are
optimised, thrown away and optimised again about a dozen times each, about
13 s of compiling in a 10 s world run. Fixing those deoptimisations in the
generator would speed up the tests and the map alike; it was out of scope
here. (`--invocation-count-for-turbofan=20000` cuts a world run's CPU by
about 30%, but the tests run with V8's defaults, as the browser does.)

## Next

1. **Balcony and window connections** (the next design step Cody raised):
   galleries and balconies stand at about +3.25-3.75 m, the first branch floor
   at +6.5 m or more, so a balcony never opens onto a branch. Line them up
   (a lower first floor where a gallery is near, or galleries at branch
   heights), then decide how a balcony or window joins a floor beside it.
2. **Growth polish**, in rough order of value:
   - Take planning off the paint path entirely (a Web Worker), so no frame
     runs long.
   - Growth downward toward the band below, the same way (open: Cody has
     asked about it, nothing built).
   - Tune the block size, steered share and landing reserve now that every
     growth shows on the zoomed-out map.
   - Pits from every level (into the floor below, not only the ground), and
     holes rolled on shared walls (step 5).
   - Growths of the same biome that come close join up (step 6).
3. **Milestone 6: an Unreal consumer proof.** The export is one connected
   multi-band network wherever a growth arrives.
   - First, an engine-neutral reference builder in this repo: read a
     `br.world-elevation` export and emit simple geometry (glTF or OBJ):
     floor slabs from surfaces, walls from wall segments with their openings
     cut, stair and ramp volumes from their reservation pieces, ladders and
     holes. If anything cannot be built from the data alone, the contract is
     missing something; fix the contract, not the consumer.
   - Then the Unreal side: an importer (Python editor script or C++) that
     builds the same from the JSON, and agreement with the game on width,
     headroom, slope limits and traversal (the values in
     `TPL.CAT.CONNECTIONS`).
   - Freeze what the consumer relies on: version the world export
     (`br.world-elevation/0.3`) once the consumer reads it.
4. **More vertical variety inside templates**: galleries on jogged walls,
   mezzanines open on several sides, split-level houses, composites with
   storeys, curved stairs or ramps for curved fillers.
5. **Quick test speed on 2 cores** (open question): the quick run's target
   of about 60 s on 2 cores is not met (see "What still costs time" above);
   the fix is in the generator's deoptimisations, not the runner. Only on
   request: Cody does not want timing measurements unless asked.

