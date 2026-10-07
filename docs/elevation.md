# Elevation implementation plan

Updated 2026-10-07 with milestone 2, simple connection zones. Milestone 1 was
merged in [PR #16](https://github.com/Zetic/Backrooms-Prototype-Map/pull/16).
For the next agent's repository entry points and implementation context, read
[the handoff](../CONTEXT.md).

## Goal

Generate architectural elevation data that a later Unreal Engine generator can
build from. The prototype's top-down representation is an inspection tool; the
spatial data must stand on its own. Continue the existing flat geometry rules
rather than replacing them with unconstrained three-dimensional noise.

## Agreed design

- Multiple stable reference elevations support sprawling horizontal networks
  above and below ground zero. Ground zero's main routes should stay especially
  consistent. Band spacing is configurable policy, not a universal story height.
- A band is a horizontal reference and planning context, not a restriction on
  floor heights. Depressed rooms, pits, raised floors, mezzanines, and compact
  stacks can exist within a fill's home band.
- Most travel is horizontal. Local changes in elevation can be more frequent
  than major transitions between bands.
- The typical major transition is a fill or an element dedicated to vertical
  exploration. Rooms, ramps, landings, branches, stacked pockets, and overlooks
  make a journey. Direct stairwells, ladders, and shafts remain possible but
  should be a minority of major transitions.
- A fill may branch into neighboring bands or own territory across several
  bands. Its footprints can expand, narrow, shift, or disappear with height.
  Related territories are planned together and inform template selection.
- Every template, including a closet or lone room/zone, must support optional
  upward and downward connections. A compact ladder/hatch variant is the
  minimum fallback; larger templates can provide authored exploration variants.
  Supporting a direction does not imply selecting it on every instance, or
  guaranteeing both directions simultaneously in an arbitrary cramped layout.
- Vertical chains should combine templates and include horizontal exploration
  between successive connections. A ramp-heavy or ladder-heavy influence can
  guide a journey, while individual layouts and connection choices vary. An
  authored multi-floor house remains valid; its top can connect to a different
  template rather than repeating the house through the whole stack.
- Reserve what the geometry and its clearance actually need. Large empty
  reservation boxes and padding filled with repetitive identical rooms are not
  substitutes for an interesting template. Intentional tall rooms and protected
  voids remain valid, but their extent must follow the design.

## Three invariants

1. **Occupancy does not imply connectivity.** A tall hall can occupy
   an upper band's space without offering an entrance into that network.
2. **Reserve vertical space together.** Rooms, slabs, routes, pits, and voids
   belonging to one fill claim space before neighboring fills are generated.
   An upper template must not be placed inside a lower template's protected void.
3. **Every template has up/down potential.** Capability is a physical connection
   option with a host surface, hatch footprint, and landing allowance. Selection
   requires a valid destination and successful reservation, rather than adding
   an isolated label or cutting a hole into unknown geometry.

## Spatial model

Use sparse, stacked floor surfaces and a traversal graph. One height per XY
coordinate cannot represent rooms underneath mezzanines or compact stacks.
Bands organize the layout; actual floor and ceiling elevations are authoritative.
The existing 0.5 m horizontal kit grid does not prescribe staircase riser heights.

The additive export is `br.elevation/0.2` (0.1 before milestone 2), with metres
in a local site frame and Z increasing upward. It retains the building renderer's rooms, walls,
openings, levels, footprints, and room graph, and adds:

| Field | Purpose |
| --- | --- |
| `fillId` | Shared owner across all occupied elevations |
| `bands[]` | Stable reference IDs and elevations |
| `rooms[].floorZ, ceilingZ, band` | Explicit vertical bounds; `ceiling` remains clear height |
| `surfaces[]` | Flat floor footprints, room ownership, elevation, ceiling, slab thickness |
| `connectors[]` | Endpoint surfaces, XYZ landings and path, kind, shape, width, clearance, slope, rise, direction, `zone`, and `reservations[]` (one or more prisms) |
| `holes[]` | Explicit floor/ceiling cutouts required by a hatch or shaft |
| `volumes[]` | Occupied or reserved prisms, including traversal allowances and protected voids |
| `bandTerritories[]` | Sections of the shared reservation at reference elevations; these are occupancy, not walkable-floor masks |
| `capabilities` | Up/down support, ladder candidates, the zone IDs and types that fit, and the template's preference order; unselected by default |
| `connectionZones[]` | Available stair/ramp/ladder areas with endpoints and heights; see below |
| `navigation` | Surface graph with explicit connector references and direction |
| `route[]` | Authored XYZ main journey, for inspection and downstream use |

`levels[]` in this export group actual floor elevations for local inspection.
They are neither world bands nor compulsory story numbers. A compact internal
floor can have a local floor entry while remaining part of its home band.
Use `navigation` for elevation reachability. The retained renderer-compatible
room graph has a single legacy `outside` node and must not be used to infer
connections between otherwise separate bands.

Ordinary openings must join floors at the same elevation. Different elevations
require an explicit connector with usable landings and a realizable path.
Floor heights and ceiling clearance are independent. Stacked rooms must leave
room for slabs; tall spaces and voids must be protected across affected bands.

Connection states are distinct: supported, selected, and connected. A capability
is supported; a request selects it; a matched destination and reserved route
make it connected. Occupancy sections and external band landings alone do not
create traversal edges into an ungenerated world network.

### Connection zones (implemented in milestone 2)

A connection zone describes the area available for a vertical connection.
It has no individual risers, treads, railings, meshes or props. A selected
variant still connects actual endpoints and reserves its occupied space and
clearance. An available zone and a selected physical connector stay distinct:
a zone is an entry in `connectionZones[]`; selecting one adds a connector, a
landing surface, cutouts, navigation and reservations.

| Zone field | Meaning |
| --- | --- |
| `id`, `owner` | `zone:<direction>:<type>:<surface>`; the template/fill that owns it |
| `direction`, `type`, `shape` | `up`/`down`; `ladder`, `stair` or `ramp`; `shaft`, `straight` or `switchback` |
| `state` | `available`, `selected` (requested) or `connected` (a connector built from it exists) |
| `surface`, `room`, `rects` | Host floor and the XY area the route, its entry and its landing occupy |
| `entry`, `exit`, `floorZ`, `targetZ`, `rise` | XYZ where the route starts and arrives, and the actual heights |
| `width`, `clearance`, `run`, `slope` | Route width, headroom, horizontal run, rise/run |
| `path`, `plan`, `destination` | Centre line, frame used to lay the route, landing footprint at the far end |

Types are catalogue rules (`TPL.CAT.CONNECTIONS`), not template code:

| Type | Width (min) | Slope (rise/run) | Headroom | Landings |
| --- | --- | --- | --- | --- |
| Ladder | 0.5 m | vertical | 1.8 m | hatch and 1 m landing |
| Stair | 1 m (0.9 m) | 0.45–0.84, laid at 0.7 (~35°) | 2 m | 1 m each end |
| Ramp | 1.5 m (1.2 m) | ≤ 0.25 (1 in 4), laid at 0.25 | 2 m | 1.5 m each end |

A stair or ramp is laid along a real wall of its host room (at least 75% of its
long side walled; an open boundary does not count) and is either straight or a
switchback (two lanes, a turn landing at half height). It must keep off
columns, existing floor holes, partitions, 1 m in front of every door, and
zones that are not marked for routes (`routes: true`; only the lawn is today:
a ramp can cross a lawn, not a park path or playground). A 1 m walker must
still reach every door and the route's entry around it. Its space must not
cross another surface in 3D.

Templates state a preference with `vertical: { prefer: [...] }` on a recipe or
filler. Houses prefer stairs; closets ladders; the park, circular hall, twin
domes, pillar hall and cross-pillar hall ramps first; sectors and radial
suites stairs. The default is stair → ramp → ladder. The ladder is always the
last resort. A preference is an order of attempts: a type whose geometry does
not fit is refused with its reason, and `auto` falls through to the next.

A zone's area is not itself walkable floor, a room, or a claim that its XY
footprint is blocked at every height. Zones do nothing until selected: no
cutout, no reservation, no navigation edge.

## Planning order for the eventual world

1. Establish stable horizontal networks and shared boundary landing elevations.
2. Select sparse major transition fills, plus local vertical opportunities.
3. Allocate jointly related territories and reservations across affected bands.
4. Select templates from the territory relationship and connection requirements.
5. Generate internal floors, passages, branches, connectors, and voids together.
6. Fit neighboring fills around reservations and match external landing contracts.
7. Validate traversability, volume conflicts, clearance, and boundary agreement.

Use deterministic shared decisions keyed by world seed, region, and band pair.
Generation order must not change a vertical reservation or connection. Control
major transition spacing by distance/area and regional topology rather than
independent doorway probabilities. Regions intended to be reachable need a
small planned connection backbone, with optional extra routes and loops.
Generate only needed bands/chunks and include band identity in cache keys.

## Current implementation milestones

This plan supersedes the initial atrium demonstration. The spatial contract,
optional ladder variants, band wrapper and exact portal validation remain;
the atrium generator, world placement policy and associated previews are removed.

### Implementation status

| System | Current state |
| --- | --- |
| Explicit room floors/ceilings, surfaces, graph and prism reservations | Implemented through the elevation adapter |
| Continuous cutaway and actual local floor selection | Implemented in milestone 1 |
| Connection zones (ladder, stair, ramp) on every template | Implemented in milestone 2; exported as `connectionZones[]` |
| Generated local vertical connections | Ladder, straight/switchback stair and ramp variants, chosen by template preference and fit; selected in the elevation lab |
| Slope-following reservations | Implemented: one prism per 0.5 m of flight; space under the high end stays free |
| New authored multi-floor layouts and broad local floor variation | Milestone 3; existing source-template levels are preserved |
| World connections between reference bands | None after atrium removal; bands are separate horizontal networks. Exports carry the zones, unselected |

Old abstract stair annotations in source templates are not proof of a physical
vertical connection. The adapter reports differing-floor legacy links as
unresolved until actual connector geometry is authored.

### Milestone 1 — Cutaway presentation (implemented)

- Replace the global preset floor slices with a continuous cut height. Show
  the highest actual walkable floor at or below that height at each XY.
- Keep uncovered lower floors visible, shade them by distance below the cut,
  and label their actual floor elevation. Floor holes reveal lower surfaces.
- Selecting a map template opens only that instance's actual floor choices.
  Upper-floor ghosting is limited to that selected template. Its JSON download
  preserves the generated geometry, XY origin and absolute world heights.
- Keep exact local floor inspection in the lab and template workshop. The lab
  also has the cutaway control; selecting a local floor switches to exact view.
- Draw physical ramp/stair paths as full-width occupied strips, including bends,
  with solid portions below the cut and faint dashed continuation above it.
  Mark landing heights and the selected connection's destination footprint.
  Ladders use their reserved hatch/landing area. Clicking a connection reveals
  the other landing's floor.
- Ramps and ceilings do not create additional floor choices. A hall with an
  8 m ceiling still has one floor unless another surface is explicitly authored.
- Remove the atrium from generation and the lab. Until replacement journeys
  are implemented, the main world's reference bands are separate horizontal
  networks; switching bands is inspection, not player traversal.

This is a schematic projection of existing spatial data. It does not generate
new house floors, connection zones, chains or slope-following reservations.
The slider's 0.01 m increment is a UI convenience; numeric height entry accepts
arbitrary values, and the spatial model has no required 2 m vertical grid.

[Cutaway rendering preview](cutaway-preview.png). Its upper row is a display
fixture testing overlap and ramps, not a new world template. The lower row uses
an existing circular-hall filler with its optional ladder variant.

![Cutaway heights and local exact-floor inspection](cutaway-preview.png)

### Milestone 2 — Simple connection zones (implemented)

Every template and filler now reports connection zones in both directions: the
compact ladder it always had, plus straight or switchback stairs and ramps
wherever its rooms fit them. `BR.ELEV.connectionVariant(source, { direction,
type, rise })` selects one: `type: 'auto'` (the default) walks the template's
preference and falls back to the ladder; a named type is built or refused with
the reason. The selected variant gains:

- a landing surface at the actual destination height, walled on three sides
  with an opening on the arrival edge;
- the connector, with its centre-line path, slope, rise and zone;
- explicit cutouts wherever its space crosses the host floor slab (going down)
  or ceiling (going up), merged on the 0.5 m grid;
- a navigation edge and an authored route;
- slope-following reservations, claimed atomically with the template's volumes.

How the acceptance criteria are met and tested (`tests/connections.test.js`):

- Zones describe area and endpoint heights without step-level detail. Listing
  zones changes nothing in the blueprint.
- Types fit their width, slope range, landings and headroom, and the validator
  checks it: no vertical stair/ramp segments, slope inside the catalogue range,
  the whole path plus headroom sampled every 0.25 m inside some prism, no
  crossing of another room, required cutouts present. A closet asked for a
  stair is refused (with a reason) and `auto` gives it a ladder.
- Both endpoints are real surfaces, the far landing has an opening, and
  navigation follows the connector.
- Each reservation prism runs from just under its walking surface to its
  headroom. A room fits under the high end of a ramp, not under the low end;
  a downward route's prisms stop at the floor above where it tunnels under.
- Sloped paths add one landing floor and no intermediate floor entries.
  Explicit rises are exact (3.37 m and −4.2 m are tested). A rise too small to
  clear the ceiling is refused, never moved.
- The same template and request give the same variant, and the source
  blueprint is not changed. Placement in a band moves every prism and zone.

Default rises, used when no rise is requested: a stair or ramp climbs the host
room's clear height plus the 0.25 m slab (at least 3 m, rounded up to 5 cm) or
descends 2.45 m (a 2.2 m landing room and its slab, at least 3 m). The ladder
keeps its 8 m default, or clears a tall host's roof. These are standalone lab
defaults; the world planner must negotiate real endpoint heights.

Measured with auto selection over every template/filler at its middle size,
seeds 1–6, both directions (960 variants): about 54% stairs, 43% ladders and
3% ramps, with no failures. Ramps need long walls: the park and pillar hall
choose them; the circular hall gets one from about 30 × 24 m, where a wing
wall is long enough (at the lab's default 23 × 17 m its curved wall leaves only
a stair). Twin domes (curved
walls) and closets stay with ladders.

[Connection zones preview](connection-zones.png), from the lab at a 0 m cut:
ranch (seed 7) with a switchback stair up and down; circular hall at 30 × 24 m
with a ramp in its wing; a closet's ladder going down; the park's zones
(potential only) and its ramp going down.

![Stairs, ramps, ladders and zones in the elevation lab](connection-zones.png)

Also fixed in this milestone: some house layouts fell back to a bare ladder,
or failed validation entirely, when a wing was reachable only through a second
door, or a yard lot was assembled in pieces. Reachability now starts at every
portal (each door is a way in), not only the main entrance.

### Milestone 3 — Template floors and authored vertical patterns

Evolve existing templates to have real local floors at their own heights.
Author multi-floor templates where the pattern matters: a house can give its
floors different purposes. Include depressed floors, pits, mezzanines, compact
stacks and offset exits. Keep every template's optional up/down fallback.

A three-floor house can end around +8 m and accept a different template above
it. Height does not require repeating the same theme through a whole stack.
Keep each authored pattern inspectable in the workshop/lab.

### Milestone 4 — World journeys composed from templates

Build sparse vertical journeys by matching the connection zones of successive
templates. Influence a journey toward ramp-heavy, ladder-heavy, or mixed choices,
while allowing variation. Every occupied floor needs horizontal exploration
between arrival and the next departure; repeated connections at one fixed XY
must not become the default chain.

Allow a template to span several bands, branch into another band, or coordinate
its territory with templates above and below. Plan related footprints, occupied
space and protected voids together before generating neighbors. Replace the
retired atrium policy with these journeys and restore connections between the
world's horizontal band networks. Generation order and cache eviction must
preserve the same ownership and matching decisions.

### Milestone 5 — Unreal consumer proof

Build a small consumer that reconstructs floors, walls, slabs, openings,
connection areas and protected voids. Agree width, headroom, slopes and traversal
capabilities with the game. The spatial export remains independent of this
prototype's schematic cutaway and the consumer's rendering/generation system.

## Current usage

Open [the elevation lab](../elevation.html). It starts with the circular hall's
upward connection. Every template and filler can be selected, and the workbench
detail panel opens the same template, seed and size there. Choose a direction,
a type (auto, ladder, stair, ramp) and optionally an exact rise. “Potential only
· show zones” draws every available zone without connecting any. The reports
list the types that fit each direction, the template's preference, each link's
shape, run, slope and reserved prisms, and the zones table. A connected local
variant does not connect world bands.

```js
const source = BR.TPL.generate({ archetype: 'ranch', seed: 7 });
const zones = BR.ELEV.prepare(source).connectionZones;           // opportunities only, nothing cut
const up = BR.ELEV.connectionVariant(source, { direction: 'up' }); // ranch prefers a stair
BR.ELEV.connectionVariant(source, { direction: 'down', type: 'ramp' }); // throws with the reasons each room refused it
BR.ELEV.validate(up); // { errors, warnings }
const ledger = new BR.ELEV.ReservationIndex();
ledger.reserve(up.fillId, up.volumes); // atomic claim, one prism per half metre of flight
BR.ELEV.drawCutaway(ctx, up, { cutZ: 0, scale: 20 });
```

`BR.ELEV.ladderVariant` remains for the compact fallback. Blueprints exported
as `br.elevation/0.1` (a single `reservation` per connector) are read and
upgraded by `prepare`.

[Current example export](elevation-example.json) (circular hall, seed 7, with
its upward stair) · [World ownership and export](elevation-world.md).

### Presentation in both directions

The milestone-1 review found the empty-lot ladder asymmetric: going down
showed detached corner strokes; going up painted the reservation like a gold
room; only upper destinations were outlined; labels overlapped. The cutaway
now draws:

- a ladder as an outlined footprint and hatch with rungs, never as a filled
  room: a dark opening when the hatch is in the floor you are looking at,
  dashed when it is overhead;
- stairs and ramps piece by piece at their width: solid where you would see
  them from the visible floor, blue dashed where a floor hides them below,
  violet dashed above the ceiling, with an uphill arrow;
- the far landing outlined in both directions (violet above, blue below) and
  tagged with its height;
- one label per connector, and staggered zone labels.

Occlusion still follows the actual floors; hidden geometry is never painted as
a solid surface.

## Open tuning decisions

- Reference-band spacing and variation between districts.
- Frequency of local elevation changes and major journeys.
- Minimum horizontal exploration between consecutive vertical departures.
- Which templates receive authored floors first (milestone 3).
- Whether more zones should allow routes (today only lawns), and preferences
  per district or journey influence rather than per template.
- Default rises for standalone variants once the world planner sets real ones.
