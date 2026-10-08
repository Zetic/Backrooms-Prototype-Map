// Real tile renderer with a canvas adapter; browser layout is verified separately.
const assert = require('node:assert/strict');
const { BR } = require('./helpers');
require('../src/tpl/render2d'); require('../src/tpl/elevation-view'); require('../src/render');
const g = () => new Proxy({ globalAlpha: 1, measureText: (s) => ({ width: s.length * 6 }) }, { get: (o,k) => k in o ? o[k] : () => {}, set: (o,k,v) => { o[k]=v; return true; } });
globalThis.OffscreenCanvas = class { constructor() { this.context = g(); } getContext() { return this.context; } };
const original = BR.ELEV.drawCutaway, calls = [];
BR.ELEV.drawCutaway = (ctx,b,opts) => { calls.push({b,opts,ctx}); return original(ctx,b,opts); };
const w = new BR.BandWorld(7), ctx=g(), view={cx:0,cy:0,zoom:3,dpr:1,w:300,h:260};
function draw(band, cutZ, ghost=false, focus=null, at=null) {
  w.setBand(band); calls.length=0;
  assert(BR.draw(ctx,w,{...view,...(at?{cx:at[0],cy:at[1]}:{})},{labels:true,cutZ,ghost,focus},Infinity).done);
  // (a blueprint with absolute heights, a raised floor, is drawn from 0)
  assert(calls.length); assert(calls.every((c)=>c.opts.cutZ===cutZ && c.opts.baseZ===(c.b.schema===BR.ELEV.SCHEMA?0:band*16)));
  assert(calls.every((c)=>c.opts.ghost === (ghost && c.opts.focus)));
}
draw(0,0); draw(0,2.75);
// (a raised floor, drawn from its own absolute floor, shows nothing below it: a growth's floors over this view are left out)
assert(calls.filter((c)=>c.b.schema!==BR.ELEV.SCHEMA).every((c)=>BR.ELEV.cutawayPlan(c.b,2.75,0).visible.length),'normal rooms remain visible between floor heights');
const site = w.siteAt(0,0), r=w.build(site), focus=r.filler ? site.id : site.id+'/'+r.buildings[0].poi.id;
draw(0,2.75,true,focus); assert(calls.some((c)=>c.opts.ghost)); assert(calls.some((c)=>!c.opts.ghost));
draw(1,16); draw(1,18.125);
for(const key of ['|b0|h0|gfalse|s','|b0|h2.75|gfalse|s','|b0|h2.75|gtrue|s'+focus,'|b1|h16|gfalse|s','|b1|h18.125|gfalse|s']) assert([...w._tiles.map.keys()].some((s)=>s.endsWith(key)));
for(let k=0;k<90;k++) BR.draw(ctx,w,view,{cutZ:16+k/10},Infinity);
assert(w._tiles.map.size<=260,'continuous height retains bounded tile memory');

