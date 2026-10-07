# Elevation implementation plan

Updated 2026-10-07 after milestone 1 was merged in
[PR #16](https://github.com/Zetic/Backrooms-Prototype-Map/pull/16).
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

The initial additive export is `br.elevation/0.1`, with metres in a local site
frame and Z increasing upward. It retains the building renderer's rooms, walls,
openings, levels, footprints, and room graph, and adds:

| Field | Purpose |
| --- | --- |
| `fillId` | Shared owner across all occupied elevations |
| `bands[]` | Stable reference IDs and elevations |
| `rooms[].floorZ, ceilingZ, band` | Explicit vertical bounds; `ceiling` remains clear height |
| `surfaces[]` | Flat floor footprints, room ownership, elevation, ceiling, slab thickness |
| `connectors[]` | Endpoint surfaces, XYZ landings and path, type, width, clearance, direction, reserved space |
| `holes[]` | Explicit floor/ceiling cutouts required by a hatch or shaft |
| `volumes[]` | Occupied or reserved prisms, including traversal allowances and protected voids |
| `bandTerritories[]` | Sections of the shared reservation at reference elevations; these are occupancy, not walkable-floor masks |
| `capabilities` | Up/down support and physical candidate locations; unselected by default |
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

### Connection zones: next contract addition

A connection zone describes the area available for a vertical connection.
It does not need individual risers, treads, railings, detailed meshes or props.
The generated variant still needs enough spatial data to connect its actual
endpoints and reserve its occupied space and clearance.

The following is a proposed contract for milestone 2, not an existing exported
field. Choose final field names during implementation and keep the two concepts
distinct: an available zone and a selected physical connector.

| Zone information | Purpose |
| --- | --- |
| Identity and owner | Associate the area with its template/fill and retain ownership across heights |
| Footprint/area | XY extent available to place the connection, including bends or landings as needed |
| Entry and exit | Locations and actual floor elevations; bind to real surfaces when connected |
| Allowed/preferred types | Permit ladders, stairs, ramps or a mixed selection; express a preference without forcing an invalid type |
| Required width and clearance | Ensure a realizable route fits the area and its surroundings |
| Capability/selection state | An unused opportunity creates no hole or traversal edge; a connected variant has a destination and reservation |

Template preferences and later journey influences should use these same
opportunities. Small templates can keep a ladder fallback; larger templates
should gain appropriate alternatives. A zone's allocated area is not itself a
walkable floor, a room, or a claim that its entire XY footprint is blocked at
every height.

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
| Generated local vertical connections | Ladder/hatch variants only, selected in the elevation lab |
| Ramp/stair footprint drawing | Generic full-width XYZ path projection exists; it does not generate these connections |
| Physical ramp checks | Existing validation/test fixture covers slope, width, landings and reservations |
| Template connection zones and ramp/stair variants | Next milestone; not implemented |
| New authored multi-floor layouts and broad local floor variation | Later milestone; existing source-template levels are preserved |
| World connections between reference bands | None after atrium removal; bands are separate horizontal networks |
| Sloped reservations allowing structures beneath high ramp sections | Planned; the current connector contract uses a single reservation prism |

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

### Milestone 2 — Simple connection zones (next)

Give vertical connections a simple footprint/area, entrance and exit locations,
endpoint floor heights, and allowed/preferred connection types. Templates can
favor ramps, stairs, ladders, or a mixed selection. This is the area needed to
place a connection, without modeling individual steps or railings.

Connect actual destination surfaces and reserve the route and usable headroom.
For ramps, replace a single full-height bounding prism with short prisms that
follow the slope. A high section may have usable space below it if clearance
permits. Keep floor/ceiling cutouts explicit; occupying upper space never creates
an entrance by itself. The milestone-1 renderer consumes these areas without
introducing extra floor slices along the slope.

Start with a small, inspectable selection of existing templates/fillers that
demonstrates ladder, stair and ramp options. Keep the all-template ladder
fallback and make new variants available in the workshop/lab, with JSON export.
Avoid creating another large demonstration fill just to exercise the contract.
World-scale chains and coordinated multi-band territory planning remain later
work.

Acceptance criteria:

- Zones describe a usable area and endpoint heights without step-level detail.
- Selected types fit their areas, width, height change and headroom. Preferences
  cannot override physical constraints; reject or choose a valid alternative.
- Both endpoints meet real floor surfaces. Required doors and floor/ceiling
  cutouts exist, and navigation follows the physical connection.
- The map/lab draw the occupied footprint at its width and show destination
  context for both upward and downward travel; they do not treat reservation
  areas as newly generated rooms.
- Ramp reservations follow the slope closely enough to permit a valid room
  under a high section while rejecting one that intersects the low section or
  its clearance. Update export, placement, reservation checks and consumers
  together if a connector gains multiple reservation volumes.
- Sloped paths add no intermediate floor entries. Authored endpoint floors can
  have arbitrary elevations, without rounding them onto a 2 m vertical grid.
- Preserve deterministic generation, the source blueprint, existing flat tiling
  and portal matching, and the compact up/down option for all template families.

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

Open [the elevation lab](../elevation.html). It starts with the existing circular
hall's optional upward ladder variant. Every existing template and filler can
be selected. “Potential only” keeps candidates without adding a connection;
upward/downward variants add a real landing, reserved shaft and floor/ceiling
cutouts. A connected local variant does not automatically connect world bands.

```js
const source = BR.TPL.generate({ archetype: 'closet', seed: 7 });
const vertical = BR.ELEV.ladderVariant(source, { direction: 'down' });
BR.ELEV.validate(vertical); // { errors, warnings }
const ledger = new BR.ELEV.ReservationIndex();
ledger.reserve(vertical.fillId, vertical.volumes); // atomic claim
BR.ELEV.drawCutaway(ctx, vertical, { cutZ: -1.25, scale: 20 });
```

[Current example export](elevation-example.json) ·
[World ownership and export](elevation-world.md).

The compact adapter's default upward landing moves above a tall host ceiling if
8 m would intersect it. An explicitly requested rise stays exact and is rejected
if it conflicts. The future world planner must negotiate destination constraints
before selecting a template, rather than silently moving a reference band.

## Known presentation issues and follow-up

The empty-lot up/down screenshots expose a visual asymmetry at a 0 m cut:

- Going down cuts the host's floor. The lower landing is covered by the ground
  floor except at the hatch; clipping can leave disconnected corner strokes.
- Going up cuts the host's ceiling, so the host floor stays intact. The renderer
  paints the whole ladder reservation footprint and adds a dashed outline for
  the landing above. The gold square can look like a room on the host floor.
- Extra destination outlines currently apply to landings above the cut. Lower
  destinations do not receive the same cue. Endpoint labels can overlap on
  compact footprints.

Occlusion should continue to reflect the actual floors. A recommended
presentation follow-up is to make the connection footprint, hatch and hidden
destination legible in both directions, without painting reserved space as an
extra room or exposing a hidden lower floor as a solid surface. This follow-up
has been identified but is not implemented.

The different endpoint heights in those screenshots are a separate placement
rule: default down is -8 m; default up clears the host ceiling plus the 0.25 m
slab and another 0.25 m allowance, so a tall host can produce +10.9 m. Neither
number defines a universal story height or world-band spacing. The future
planner must negotiate real endpoint heights; it must not silently move a
matched destination to copy this standalone fallback behavior.

## Open tuning decisions

- Reference-band spacing and variation between districts.
- Frequency of local elevation changes and major journeys.
- Minimum horizontal exploration between consecutive vertical departures.
- First templates to receive authored floors and connection-zone preferences.
