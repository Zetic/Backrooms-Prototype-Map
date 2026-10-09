# Room-first house generation performance

This follow-up optimizes the separate `src/space` prototype against upstream
`a2e09427d17d56b0724575c5bdd3f4c208ce1c32` (the walk-through house generator).
All 20 route attempts remain. Selection still scores every valid placement in
the original order, and picks the same winning house. Room sizes, the free
outline, stairs, branching, wrongness and clearance rules remain unchanged.

## Changes

- **Floor occupancy:** each floor maintains its room list and a conservative
  6 m spatial index. Coordinates are never rounded to those buckets. Small
  lists use direct iteration to avoid lookup overhead.
- **Candidate bands:** one lookup covers all possible offsets for a given
  face and shape. Exact rectangle checks then reject overlaps and prohibited
  gaps, including the full 0.6 m exterior-wall clearance. Entrance, exit and
  garage reservations are still checked.
- **Offsets and nearby edges:** nearby room edges are collected once per
  attachment. Offsets that cannot share the required host-wall length are
  omitted before Set insertion. Their original random draws still occur.
- **Duplicate geometry:** repeated shapes reuse checked rectangles within an
  attachment. Each valid logical candidate still receives its own original
  random score. Cache entries do not survive room placement or rollback.
- **Exact checks:** scalar comparisons replace temporary arrays in the gap
  loop, and distant rectangles exit before detailed overlap arithmetic.
- **Walls:** placement records all shared walls, including incidental
  contacts. Rolling back a temporary branch hall removes its occupancy and
  walls. Records are sorted into the original per-floor pair order; door
  lookup uses a room-pair map.
- **Final raster:** contiguous typed-array fills paint room rows; scalar
  morphology loops and a typed flood-fill stack remove per-cell coordinate
  allocations. The 5 cm raster, closing, hole filling and output rectangles
  are identical to the original algorithm. This also accelerates the older
  bar/deep plans, which share the wall builder.

## Measurements

Linux x64, Node v24.19.0, wrongness 0.35, 200 seeds per recipe, three
alternating process rounds. Each recipe built and verified all 200 houses in
every round, retained 20 attempts per house, and matched the original output.

| House | Original mean | Optimized mean | Speedup | Original p95 | Optimized p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Passage house (two floors) | 121.38 ms | 46.52 ms | 2.61× | 190.72 ms | 72.66 ms |
| Passage bungalow | 69.46 ms | 28.45 ms | 2.44× | 100.23 ms | 39.61 ms |
| Back-door ranch | 111.15 ms | 43.37 ms | 2.56× | 174.27 ms | 64.64 ms |

Separate 50-seed, one-round comparisons:

| House | Placement changes only | Raster changes only |
| --- | ---: | ---: |
| Passage house (two floors) | 1.08× | 1.51× |
| Passage bungalow | 1.17× | 1.30× |
| Back-door ranch | 1.50× | 1.23× |

Both groups reduced total generation time in the isolated samples. These
smaller runs use a different seed sample and separate processes; their ratios
are not additive predictions of the combined result. Wall construction is a
material cost, so spatial indexing alone does not account for the full gain.

Raw results: [combined](space-performance.json),
[placement only](space-performance-placement.json),
[raster only](space-performance-raster.json). These measure this prototype on
the test environment, not Unreal runtime performance. Even the optimized mean
times exceed a 16.7 ms frame budget; synchronous generation still needs scheduling.

## Reproduction

From a checkout that contains the original upstream commit:

```sh
node tools/benchmark-space.js --baseline-ref a2e09427d17d56b0724575c5bdd3f4c208ce1c32 --seeds 200 --rounds 3 --json results.json
node tools/benchmark-space.js --baseline-ref a2e09427d17d56b0724575c5bdd3f4c208ce1c32 --seeds 50 --rounds 1 --variant placement
node tools/benchmark-space.js --baseline-ref a2e09427d17d56b0724575c5bdd3f4c208ce1c32 --seeds 50 --rounds 1 --variant raster
```

The benchmark alternates original/current process order between rounds. Each
process loads one implementation and warms each recipe with 12 additional
seeds. Timings include complete generation, but exclude loading, verification,
hashing and the separate diagnostic generation. Output hashes compare every
field except `meta.ms`, including scores, failed-attempt reasons and room/wall
ordering. A mismatch or invalid generated house fails the benchmark.

The recorded runs used a local `baseline` branch containing the original
source files; `baselineLabel` identifies the upstream commit, and the JSON
includes hashes of the four loaded source files. The smaller variant runs
separate placement work from raster work; they are exploratory samples rather
than the main 200-seed, three-round measurement.

Optional diagnostics are available without changing normal output:

```js
BR.SPACE.generate({ recipe: 'passage', seed: 7, profile: true }).meta.profile
```

Diagnostics report exact-check calls, room comparisons, cache hits, temporary
branch rollbacks and attempt/emission time. `fullScanRooms` is a hypothetical
unpruned comparison count for uncached checks, not measured original work.

## Correctness

`tests/space-output-fixture.json` contains original-output hashes for 468 cases:
all seven recipes; wrongness 0, 0.35 and 1 for route recipes; seeds 1–30 plus
zero, negative, large and unsigned boundary values. Only elapsed time is
excluded. Independent wall-pair checks also exercise 407 candidate rectangles,
negative coordinates, exact 0.15 m / 0.6 m gap boundaries, reserved ground,
long rooms spanning buckets, floor isolation and temporary-hall rollback.

Both room-first test files now run through the existing CI workflow:

```sh
node tests/run-all.js --full
```

The local full run passed all **441 checks across 24 files**. Exact-output
regressions retain the original generator's known fixed-lot failures; this
change optimizes generation rather than changing which houses can be built.

## Later room-relationship and mansion experiments

The measurements above apply to the archived placement solver. The later
`house.js` API enables a different relationship solver by default, and adds
three-floor mansions; those results are not covered by these speedup numbers.
`tools/benchmark-space.js` still loads the original four modules. Use
`relationships:false` in the full test-bed API to retain archived placement.
