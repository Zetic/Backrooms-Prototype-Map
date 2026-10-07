# Fillers: the plain Backrooms between POIs

In the template-first world every site is built by a template from its
connections. POIs (houses, restrooms, later malls and streets) claim their
places first: a house gets a lot with a front yard, a block-sized template a
lot of its own, and a smaller one sits inside a filler's site. Every other site gets
a **filler**, which also builds round any small POI inside it, taking its
doors as connections. Fillers are the bulk of the
map, so they are cheap (about 1 ms on a 10–24 m site), they cope with any
rectilinear site, and they honour every connection they are given.

They are Backrooms only and lean **enclosed**: clumps of small, irregular
rooms, long thin passages and chains of rooms, with an open hall only now
and then. Cells a filler leaves unbuilt are solid, the mass between rooms
that the reference map is full of.

![One example of each filler](fillers-atlas.png)

Try them in `workbench.html` (`fillers.html` now redirects there). They are
the *Fillers (Backrooms)* group in the library: one entry per filler, plus
*Pool pick*, where each seed picks a filler by weight. Page through seeds,
compare fillers with each other or with templates, change the site size and
shape, and set the connections by count or exactly (`S 4 1.5; E 10 2`:
side, metres along it, width). Pool pick with 48 seeds shows the mix in the
summary bar. *Check health* builds each filler on 12 standard sites and
shows how many came out clean.

The map (`index.html`) is built from fillers: every site that is not a POI's
lot gets one from the pool, weighted by the biome, and builds round any small
POI inside it. A house's lot is built by the `yard` filler
([docs/world.md](world.md)), in pieces: the front yard, and each door's
passage to the lot edge.

## The pool

| filler | feel | weight | what it builds |
|---|---|---|---|
| `warren` | enclosed | 26 | a clump of 3–10 m rooms with jagged outlines and off-centre openings; solid gaps, ragged edge |
| `passage` | enclosed | 16 | a 1–2 m corridor that kinks between the connections, with alcoves and dead-end stubs |
| `enfilade` | enclosed | 14 | a chain of rooms in a row through off-centre openings; sometimes it turns a corner |
| `cells` | enclosed | 8 | tiny 2–4 m rooms packed together, mostly a tree, so it reads like a maze |
| `ring` | enclosed | 6 | rooms around a solid core (sometimes a closet), joined in a loop; warren or solid around it |
| `broken` | mixed | 20 | a 10–18 m room cut up by stub walls and gapped partitions, with small rooms or solid around it |
| `ragged_hall` | open | 5 | a big room with a notched outline, a few columns, sometimes a solid block to walk around |
| `pillar_hall` | open | 5 | an open floor on a 3.5–6 m column grid |
| `yard` | open | 0 | not in the pool: a house's front yard (a strip across the front of the house and a lane out to the lot edge) and the passages from its other doors to the lot edge; the rest of the lot is solid (`src/tpl/lot.js`; the yard comes as a `hint`) |

The weights add up to 70 enclosed, 20 mixed and 10 open. `BR.FILL.pick`
chooses by weight among the fillers that fit the site (each has a `fits`
rule, for example halls need 12 m). A biome can pass its own `weights`.

The old world-first fill's Backrooms zones (open, split, warren, ring, corridor rooms)
and knobs (room scale, pillars, loops, wide openings) were the starting
point, retuned for less open floor and more solid between rooms.

## Input

```js
BR.FILL.generate({
  filler: 'warren',            // optional: picked from the pool when left out
  seed: 1234,                  // uint32
  site: { w: 24, h: 20 },      // metres; or { rects: [[x0, y0, x1, y1], ...] } for any rectilinear shape
  connections: [               // the openings the world's connection graph gives this site
    { id: 'n1', side: 'S', at: 4, width: 1.5, route: true },
    { id: 'n2', side: 'E', at: 10, width: 2, kind: 'door', route: false }
  ],
  weights: { warren: 30 },     // optional, only used when picking
  hint: { yard: [[2, 14, 28, 18], [10, 18, 16, 26]], adapters: [] }  // optional, metres: the yard filler's front yard and passages
})
```

* The site frame is the same as for templates: origin at the bounding-box
  corner, +x right, +y down, 0.5 m kit grid.
* A connection is an opening on the site outline. `side` is the direction
  you leave the site through it. It runs from `at` to `at + width` along that
  side (x for N and S, y for E and W). `line` picks which outline line when a
  side has several (an L or U site); by default it is the outermost one that
  fits. It needs 1 m of site behind it.
