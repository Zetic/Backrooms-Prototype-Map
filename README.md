# Backrooms map prototype

An infinite, deterministic Backrooms map with elevation bands, built entirely
from templates and inspected in 2-D.
Open `index.html` in a browser. There is no build step and no runtime
dependency.

![The map at 3 px/m](preview.png)

Every site on the plane is built by a template from its outline and its
connections:

- **Fillers** build the plain Backrooms: warrens, winding passages, chains of
  rooms, corridors lined with rooms or dead ends, switchbacks, branching
  tunnels, room mazes, partition fields, nested rings, and now and then a
  hall of pillars. Curved fillers use architectural circles, semicircles and
  radial sectors.
- **POI templates** build the places that should feel designed (houses,
  closets, restrooms, storage, neighborhoods). A house stands toward the back
  of its own lot, in a big yard room. A template at least 8 m across can be a
  lot of its own with its door on the edge, and a smaller one sits inside a
  filler. A template can be made of other templates: a neighborhood lines a
  street in a big hall with houses, each one built by the house template.

The world itself only decides where the sites are and how they connect.
Where two blueprints happen to end up wall to wall, the shared wall is a
**seam**: recorded once, and sometimes cut through by a seam rule (a window or
a door from a house straight into the backrooms next door).

## The world

The plane is cut into 128 m cells. Each cell is planned from the seed and its
own coordinates, so any part of the map comes out the same in any order:

1. Each cell border gets 2–4 openings, which both cells agree on.
2. POIs claim their places: houses and block-sized templates get lots, and
   smaller ones go inside what will be filler sites.
3. Every lot is cut out as a site of its own. The rest of the cell is cut
   into 8–32 m blocks around them. Some blocks merge into L, T and Z sites,
   and the sites tile the cell with no gaps.
4. A spanning tree of exact openings joins the sites, plus a few loops. The
   border openings join the cells, so the whole map is one connected graph.
5. Each site is built from its connections: a filler from the pool (built
   round any small POI inside it), a house behind its front yard (solid round
   its back and sides, a lane out to the lot edge), or a flush building whose
   doors are the connections.

A slow biome field tilts the filler weights between deep warrens and open
stretches. Unbuilt cells are solid, so the map is mostly enclosed, with open
space now and then.

[How the world is planned and built, measured](docs/world.md)

## Templates

A template takes any rectilinear site, its connections or main side, and a
seed. It returns a **blueprint** on a 0.5 m kit grid: rooms with types and
tags, walls, doors, windows, portals, levels and a room graph. Templates output
no furniture.

- **House** (ranch, bungalow, split ranch, suburban) and **Rooms & small
  POIs** (closet, storage room, restroom, mechanical room, storage units).
  [Contract, pipeline and how to add archetypes](docs/templates.md)
- **Every room and zone alone.** Each is defined once in a shared catalogue
  that every template draws on, and is a template of its own: a janitor
  closet or a corridor on its own (the *expected* pool), or, rarely, a
  kitchen, a stall or a playground walled in somewhere it doesn't belong (the
  *weird* pool).
- **Park**, an indoor park: a hall whose floor is tiled by zones (lawn,
  paths, plaza, playground, seating) for a later prop pass, pillars on tile
  pads, and sometimes a small building built by its own template.
