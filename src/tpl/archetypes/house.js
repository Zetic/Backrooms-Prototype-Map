/*
 * House archetypes - recipes for the House engine (pure data).
 *
 * site: the allowance the world should give, canonical metres (w along the
 *   main side, h going back). Houses use it almost to the edge.
 * rooms: { n: count or [min, max], p: probability it exists, area: [m², m²] };
 *   master also takes ensuite / wic probabilities.
 * plans: weights of the engine's plan types (bar, L, deep, split).
 * backDoor / sideDoor: chance of a back exit / a side exit.
 * windows: chance per window position (0 = none, 1 = every exterior wall that
 *   wants one).
 * wrongness: chance of liminal mutations (see the engine's MUTATIONS).
 * vertical: the connection types this template prefers, in order (elevation
 *   layer, tpl/connections.js); a type that does not fit falls through to the next.
 * floors: floor patterns laid on the finished house (tpl/floors.js), e.g. a
 *   sunken living room with steps down into it.
 * storeys: 2 or 3 (or [min, max]): the stack plan, public rooms below,
 *   bedrooms above, a stairwell up one side that the elevation layer fills
 *   with a real switchback stair.
 */
(function (root) {
  'use strict';
  const TPL = root.BR.TPL;

  TPL.registerArchetype({
    id: 'ranch', engine: 'house', name: 'Ranch', category: 'house', rarity: 'common', weight: 3,
    blurb: 'Single-storey bar or L, attached garage, bedrooms down a hallway.',
    site: { w: [20, 30], h: [11, 20] },
    plans: { bar: 3, L: 2 },
    depth: [8.5, 11],
    rooms: {
      foyer: { p: 0.5, area: [4, 6] },
      living: { area: [18, 26] },
      dining: { p: 0.8, area: [9, 12] },
      kitchen: { area: [9, 13] },
      family: { p: 0.25, area: [14, 18] },
      laundry: { p: 0.75, area: [3.5, 5] },
      pantry: { p: 0.3, area: [1.5, 2.5] },
      master: { area: [13, 17], ensuite: 0.55, wic: 0.45 },
      bedroom: { n: [2, 3], area: [9, 12] },
      bath: { area: [4.5, 6] },
      linen: { p: 0.4, area: [1, 1.5] },
      office: { p: 0.15, area: [7, 9] }
    },
    closets: 0.75,
    garage: { p: 0.75, cars: [1, 2], forward: [0, 2] },
    backDoor: 0.6, sideDoor: 0.25,
    openPlan: 0.35,
    hall: { w: [1, 1.2] },
    windows: 1,
    vertical: { prefer: ['stair', 'ladder'] },
    wrongness: 0.15
  });

  TPL.registerArchetype({
    id: 'bungalow', engine: 'house', name: 'Bungalow', category: 'house', rarity: 'common', weight: 2,
    blurb: 'Small house on a narrow, deep site: living up front, bedrooms behind.',
    site: { w: [8.5, 13], h: [13, 19] },
    plans: { deep: 4, bar: 1 },
    depth: [9, 12],
    rooms: {
      living: { area: [14, 20] },
      dining: { p: 0.5, area: [8, 10] },
      kitchen: { area: [8, 11] },
      laundry: { p: 0.4, area: [3, 4] },
      mudroom: { p: 0.2, area: [3, 4] },
      master: { area: [11, 14], ensuite: 0.1, wic: 0.1 },
      bedroom: { n: [1, 2], area: [8.5, 11] },
      bath: { area: [4, 5] },
      linen: { p: 0.3, area: [1, 1.5] }
    },
    closets: 0.6,
    garage: { p: 0.15, cars: [1, 1], forward: [0, 0] },
    backDoor: 0.7, sideDoor: 0.2,
    openPlan: 0.5,
    hall: { w: [1, 1] },
    windows: 1,
    vertical: { prefer: ['stair', 'ladder'] },
    wrongness: 0.15
  });

  TPL.registerArchetype({
    id: 'split_ranch', engine: 'house', name: 'Split-bedroom ranch', category: 'house', rarity: 'uncommon', weight: 1.2,
    blurb: 'Master suite at one end, the other bedrooms at the far end, living in between.',
    site: { w: [26, 34], h: [10, 13] },
    plans: { split: 4, bar: 1 },
    depth: [8.5, 10.5],
    rooms: {
      foyer: { p: 0.7, area: [4, 6] },
      living: { area: [20, 28] },
      dining: { p: 0.9, area: [10, 13] },
      kitchen: { area: [10, 14] },
      family: { p: 0.3, area: [14, 18] },
      laundry: { p: 0.8, area: [3.5, 5] },
      pantry: { p: 0.4, area: [1.5, 2.5] },
      master: { area: [14, 18], ensuite: 1, wic: 0.7 },
      bedroom: { n: [2, 3], area: [9.5, 12] },
      bath: { n: [1, 2], area: [4.5, 6] },
      office: { p: 0.3, area: [7, 10] },
      linen: { p: 0.5, area: [1, 1.5] }
    },
    closets: 0.8,
    garage: { p: 0 },
    backDoor: 0.7, sideDoor: 0.15,
    openPlan: 0.45,
    hall: { w: [1, 1.2] },
    windows: 1,
    vertical: { prefer: ['stair', 'ladder'] },
    wrongness: 0.15
  });

  TPL.registerArchetype({
    id: 'suburban', engine: 'house', name: 'Suburban family house', category: 'house', rarity: 'common', weight: 2,
    blurb: 'Bigger L or bar with a two-car garage, mudroom, family room and a full master suite.',
    site: { w: [26, 36], h: [12, 24] },
    plans: { L: 3, bar: 2 },
    depth: [9, 11.5],
    rooms: {
      foyer: { p: 0.8, area: [5, 8] },
      living: { area: [20, 28] },
      dining: { p: 0.9, area: [11, 14] },
      kitchen: { area: [12, 16] },
      family: { p: 0.6, area: [16, 22] },
      laundry: { p: 0.9, area: [4, 6] },
      mudroom: { p: 0.5, area: [3.5, 5] },
      pantry: { p: 0.5, area: [2, 3] },
      master: { area: [15, 20], ensuite: 0.85, wic: 0.8 },
      bedroom: { n: [3, 4], area: [10, 13] },
      bath: { n: [1, 2], area: [5, 7] },
      office: { p: 0.35, area: [8, 11] },
      linen: { p: 0.5, area: [1, 2] }
    },
    closets: 0.85,
    garage: { p: 0.95, cars: [2, 2], forward: [0, 3] },
    backDoor: 0.6, sideDoor: 0.35,
    openPlan: 0.4,
    hall: { w: [1, 1.5] },
    windows: 1,
    vertical: { prefer: ['stair', 'ladder'] },
    floors: { sunken: { p: 0.2, rooms: ['living', 'family'], size: [2.5, 4], depth: [0.3, 0.6] } },
    wrongness: 0.12
  });

  TPL.registerArchetype({
    id: 'two_storey', engine: 'house', grows: { biome: 'houseroom' }, name: 'Two-storey house', category: 'house', rarity: 'uncommon', weight: 0.9,
    blurb: 'Living rooms downstairs, bedrooms upstairs: a stairwell beside the front hall climbs to a landing hallway.',
    site: { w: [15, 22], h: [9, 12] },
    storeys: 2,
    depth: [8, 10],
    rooms: {
      foyer: { area: [4, 6] },
      living: { area: [16, 22] },
      dining: { p: 0.7, area: [9, 12] },
      kitchen: { area: [9, 12] },
      laundry: { p: 0.6, area: [3.5, 5] },
      pantry: { p: 0.3, area: [1.5, 2.5] },
      master: { area: [13, 16], ensuite: 0.6, wic: 0.4 },
      bedroom: { n: [2, 3], area: [9, 12] },
      bath: { area: [4.5, 6] },
      linen: { p: 0.4, area: [1, 1.5] }
    },
    closets: 0.75,
    garage: { p: 0.5, cars: [1, 1], forward: [0, 0] },
    backDoor: 0.6, sideDoor: 0.2,
    openPlan: 0.4,
    hall: { w: [1, 1.2] },
    windows: 1,
    vertical: { prefer: ['stair', 'ladder'] },
    floors: { sunken: { p: 0.25, rooms: ['living'], size: [2.5, 4], depth: [0.3, 0.6] } },
    wrongness: 0.12
  });

  TPL.registerArchetype({
    id: 'townhouse', engine: 'house', grows: { biome: 'houseroom' }, name: 'Townhouse', category: 'house', rarity: 'rare', weight: 0.3,
    blurb: 'Three narrow storeys: kitchen and living below, bedrooms on the first floor, the master suite and a study at the top of the stair.',
    site: { w: [11, 14], h: [11, 14] },
    storeys: 3,
    depth: [9, 11],
    rooms: {
      foyer: { area: [3.5, 5] },
      living: { area: [15, 20] },
      kitchen: { area: [9, 12] },
      dining: { p: 0.4, area: [8, 10] },
      laundry: { p: 0.5, area: [3, 4] },
      master: { area: [12, 15], ensuite: 0.8, wic: 0.5 },
      bedroom: { n: [1, 2], area: [9, 11] },
      bath: { area: [4.5, 5.5] },
      office: { p: 0.6, area: [6, 8] }
    },
    closets: 0.6,
    garage: { p: 0 },
    backDoor: 0.7, sideDoor: 0,
    openPlan: 0.5,
    hall: { w: [1, 1.2] },
    windows: 1,
    vertical: { prefer: ['stair', 'ladder'] },
    wrongness: 0.12
  });
})(typeof window !== 'undefined' ? window : globalThis);
