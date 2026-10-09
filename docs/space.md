# Room-first houses (test bed)

A second house generator, kept apart from the template engines in `src/tpl`
so a new way of laying out houses can be tried without changing anything that
already works. It has its own room modules, its own house recipes, its own
page and its own tests. Nothing in `src/tpl` uses it, and it uses nothing from
`src/tpl`.

- page: `space.html`
- code: `src/space/recipes.js` (data), `src/space/space.js` (generator and
  checker), `src/space/route.js` (walk-through houses), `src/space/render.js`
  (drawing)
- tests: `node tests/space.test.js [seeds] [--full]` and
  `node tests/space-performance.test.js`; both are included in `tests/run-all.js`

## The idea

The template engines draw rooms on a 0.5 m raster and then put the walls on the
room edges, so a wall takes floor from the rooms it sits between and every wall
type changes how big the rooms really are. Here it is the other way round:

1. **Rooms are reserved floor.** Every size is clear floor, walls not
   included. A room is a module with its own narrowest side, longest shape and
   area window (`SP.MODULES`); the generator never makes it smaller than that.
2. **Walls get their own space.** Two rooms that face each other are exactly
   one interior wall apart (0.15 m), or at least two outer walls apart (0.6 m).
   Anything in between is rejected, so a wall is never thinner or thicker than
   its type, whatever the rooms around it.
3. **One wall builder, last.** After every room is placed, one pass builds all
   the solid parts from the rooms alone: the interior walls in the gaps, the
   outer shell laid outside the rooms (0.3 m), and any leftover outside nook too
   narrow to use filled solid. No part of the plan draws its own walls, so two
   parts can never put two walls in the same place or a wall into a room.
4. **Not bound to a grid.** Lengths are whole centimetres on a 5 cm step. The
   output carries a polygon per room as well as its rectangle, so diagonal or
   curved rooms can come later without changing the format.

## How a house is made

`BR.SPACE.generate({ recipe, seed, site? })`:

1. **Program.** The recipe (`SP.RECIPES`) gives the rooms and their target
   areas: ranch, bungalow, cottage, suburban.
2. **Plan.** A plan arranges the room modules in rows and columns.
   - *bar*: garage, public rooms (a back row and a front row), then a wing of
     private rooms down both sides of a hallway, along the street. The garage
     sits beside the service end or in front of it.
   - *deep*: public rooms at the front, the private wing behind them with its
     hallway running back. For narrow lots.
3. **Solve.** Inside a row or column, neighbours are one interior wall apart.
   A face that meets another part of the house is flush; a face on the outside
   may jog. The solver sizes each module inside its own ranges until every
   flush face lines up; when it cannot, the plan shares the rooms out
   differently and tries again.
4. **Check.** Gaps, sizes, the lot (with room for the outer wall).
5. **Doors.** Every pair of rooms that should connect (`SP.LINKS`) and has room
   for its door gets one. Then the front door, the garage door, the door from
   the garage into the house and a back door. Every room must be reached from
   the front door through the house; a last-resort door may come from a
   hallway or public room, never into a closet or ensuite.
6. **Walls.** The wall builder above.
7. **Best of many.** About 60 candidates are tried; the best scored valid one
   is kept (sizes near target, compact, not too much hallway, few extra doors).

## Walk-through houses (the route plan)

Performance work and reproducible comparisons are documented in
[space-performance.md](space-performance.md). All 20 route attempts and the
original selection rules remain; the changes accelerate exact checks and the
final raster wall construction.

For the backrooms the outline of a house does not have to make sense, but
walking through it must, like a ride through a set: you should feel you are in
a home, and that something is wrong. So these houses are built along the way
through them (`src/space/route.js`). Recipes: `passage` (two floors),
`passage1` (one floor) and `backdoor` (out through the kitchen and mudroom).