- **Neighborhood**, a template made of templates: a street down a big hall,
  houses on both sides facing it, each built by the house template on its own
  lot and merged into one blueprint.
  [Templates inside templates](docs/templates.md#8-templates-inside-templates-srctplcompositejs)
- **Fillers**: a pool of 34 Backrooms fillers, weighted 70 / 20 / 10
  enclosed / mixed / open, plus the yard round a house. Each builds a site in about
  2–3 ms and honours every connection exactly.
  [Filler pool, contract and pipeline](docs/fillers.md)

Open `workbench.html` to:

- browse, search and health-check every template and filler;
- page through seeds;
- compare templates side by side;
- try sites and connections;
- edit recipes;
- export the JSON.

Templates have floors at their own heights: houses of two and three storeys
(`two_storey`, `townhouse`) with a real stair in their stairwell, sunken
living rooms and hall floors with steps down, and galleries along tall halls
(`docs/elevation.md`, milestone 3). The workbench shows a tab per floor and
draws the stairs.

Bands are joined by journeys (milestone 4): in every 512 m region, one
territory climbs to the band above and another to the band below. A journey
is a stack of different templates, each a floor of its own about 4 m above
the last, joined by stairs, ramps or ladders, with a floor to cross between
each climb and the next. Some journeys lean to ramps, some to ladders, some
to stairs; the largest share (4 in 9) take each floor's own preference.

Open [the elevation lab](elevation.html) to inspect actual floors, continuous
cutaway heights and the connection zones of every template and filler: where a
ladder, stair or ramp fits up or down, and a connected variant of any of them
(the template's preferred type by default, the ladder as fallback) with its
landing, cutouts and slope-following reservation. Exact local floor inspection,
ghosting, route profiles and `br.elevation/0.2` JSON export remain available.
The workbench detail panel opens the same template in the lab. The main map
uses band controls, a continuous cut height, and template-specific inspection.
[Elevation world planning, reservations and export](docs/elevation-world.md).
[Elevation design, data contract, and milestones](docs/elevation.md).
[Agent handoff and current implementation context](CONTEXT.md).

## Controls (`index.html`)

| Control | Function |
|---|---|
| Drag / WASD / arrow keys | Pan; Shift is faster |
| Wheel / pinch / `+` / `-` | Zoom. Blueprints from 1 px/m, room labels in POIs from 7 px/m |
| Go to | Enter `x, y` |
| Site outlines / Connection graph | Show the sites and the graph between them |
| Band controls | Inspect another horizontal band (each generated independently, joined by journeys) |
| Journey ↓ / Journey ↑ | Centre the view on the nearest journey down or up from the active band |
| Cutaway height | Highest floor below the cut at each XY; lower floors shaded by depth |
| Click a template | Its actual floor choices, focused upper-floor ghosting and JSON export |
| Hover | The site's template, size, connections, biome and build time; the POI, its setting and its doors; a journey's bands, style and floors |

The URL hash keeps the seed, position, zoom, band, cut height and toggles, for example
`#seed=31337&x=20&y=70&z=9&graph=1`.

## Modules

| Module | Responsibility |
|---|---|
| `core.js` | Seeded hashing, PRNG, noise, union-find |
| `poi.js` | POI placement per cell: tiers, density rhythm, settings (yard lots built round their house, flush lots, inside fillers), clusters, sites; `buildPOI` |
| `world.js` | Cell plans (borders, blocks, sites, connection graph), site builds, bounded caches, queries |
| `seams.js` | Where two blueprints end up wall to wall: each shared wall recorded once, and the seam rules that sometimes cut a window or door through it (a house against the backrooms) |
| `render.js` | The map: tile cache, detail / plan / far views, overlays |
| `tpl/` | The template system: kit grid, framework, the shared catalogue of room and zone types (`catalogue.js`), House, Rooms and Zone engines, the composite pipeline (`composite.js`: templates built inside a template and merged into one blueprint) and the Neighborhood and Park engines, archetypes, fillers, lots (`lot.js`: settings, the yard, and the adapter that builds templates inside bigger ones), blueprint renderer |
| `tpl/elevation.js`, `tpl/elevation-view.js`, `elevation-lab.js` | Stacked surfaces, reservations, ladder variants, validation, cutaway, JSON renderer and standalone lab |
| `tpl/connections.js` | Connection zones (ladder, stair, ramp), template preferences, slope-following reservations, `connectionVariant`, and `linkFloors` (a template's own stairs between its floors) |
| `tpl/floors.js` | Floor patterns on a finished building: sunken floors with steps, galleries over an undercroft |
| `journeys.js` | Vertical journeys: different fillers stacked from one band's floor to the next, joined by connection variants with exact rises |
| `band-world.js` | Deterministic reference-band networks, journey plans across band pairs, spatial reservations, exact portal matching and canonical world export |

```js
const W = new BR.World(31337);
const s = W.siteAt(20, 70);   // the site at a point
W.build(s);                   // its blueprints: the filler or yard and any POI buildings
W.cell(0, 0).conns;           // the connection graph of a cell
```

## Verification

```sh
node tests/run-all.js
```

The runner checks:

- **Templates.** Every archetype builds on many seeds, sites and main sides,
  and keeps the blueprint contract.
- **Seams.** Every seam is one wall both blueprints share with floor on both
  sides. Seam openings sit clear of every other opening, doors have floor in
  front of them on both sides and join the world graph, and seams come out the
  same whatever was built first.
- **The catalogue.** Every engine's rooms and zones are the catalogue's plus
  only its own context; every room and zone is a template of its own, alone;
  every template is in the expected or the weird pool, and weird ones are
  placed rarely.
- **The park.** Its floor is tiled exactly by zones, every park has a
  playground, paths and lawn, every way in opens onto a path, pillars stand on
  tile pads and a 1 m walker gets everywhere round them, and its building is
  exactly what its template builds alone.
- **The neighborhood.** Every house in it is exactly what the house template
  builds alone from the spec it records. Houses line both sides of the street
  and face it, every door a house chose opens onto its front yard, and on the
  map a neighborhood is its own lot, joined through its doors, every room
  reachable.
- **Elevation and connection zones.** Every template and filler validates with
  up/down ladder potential on many seeds; stairs and ramps meet real floors,
  keep their slope, width and headroom, cut only what they pass through, and
  reserve space that follows the slope (a room fits under the high end, not the
  low). Preferences never override fit, explicit rises are exact, variants are
  deterministic, and the cutaway shows routes and far landings both ways.
- **Floors at their own heights.** Houses of two and three storeys have one
  stacked stairwell and a real switchback per storey; sunken floors have open
  edges, the same ceiling and steps of exactly their depth; galleries stand
  over an undercroft with headroom, reached by a stair up a side wall; every
  template stair is built, or stays abstract with a warning where nothing
  fits; exits up and down keep away from where those stairs arrive.
- **Journeys.** Every journey climbs exactly 16 m through floors of different
  fillers, never stacks one climb over another, makes you cross each floor
  between arriving and leaving, builds exactly the doors the world planned,
  and is walkable from either band. Styles tilt the climbs. In the world,
  neighbouring bands become one network, whichever band is generated first and
  whatever the caches drop; a journey that cannot be built leaves an ordinary
  filler behind the same doors.
- **Fillers.** Every filler keeps the contract on any site shape and honours
  every connection. The pool leans enclosed, and fillers are fast.
- **The world, on five seeds.** Sites tile every cell exactly. Connections are
  exact openings on shared lines, and the cells agree on their borders. The
  plan is the same in any order and with a tiny cache. Every site builds with
  no problems, every connection is cut on both sides, and every room in a
  3 × 3 cell region (POI rooms included) is reachable. Every lot is its own
  site, a house stands toward the back of its yard and is entered from the
  front, and a flush lot is joined only through its doors. The rest of the
  POI placement rules are checked too.
- **The map page.** It runs `index.html`'s controller with a stub canvas.
- **Elevation.** Both directions, stacked clearance, explicit floor/ceiling
  cutouts, traversal from the ground entrance, protected void reservations,
  all-template connection potential, and the lab's actual controller with a
  minimal DOM/canvas adapter.

There is no CI yet; run the checks before pushing.
