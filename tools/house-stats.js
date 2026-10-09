// How well the house engine lays out houses, over many seeds.
//
//   node tools/house-stats.js              60 seeds per house type
//   node tools/house-stats.js --seeds 200
//
// Per house type: how many seeds build, the mean score and the biggest
// penalties, and the layout checks below. Widths are the short side of a
// room's largest rect, centre line to centre line, in metres.
//   cut off     rooms that cannot be reached from the front door without
//               going outside (e.g. a garage wing reached only by the garage
//               door)
//   front door  houses with a foyer whose front door opens into it
//   deep strip  closets, linen closets and bathrooms at most 1.5 m wide but
//               more than 2 m deep (they read as dead-end corridors)
const path = require('node:path');
const { BR } = require(path.join(__dirname, '..', 'tests', 'helpers'));
const arg = (k, d) => { const a = process.argv.indexOf(k); return a >= 0 ? process.argv[a + 1] : d; };
const N = +arg('--seeds', 60);
const TYPES = ['ranch', 'bungalow', 'cottage', 'split_ranch', 'suburban', 'two_storey', 'townhouse'];
const med = (a) => { if (!a.length) return NaN; a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
const big = (rm) => rm.rects.reduce((b, r) => ((r[2] - r[0]) * (r[3] - r[1]) > (b[2] - b[0]) * (b[3] - b[1]) ? r : b), rm.rects[0]);
const short = (r) => Math.min(r[2] - r[0], r[3] - r[1]), long = (r) => Math.max(r[2] - r[0], r[3] - r[1]);

function inside(b) {
  // rooms reached from the front door's room through the house, never outside
  const main = b.portals.find((p) => p.main), op = main && b.openings.find((o) => o.id === main.opening);
  const start = op && op.rooms.find(Boolean);
  const adj = new Map();
  for (const [a, c] of b.graph.edges) if (a !== 'outside' && c !== 'outside') {
    if (!adj.has(a)) adj.set(a, []); if (!adj.has(c)) adj.set(c, []);
    adj.get(a).push(c); adj.get(c).push(a);
  }
  for (const v of b.verticals || []) for (let k = 1; k < v.rooms.length; k++) {
    const a = v.rooms[k - 1], c = v.rooms[k];
    if (!adj.has(a)) adj.set(a, []); if (!adj.has(c)) adj.set(c, []);
    adj.get(a).push(c); adj.get(c).push(a);
  }
  const seen = new Set(start ? [start] : []), st = start ? [start] : [];
  while (st.length) { const u = st.pop(); for (const v of adj.get(u) || []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
  return { start, seen };
}

const rows = [];
for (const id of TYPES) {
  const s = { id, built: 0, ms: 0, pen: 0, terms: {}, cutOff: 0, foyer: 0, foyerDoor: 0, deep: 0, windows: 0, hall: [], bath: [], bedroom: [] };
  for (let k = 1; k <= N; k++) {
    const t0 = performance.now(), b = BR.TPL.generate({ archetype: id, seed: k * 7919 });
    s.ms += performance.now() - t0;
    if (b.error) continue;
    s.built++;
    s.pen += b.meta.penalty || 0;
    for (const [t, v] of Object.entries(b.meta.terms || {})) s.terms[t] = (s.terms[t] || 0) + v;
    const { start, seen } = inside(b);
    if (b.rooms.some((rm) => !seen.has(rm.id))) s.cutOff++;
    if (b.rooms.some((rm) => rm.type === 'foyer' && !rm.level)) { s.foyer++; if (start && b.rooms.find((rm) => rm.id === start).type === 'foyer') s.foyerDoor++; }
    for (const rm of b.rooms) {
      const r = big(rm);
      if (['closet', 'linen', 'bath', 'ensuite', 'pantry'].includes(rm.type) && short(r) <= 1.5 && long(r) > 2) s.deep++;
      if (rm.type === 'hall') s.hall.push(short(r));
      if (rm.type === 'bath' || rm.type === 'ensuite') s.bath.push(short(r));
      if (rm.type === 'bedroom') s.bedroom.push(short(r));
    }
    s.windows += b.openings.filter((o) => o.kind === 'window').length;
  }
  rows.push(s);
}
console.log('house type    built  ms   score  cut off  foyer door  deep strips  hall  bath  bedroom  windows  biggest penalties');
for (const s of rows) {
  const n = s.built || 1, top = Object.entries(s.terms).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + ' ' + (v / n).toFixed(1)).join(', ');
  console.log(s.id.padEnd(12), (s.built + '/' + N).padStart(6), (s.ms / N).toFixed(1).padStart(5), (100 - s.pen / n).toFixed(1).padStart(6),
    String(s.cutOff).padStart(7), (s.foyer ? s.foyerDoor + '/' + s.foyer : '-').padStart(11), String(s.deep).padStart(12),
    med(s.hall).toFixed(1).padStart(5), med(s.bath).toFixed(1).padStart(5), med(s.bedroom).toFixed(1).padStart(8), String(s.windows).padStart(8), ' ' + top);
}
