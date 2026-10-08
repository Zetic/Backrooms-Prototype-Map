# Map procedural generation: agent handoff

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
**one house pillar and its branch**, is this branch: a house that seeds growth
carries its stairwell on up, and a branch of its biome (`houseroom`) grows at
that floor over the ground beside it. Step 3, recursive growth with a budget
per region and steering toward the next band, is next; the Unreal consumer of
the exported data is milestone 6.

## Repository state

- Repository: [Zetic/Backrooms-Prototype-Map](https://github.com/Zetic/Backrooms-Prototype-Map).
- Plain JavaScript, browser globals under `BR`, no build step and no runtime
  packages. `index.html` is the map, `workbench.html` the template workshop,
  `elevation.html` the elevation lab. Serve the folder statically to inspect
  (`python3 -m http.server 8765`).
- `main` holds everything up to layered ownership (PR #24, `a58c8f8`). Growth
  step 2 is on `claude/house-branch`, in
  [PR #25](https://github.com/Zetic/Backrooms-Prototype-Map/pull/25). The branches `claude/world-journeys`,
  `claude/kept-stairs` and `claude/fast-test-runs-l53vww` are merged and can
  be deleted.
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
| Journeys (M4) | `src/journeys.js`: per band pair per 512 m region, a territory holding a stack of different fillers climbing 16 m, each climb a stair, ramp or ladder with an exact rise. Styles: mixed, stairs, ramps, ladders |
| World | `BR.BandWorld`: independently seeded horizontal bands, joined by journeys. Plans are pure functions of (seed, region, band pair); generation order and cache eviction change nothing |
| Layered ownership (M5) | `src/claims.js`: claims with height ranges in one column, ceilings capped under a claim above, a house's stairwell carried up to a raised landing, and pits found and drilled between two claims, one drilled from a branch down into the ground |
| Growth (step 2) | `src/biomes.js`: archetypes that seed growth (`grows`), biome tags on rooms, templates and fillers, the `houseroom` pool, `furnish`. `band-world.js` grows at most one branch per cell from a seeding house (a share of them): its stair carried one flight up (+6.5 m or +9.5 m), then 1-4 plain ground sites edge to edge, each a houseroom filler with house rooms in it |
| World export | `br.world-elevation/0.2`: layouts, reservations, navigation, exact portal matches, `policy.verticalJourneys: 'composed'`, `policy.layeredOwnership: 'stacked-claims'`, a `journeys` summary, per-slice `raised[]` with each site's `floorZ`/capped `ceilingZ`, a top-level `pits[]`, `verticalFrontier` for journey doors onto an unexported band |
| Map | Raised branches painted with the ground at their own height (the ground showing through their pits), hover telling you what stands over what; continuous cutaway by height, band switching; a template's stairs at their width with their heights (click one to move the cut to where it arrives); sunken floors at their depth; journey territories teal at plan zoom; *Journey ↓ / ↑* buttons; hover names a journey's bands, style and floors |
| Lab | Any template or filler with direction/type/rise; zones view; "Carry its stair on up" for the raised landing a branch is entered from; a journey per style with its climbs, floors and route profile |
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
- World: `journeyPlan(lower, ri, rj)` (region of 4 × 4 cells; even pairs in the
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

## Known limits

- One journey per band pair per region, always exactly one band tall; no
  branches into a band partway up; neighbours are planned round the journey's
  rectangle, not its floors.
- A journey is built in one piece when its site is first drawn, so the map
  stalls up to about a second when one comes into detail view; the *Journey*
  buttons build the nearest one synchronously.
- At each journey landing exit, the landing and the next floor each keep their
  own wall on the shared line (with matching openings), as two neighbouring
  sites do.
- Ramps are rare outside the ramp style; routes stay inside one room;
  nothing curves; curved-wall fillers keep ladders.
- Galleries need an 8 m straight wall (none on pier-jogged halls); at most one
  gallery and one sunken floor per building; no mezzanines open on several
  sides, split levels or composites with storeys of their own.
- Seams (shared walls between blueprints) are not computed against journeys.
- A branch grows from a house only (the only seeding archetypes are
  `two_storey` and `townhouse`), one flight up, at most one per cell and
  within its cell; no pillar rises from a branch yet, nothing steers toward the
  next band, and branches do not link to each other or to a journey. It never
  covers a lot or a POI. Over 144 cells of four seeds, 14 branches grew where
  20 houses could have seeded one.
- The houseroom pool is the catalogue's lone house rooms and seven existing
  fillers, so districts read as hallways with a few rooms in them; new
  houseroom fillers are step 4.
- Planning a branch builds its ground sites and its district (about 0.1-0.4 s,
  up to about a second under load) when its cell first comes into detail view
  or a site of it is built, so the map can pause briefly there; the plan view
  only tints branches already planned (`raisedIn(..., planned)`).
- A raised site that cannot be built is dropped with its subtree; a parent
  that fails only because of a child's door is dropped too (rather than the
  child). In practice none fails: over 300 cells, 0 of 51 raised sites.
- A pit needs 3 m of fall, a clear 2 × 2 m square on both floors and a clear
  shaft between them, so a branch often has none. Drilled walls (the
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
| `src/world.js`, `src/poi.js` | Horizontal cell and site plans, POI placement, reserved lots (`plannedLots`, `buildTransition` hooks) |
| `src/tpl/framework.js`, `src/tpl/grid.js` | Template pipeline (floor patterns, then kept stairs, last) and the 0.5 m kit |
| `src/tpl/house.js`, `src/tpl/archetypes/` | House engine (`stack` plan for storeys) and recipes |
| `src/tpl/fillers/`, `src/tpl/lot.js`, `src/tpl/composite.js` | Fillers, lots, templates inside templates |
| `src/tpl/elevation.js` | Adapter, kept stairs, ladder variants, capabilities, reservations, validation |
| `src/tpl/connections.js` | Connection zones, stair/ramp layout, `connectionVariant`, `linkFloors` |
| `src/tpl/floors.js` | Sunken floors and galleries |
| `src/tpl/elevation-view.js` | Cutaway, connection drawing, kept-stair parts, route profile |
| `src/journeys.js` | Journeys |
| `src/claims.js` | Layered ownership: capped ceilings, a stair carried up to a raised landing, pits found and drilled |
| `src/biomes.js` | Growth biomes: seeding archetypes, pools, `furnish` |
| `src/band-world.js` | Bands, journey plans and slices, house pillars and their branches, pits, stacked claims, spatial graph, world export |
| `src/render.js`, `index.html` | Map tiles and interaction |
| `src/elevation-lab.js`, `elevation.html`; `workbench.html` | Lab; workbench |

## Verification

```sh
node tests/run-all.js            # quick: while working, after each change
node tests/run-all.js --full     # full: before pushing or opening a PR; CI runs this
node tests/run-all.js floors world   # just those files (quick; add --full for full)
node tests/floors.test.js --full     # one file on its own
```

Quick mode runs every check on 2 world seeds and smaller samples; full mode is
the whole suite as it always was (5 world seeds, full samples, 392 checks).
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
- Pull requests opened with the GitHub MCP tools (`mcp__github__*`): no `gh`,
  `hub` or raw API in this session. PR bodies end with the Claude Code
  attribution.
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

1. **Growth step 3: recursive growth** ([docs/growth.md](docs/growth.md)).
   Step 2 grows one branch from a house, one flight up, inside its cell. Next:
   - A growth plan per region (not per cell), a pure function of (seed,
     region, the region's ground plan), with a budget of pillars and branch
     sites; a share of eligible POIs seed.
   - Pillars from branches: a branch site raises a pillar of 3-8 m (one or more
     flights, each an exact rise, a floor at each landing) a few sites away
     from the last, and a new branch grows at its floor, over the branch below
     (the claims already allow a claim over a claim; `ceilingOf` and
     `reservationPlan` need to stack more than two).
   - Steering: after growing, check whether any chain reaches the next band;
     if none does, extend the most promising branch upward until one does. A
     chain within reach of the next band ends in an ordinary site there.
   - Today's journey plot becomes the fallback where steering fails, and
     "journey" becomes the player's route (the renaming the design asks for).
   - Keep: no shafts, no template repeated along one chain, exact rises, whole
     sites, claims that touch but never overlap, the ground plan unchanged.
   - The checks change to "a way up exists in each region with every emergent
     connection removed".
   Open questions the design leaves for the user: whether every region must
   guarantee a way up, which other POIs seed and with which biomes, the seeding
   share, whether districts cross region borders, and whether the journey plot
   survives as a rare style.
2. **Milestone 6: an Unreal consumer proof.** The export is now one connected
   multi-band network, so it is ready to be consumed.
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
     (`br.world-elevation/0.2`) once the consumer reads it.
3. **Journey polish**, in rough order of value:
   - Remove the map stall: build journeys off the paint path (a Web Worker, or
     build when the cell is planned while the map is idle).
   - Show a journey's route on the map when hovered or selected (the lab's
     profile already has it).
   - Let neighbours respond to a journey's floors (an overlook or window onto
     its stair hall, or a branch into a band partway up).
   - Density and style by district or biome instead of one per region and a
     fixed weighting; consider journeys spanning two bands.
   - Merge the double wall at landing exits into one shared wall.
4. **More vertical variety inside templates**: galleries on jogged walls,
   mezzanines open on several sides, split-level houses, composites with
   storeys, curved stairs or ramps for curved fillers.
