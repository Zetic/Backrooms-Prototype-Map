/*
 * Park archetypes - recipes for the Park engine (pure data).
 *
 * site: canonical metres (w along the entrance side, h going back).
 * building: { p (chance of one), templates (by weight: any template that fits
 *   a block of the park), margin (m of park kept round it) }.
 * playground: { w, d } its size (m). path: path width; cross: chance of a
 *   cross path. exits: chances of a way out at the far end (far) and at each
 *   end of the cross path (side). gate: opening width (m).
 * pillars: { p (chance of any), every (grid spacing), size, pad (m) }.
 * seats: how many bench spots. ceiling: the hall's (m).
 * vertical: preferred connection types (a long ramp first: the park is big enough).
 * floors: the pit (wrongness) is a real sunken floor, with steps down into it.
 */
(function (root) {
  'use strict';
  const TPL = root.BR.TPL;

  TPL.registerArchetype({
    id: 'park', engine: 'park', name: 'Indoor park', category: 'park', rarity: 'uncommon', weight: 0.8,
    blurb: 'A hall laid out as a park: lawns crossed by tiled paths, a playground, pillars on tile pads, and sometimes a small building built by its own template.',
    site: { w: [28, 44], h: [24, 38] },
    building: { p: 0.6, templates: { restroom: 3, storage_room: 1, bungalow: 1 }, margin: [2, 3] },
    playground: { w: [7, 11], d: [6, 10] },
    path: [2, 3], cross: 0.7, exits: { far: 0.4, side: 0.35 }, gate: [2, 3.5],
    pillars: { p: 0.75, every: [8, 11], size: [0.8, 1.5], pad: [2.5, 3.5] },
    seats: [1, 4],
    ceiling: [4.5, 7],
    vertical: { prefer: ['ramp', 'stair', 'ladder'] },
    floors: { sunken: { zones: ['pit'], depth: [0.6, 1.25] } },
    wrongness: 0.15
  });
})(typeof window !== 'undefined' ? window : globalThis);
