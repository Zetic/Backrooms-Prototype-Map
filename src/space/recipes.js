/*
 * space/recipes.js - the room modules and house recipes of the reserved-floor
 * generator (space/space.js). Its own data, apart from the template engines
 * (src/tpl): a test bed for a new way of laying out houses.
 *
 * Every size here is CLEAR FLOOR, in metres: what you can stand on, walls
 * not included. Walls get their own space between rooms (space/space.js).
 *
 * A module is one kind of room:
 *   zone     public / private / service / circulation
 *   min      the narrowest a side may be (m)
 *   asp      the longest it may be for its width (long side / short side)
 *   area     default floor area range (m²), when a recipe gives none
 *   label    the name shown
 */
(function (root) {
  'use strict';
  const BR = root.BR, SP = BR.SPACE = BR.SPACE || {};

  SP.MODULES = {
    foyer: { zone: 'public', min: 1.8, asp: 2.5, area: [4, 7] },
    living: { zone: 'public', min: 3.4, asp: 2, area: [16, 24] },
    family: { zone: 'public', min: 3.4, asp: 2, area: [14, 20], label: 'family room' },
    dining: { zone: 'public', min: 2.8, asp: 2, area: [9, 13] },
    kitchen: { zone: 'public', min: 2.4, asp: 2.4, area: [9, 14] },
    office: { zone: 'private', min: 2.4, asp: 2, area: [7, 10] },
    bedroom: { zone: 'private', min: 2.8, asp: 1.8, area: [9, 13] },
    master: { zone: 'private', min: 3.2, asp: 1.8, area: [13, 18], label: 'master bedroom' },
    bath: { zone: 'private', min: 1.6, asp: 2.5, area: [4, 6], label: 'bathroom' },
    ensuite: { zone: 'private', min: 1.6, asp: 2.5, area: [4, 6] },
    wic: { zone: 'private', min: 1.4, asp: 3, area: [3, 5], label: 'walk-in closet' },
    linen: { zone: 'private', min: 0.9, asp: 2.5, area: [0.8, 1.4], label: 'linen closet' },
    laundry: { zone: 'service', min: 1.6, asp: 2.5, area: [3.5, 6] },
    mudroom: { zone: 'service', min: 1.6, asp: 2.5, area: [3, 5] },
    pantry: { zone: 'service', min: 1.0, asp: 3, area: [1.5, 3] },
    utility: { zone: 'service', min: 1.4, asp: 3, area: [3, 5], label: 'storage' },
    garage: { zone: 'service', min: 3.0, asp: 2.4, area: [18, 40] },
    hall: { zone: 'circulation', min: 1.1, asp: 99, label: 'hallway' }
  };

  // Which rooms open into which, and how. kind: door | opening | open (no
  // wall at all) | hall (an opening as wide as the hallway). w: clear width (m).
  SP.LINKS = {
    'bedroom|hall': { kind: 'door', w: 0.9 }, 'hall|master': { kind: 'door', w: 0.9 }, 'bath|hall': { kind: 'door', w: 0.8 },
    'hall|linen': { kind: 'door', w: 0.6 }, 'hall|office': { kind: 'door', w: 0.9 }, 'hall|laundry': { kind: 'door', w: 0.9 }, 'hall|utility': { kind: 'door', w: 0.8 },
    'foyer|hall': { kind: 'hall' }, 'hall|living': { kind: 'hall' }, 'dining|hall': { kind: 'hall' }, 'family|hall': { kind: 'hall' }, 'hall|kitchen': { kind: 'hall' },
    'foyer|living': { kind: 'opening', w: [1.2, 2] }, 'dining|foyer': { kind: 'opening', w: [1, 1.6] }, 'foyer|office': { kind: 'door', w: 0.9 },
    'dining|living': { kind: 'plan', w: [1.6, 2.8] }, 'kitchen|living': { kind: 'plan', w: [1.2, 2.4] }, 'dining|kitchen': { kind: 'plan', w: [1.2, 2.4] }, 'family|kitchen': { kind: 'plan', w: [1.6, 3] },
    'family|living': { kind: 'opening', w: [1.2, 2] }, 'dining|family': { kind: 'opening', w: [1.2, 2] },
    'kitchen|pantry': { kind: 'door', w: 0.8 }, 'kitchen|laundry': { kind: 'door', w: 0.8 }, 'kitchen|mudroom': { kind: 'opening', w: [0.9, 1.2] },
    'laundry|mudroom': { kind: 'opening', w: [0.9, 1.2] }, 'kitchen|utility': { kind: 'door', w: 0.8 }, 'laundry|utility': { kind: 'door', w: 0.8 },
    'ensuite|master': { kind: 'door', w: 0.8 }, 'master|wic': { kind: 'opening', w: [0.8, 1] }, 'ensuite|wic': { kind: 'door', w: 0.8 }, 'living|office': { kind: 'door', w: 0.9 }
  };
  // the garage's door into the house, best first
  SP.GARAGE_INTO = ['mudroom', 'laundry', 'utility', 'kitchen', 'pantry', 'dining', 'family', 'foyer'];

  /**
   * House recipes. site: lot size range (m, w along the street). plans:
   * weights. rooms: per type a count (n, or p for a chance) and an area range
   * (m², clear). hall: hallway clear width range (m). garage: chance, cars.
   */
  SP.RECIPES = {
    ranch: {
      name: 'Ranch', site: { w: [25, 34], h: [13, 22] }, plans: { bar: 4, deep: 1 },
      rooms: {
        foyer: { p: 0.7, area: [4, 6] }, living: { area: [18, 24] }, dining: { p: 0.8, area: [9, 12] }, kitchen: { area: [10, 14] },
        family: { p: 0.25, area: [14, 18] }, laundry: { p: 0.8, area: [3.5, 5] }, utility: { p: 0.5, area: [3, 5] }, pantry: { p: 0.3, area: [1.5, 2.5] },
        master: { area: [13, 17], ensuite: 0.55, wic: 0.45 }, bedroom: { n: [2, 3], area: [9, 12] }, bath: { area: [4.5, 6] },
        linen: { p: 0.5, area: [0.8, 1.2] }, office: { p: 0.15, area: [7, 9] }
      },
      hall: [1.1, 1.3], garage: { p: 0.75, cars: [1, 2] }, openPlan: 0.35, backDoor: 0.6
    },
    bungalow: {
      name: 'Bungalow', site: { w: [11, 14.5], h: [14, 20] }, plans: { deep: 4, bar: 1 },
      rooms: {
        living: { area: [14, 20] }, dining: { p: 0.5, area: [8, 10] }, kitchen: { area: [8, 11] }, laundry: { p: 0.4, area: [3, 4] },
        master: { area: [11, 14], ensuite: 0.1, wic: 0.1 }, bedroom: { n: [1, 2], area: [8.5, 11] }, bath: { area: [4, 5] }, linen: { p: 0.3, area: [0.8, 1.2] }
      },
      hall: [1.1, 1.2], garage: { p: 0.15, cars: [1, 1] }, openPlan: 0.5, backDoor: 0.7
    },
    cottage: {
      name: 'Cottage', site: { w: [9, 12], h: [12.5, 16] }, plans: { deep: 3, bar: 1 },
      rooms: {
        living: { area: [12, 16] }, kitchen: { area: [6.5, 9] }, dining: { p: 0.3, area: [6, 8] },
        master: { area: [9, 11], wic: 0.1 }, bedroom: { n: [0, 1], area: [7.5, 9] }, bath: { area: [3.5, 4.5] }, linen: { p: 0.3, area: [0.8, 1.2] }
      },
      hall: [1.1, 1.15], garage: null, openPlan: 0.6, backDoor: 0.6
    },
    suburban: {
      name: 'Suburban family house', site: { w: [33, 42], h: [14, 24] }, plans: { bar: 1 },
      rooms: {
        foyer: { p: 0.85, area: [5, 8] }, living: { area: [20, 28] }, dining: { p: 0.9, area: [11, 14] }, kitchen: { area: [12, 16] },
        family: { p: 0.6, area: [16, 22] }, laundry: { p: 0.9, area: [4, 6] }, mudroom: { p: 0.5, area: [3.5, 5] }, pantry: { p: 0.5, area: [2, 3] },
        master: { area: [15, 20], ensuite: 0.85, wic: 0.8 }, bedroom: { n: [3, 4], area: [10, 13] }, bath: { n: [1, 2], area: [5, 7] },
        office: { p: 0.35, area: [8, 11] }, linen: { p: 0.5, area: [0.8, 1.2] }
      },
      hall: [1.2, 1.4], garage: { p: 0.95, cars: [2, 2] }, openPlan: 0.4, backDoor: 0.6
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
