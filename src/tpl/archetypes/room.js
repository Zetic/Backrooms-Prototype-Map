/*
 * Room-engine archetypes: the small end of the POI range (pure data).
 * portals: [{ role: 'entrance'|'exit'|'both', kind: 'door'|'double'|'opening'|'vehicle' or weights { door: 0.6, double: 0.4 },
 *             side: 'S' (main) | 'back' | 'flank' | 'any', w (m), p (chance), clear (m) }]
 */
(function (root) {
  'use strict';
  const TPL = root.BR.TPL;

  TPL.registerArchetype({
    id: 'closet', engine: 'room', name: 'Closet', category: 'room', rarity: 'common', weight: 3,
    blurb: 'One small room with one door. The smallest POI.',
    layout: 'single', room: 'closet',
    site: { w: [1.5, 3], h: [1, 2.5] },
    portals: [{ role: 'both', kind: 'door', side: 'S', w: 1 }],
    vertical: { prefer: ['ladder'] },
    windows: 0, wrongness: 0.2
  });

  TPL.registerArchetype({
    id: 'storage_room', engine: 'room', name: 'Storage room', category: 'room', rarity: 'common', weight: 2,
    blurb: 'A plain storage room; sometimes double doors, sometimes a second way out.',
    layout: 'single', room: 'storage',
    site: { w: [3, 7], h: [3, 6] },
    portals: [{ role: 'both', kind: { door: 0.6, double: 0.4 }, side: 'S' }, { role: 'exit', kind: 'door', side: 'flank', p: 0.3 }],
    windows: 0, wrongness: 0.2
  });

  TPL.registerArchetype({
    id: 'restroom', engine: 'room', name: 'Public restroom', category: 'room', rarity: 'common', weight: 2,
    blurb: 'A vestibule, an open washroom and a row of stalls along the back wall.',
    layout: 'stalls', vestibule: 0.6, janitor: 0.4, stalls: [2, 6],
    site: { w: [4, 9], h: [4, 7] },
    portals: [{ role: 'both', kind: 'door', side: 'S', w: 1 }],
    windows: 0, wrongness: 0.2
  });

  TPL.registerArchetype({
    id: 'mechanical', engine: 'room', name: 'Mechanical room', category: 'room', rarity: 'uncommon', weight: 1,
    blurb: 'An L-shaped plant room; often a second door straight through to the far side.',
    layout: 'L', room: 'mechanical',
    site: { w: [5, 11], h: [4, 9] },
    portals: [{ role: 'entrance', kind: 'door', side: 'S', w: 1 }, { role: 'exit', kind: 'door', side: 'any', w: 1, p: 0.6 }],
    windows: 0, wrongness: 0.25
  });

  TPL.registerArchetype({
    id: 'storage_units', engine: 'room', name: 'Storage units', category: 'room', rarity: 'uncommon', weight: 1,
    blurb: 'A corridor from the entrance with lockable units either side and an exit at the far end.',
    layout: 'units', room: 'unit', corridor: 1.5, unit: [2, 3.5],
    site: { w: [6, 11], h: [8, 22] },
    portals: [{ role: 'entrance', kind: 'double', side: 'S', w: 1.5 }, { role: 'exit', kind: 'door', side: 'back', w: 1, p: 0.7 }],
    windows: 0, wrongness: 0.2
  });
})(typeof window !== 'undefined' ? window : globalThis);
