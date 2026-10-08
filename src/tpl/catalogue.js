/*
 * tpl/catalogue.js - what every room and every zone *is*, in one place.
 *
 * A kitchen is a kitchen wherever it turns up: in a house, in a motel, or
 * alone in the backrooms. This catalogue holds only what is true of the room
 * itself: its tags (what a prop pass reads), its default zone (public /
 * private / service / circulation), its smallest width and longest
 * proportion, a default floor area, a ceiling range and a label. How a room
 * behaves in a particular template - which room it opens off, how private it
 * is, whether it wants a window to the outside, that a closet in a house is
 * private - is that template's business: each engine takes the catalogue and
 * lays its own context over it (CAT.types).
 *
 * Zones (marked areas of a room's floor) are catalogued the same way.
 *
 * Every catalogued room and zone is also a template of its own, buildable
 * alone (archetypes/lone.js): `lone` says which pool it is in - `expected`
 * (what the backrooms are made of: closets, storage, utility, corridors) or
 * `weird` (out of place: a kitchen, a bedroom, a stall, a playground) - its
 * weight in that pool, and anything its lone template needs (site, door).
 *
 * Units: minW is in kit units (0.5 m), area in m², ceil in m.
 */
(function (root) {
  'use strict';
  const BR = root.BR, TPL = BR.TPL = BR.TPL || {};

  // ------------------------------------------------------------ rooms
  const ROOMS = {
    // living
    foyer: { zone: 'public', minW: 3, maxAsp: 3, area: [4, 7], ceil: [2.5, 2.9], tags: ['entry'], lone: { pool: 'weird' } },
    living: { zone: 'public', minW: 7, maxAsp: 2.2, area: [16, 26], ceil: [2.5, 2.9], tags: ['living', 'social'], lone: { pool: 'weird' } },
    family: { zone: 'public', minW: 7, maxAsp: 2.2, area: [14, 20], ceil: [2.4, 2.7], tags: ['living', 'social'], label: 'family room', lone: { pool: 'weird' } },
    dining: { zone: 'public', minW: 6, maxAsp: 2, area: [9, 13], ceil: [2.4, 2.7], tags: ['dining', 'social'], lone: { pool: 'weird' } },
    kitchen: { zone: 'public', minW: 5, maxAsp: 2.6, area: [9, 14], ceil: [2.4, 2.6], tags: ['kitchen', 'wet', 'cooking'], lone: { pool: 'weird' } },
    office: { zone: 'private', minW: 5, maxAsp: 2, area: [7, 10], ceil: [2.4, 2.6], tags: ['work'], lone: { pool: 'expected', weight: 0.5 } },
    // sleeping and washing
    bedroom: { zone: 'private', minW: 6, maxAsp: 2, area: [9, 13], ceil: [2.4, 2.6], tags: ['sleeping', 'private'], lone: { pool: 'weird' } },
    master: { zone: 'private', minW: 7, maxAsp: 2, area: [13, 18], ceil: [2.4, 2.8], tags: ['sleeping', 'private', 'primary'], label: 'master bedroom', lone: { pool: 'weird', weight: 0.6 } },
    bath: { zone: 'private', minW: 3, maxAsp: 3, area: [4, 6], ceil: [2.3, 2.5], tags: ['bathroom', 'wet', 'private'], label: 'bathroom', lone: { pool: 'weird' } },
    ensuite: { zone: 'private', minW: 3, maxAsp: 3, area: [4, 6], ceil: [2.3, 2.5], tags: ['bathroom', 'wet', 'private', 'ensuite'], lone: { pool: 'weird', weight: 0.5 } },
    cell: { zone: 'private', minW: 3, maxAsp: 3, ceil: [2.4, 2.6], tags: ['sleeping', 'cell'], lone: { pool: 'weird', site: { w: [2, 3], h: [2.5, 3.5] } } },
    // storage
    closet: { zone: 'service', minW: 2, maxAsp: 4, ceil: [2.2, 2.4], tags: ['storage', 'closet'], lone: { template: 'closet' } },
    wic: { zone: 'private', minW: 3, maxAsp: 4, area: [3, 5], ceil: [2.3, 2.4], tags: ['storage', 'closet', 'walk-in'], label: 'walk-in closet', lone: { pool: 'weird', weight: 0.6 } },
    linen: { zone: 'private', minW: 2, maxAsp: 8, area: [1, 2], ceil: [2.3, 2.4], tags: ['storage', 'closet'], label: 'linen closet', lone: { pool: 'expected', weight: 0.3, site: { w: [1, 1.5], h: [1, 1.5] } } },
    pantry: { zone: 'service', minW: 2, maxAsp: 4, area: [1.5, 3], ceil: [2.4, 2.5], tags: ['storage', 'food'], lone: { pool: 'weird', weight: 0.6 } },
    storage: { zone: 'service', minW: 4, maxAsp: 3, ceil: [2.4, 3.2], tags: ['storage'], label: 'storage room', lone: { template: 'storage_room' } },
    utility: { zone: 'service', minW: 3, maxAsp: 4.5, area: [3, 6], ceil: [2.4, 2.5], tags: ['storage', 'mechanical'], label: 'storage', lone: { pool: 'expected', weight: 0.6 } },
    unit: { zone: 'private', minW: 3, maxAsp: 3.5, ceil: [2.4, 3], tags: ['storage', 'unit'], label: 'unit', lone: { pool: 'expected', weight: 0.4, site: { w: [2.5, 3.5], h: [2.5, 4] }, door: 'vehicle', doorW: 2.5 } },
    // service
    laundry: { zone: 'service', minW: 4, maxAsp: 3, area: [3.5, 6], ceil: [2.4, 2.5], tags: ['laundry', 'wet', 'utility'], lone: { pool: 'expected', weight: 0.4 } },
    mudroom: { zone: 'service', minW: 3, maxAsp: 3.5, area: [3, 5], ceil: [2.4, 2.5], tags: ['entry', 'storage'], lone: { pool: 'weird', weight: 0.5 } },
    janitor: { zone: 'service', minW: 2, maxAsp: 3, ceil: [2.4, 2.5], tags: ['storage', 'wet', 'utility'], label: 'janitor closet', lone: { pool: 'expected', weight: 0.6, site: { w: [1.5, 2.5], h: [1.5, 2.5] } } },
    mechanical: { zone: 'service', minW: 3, maxAsp: 5, ceil: [2.6, 3.6], tags: ['mechanical', 'utility'], label: 'mechanical room', lone: { template: 'mechanical' } },
    garage: { zone: 'service', minW: 7, maxAsp: 2.6, ceil: [2.6, 2.8], tags: ['vehicle', 'storage', 'unfinished'], lone: { pool: 'weird', weight: 0.6, site: { w: [4, 6.5], h: [5.5, 7] }, door: 'vehicle', doorW: 2.5 } },
    // public washrooms
    restroom: { zone: 'public', minW: 3, maxAsp: 4, ceil: [2.4, 2.7], tags: ['bathroom', 'wet', 'public'], lone: { pool: 'expected', weight: 0.4, site: { w: [2.5, 4], h: [2, 3] } } },
    stall: { zone: 'private', minW: 2, maxAsp: 3, ceil: [2.4, 2.7], tags: ['bathroom', 'wet', 'stall'], lone: { pool: 'weird', site: { w: [1, 1.5], h: [1.5, 2] } } },
    // circulation
    hall: { zone: 'circulation', minW: 2, maxAsp: 99, ceil: [2.4, 2.5], tags: ['circulation'], label: 'hallway', lone: { pool: 'expected', weight: 0.5, site: { w: [1, 1.5], h: [5, 9] } } },
    corridor: { zone: 'circulation', minW: 2, maxAsp: 99, ceil: [2.4, 2.7], tags: ['circulation'], lone: { pool: 'expected', weight: 0.5, site: { w: [1.5, 2], h: [6, 12] }, exit: 0.6 } },
    vestibule: { zone: 'circulation', minW: 2, maxAsp: 4, ceil: [2.4, 2.7], tags: ['entry', 'circulation'], lone: { pool: 'expected', weight: 0.4, site: { w: [2, 3], h: [1.5, 2.5] }, exit: 0.8 } },
    // floors at other heights (no lone templates: each exists only beside the floor it changes from)
    stairwell: { zone: 'circulation', minW: 4, maxAsp: 3, ceil: [2.4, 2.6], tags: ['circulation', 'stair', 'vertical'] },
    sunken: { zone: 'public', minW: 4, ceil: [2.5, 3], tags: ['sunken', 'floor change'], label: 'sunken floor' },
    gallery: { zone: 'circulation', minW: 4, ceil: [2.2, 4], tags: ['gallery', 'mezzanine', 'overlook', 'floor change'] },
    undercroft: { zone: 'circulation', minW: 4, ceil: [2.2, 3.5], tags: ['under gallery', 'circulation'], label: 'under the gallery' },
    // outdoors, indoors
    street: { zone: 'circulation', minW: 12, ceil: [9, 14], tags: ['street', 'road', 'outdoor', 'hall'], lone: { pool: 'weird', weight: 0.5, site: { w: [6, 7.5], h: [12, 20] }, door: 'opening', doorW: 3, exit: 1 } },
    front_yard: { zone: 'public', ceil: [9, 14], tags: ['yard', 'front yard', 'outdoor'], label: 'front yard', lone: { pool: 'weird', weight: 0.5, site: { w: [5, 7.5], h: [3, 6] }, door: 'opening', doorW: 2 } },
    vacant_lot: { zone: 'public', ceil: [9, 14], tags: ['yard', 'vacant', 'outdoor'], label: 'empty lot', lone: { pool: 'weird', weight: 0.4, site: { w: [5, 7.5], h: [6, 10] }, door: 'opening', doorW: 2 } },
    park: { zone: 'public', minW: 16, ceil: [4.5, 7], tags: ['park', 'outdoor', 'hall'], lone: { template: 'park' } },
    patch: { zone: 'public', ceil: [2.5, 4], tags: ['outdoor', 'lone'], label: 'patch' }
  };

  // ------------------------------------------------------------ zones
  // routes: a stair or ramp may be built on this zone (lawn); every other zone
  // is kept clear of them (paths, playgrounds, pads, seating, pits). A zone
  // that is the whole of a sunken floor (the park's pit, once sunk) takes the
  // steps down into it (connections.js, linkFloors).
  const ZONES = {
    lawn: { label: 'lawn', tags: ['grass', 'soft'], routes: true, lone: { pool: 'weird', weight: 0.6, site: { w: [4, 7.5], h: [4, 7.5] } } },
    path: { label: 'path', tags: ['tile', 'walkway'], lone: { pool: 'weird', weight: 0.4, site: { w: [2, 3], h: [6, 12] }, exit: 0.8 } },
    plaza: { label: 'plaza', tags: ['tile'], lone: { pool: 'weird', weight: 0.4, site: { w: [3, 6], h: [3, 6] } } },
    playground: { label: 'playground', tags: ['play', 'equipment'], lone: { pool: 'weird', weight: 1, site: { w: [5, 7.5], h: [5, 7.5] } } },
    seating: { label: 'seating', tags: ['bench'], lone: { pool: 'weird', weight: 0.6, site: { w: [2, 3], h: [1.5, 2.5] } } },
    pit: { label: 'pit', tags: ['hazard', 'drop', 'wrong:pit'], lone: { pool: 'weird', weight: 0.5, site: { w: [2, 4], h: [2, 4] } } }
  };

  // ------------------------------------------------------------ vertical connections
  // What a ladder, a stair and a ramp are, wherever they turn up (elevation
  // layer, tpl/connections.js). No steps, rails or meshes: the area a route
  // needs, its width, its slope and the headroom over it.
  //   width      the width a generator builds (m); minWidth what validation accepts
  //   slope      rise / run accepted [min, max]; design the slope generators build
  //   clearance  headroom over every point of the route (m)
  //   landing    flat floor at each end of a flight (m, along the route)
  //   rise       the smallest change in height worth the type (m)
  const CONNECTIONS = {
    ladder: { label: 'ladder', tags: ['vertical', 'ladder', 'hatch'], width: 0.5, minWidth: 0.5, clearance: 1.8, rise: 3 },
    stair: { label: 'stair', tags: ['vertical', 'stair'], width: 1, minWidth: 0.9, slope: [0.45, 0.84], design: 0.7, clearance: 2, landing: 1, rise: 1 },
    ramp: { label: 'ramp', tags: ['vertical', 'ramp'], width: 1.5, minWidth: 1.2, slope: [0, 0.25], design: 0.25, clearance: 2, landing: 1.5, rise: 0.5 }
  };

  /**
   * A template's own table of room (or zone) types: the catalogue's entry for
   * each type named, with the template's context laid over it. `types` is a
   * list of names or true for every catalogued type; `context` maps a type to
   * the fields that template adds or changes (privacy, a window rule, a
   * different zone or ceiling for a room in that setting).
   */
  function types(list, context, table) {
    const src = table || ROOMS, names = list === true ? Object.keys(src) : list, out = {};
    for (const t of names) {
      if (!src[t]) throw new Error('not in the catalogue: ' + t);
      const e = Object.assign({}, src[t], (context || {})[t] || {});
      delete e.lone;
      out[t] = e;
    }
    for (const t of Object.keys(context || {})) if (!out[t]) out[t] = Object.assign({}, context[t]);
    return out;
  }

  TPL.CAT = { ROOMS, ZONES, CONNECTIONS, types, zones: (list, context) => types(list, context, ZONES) };
})(typeof window !== 'undefined' ? window : globalThis);
