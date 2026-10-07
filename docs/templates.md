# Templates: blueprints for points of interest

Templates design the authored-feeling places (POIs) that sit buried inside the
backrooms. They range in size:

* **Small:** a one-room closet, a restroom, storage units.
* **Medium:** a house.
* **Planned, not built yet:** a mall, a street of houses, a skyscraper or an
  amusement park.

A template outputs **architecture only**:

* rooms, each with a type and tags;
* walls;
* doors and windows;
* entrances and exits onto the surrounding backrooms (*portals*);
* vertical links between levels.

There is no furniture, terrain or outside dressing. A later tool furnishes
rooms from their types and tags.

```
site (allotted shape) + seed + archetype  ─►  engine  ─►  building JSON (br.building/0.2)
                                                          ├─► 2-D workbench / map
                                                          └─► Unreal: kit pieces from walls / openings, furnishing from room tags
```

Open `workbench.html` to browse, compare and debug templates (section 7).

## 1. Kit grid and frames

* **Kit grid: 0.5 m.** Every room edge, wall and opening edge is a multiple of
  0.5 m, so an Unreal modular kit built on 0.5 / 1 / 2 / 4 m pieces lines up
  exactly.
* **Walls are centre lines.** Rooms are measured boundary to boundary.
  Suggested thickness comes with each wall: exterior 0.3 m, interior 0.15 m.
* **Site frame.** The origin is the site's bounding-box corner. +x goes right
  and +y goes down (the same as the map).
* **Turning to the main side.** Engines design in a canonical frame with the
  main side at the bottom. The framework turns the result to face the
  requested `approach`.

## 2. Input: the site

The world allots each POI a **site**: any rectilinear shape (a rectangle, an
L, a U, a notched block). The template builds inside it.

There is no yard or apron around a template. POIs are buried, so a house uses
its site almost to the edge. Any unbuilt cells go back to the backrooms fill.
The only breathing room is each portal's `clear` depth: the floor the world
must keep open in front of a door.

```js
BR.TPL.generate({
  archetype: 'ranch',                         // id, or a recipe object
  seed: 1234,                                 // uint32
  site: { w: 26, h: 15 },                     // metres; or { rects: [[x0,y0,x1,y1], ...] } for any shape
                                              // (default: drawn from the recipe's site ranges)
  approach: 'S',                              // the side the main entrance faces: N | E | S | W
  wrongness: 0.5,                             // optional 0..1, overrides the recipe
  mutations: ['falseDoors'],                  // optional, forces specific mutations
  candidates: 36                              // optional: layouts tried
})
```

The result is deterministic: the same spec gives the same building, whatever
was generated before. If nothing fits, the result is
`{ error: 'no valid layout', meta: { layoutFailures } }`; the world can then
try another site or another template. A recipe's `site` ranges tell the world
what to allot.

## 3. Output: `br.building/0.2`

Lengths are in metres in the site frame. Ids are stable within a building.

| field | content |
|---|---|
| `schema, engine, archetype, name, seed, approach, grid` | identity |
| `site` | `{ w, h, rects }`: the allowance |
| `levels[]` | `{ index, elevation, height }`; there is at least one |
| `footprint[]` | `{ level, rects }`: built cells per level |
| `rooms[]` | `{ id, type, name, zone, level, rects, area, ceiling, tags, parent }`. `zone`: public, private, service or circulation. `tags` describe what the room is for (`kitchen`, `wet`, `sleeping`, `storage`, `vehicle`…, plus `wrong:*` for mutations). `parent`: the owning room of closets, ensuites and stalls |
| `walls[]` | `{ id, level, kind, a, b, rooms [idA, idB], thickness }`. `kind`: `exterior` (one side is the backrooms; that room id is `null`), `interior`, `open` (a boundary with no wall) |
| `openings[]` | `{ id, level, wall, kind, a, b, width, rooms, swingInto, hinge, height \| sill+head, portal }`. `kind`: `door`, `double`, `opening` (cased, no leaf), `slider`, `vehicle` (garage/roller door), `window`, `false` (a door on a wall that leads nowhere) |
| `portals[]` | `{ id, opening, level, room, role, kind, side, width, clear, main, tags }`. Where the POI meets the backrooms. `role`: `entrance`, `exit` or `both`. `main` marks the main entrance. `clear`: metres of open floor the world must keep in front |
| `verticals[]` | `{ id, kind, rooms: [bottom → top], dead, tags }`: stairs, lifts, ladders linking stacked rooms. `dead: true` means it leads nowhere (a mutation) |
| `graph` | `{ nodes: [room ids, 'outside'], edges: [[a, b, kind, opening id], ...] }`. Edge kinds: the opening kinds, `open`, and vertical kinds |
| `meta` | `plan, score, terms, candidates, valid, chosen, mutations, program, issues, autoDoors, layoutFailures, ms`. This is debug information, not part of the building |

