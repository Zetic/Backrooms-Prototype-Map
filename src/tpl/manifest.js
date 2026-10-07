/*
 * tpl/manifest.js - STAND-IN asset manifest and style kits.
 *
 * In the real pipeline this file is exported from Unreal by an editor
 * utility: one entry per placeable asset with its footprint, height and
 * tags. Templates only ever reference assets through this manifest, so the
 * layout always matches what real assets can fill.
 *
 * Asset: { id, cat: 'prop'|'module'|'kit', tag, w, d, h (metres; w along the
 *          wall it backs onto, d into the room), styles: [...] or ['any'],
 *          low: true if it fits under a window, stretch: true if any length
 *          up to w works (counter runs), weight }
 *
 * Style kit: per room-type material slots (floor / wall / ceiling) plus door
 * and window styles. '*' is the fallback entry.
 */
(function (root) {
  'use strict';
  const BR = root.BR || (root.BR = {});

  const A = (id, cat, tag, w, d, h, styles, extra) =>
    Object.assign({ id, cat, tag, w, d, h, styles: styles || ['any'], low: h <= 1.0, weight: 1 }, extra || {});

  const ASSETS = [
    // bedrooms
    A('bed_single_01', 'prop', 'bed_single', 1.0, 2.0, 0.6),
    A('bed_double_01', 'prop', 'bed_double', 1.5, 2.0, 0.6),
    A('bed_double_brass', 'prop', 'bed_double', 1.5, 2.25, 1.1, ['cottage', 'ranch70s']),
    A('bed_king_01', 'prop', 'bed_king', 2.0, 2.25, 0.6),
    A('nightstand_01', 'prop', 'nightstand', 0.5, 0.5, 0.6),
    A('dresser_01', 'prop', 'dresser', 1.25, 0.5, 0.9),
    A('dresser_tall', 'prop', 'dresser', 1.0, 0.5, 1.4, ['any'], { low: false }),
    A('wardrobe_01', 'prop', 'wardrobe', 1.0, 0.75, 2.0),
    A('desk_01', 'prop', 'desk', 1.25, 0.75, 0.75),
    A('desk_small', 'prop', 'desk', 1.0, 0.5, 0.75),
    A('bookshelf_01', 'prop', 'bookshelf', 1.0, 0.5, 1.9),
    A('armchair_01', 'prop', 'armchair', 1.0, 1.0, 0.9),
    A('toybox_01', 'prop', 'toybox', 0.75, 0.5, 0.5),
    // living
    A('sofa_3_01', 'prop', 'sofa', 2.25, 1.0, 0.85),
    A('sofa_3_floral', 'prop', 'sofa', 2.25, 1.0, 0.9, ['cottage', 'ranch70s']),
    A('sofa_2_01', 'prop', 'sofa', 1.75, 1.0, 0.85),
    A('tv_unit_01', 'prop', 'tv_unit', 1.75, 0.5, 0.6),
    A('tv_crt_cabinet', 'prop', 'tv_unit', 1.25, 0.75, 0.9, ['ranch70s']),
    A('coffee_table_01', 'prop', 'coffee_table', 1.25, 0.75, 0.45),
    A('rug_01', 'prop', 'rug', 2.5, 2.0, 0.01),
    A('piano_upright', 'prop', 'piano', 1.5, 0.75, 1.3, ['cottage', 'ranch70s'], { weight: 0.3 }),
    A('fireplace_01', 'module', 'fireplace', 1.75, 0.75, 1.2, ['any'], { low: false }),
    // dining
    A('dining_table_4', 'prop', 'dining_table', 1.25, 1.0, 0.75),
    A('dining_table_6', 'prop', 'dining_table', 2.0, 1.0, 0.75),
    A('dining_chair_01', 'prop', 'chair', 0.5, 0.5, 0.9),
    A('sideboard_01', 'prop', 'sideboard', 1.5, 0.5, 0.9),
    // kitchen
    A('kitchen_run_std', 'module', 'counter_run', 4.5, 0.75, 0.9, ['any'], { stretch: true }),
    A('kitchen_run_retro', 'module', 'counter_run', 4.5, 0.75, 0.9, ['ranch70s'], { stretch: true }),
    A('fridge_01', 'prop', 'fridge', 0.75, 0.75, 1.8, ['any'], { low: false }),
    A('island_01', 'module', 'island', 2.0, 1.0, 0.9),
    A('island_small', 'module', 'island', 1.5, 0.75, 0.9),
    A('kitchen_table_2', 'prop', 'small_table', 1.0, 0.75, 0.75),
    // bath
    A('tub_01', 'prop', 'tub', 1.75, 0.75, 0.6),
    A('shower_01', 'prop', 'shower', 1.0, 1.0, 2.1, ['any'], { low: false }),
    A('toilet_01', 'prop', 'toilet', 0.5, 0.75, 0.8),
    A('vanity_01', 'prop', 'vanity', 1.0, 0.5, 0.9),
    A('vanity_double', 'prop', 'vanity', 1.5, 0.5, 0.9),
    // closets / storage
    A('closet_rod_01', 'module', 'closet_rod', 3.0, 0.5, 2.0, ['any'], { stretch: true, low: false }),
    A('shelves_01', 'module', 'shelves', 3.0, 0.5, 2.0, ['any'], { stretch: true, low: false }),
    // service
    A('washer_01', 'prop', 'washer', 0.75, 0.75, 0.9),
    A('dryer_01', 'prop', 'dryer', 0.75, 0.75, 0.9),
    A('utility_sink', 'prop', 'utility_sink', 0.75, 0.5, 0.9),
    A('bench_coat', 'prop', 'bench', 1.25, 0.5, 1.8, ['any'], { low: false }),
    A('water_heater', 'prop', 'water_heater', 0.75, 0.75, 1.6, ['any'], { low: false }),
    A('car_sedan', 'prop', 'car', 2.0, 4.75, 1.4),
    A('car_wagon', 'prop', 'car', 2.0, 5.0, 1.5, ['ranch70s', 'suburban90s']),
    A('workbench_01', 'prop', 'workbench', 2.0, 0.75, 0.9),
    A('boxes_01', 'prop', 'boxes', 1.0, 1.0, 1.2, ['any'], { low: false }),
    A('console_01', 'prop', 'console', 1.0, 0.5, 0.8),
    // outdoor
    A('porch_bench', 'prop', 'porch_bench', 1.5, 0.5, 0.9),
    A('patio_set_4', 'prop', 'patio_set', 2.0, 2.0, 0.8),
    A('grill_01', 'prop', 'grill', 1.0, 0.75, 1.1),
    A('tree_oak', 'prop', 'tree', 2.5, 2.5, 6),
    A('tree_small', 'prop', 'tree', 1.5, 1.5, 3.5),
    A('shrub_01', 'prop', 'shrub', 1.0, 1.0, 0.9),
    A('shed_01', 'module', 'shed', 2.5, 2.0, 2.4, ['any'], { low: false }),
    A('swingset_01', 'prop', 'swingset', 3.0, 2.0, 2.2, ['any'], { low: false }),
    // wrongness
    A('stairs_up_01', 'module', 'stairs_nowhere', 1.0, 3.0, 2.6, ['any'], { low: false }),
    A('door_false_01', 'kit', 'false_door', 1.0, 0.25, 2.1)
  ];

  const STYLES = {
    ranch70s: {
      name: '70s ranch', door: 'flush_wood', window: 'slider_alu', trim: 'wood_dark',
      floor: { living: 'shag_orange', family: 'shag_orange', bedroom: 'carpet_brown', master: 'carpet_brown', kitchen: 'linoleum_check',
        dining: 'parquet', bath: 'tile_avocado', ensuite: 'tile_avocado', laundry: 'linoleum', garage: 'concrete', hall: 'carpet_brown', '*': 'carpet_brown' },
      wall: { living: 'panel_wood', kitchen: 'wallpaper_fruit', bath: 'tile_avocado', ensuite: 'tile_avocado', garage: 'block_painted', '*': 'paint_cream' },
      ceiling: { '*': 'popcorn_white', garage: 'joists' }
    },
    suburban90s: {
      name: '90s suburban', door: 'panel_6', window: 'double_hung_white', trim: 'white',
      floor: { living: 'carpet_beige', family: 'carpet_beige', bedroom: 'carpet_beige', master: 'carpet_beige', kitchen: 'tile_beige', dining: 'oak',
        foyer: 'tile_beige', bath: 'tile_white', ensuite: 'tile_white', laundry: 'vinyl', garage: 'concrete', '*': 'carpet_beige' },
      wall: { bath: 'paint_white', ensuite: 'paint_white', kitchen: 'paint_eggshell', garage: 'drywall_raw', '*': 'paint_eggshell' },
      ceiling: { '*': 'drywall_white', garage: 'drywall_raw' }
    },
    cottage: {
      name: 'cottage', door: 'plank', window: 'casement_white', trim: 'white',
      floor: { kitchen: 'tile_terracotta', bath: 'hex_white', ensuite: 'hex_white', garage: 'concrete', '*': 'pine_boards' },
      wall: { living: 'wallpaper_floral', bedroom: 'wallpaper_stripe', bath: 'beadboard', kitchen: 'beadboard', '*': 'plaster_white' },
      ceiling: { '*': 'plaster_white', garage: 'joists' }
    }
  };

  function material(style, slot, type) {
    const S = STYLES[style] || STYLES.suburban90s, m = S[slot] || {};
    return m[type] || m['*'] || 'default';
  }

  /** Assets with this tag that fit (w <= maxW, d <= maxD) in this style, weighted pick. */
  function selectAsset(rng, tag, style, maxW, maxD) {
    const c = ASSETS.filter((a) => a.tag === tag && (a.styles.indexOf('any') >= 0 || a.styles.indexOf(style) >= 0) &&
      (maxW === undefined || a.w <= maxW + 1e-9 || a.stretch) && (maxD === undefined || a.d <= maxD + 1e-9));
    if (!c.length) return null;
    // prefer style-specific variants a little
    let tot = 0;
    const w = c.map((a) => { const v = a.weight * (a.styles.indexOf(style) >= 0 ? 1.5 : 1); tot += v; return v; });
    let r = rng.f() * tot;
    for (let i = 0; i < c.length; i++) { r -= w[i]; if (r < 0) return c[i]; }
    return c[c.length - 1];
  }
  function assetById(id) { return ASSETS.find((a) => a.id === id) || null; }

  BR.TPL_MANIFEST = { ASSETS, STYLES, material, selectAsset, assetById };
})(typeof window !== 'undefined' ? window : globalThis);
