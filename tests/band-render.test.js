// Real tile renderer with a canvas adapter; browser layout is verified separately.
const assert = require('node:assert/strict');
const { BR } = require('./helpers');
require('../src/tpl/render2d'); require('../src/tpl/elevation-view'); require('../src/render');
const g = () => new Proxy({ globalAlpha: 1, measureText: (s) => ({ width: s.length * 6 }) }, { get: (o,k) => k in o ? o[k] : () => {}, set: (o,k,v) => { o[k]=v; return true; } });
globalThis.OffscreenCanvas = class { constructor() { this.context = g(); } getContext() { return this.context; } };
const original = BR.ELEV.drawCutaway, calls = [];
BR.ELEV.drawCutaway = (ctx,b,opts) => { calls.push({b,opts}); return original(ctx,b,opts); };
const w = new BR.BandWorld(7), ctx=g(), view={cx:0,cy:0,zoom:3,dpr:1,w:300,h:260};
function draw(band, cutZ, ghost=false, focus=null, at=null) {
  w.setBand(band); calls.length=0;
  assert(BR.draw(ctx,w,{...view,...(at?{cx:at[0],cy:at[1]}:{})},{labels:true,cutZ,ghost,focus},Infinity).done);
  // (a blueprint with absolute heights, a journey or a raised floor, is drawn from 0)
  assert(calls.length); assert(calls.every((c)=>c.opts.cutZ===cutZ && c.opts.baseZ===(c.b.schema===BR.ELEV.SCHEMA?0:band*16)));
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

// a raised claim (claims.js, band-world.js) is painted with the ground, at its
// own height: the same cut shows the ground below it and the branch above
{
  const v = new BR.BandWorld(7), B = v.branch(0,3,-2);
  assert(B && B.pit, 'the known branch is there');
  const rs = B.sites.find((s)=>s.id===B.pit.top.site), mid=[(rs.rects[0][0]+rs.rects[0][2])/2,(rs.rects[0][1]+rs.rects[0][3])/2];
  const shot = (cutZ) => { calls.length=0; let done=false; for (let k=0;k<4&&!done;k++) done=BR.draw(ctx,v,{cx:mid[0],cy:mid[1],zoom:3,dpr:1,w:300,h:260},{labels:true,cutZ},Infinity).done; assert(done); return calls.map((c)=>c.b); };
  const raisedPainted = (list) => list.some((b)=>String(b.fillId).startsWith('branch:'));
  const groundFiller = v.build(v.site(B.over[0])).filler;
  const low = shot(0), high = shot(B.floorZ);
  assert(raisedPainted(low)&&raisedPainted(high),'a raised claim is painted whatever the cut: its own floors decide what shows');
  assert(high.includes(groundFiller)&&low.includes(groundFiller),'and the ground under it is painted in the same tile');
  // the cut at the branch's floor: the pit is a hole in it, so the floor below shows through
  const top = v.raisedBuild(rs).filler, plan = BR.ELEV.cutawayPlan(top, B.floorZ, 0);
  assert(plan.visible.some((r)=>r.floorZ===B.floorZ),'the branch floor is visible at its own cut');
  assert(!plan.visible.some((r)=>r.floorZ===B.floorZ&&r.rects.some((q)=>BR.TG.roverlap(q,B.pit.top.rect))),'except over the pit, which is open');
  assert(BR.ELEV.cutawayPlan(top,B.floorZ-0.1,0).visible.length===0,'below its floor a raised claim shows nothing');
  // the ground site below keeps its own floors at the lower cut
  const under = v.spatial(v.site(B.over[0])).filler;
  assert(BR.ELEV.cutawayPlan(under,0,0).visible.length>0);
  // a townhouse's branch stands a storey higher: drawn at its own cut, and nothing of it below
  const T = v.branch(0,-1,2);
  assert(T && T.archetype==='townhouse' && T.floorZ===9.5, 'the known townhouse branch');
  const trs = T.sites[0], tm=[(trs.rects[0][0]+trs.rects[0][2])/2,(trs.rects[0][1]+trs.rects[0][3])/2];
  calls.length=0; let done=false; for (let k=0;k<4&&!done;k++) done=BR.draw(ctx,v,{cx:tm[0],cy:tm[1],zoom:3,dpr:1,w:300,h:260},{labels:true,cutZ:9.5},Infinity).done;
  assert(done && calls.some((c)=>String(c.b.fillId).startsWith(T.id)),'its floors and rooms are painted');
  const tb = v.raisedBuild(trs);
  assert(BR.ELEV.cutawayPlan(tb.filler,9.5,0).visible.some((r)=>r.floorZ===9.5) && BR.ELEV.cutawayPlan(tb.filler,9.4,0).visible.length===0);
}
BR.ELEV.drawCutaway=original;
console.log('ok   cut heights, band offsets, selected-only ghosts, raised claims at their own height and bounded tile caches');
