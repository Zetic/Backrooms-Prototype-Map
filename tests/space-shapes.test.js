// Shaped floors reserve their full union before the shared wall compiler runs.
const assert=require('node:assert/strict');
for(const f of ['core','space/recipes','space/space','space/route'])require('../src/'+f+'.js');
const SP=BR.SPACE, strip=h=>{h=structuredClone(h);if(h.meta)delete h.meta.ms;return h;};
const original=Object.keys(SP.RECIPES).map(recipe=>strip(SP.generate({recipe,seed:7})));
require('../src/space/shapes.js');
Object.keys(SP.RECIPES).forEach((recipe,i)=>assert.deepEqual(strip(SP.generate({recipe,seed:7})),original[i]));
console.log('ok original outputs unchanged with shape module loaded');
const profiles=[['straight','rectangle'],['L','L'],['T','alcove'],['mixed','mixed']];
let built=0,failed=0;const kinds=new Set();
const N=process.env.BR_TEST_MODE==='full'?20:5;
for(const recipe of Object.keys(SP.RECIPES))for(const [hall,living] of profiles){
  let successes=0;
  for(let seed=1;seed<=N;seed++){
    const h=SP.generate({recipe,seed,shapes:{hall,living}});
    if(h.error){failed++;continue;}
    built++;successes++;
    assert.deepEqual(SP.verify(h),[],recipe+' seed '+seed+' '+hall+'/'+living);
    for(const s of h.spaces)kinds.add(s.shape);
    assert.equal(h.schema,'br.space/0.3');
    const P=SP.SHAPES.roomProgram(SP.RECIPES[recipe],recipe,seed);
    for(const type of ['bedroom','master'])assert.equal(h.spaces.filter(s=>s.type===type).length,P.path.concat(P.sides).filter(e=>e.type===type).length);
    if(seed===1)assert.deepEqual(strip(SP.generate({recipe,seed,shapes:{hall,living}})),strip(h));
  }
  assert(successes>0,recipe+' '+hall+'/'+living+' never built');
}
assert.deepEqual([...kinds].sort(),['L','T','alcove','rectangle','straight']);
console.log('ok all recipes/profiles, deterministic floors, counts, solids and reachability: '+built+' built, '+failed+' explicitly failed');
const h=SP.generate({recipe:'passage1',seed:1,shapes:{hall:'L',living:'L'}});
assert(!h.error);
const bad=structuredClone(h);bad.spaces[0].area+=1;assert(SP.verify(bad).some(x=>x.includes('area')));
const solid=structuredClone(h),room=solid.spaces[0];solid.levels.find(l=>l.floor===room.floor).solids.walls.push(room.floorRects[0]);assert(SP.verify(solid).some(x=>x.includes('solid')));
const disconnected=structuredClone(h);disconnected.graph.edges=[];assert(SP.verify(disconnected).includes('unreachable room'));
assert.throws(()=>SP.generate({recipe:'passage1',seed:1,shapes:{hall:'circle'}}),/profile/);
assert(SP.generate({recipe:'passage1',seed:1,shapes:{},site:{w:1,h:1}}).error);
console.log('ok verifier mutations, invalid profile, fixed-site rejection');
