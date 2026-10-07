// Every check, dependency-free: node tests/run-all.js
const { spawnSync } = require('node:child_process'), path = require('node:path');
const run = (file, args, title) => {
  console.log('\n' + title);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)].concat(args || []), { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
};
run('templates.test.js', [], 'templates');
run('fillers.test.js', [], 'fillers');
for (const seed of ['31337', '7', '12345', '99', '4242']) run('world.test.js', [seed], 'world: seed ' + seed);
run('ui-smoke.test.js', [], 'map page');
console.log('\nAll template, filler, world (5 seeds) and map page checks passed.');