1. **The route.** The recipe's `route.script` lists the rooms you pass
   through, in order, from the front door to an exit into another part of the
   backrooms: for example foyer, living room, stairwell, upstairs hallway,
   loft, hallway, exit. Only rooms you pass through may be on it (`SP.PASS`),
   so it never ends at a bathroom or a bedroom.
2. **Each step against the last.** Each room of the route is placed one
   interior wall from the room before it, on any side but the one you came in
   by. After a hallway the next room comes off its far end or near it, so you
   walk the hallway. A stairwell is a step to the floor above: its floor is
   reserved on both floors and the route carries on from its top end. The last
   room keeps clear ground beyond it for the exit.
3. **Side rooms.** Everything else a home has hangs off the room it belongs
   with (`SP.HOSTS`): the kitchen and dining room off the living room, the
   garage off the mudroom, laundry or foyer, bedrooms and bathrooms off a
   hallway (upstairs when there is one), closets, ensuites and walk-in closets
   off their bedroom. When the route has no room left for a bedroom or a
   bathroom, a short hallway of its own branches off. Side rooms are dead
   ends: one door, back the way you came.
4. **Wrongness** (`route.wrong`, 0 to 1, or `wrong` in the call). It changes
   the script, never the walls: a hallway far too long, the same room twice in
   a row, stairs that go up two floors, a room off the wrong room (a bathroom
   off the living room, a bedroom off the kitchen), a bedroom reached only
   through another. The house lists what is off in `wrong`. At 0 nothing is;
   at the default 0.35 about 6 houses in 10 have something; at 1 nearly all.

The checker adds, for these houses: the route starts at the front door and
ends at the exit, each step opens into the next, only pass-through rooms are on
it, no side room makes a way around it, and stairwells line up between floors.

## Output (`br.space/0.2`)

All in metres, the street along the bottom (`front: 'S'`).

- `floors`, and `floor` on every space, wall and opening (0 the ground floor).
- `spaces`: `{ id, type, name, zone, floor, rect, poly, size, area, target, parent }`.
  `size` and `area` are clear floor.
- `walls`: one per pair of rooms one wall apart (`interior`, 0.15 m, or
  `open` when an open plan removes it) and each room's outer faces
  (`exterior`, 0.3 m, with `out`, the side the wall is on). Each has its
  `rect` and centre `line`.
- `openings`: doors and openings between rooms, and the front door, garage
  door, back door and exit (`role`).
- `levels`: per floor, the wall builder's result as rectangles (`solids`:
  `walls`, `pockets` (filled nooks), `openings` (floor through a wall)) and the
  `footprint`.
- `verticals`: stairwells, `{ rooms: [lower, upper], floors, rect, up }`.
- `route` (walk-through houses): the rooms in walking order; `wrong`: what is
  off.
- `graph`, `thickness`, `meta` (plan, score and its terms, candidates tried,
  why candidates failed, time).

`BR.SPACE.verify(house)` checks a house from this output alone, apart from the
generator: no wall or filled nook on any room floor, every gap exactly one wall
or at least two outer walls, wall thicknesses exact, sizes inside each room's
ranges, inside the lot, every room reached from the front door. The page and the
tests both use it.

## Where it stands

Over 200 seeds of each house type: the bar and deep plans build about 98% of
the time (the rest fail plainly with "lot": the house does not fit the lot
drawn for that seed), the walk-through houses every time, and every built
house passes the checks. Before the performance follow-up, the reported times
were 10 to 45 ms for a bar or deep house and 60 to 100 ms for a walk-through
house. The same-machine before/after measurements are in
[space-performance.md](space-performance.md).

Not done yet: windows, diagonal and curved rooms (the format is ready for
them), yards, and joining this into the neighbourhood and world generators.
Upper floors of walk-through houses may overhang anything: the outline is free
by design.


## Shape study

An opt-in experiment adds L/T halls and L/alcove living floors, a same-seed
comparison, and the `br.space/0.3` floor-union contract. See
[space-shapes.md](space-shapes.md) for controls, limitations and validation.
