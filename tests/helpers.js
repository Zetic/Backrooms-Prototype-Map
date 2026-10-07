// Shared test setup: loads the generator into globalThis.BR.
const path = require('node:path');
for (const f of ['core', 'tpl/grid', 'tpl/framework', 'tpl/house', 'tpl/room', 'tpl/composite', 'tpl/neighborhood', 'tpl/archetypes/house', 'tpl/archetypes/room', 'tpl/archetypes/neighborhood',
  'tpl/fillers/engine', 'tpl/fillers/kit', 'tpl/fillers/pool', 'tpl/fillers/corridors', 'tpl/fillers/halls', 'tpl/fillers/rooms', 'tpl/lot', 'poi', 'world', 'seams'])
  require(path.join(__dirname, '..', 'src', f + '.js'));
const BR = globalThis.BR;

/** connected components of an undirected graph: { labels: Map, sizes: [] } */
function components(nodes, edges) {
  const adj = new Map([...nodes].map((k) => [k, []]));
  for (const [a, b] of edges) if (adj.has(a) && adj.has(b)) { adj.get(a).push(b); adj.get(b).push(a); }
  const labels = new Map(), sizes = [];
  for (const k of adj.keys()) if (!labels.has(k)) {
    const stack = [k], c = sizes.length;
    labels.set(k, c);
    let count = 0;
    while (stack.length) { const u = stack.pop(); count++; for (const v of adj.get(u)) if (!labels.has(v)) { labels.set(v, c); stack.push(v); } }
    sizes.push(count);
  }
  return { labels, sizes };
}

function harness() {
  let failures = 0;
  return {
    check(name, ok, detail = '') { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : '')); if (!ok) failures++; },
    finish() { console.log(failures ? failures + ' checks failed' : 'All checks passed.'); process.exitCode = failures ? 1 : 0; }
  };
}

module.exports = { BR, components, harness };
