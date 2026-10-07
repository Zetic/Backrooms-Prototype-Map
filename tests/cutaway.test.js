const assert=require('node:assert/strict'), {BR}=require('./helpers');
require('../src/tpl/render2d'); require('../src/tpl/elevation-view');
const E=BR.ELEV, fixture=require('./cutaway-fixture'), b=fixture(), area=(r)=>(r[2]-r[0])*(r[3]-r[1]);
assert.deepEqual(E.floorElevations(b),[0,2.75,5.5],'ceilings and ramp paths do not add floors');
for(const height of [-1,0,2.5,2.75,4.125,5.5,9]) {
  const plan=E.cutawayPlan(b,height);
  const rs=plan.visible.flatMap((r)=>r.rects);
  for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++)assert(!BR.TG.roverlap(rs[i],rs[j]),'each XY has one visible floor');
  for(let y=.125;y<8;y+=.25)for(let x=.125;x<15;x+=.25) {
    const candidates=b.rooms.filter((r)=>r.floorZ<=height&&r.rects.some((q)=>x>=q[0]&&x<q[2]&&y>=q[1]&&y<q[3]));
    const expected=candidates.length?Math.max(...candidates.map((r)=>r.floorZ)):null, hit=E.hitCutaway(b,x,y,height);
    assert.equal(hit?hit.floorZ:null,expected);
  }
}
assert.equal(E.cutawayPlan(b,2.75).visible.flatMap((r)=>r.rects).reduce((n,q)=>n+area(q),0),112,'lower areas remain visible outside upper footprints');
assert.equal(E.hitCutaway(b,12,3,9).floorZ,0,'8 m clear height does not invent an upper floor');
assert.equal(E.cutawayPlan(b,3),E.cutawayPlan(b,4),'same floor interval reuses its visibility plan');
b.holes=[{surface:'s:r1',face:'floor',rect:[5,1,6,2]}];E.invalidateView(b);
assert.equal(E.hitCutaway(b,5.5,1.5,3).floorZ,0,'floor holes reveal the lower surface');
const shifted=fixture();for(const r of shifted.rooms)r.floorZ-=4;E.invalidateView(shifted);
assert.deepEqual(E.floorElevations(shifted),[-4,-1.25,1.5]);assert.equal(E.hitCutaway(shifted,5,1,-1).floorZ,-1.25);
const raw=BR.TPL.generate({archetype:'closet',seed:7,wrongness:0});assert.equal(E.hitCutaway(raw,raw.rooms[0].rects[0][0]+.1,raw.rooms[0].rects[0][1]+.1,18.1,16).floorZ,16);
const polygonArea=(pts)=>Math.abs(pts.reduce((n,p,k)=>{const q=pts[(k+1)%pts.length];return n+p[0]*q[1]-q[0]*p[1];},0))/2;
const ramp={kind:'ramp',width:2,path:[[0,0,-1],[6,8,4]]};
for(const path of [ramp.path,ramp.path.slice().reverse()]) {
  const areas=E.connectionAreas({...ramp,path},1.5);
  assert.equal(areas.length,2);assert.equal(areas.filter((a)=>!a.above).length,1);
  assert(Math.abs(areas.reduce((n,a)=>n+polygonArea(a.pts),0)-20)<1e-7,'10 m diagonal run occupies 2 m width');
  assert(Math.abs(polygonArea(areas.find((a)=>!a.above).pts)-10)<1e-7);
}
assert.equal(E.connectionAt({connectors:[ramp]},3,4,-2),null,'wholly hidden routes cannot be clicked');
assert.equal(E.connectionAt({connectors:[ramp]},3,4,-2,true),ramp,'selected ghosts can be inspected');
assert.equal(E.connectionAt({connectors:[ramp]},3,4,1.5),ramp);assert.equal(E.connectionAt({connectors:[ramp]},6,0,1.5),null);
const contexts=[];
const g=new Proxy({globalAlpha:1,measureText:(s)=>({width:s.length*6})},{get:(o,k)=>k in o?o[k]:(...args)=>{contexts.push([k,...args]);},set:(o,k,v)=>{o[k]=v;return true;}});
const painted=fixture(), snapshot=JSON.stringify(painted);
E.drawCutaway(g,painted,{cutZ:3,scale:12,ghost:false});assert(contexts.some((c)=>c[0]==='clip'&&c[1]==='evenodd'),'upper floors clip hidden lower walls');
assert.equal(JSON.stringify(painted),snapshot,'view does not alter generation geometry');
console.log('ok   highest-floor visibility, partial overlap, holes, arbitrary/negative heights, caching and diagonal footprint widths');
