// Real tile renderer with a canvas adapter; browser layout is verified separately.
const assert = require('node:assert/strict');
const { BR } = require('./helpers');
require('../src/tpl/render2d'); require('../src/tpl/elevation-view'); require('../src/render');
const g = () => new Proxy({ globalAlpha: 1, measureText: (s) => ({ width: s.length * 6 }) }, { get: (o,k) => k in o ? o[k] : () => {}, set: (o,k,v) => { o[k]=v; return true; } });
globalThis.OffscreenCanvas = class { constructor() { this.context = g(); } getContext() { return this.context; } };
const original = BR.ELEV.drawCutaway, calls = [];
BR.ELEV.drawCutaway = (ctx,b,opts) => { calls.push({b,opts}); return original(ctx,b,opts); };
const w = new BR.BandWorld(7), ctx=g(), view={cx:0,cy:0,zoom:3,dpr:1,w:300,h:260};
function draw(band, cutZ, ghost=false, focus=null) {
  w.setBand(band); calls.length=0;
  assert(BR.draw(ctx,w,view,{labels:true,cutZ,ghost,focus},Infinity).done);
  assert(calls.length); assert(calls.every((c)=>c.opts.cutZ===cutZ && c.opts.baseZ===band*16));
  assert(calls.every((c)=>c.opts.ghost === (ghost && c.opts.focus)));
}
draw(0,0); draw(0,2.75);
assert(calls.every((c)=>BR.ELEV.cutawayPlan(c.b,2.75,0).visible.length),'normal rooms remain visible between floor heights');
const site = w.siteAt(0,0), r=w.build(site), focus=r.filler ? site.id : site.id+'/'+r.buildings[0].poi.id;
draw(0,2.75,true,focus); assert(calls.some((c)=>c.opts.ghost)); assert(calls.some((c)=>!c.opts.ghost));
draw(1,16); draw(1,18.125);
for(const key of ['|b0|h0|gfalse|s','|b0|h2.75|gfalse|s','|b0|h2.75|gtrue|s'+focus,'|b1|h16|gfalse|s','|b1|h18.125|gfalse|s']) assert([...w._tiles.map.keys()].some((s)=>s.endsWith(key)));
for(let k=0;k<90;k++) BR.draw(ctx,w,view,{cutZ:16+k/10},Infinity);
assert(w._tiles.map.size<=260,'continuous height retains bounded tile memory');
BR.ELEV.drawCutaway=original;
console.log('ok   cut heights, band offsets, selected-only ghosts and bounded tile caches');