// a growth's floors (growth.js, band-world.js) are painted with the ground,
// at their own heights: the same cut shows the ground below and the floors above
{
  const v = new BR.BandWorld(7), B = v.growth(0,0,2);
  assert(B && B.pit, 'the known growth is there');
  const rs = B.sites.find((s)=>s.id===B.pit.top.site), mid=[(rs.rects[0][0]+rs.rects[0][2])/2,(rs.rects[0][1]+rs.rects[0][3])/2];
  const shot = (cutZ, p=mid) => { calls.length=0; let done=false; for (let k=0;k<4&&!done;k++) done=BR.draw(ctx,v,{cx:p[0],cy:p[1],zoom:3,dpr:1,w:300,h:260},{labels:true,cutZ},Infinity).done; assert(done); return calls.map((c)=>c.b); };
  const raisedPainted = (list, id) => list.some((b)=>String(b.fillId).startsWith(id));
  const groundFiller = v.build(v.site(B.over[0])).filler;
  const low = shot(0), high = shot(B.floorZ), drawn = calls.slice();
  assert(raisedPainted(low,B.id)&&raisedPainted(high,B.id),'a raised floor is painted whatever the cut: its own floors decide what shows');
  assert(high.includes(groundFiller)&&low.includes(groundFiller),'and the ground under it is painted in the same tile');
  // the ground is painted whole (floors, walls, tags) before any raised floor at
  // or under the cut, which blanks its claim first: nothing of the ground shows over it
  {
    const isRaised = (c) => String(c.b.fillId).startsWith(B.id) || v.raisedIn(mid[0]-60,mid[1]-60,mid[0]+60,mid[1]+60).some((rs)=>v.raisedBuild(rs).filler===c.b);
    const tiles = new Set(drawn.map((c)=>c.ctx)); let seen = 0;
    for (const t of tiles) {
      const list = drawn.filter((c)=>c.ctx===t), first = list.findIndex(isRaised);
      if (first < 0) continue; seen++;
      assert(list.slice(first).every(isRaised), 'no ground wall or tag is drawn over a raised floor');
    }
    assert(seen, 'a tile with a raised floor');
  }
  // the cut at its floor: the pit is a hole in it, so the floor below shows through
  const top = v.raisedBuild(rs).filler, plan = BR.ELEV.cutawayPlan(top, B.floorZ, 0);
  assert(plan.visible.some((r)=>r.floorZ===B.floorZ),'the raised floor is visible at its own cut');
  assert(!plan.visible.some((r)=>r.floorZ===B.floorZ&&r.rects.some((q)=>BR.TG.roverlap(q,B.pit.top.rect))),'except over the pit, which is open');
  assert(BR.ELEV.cutawayPlan(top,B.floorZ-0.1,0).visible.length===0,'below its floor a raised floor shows nothing');
  const under = v.spatial(v.site(B.over[0])).filler;
  assert(BR.ELEV.cutawayPlan(under,0,0).visible.length>0, 'the ground site keeps its own floors at the lower cut');
  // a second floor, stacked over the first: drawn at its own cut, and nothing of it below
  const T = v.growth(0,2,1), second = T.sites.find((s)=>s.level===2), sm=[(second.rects[0][0]+second.rects[0][2])/2,(second.rects[0][1]+second.rects[0][3])/2], z2 = second.floorZ;
  assert(second && z2===11.5, 'the known second floor');
  assert(raisedPainted(shot(z2, sm), second.owner),'its floors and rooms are painted');
  const tb = v.raisedBuild(second);
  assert(BR.ELEV.cutawayPlan(tb.filler,z2,0).visible.some((r)=>r.floorZ===z2) && BR.ELEV.cutawayPlan(tb.filler,z2-0.1,0).visible.length===0);
  // a climb from band 0 arriving in band 1: painted in band 1's tiles through the opening its landing site leaves
  const A = B.arrival, am=[(A.box[0]+A.box[2])/2,(A.box[1]+A.box[3])/2], from = B.sites.find((s)=>s.id===A.site);
  v.setBand(1);
  const up = shot(16, am);
  assert(up.includes(v.raisedBuild(from).filler), 'the climb from below is painted in the band above');
  assert(BR.ELEV.cutawayPlan(v.raisedBuild(from).filler,16,0).visible.some((r)=>r.floorZ===16), 'its landing shows at the band\'s floor');
  assert(v.arrivalsIn(am[0],am[1],am[0]+1,am[1]+1).some((x)=>x.arrival===A));
  v.setBand(0);
}
// growths are planned a few a frame: under a tiny budget a tile is left
// incomplete and drawn again, and the plan view then shows every growth's floors
{
  const v = new BR.BandWorld(7), B = v.growth(0,0,2), q = B.sites[0].rects[0], c=[(q[0]+q[2])/2,(q[1]+q[3])/2];
  const fresh = new BR.BandWorld(7), fills = [];
  const rec = () => { const o = { globalAlpha: 1, fillStyle: '', measureText: (s) => ({ width: s.length * 6 }) };
    return new Proxy(o, { get: (t,k) => k==='fillRect' ? (...a) => fills.push(t.fillStyle) : k in t ? t[k] : () => {}, set: (t,k,x) => { t[k]=x; return true; } }); };
  const keep = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class { constructor() { this.context = rec(); } getContext() { return this.context; } };
  const plan = { cx:c[0], cy:c[1], zoom:0.5, dpr:1, w:300, h:260 };
  assert(!fresh.footprints.size && !BR.draw(ctx,fresh,plan,{},0.001).done, 'nothing planned in no time: the frame is not done');
  let frames = 1;
  while (!BR.draw(ctx,fresh,plan,{},50).done) assert(++frames < 400);
  assert(frames > 1, 'the plan view filled in over several frames');
  assert(fresh.footprintAt(0,0,2).floors.length===B.sites.length && fills.includes('rgba(181,164,197,0.45)'), 'and drew the growth\'s floors');
  // detail: a cell whose growths are not planned is a draft until they are
  const d = new BR.BandWorld(7), detail = { cx:c[0], cy:c[1], zoom:3, dpr:1, w:300, h:260 };
  assert(!d.growthReady(0,0,2) && !BR.draw(ctx,d,detail,{cutZ:0},0.001).done);
  let k = 0; while (!BR.draw(ctx,d,detail,{cutZ:0},50).done) assert(++k < 400);
  assert(d.growthReady(0,0,2), 'the detail view planned the growths it shows');
  globalThis.OffscreenCanvas = keep;
}
BR.ELEV.drawCutaway=original;
console.log('ok   cut heights, band offsets, selected-only ghosts, raised floors at their own heights, climbs arriving from below, growths planned a few a frame (and every one in the plan view), the ground never drawn over a raised floor and bounded tile caches');
