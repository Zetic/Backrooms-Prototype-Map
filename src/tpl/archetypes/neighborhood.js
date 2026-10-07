/*
 * Neighborhood archetypes - recipes for the Neighborhood engine (pure data).
 *
 * A neighborhood is made of other templates: `houses` names the house
 * recipes that line its street (by weight) and `child` is laid over each of
 * them before it is built, so the house template is reused as it is, with
 * only what the setting needs changed.
 *
 * site: the allowance (canonical metres: w across the hall, h along the
 *   street from the entrance to the far end).
 * street: street width (m); row: the depth of each row of lots the street is
 *   sized round; rowMin: the shallowest row worth trying.
 * apron: the least yard in front of a house; yardMax: the most, once the house
 *   is pushed back against the hall wall.
 * gap: between neighbouring lots; perSide: most houses on each side.
 * mouth / farEnd: clear stretch at the entrance end / the far end.
 * gate / gateKind: the entrance; farExit / farWidth / farKind: a way out at
 *   the far end, by chance.
 * ceiling: the hall's ceiling over the street and yards.
 */
(function (root) {
  'use strict';
  const TPL = root.BR.TPL;

  TPL.registerArchetype({
    id: 'neighborhood', engine: 'neighborhood', name: 'Neighborhood hall', category: 'neighborhood', rarity: 'rare', weight: 1,
    blurb: 'A street down a huge hall, houses lined up on both sides facing it. Each house is built by its own house template.',
    site: { w: [40, 52], h: [40, 64] },
    houses: { bungalow: 3, ranch: 3, suburban: 1 },
    child: { backDoor: 0, sideDoor: 0, wrongness: 0.08 },
    street: [8, 14], row: [12, 16], rowMin: 9,
    apron: [2, 3.5], yardMax: 6,
    gap: [1, 2.5], perSide: 4,
    mouth: [2, 6], farEnd: [0, 1.5],
    gate: [3, 5], gateKind: { opening: 0.7, double: 0.3 },
    farExit: 0.5, farWidth: [1.5, 2.5], farKind: { door: 0.5, opening: 0.5 },
    ceiling: [9, 14],
    wrongness: 0.2
  });
})(typeof window !== 'undefined' ? window : globalThis);
