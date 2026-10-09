# Room-first houses (test bed)

A second house generator, kept apart from the template engines in `src/tpl`
so a new way of laying out houses can be tried without changing anything that
already works. It has its own room modules, its own house recipes, its own
page and its own tests. Nothing in `src/tpl` uses it, and it uses nothing from
`src/tpl`.

- page: `space.html`
- code: `src/space/recipes.js` (data), `src/space/space.js` (generator and
  checker), `src/space/render.js` (drawing)
- tests: `node tests/space.test.js [seeds] [--full]` (not in `tests/run-all.js`)

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

## Output (`br.space/0.1`)

All in metres, the street along the bottom (`front: 'S'`).

- `spaces`: `{ id, type, name, zone, rect, poly, size, area, target, parent }`.
  `size` and `area` are clear floor.
- `walls`: one per pair of rooms one wall apart (`interior`, 0.15 m, or
  `open` when an open plan removes it) and each room's outer faces
  (`exterior`, 0.3 m, with `out`, the side the wall is on). Each has its
  `rect` and centre `line`.
- `openings`: doors and openings between rooms, and the front door, garage
  door and back door (`role`).
- `solids`: the wall builder's result as rectangles: `walls`, `pockets`
  (filled nooks) and `openings` (floor through a wall).
- `footprint`, `graph`, `thickness`, `meta` (plan, score and its terms,
  candidates tried, why candidates failed, time).

`BR.SPACE.verify(house)` checks a house from this output alone, apart from the
generator: no wall or filled nook on any room floor, every gap exactly one wall
or at least two outer walls, wall thicknesses exact, sizes inside each room's
ranges, inside the lot, every room reached from the front door. The page and the
tests both use it.

## Where it stands

Over 200 seeds of each house type, about 98% build and every built house passes
the checks. The rest fail plainly with "lot" (the house does not fit the lot
drawn for that seed). A house takes 10 to 45 ms.

Not done yet: windows, stairs and second floors, diagonal and curved rooms
(the format is ready for them), yards, and joining this into the
neighbourhood and world generators.