Guarantees, checked by `tests/templates.test.js`:

* everything is on the kit grid;
* rooms lie inside the site and never overlap on a level;
* openings lie on their walls, and portals on exterior walls;
* there is a main entrance facing `approach`;
* every room can be reached from the outside through the graph, across levels
  too;
* no furniture or terrain fields appear.

### How the world uses it

* **Placement.** Place the POI, then fill the backrooms around its footprint.
  Exterior walls become the boundary.
* **Routes.** Connect routes to `portals`. Entrances are where routes arrive;
  exits lead onward.
* **Clearance.** Keep each portal's `clear` box open.

## 4. Entrances and exits are template-specific

Each engine and recipe decides its own portals:

* **House:** a front door (main entrance, sometimes double), a garage door
  (`vehicle`, both ways), maybe a back exit (a door, or a slider from
  living/dining), maybe a side exit.
* **Restroom:** a single way in and out.
* **Mechanical room:** an entrance, and often an exit straight through the
  other side.
* **Storage units:** a double-door entrance and a fire exit at the far end.

Room-engine recipes list them as data:

```js
portals: [{ role: 'both', kind: { door: 0.6, double: 0.4 }, side: 'S' },   // the main side; kind drawn from weights
          { role: 'exit', kind: 'door', side: 'flank', p: 0.3 }]         // 'back' | 'flank' | 'any', with a chance
```

## 5. Pipeline (`src/tpl/framework.js`)

1. **site.** The allowance becomes a canonical mask, with its largest inner
   rect.
2. **program.** `engine.program(recipe)`: what to build.
3. **candidates.** `engine.layout(program)` runs N times (default 36). Each
   run returns rooms per level, wanted connections (to rooms, or to
   `TPL.OUTSIDE` for portals) and verticals.
4. **quick score.** `engine.quickScore` makes cheap checks.
5. **resolve.** The best K (default 6) candidates are resolved:
   * walls per level, from a raster of rooms;
   * explicit connections first, then `engine.connRule` for adjacent pairs;
   * portals on the exterior walls of the requested side;
   * reachability from outside through portals and verticals, with doors
     added (`engine.autoPenalty`) wherever a room would be cut off;
   * `engine.postResolve` (mutations such as false doors);
   * windows from each room type's rule (recipe `windows: 0..1`).
6. **score and validate.** Generic penalties (sizes, proportions, missing
   windows, circulation share, extra doors, missing links) plus engine terms.
   Score = 100 − penalties. The best valid candidate wins.
7. **output.** Units become metres, and the building turns to face the main
   side.

## 6. Engines and recipes

An **engine** is code: the architectural logic of one family. It registers
with `BR.TPL.registerEngine({ id, name, types, mutations, program, layout,
quickScore, score, connRule, autoPenalty, postResolve, fallback })`. `types`
is its room catalogue: zone, minimum width, maximum aspect, door privacy,
window rule, ceiling range and tags.

Current engines:

* **`house`** (`src/tpl/house.js`): public / private / service zones and
  plan types bar, T, L, deep and split.
  * The public zone is cut by recursive slicing, entry rooms toward the main
    side and service rooms toward the garage.
  * The private wing searches hall position, master endcap and side
    assignment. It produces an ensuite and walk-in closet around a vestibule,
    plus reach-in closets carved beside bedroom doors.
  * A garage comes with a service room behind it.
  * Portals as above.
