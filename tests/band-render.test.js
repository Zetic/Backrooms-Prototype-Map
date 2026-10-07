// Executes the real tile renderer with a canvas adapter; not browser layout QA.
const assert = require('node:assert/strict');
const { BR } = require('./helpers');
require('../src/tpl/render2d'); require('../src/tpl/elevation-view'); require('../src/render');
const g = () => new Proxy({ measureText: (s) => ({ width: s.length * 6 }) }, { get: (o, k) => k in o ? o[k] : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
globalThis.OffscreenCanvas = class { constructor() { this.context = g(); } getContext() { return this.context; } };
const original = BR.TPL.drawBuilding, calls = [];
BR.TPL.drawBuilding = (ctx, b, opts) => { calls.push({ b, opts }); original(ctx, b, opts); };
const w = new BR.BandWorld(7), p = w.transitionPlan(0, 0, 0), ctx = g();
const view = { cx: (p.rect[0] + p.rect[2]) / 2, cy: (p.rect[1] + p.rect[3]) / 2, zoom: 3, dpr: 1, w: 300, h: 260 };
function draw(band, floor, ghost = false) {
  w.setBand(band); calls.length = 0;
  const r = BR.draw(ctx, w, view, { labels: true, floor, ghost }, Infinity); assert(r.done);
  const own = calls.filter((c) => c.b.fillId === p.id);
  assert(own.length);
  if (!ghost) for (const c of own) assert.equal(c.b.levels.find((l) => l.index === c.opts.level)?.elevation, band * 16 + floor);
  return own;
}
draw(0, 0); draw(1, 0); draw(1, -4);
const ghost = draw(1, -4, true);
assert(new Set(ghost.map((c) => c.opts.level)).size > 1);
for (const key of ['|b0|f0|gfalse', '|b1|f0|gfalse', '|b1|f-4|gfalse', '|b1|f-4|gtrue']) assert([...w._tiles.map.keys()].some((s) => s.endsWith(key)));
// No actual room at +10; the real view still renders the ramp/void geometry.
calls.length = 0; BR.draw(ctx, w, view, { floor: -6, ghost: false }, Infinity);
assert(calls.filter((c) => c.b.fillId === p.id).every((c) => c.opts.level === -1));
assert(w._tiles.map.size <= 260);
BR.TPL.drawBuilding = original;
console.log('ok   actual renderer selects correct floor, handles ramp-only slices, ghosts shared floors and isolates band/floor tile caches');
