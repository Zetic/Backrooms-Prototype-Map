// Canonical house connections, functional adjacency and three-floor mansions.
const assert=require('node:assert/strict');
for(const f of ['core','space/recipes','space/space','space/route','space/shapes'])require('../src/'+f+'.js');
const SP=BR.SPACE, original=SP.generate({recipe:'passage1',seed:7});
require('../src/space/house.js');
const withoutMetadata=h=>{h=structuredClone(h);delete h.meta.ms;delete h.meta.roomRelationships;delete h.connections;for(const o of h.openings)if(o.legacyRole){o.role=o.legacyRole;delete o.legacyRole;}return h;};
assert.deepEqual(withoutMetadata(SP.generate({recipe:'passage1',seed:7,relationships:false})),withoutMetadata(original));
console.log('ok original placement preserved through explicit comparison option');
const full=process.env.BR_TEST_MODE==='full',N=full?40:5;
let built=0,failed=0;
for(const recipe of Object.keys(SP.RECIPES).filter(r=>r!=='mansion')){
 let count=0;
 for(let seed=1;seed<=N;seed++){
  const h=SP.generate({recipe,seed});if(h.error){failed++;continue;}count++;built++;
  assert.deepEqual(SP.verify(h),[],recipe+' '+seed);
  assert.equal(h.connections.filter(c=>c.role==='primary').length,1);
  assert(h.connections.every(c=>h.openings.find(o=>o.id===c.opening).kind!=='vehicle'));
  if(SP.RECIPES[recipe].route)assert.equal(h.connections.filter(c=>c.role==='secondary').length,1);
  const dining=h.spaces.filter(s=>s.type==='dining');
  for(const d of dining)assert(h.openings.some(o=>o.rooms.includes(d.id)&&o.rooms.some(id=>h.spaces.find(s=>s.id===id)?.type==='kitchen')));
 }
 assert(count>=N*0.9,recipe+': too many complete-program failures');
}
console.log('ok current presets, direct dining access, pantry relationships and canonical connections: '+built+' built, '+failed+' explicitly failed');
let mansions=0;const types=new Set(),totals=new Set(),profiles=['straight','L','T','mixed'];
for(const hall of profiles)for(let seed=1;seed<=(full?20:3);seed++){
 const spec={recipe:'mansion',seed,shapes:{hall,living:hall==='straight'?'rectangle':hall==='L'?'L':'alcove'}};
 const h=SP.generate(spec);assert(!h.error,hall+' seed '+seed+': '+h.error);
 assert.deepEqual(SP.verify(h),[],hall+' seed '+seed);mansions++;
 assert.equal(h.floors,3);assert.deepEqual(h.levels.map(l=>l.floor),[0,1,2]);
 assert(h.spaces.length>=40);assert(h.spaces.filter(s=>['master','bedroom','guest'].includes(s.type)).length>=6);
 assert.equal(h.connections.filter(c=>c.role==='primary').length,1);assert([3,4].includes(h.connections.length));
 assert(h.connections.every(c=>c.floor===0));totals.add(h.connections.length);
 assert(h.requirements.length>=12);
 const P=SP.MANSION.program(seed),entries=P.path.concat(P.sides);
 for(const e of P.sides)assert(h.spaces.some(s=>s.type===e.type&&s.floor===e.floor));
 assert.equal(h.spaces.length- h.spaces.filter(s=>s.type==='hall').length,entries.filter(e=>e.type!=='hall').length+2);
 for(const s of h.spaces)types.add(s.type);
 if(seed===1){const a=structuredClone(h),b=SP.generate(spec);delete a.meta.ms;delete b.meta.ms;assert.deepEqual(a,b);}
}
assert.deepEqual([...totals].sort(),[3,4]);assert(types.has('pool')&&types.has('cinema')&&types.has('prep')&&types.has('guest')&&types.has('library'));
console.log('ok '+mansions+' mansions: all profiles, three connected floors, complete programs, clear outside ports and deterministic generation');
assert.deepEqual(SP.MANSION.program(1,2).sides.map(e=>[e.type,e.floor,e.area]),SP.MANSION.program(1,3).sides.map(e=>[e.type,e.floor,e.area]));
for(const secondaryConnections of [2,3]){const h=SP.generate({recipe:'mansion',seed:1,secondaryConnections});assert(!h.error);assert.equal(h.connections.length,secondaryConnections+1);assert.deepEqual(SP.verify(h),[]);}
const h=SP.generate({recipe:'mansion',seed:1});
const wrong=structuredClone(h);wrong.connections[1].role='primary';assert(SP.verify(wrong).includes('requires one primary connection'));
const missing=structuredClone(h);missing.connections.pop();assert(SP.verify(missing).includes('connection opening mismatch'));
const adjacency=structuredClone(h),pair=adjacency.requirements[0].rooms;adjacency.openings=adjacency.openings.filter(o=>!(o.rooms.includes(pair[0])&&o.rooms.includes(pair[1])));assert(SP.verify(adjacency).includes('missing direct room relationship'));
const blocked=structuredClone(h),c=blocked.connections[1],op=blocked.openings.find(o=>o.id===c.opening),room=blocked.spaces.find(s=>s.id===c.room);room.floorRects.push(op.rect.slice());assert(SP.verify(blocked).length);
assert.throws(()=>SP.generate({recipe:'mansion',seed:1,secondaryConnections:1}),/2 or 3/);
assert(SP.generate({recipe:'mansion',seed:1,site:{w:1,h:1}}).error);
console.log('ok secondary-count controls, invalid connection/adjacency mutations and undersized-site rejection');