* **`room`** (`src/tpl/room.js`), the small end of the range. Layouts:
  * `single` (closet, storage room);
  * `stalls` (restroom: vestibule, washroom, stall row, janitor closet);
  * `L` (an L-shaped plant room);
  * `units` (a corridor with rooms either side and an exit at the far end).

A **recipe** (archetype) is pure data in `src/tpl/archetypes/`:

* the `site` ranges;
* rooms with counts, chances and m² ranges;
* plan weights;
* portal chances;
* `windows`;
* `wrongness`;
* `category`, `blurb` and `rarity`, which the workbench uses.

A new house type is a new recipe:

```js
BR.TPL.registerArchetype({
  id: 'cottage_small', engine: 'house', name: 'Small cottage', category: 'house',
  site: { w: [9, 12], h: [12, 16] }, plans: { deep: 1 }, depth: [8, 10],
  rooms: { living: { area: [14, 18] }, kitchen: { area: [8, 10] }, master: { area: [11, 13] }, bath: { area: [4, 5] } },
  backDoor: 0.8, windows: 1, wrongness: 0.2
});
```

**Bigger POIs** use the same contract:

* a skyscraper is several `levels` with stacked stair and lift `verticals`
  (the tests build one with a test engine);
* a street of houses or a mall will be a composite engine that runs child
  templates inside sub-sites and merges them.

### Wrongness

| engine | mutations |
|---|---|
| house | `twin` (a room repeats), `giant` (one room far too big), `endless` (the hallway keeps going), `windowless`, `stairs` (a staircase into the ceiling), `falseDoors` (doors onto walls), `ceiling` (a ceiling at the wrong height) |
| room | `falseDoors`, `ceiling` |

Each mutation is tagged in the output (`wrong:*`), so a client can play it up.

## 7. The workbench (`workbench.html`)

**Library (left):**

* search across name, engine, category and text;
* filter chips by engine and size class (tiny / small / medium / large /
  huge), plus favourites and "needs work";
* sorting by engine, name, health or size.

*Check health* builds every listed template on 12 seeds. Each one then shows
a coloured dot, its average score, how often it found no layout, and its
most common rejection. Use it after editing many recipes.

**Modes:**

* **Seeds:** one template over a page of seeds.
* **Compare:** the ticked templates as rows on the same seeds and the same
  site.
* **Gallery:** one card per listed template.

**Site controls:** archetype-size or fixed W×D, a shape (rect, L, U, notched,
random), the main side and the wrongness level.

**View options:**

* room labels, with sizes or tags;
* portals: arrows in for entrances and out for exits, plus the clearance box;
* the room graph;
* a blueprint theme;
* crop to the footprint.

**Detail view** (click a card):

* pan and zoom;
* level tabs;
* tabs for score breakdown and rejections, rooms with tags, portals,
  program, issues, and the JSON (copy or download).

**Recipes:** *Edit recipe* changes a recipe live. *Save as new…* forks it into
a new template in the library, which is the fastest way to grow the catalogue.

**Keys:**

* `/` search;
* `↑` `↓` switch template;
* `←` `→` page seeds;
* `1` `2` `3` modes;
* `c` compare;
* `f` favourite;
* `Esc` close.

## 8. Next

* **More house recipes and logic:** shotgun, duplex, courtyard, two-storey
  (with levels).
* **Use the leftover arms of irregular sites.** For example, push a garage or
  a wing into the free arm of an L-shaped site.
* **Composite engines** (a street of houses, a mall), then a tower engine.
* **Templates in the map.** The world already places POIs and builds their
  blueprints ([POI placement](POI_PLACEMENT.md)). Carving sites into the fill
  and connecting portals to routes are next.

The world reads three optional recipe fields when it places POIs: `weight`
(frequency within the size tier), `areas` (which semantic areas the template
appears in) and `poi: false` (keep the template out of the world).
