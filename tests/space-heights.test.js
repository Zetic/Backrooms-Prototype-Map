// Physical height/void constraints in the independent room-first test bed.
const assert=require('node:assert/strict');
for(const f of ['core','space/recipes','space/space','space/route','space/shapes','space/house'])require('../src/'+f+'.js');
const SP=BR.SPACE,flat=SP.generate({recipe:'passage',seed:7,shapes:{hall:'L',living:'alcove'}});
require('../src/space/heights.js');require('../src/space/render.js');
const stable=h=>{h=structuredClone(h);delete h.meta.ms;return h;};
assert.deepEqual(stable(SP.generate({recipe:'passage',seed:7,heights:false,shapes:{hall:'L',living:'alcove'}})),stable(flat));
console.log('ok explicit flat mode preserves pre-height output');
const full=process.env.BR_TEST_MODE==='full',N=full?8:2;
let count=0;const hosts=new Set(),profiles=new Set(),frames=new Set();
for(const recipe of ['galleryhouse','mansion'])for(const gallery of ['balcony','L','U'])for(const galleryRoom of ['living','foyer'])for(let seed=1;seed<=N;seed++){
 const spec={recipe,seed,heights:true,gallery,galleryRoom,storeyHeight:[2.8,3.2,4.2][seed%3],shapes:{hall:seed%2?'L':'T',living:'alcove'}},h=SP.generate(spec);
 assert(!h.error,JSON.stringify(spec)+': '+h.error);assert.deepEqual(SP.verify(h),[],JSON.stringify(spec));count++;
 assert.equal(h.schema,'br.space/0.4');assert.equal(h.meta.gallery,gallery);assert.equal(h.floors,recipe==='mansion'?3:2);
 const g=h.spaces.find(s=>s.type==='gallery_landing'),low=h.spaces.find(s=>s.id===g.lowerRoom),v=h.voids.find(v=>v.gallery===g.id);
 assert(low.height>=2*h.meta.storeyHeight-.25);assert.equal(g.floorZ,low.floorZ+h.meta.storeyHeight);assert.equal(g.shape,gallery);
 assert(low.clearVolumes.some(v=>Math.abs(v.z1-g.floorZ+.25)<1e-7));assert(low.clearVolumes.some(v=>v.z1>g.floorZ+2.2));
 assert(Math.abs(low.area-low.clearVolumes.reduce((a,v)=>a+(v.rect[2]-v.rect[0])*(v.rect[3]-v.rect[1]),0))<1e-7);assert(v.rects.length>0);
 for(const c of h.connectors){assert(c.path.some((p,k)=>k&&p[2]!==c.path[k-1][2]));assert(c.entry.rect[2]-c.entry.rect[0]>=1-1e-7);assert(c.entry.rect[3]-c.entry.rect[1]>=1-1e-7);frames.add(h.verticals.find(v=>v.id===c.id).up);}
 hosts.add(low.type);profiles.add(g.shape);
 const base=SP.generate({...spec,heights:false}),types=h=>h.spaces.filter(s=>!['hall','stair','gallery_landing'].includes(s.type)).map(s=>s.type).sort();assert(!base.error);assert.deepEqual(types(h),types(base),'gallery retains every selected non-circulation room');
 if(recipe==='mansion'){assert(h.connections.some(c=>c.floor===1&&c.role==='secondary'));assert(h.connections.some(c=>c.floor===2&&c.role==='secondary'));}
 const runs=SP.passageRuns(h);assert.equal(runs.length,h.route.length);
 for(const run of runs){const s=h.spaces.find(s=>s.id===run.room),inside=p=>s.floorRects.some(r=>p[0]>=r[0]-1e-7&&p[0]<=r[2]+1e-7&&p[1]>=r[1]-1e-7&&p[1]<=r[3]+1e-7);
  for(let k=2;k<run.points.length-1;k++)for(let t=0;t<=8;t++){const a=run.points[k-1],b=run.points[k];assert(inside([a[0]+(b[0]-a[0])*t/8,a[1]+(b[1]-a[1])*t/8]),'passage goes across gallery opening');}}
 if(seed===1&&galleryRoom==='living')assert.deepEqual(stable(h),stable(SP.generate(spec)));
}
assert.equal(profiles.size,3);assert(hosts.has('foyer')&&hosts.has('living'));assert(frames.size>=2);
console.log('ok '+count+' complete gallery houses/mansions: three profiles, both hosts, floor rises, stair orientations, retained rooms and physical passage');
for(const recipe of ['passage','passage1','backdoor','ranch','bungalow','cottage','suburban']){
 const h=SP.generate({recipe,seed:recipe==='suburban'?3:1,heights:true,gallery:'off'});assert(!h.error,recipe);assert.deepEqual(SP.verify(h),[],recipe);assert.equal(h.meta.gallery,'off');assert.equal(h.voids.length,0);
}
const tall=SP.generate({recipe:'passage',seed:2,heights:{roomHeights:{living:7}},gallery:'off'});assert(!tall.error);assert.deepEqual(SP.verify(tall),[]);assert.equal(tall.spaces.find(s=>s.type==='living').height,7);
assert.throws(()=>SP.generate({recipe:'galleryhouse',heights:true,storeyHeight:2}),/storey height/);
assert.throws(()=>SP.generate({recipe:'galleryhouse',heights:{roomHeights:{living:2}}}),/room heights/);
assert.throws(()=>SP.generate({recipe:'galleryhouse',heights:true,gallery:'circle'}),/gallery profile/);
assert(SP.generate({recipe:'galleryhouse',heights:true,site:{w:1,h:1}}).error);
console.log('ok ordinary presets, tall-room clearance and explicit infeasible-input failures');
const h=SP.generate({recipe:'galleryhouse',seed:1,gallery:'U'});assert.deepEqual(SP.verify(h),[]);
function reject(edit,message){const m=structuredClone(h);edit(m);assert(SP.verify(m).includes(message),message+': '+SP.verify(m).join('; '));}
reject(m=>m.voids=[],'gallery missing reserved void');
reject(m=>m.guards.pop(),'gallery missing guard boundary');
reject(m=>m.holes=m.holes.filter(q=>q.kind!=='open-to-below'),'missing open-to-below cutout');
reject(m=>m.holes.find(q=>q.kind==='stair').rects=[],'stair cutout does not match shaft');
reject(m=>m.connectors=[],'missing physical stair connector');
reject(m=>m.connectors[0].reservations=[],'stair lacks reserved headroom');
reject(m=>m.connectors[0].path[0][0]+=200,'stair endpoint misses landing');
reject(m=>m.connectors[0].reservations.forEach(v=>{v.rect[2]=v.rect[0]+.01;}),'stair lacks reserved headroom');
reject(m=>m.spaces[0].height=1,'invalid room height');
reject(m=>m.surfaces[0].slabThickness=.5,'surface does not match room floor');
reject(m=>m.volumes.pop(),'volume export does not match rooms');
reject(m=>m.openings.find(o=>o.rooms.filter(Boolean).length===2).height=9,'opening height does not fit room');
reject(m=>{const pair=m.route.slice(0,2);m.openings=m.openings.filter(o=>!pair.every(id=>o.rooms.includes(id)));},'broken physical passage');
reject(m=>{const sf=m.surfaces.find(s=>s.floor===1),v=m.voids[0];sf.rects.push(v.rects[0]);},'floor crosses protected opening');
reject(m=>{const s=m.spaces.find(s=>s.type==='bedroom');s.clearVolumes=[{rect:m.voids[0].rects[0],z0:3.2,z1:5.95}];},'room occupies reserved void');
console.log('ok independent rejection of removed voids/guards/cutouts, blocked floors, invalid heights, narrow clearance and stale connectivity');
