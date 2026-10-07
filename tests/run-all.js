// Every check, dependency-free: node tests/run-all.js
const { spawnSync } = require('node:child_process'), path = require('node:path');
const run = (file, args, title) => {
  console.log('\n' + title);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)].concat(args || []), { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
};
run('templates.test.js', [], 'templates');
run('catalogue.test.js', [], 'catalogue (every room and zone, alone; pools)');
run('neighborhood.test.js', [], 'neighborhood (templates inside a template)');
run('park.test.js', [], 'park (a hall tiled by zones)');
run('fillers.test.js', [], 'fillers');
run('architectural.test.js', [], 'architectural curves (constant radii and radial layouts)');
run('elevation.test.js', [], 'elevation (surfaces, vertical fills, capabilities and reservations)');
run('elevation-ui.test.js', [], 'elevation lab controller');
run('seams.test.js', [], 'seams (shared walls between blueprints)');
for (const seed of ['31337', '7', '12345', '99', '4242']) run('world.test.js', [seed], 'world: seed ' + seed);
run('ui-smoke.test.js', [], 'map page');
console.log('\nAll template, catalogue, neighborhood, park, filler, architectural geometry, elevation, seam, world (5 seeds) and page checks passed.');