* `kind` is `opening` (the default) or `door`. `route` marks a connection on
  the main route rather than a side link; it is carried through as a tag.
* A connection that is off the outline, under 1 m wide or overlapping
  another is **refused** with `{ error }`, never moved.
* The result depends only on the spec. Connection order does not matter.

## Output: `br.filler/0.1`

The same shape as a template blueprint (`br.building/0.2`), so the same
renderer draws it:

| field | content |
|---|---|
| `schema, filler, name, feel, seed, grid` | identity |
| `site`, `connections` | the input, as used |
| `levels`, `footprint` | one level; the built cells |
| `rooms[]` | `{ id, type, name, zone, level, rects, area, ceiling, tags }`. Types: `room`, `hall`, `passage`, `cell`, `alcove`, `closet`. Every room is tagged `backrooms` plus what made it (`warren`, `enfilade`, `ring`, `bridge`, `landing`…) |
| `walls[]` | `exterior` (against solid or the site edge), `interior`, `open` (no wall), and `partition` (a free wall inside one room) |
| `openings[]` | `opening` (no leaf) or `door`, on their walls |
| `portals[]` | one per connection: `{ id, connection, opening, room, side, width, kind, tags: ['route' or 'side'] }` |
| `columns[]` | `{ id, room, rect }` |
| `graph` | room graph, with `outside` for the portals |
| `meta` | `rooms, built` (share of the site built), `openFloor` (share of floor in rooms of 80 m² or more), `partitions, columns, carved, loops, issues, ms` |

## Pipeline (`src/tpl/fillers/engine.js`)

There is no candidate search. A filler's `layout` paints rooms onto a raster
of the site once, and the shared pipeline makes the result sound:

1. **Land.** Each connection gets a landing, 1 m of floor behind the
   opening. If the layout left it solid, it joins the room next to it or
   becomes a passage.
2. **Clean.** Nothing narrower than 1 m. A room split in two becomes two
   rooms, and crumbs join a neighbour.
3. **Join.** If the floor is in pieces, the shortest 1 m passages through
   the solid join them.
4. **1 m.** A walker 1 m wide gets everywhere. Where a room steps
   diagonally so that it narrows under 1 m at a corner, a solid cell beside
   the step is filled. A room still pinched under 1 m becomes two rooms, and
   floor no walker can stand on turns solid. Two rooms that share no straight
   1 m of wall count as apart: the pinch between them is widened to 1 m, or a
   1 m passage joins them through the solid. A filler built in pieces (the
   yard) is settled the same way but never joined.
5. **Openings.** Portals go exactly where the connections are. Then comes a
   spanning tree of openings between rooms, the filler's required links (a
   ring's loop, an enfilade's chain) and a few extra loops. Two rooms that
   cannot share an opening lose the wall between them.
6. **Furnish.** The filler's partitions and columns are each kept only if
   the 1 m walker still reaches every floor cell. They keep clear of
   openings, and partitions never cross or double up.
7. **Output.** Metres, site frame.

A new filler is a `layout` (and maybe a `furnish`), registered with
`BR.FILL.register({ id, name, feel, weight, blurb, fits, doors, loops, layout, furnish })`.
The pipeline's helpers are in `BR.FILL.lib`: `bsp`, `voidSome`, `notch`,
`paintRooms`, `route`, `paintPath`.

## Tests (`tests/fillers.test.js`)

These are checked from the output JSON alone, on every filler over many
seeds, site shapes (rect, L, U, notched, random) and 0–4 connections:

* on the kit grid, inside the site, no overlaps, nothing under 1 m wide;
* every connection is honoured exactly, on an exterior wall, facing the
  right way;
* every room is reachable in the graph, and a walker 1 m wide, starting
  behind the connections, reaches every floor cell, given walls, openings,
  partitions and columns (`tests/walk.js`); a gap under 1 m stops it;
* the result is the same whatever was built before, and in any connection
  order;
* bad connections are refused, and tiny or odd sites still build;
* the pool picks only fillers that fit and leans enclosed;
* the average time on 10–24 m sites stays under 5 ms (it is about 1 ms).

## Next

* House and Rooms take their entrances from connections in the same way.
  Today they choose their own doors, and the world or the filler round them
  adapts (docs/world.md).
* More variety: a gallery (a room with a ring of bays), a stair-ish split
  level, corridor-with-rooms, and wrongness for fillers (false doors,
  dead-end loops, a ceiling at the wrong height).
