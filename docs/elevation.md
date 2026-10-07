# Elevation implementation plan

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
floor can have a display slice while remaining part of its home band.
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

### Milestone 2 — Simple connection zones

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

## Open tuning decisions

- Reference-band spacing and variation between districts.
- Frequency of local elevation changes and major journeys.
- Minimum horizontal exploration between consecutive vertical departures.
- First templates to receive authored floors and connection-zone preferences.
