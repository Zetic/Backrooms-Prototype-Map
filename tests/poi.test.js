// POI plan layer: placement, sites and blueprints on an infinite map.
const {BR,harness}=require('./helpers');
const {check,finish}=harness(),seed=+(process.argv[2]||31337),TPL=BR.TPL,CFG=BR.POI_CFG;
const fp=(W,q)=>JSON.stringify(W.poisIn(...q).slice().sort((a,b)=>a.id<b.id?-1:1));
const Q=[-260,-200,260,200],base=fp(new BR.World(seed),Q);

// ---- order independence
{
 const W=new BR.World(seed);W.poisIn(3000,3000,3600,3400);W.poisIn(-5000,800,-4500,1200);
 check('unrelated visits leave POI placement unchanged',fp(W,Q)===base);
 const W2=new BR.World(seed),C=CFG.cell;
 for(let i=Math.floor(Q[2]/C);i>=Math.floor(Q[0]/C);i--)for(let j=Math.floor(Q[3]/C);j>=Math.floor(Q[1]/C);j--)W2.poiCell(i,j);
 check('reverse cell order leaves POI placement unchanged',fp(W2,Q)===base);
 const W3=new BR.World(seed,{limits:{poiCells:3,manifests:8,buildings:2}});
 for(const t of [[0,0,260,200],[-260,0,0,200],[0,-200,260,0],[-260,-200,0,0]])W3.poisIn(...t);
 check('tiled queries and a tiny cache leave POI placement unchanged',fp(W3,Q)===base&&W3.poiCells.size<=3);
 const far=[-1000300,999800,-999900,1000200],fb=fp(new BR.World(seed),far);
 const W4=new BR.World(seed,{limits:{poiCells:3}});W4.poisIn(0,0,300,300);
 check('far negative coordinates are placed the same in any order',fp(W4,far)===fb&&JSON.parse(fb).length>0);
 check('a different seed places different POIs',fp(new BR.World(seed+1),Q)!==base);
}

// ---- sites
const W=new BR.World(seed),R=[-700,-700,700,700],ps=W.poisIn(...R),C=CFG.cell;
{
 let outside=0,offGrid=0,badShape=0;
 for(const P of ps){
  const c=[P.i*C+CFG.margin,P.j*C+CFG.margin,(P.i+1)*C-CFG.margin,(P.j+1)*C-CFG.margin],B=P.bbox;
  if(B[0]<c[0]||B[1]<c[1]||B[2]>c[2]||B[3]>c[3])outside++;
  for(const q of [B,...P.rects])if(q.some(v=>v!==Math.round(v)))offGrid++;
  const bb=P.rects.reduce((a,q)=>[Math.min(a[0],q[0]),Math.min(a[1],q[1]),Math.max(a[2],q[2]),Math.max(a[3],q[3])],[Infinity,Infinity,-Infinity,-Infinity]);
  if(bb.join()!==B.join()||(P.shape==='rect')!==(P.rects.length===1))badShape++;
 }
 check('every site stays inside its planning cell',outside===0,`${ps.length} POIs`);
 check('sites are whole metres and their rects fill their bbox',offGrid===0&&badShape===0);
 let close=0;
 for(let a=0;a<ps.length;a++)for(let b=a+1;b<ps.length;b++){
  const p=ps[a].bbox,q=ps[b].bbox,g=CFG.gap;
  if(p[0]<q[2]+g&&q[0]<p[2]+g&&p[1]<q[3]+g&&q[1]<p[3]+g)close++;
 }
 check('sites keep the fill gap from each other, across cells too',close===0);
 const ids=new Set(ps.map(P=>P.id));
 check('POI ids are unique and resolve back to their POI',ids.size===ps.length&&ps.every(P=>W.poi(P.id)===P));
 check('poiAt finds the POI on its own site',ps.slice(0,60).every(P=>{const r=P.rects[0];return W.poiAt((r[0]+r[2])/2,(r[1]+r[3])/2)===P;}));
}

// ---- density and variety
{
 const ha=(R[2]-R[0])*(R[3]-R[1])/1e4,st=BR.poiStats(ps,ha),cat=BR.poiCatalogue();
 const tiers=BR.POI_TIERS.filter(t=>cat[t].length);
 check('density is in the dense-but-not-crowded band',st.perHa>2&&st.perHa<7,st.perHa.toFixed(2)+' POIs/ha');
 check('every tier with templates is placed',tiers.every(t=>st.byTier[t]>0),JSON.stringify(st.byTier));
 const used=new Set(ps.map(P=>P.archetype)),all=tiers.flatMap(t=>cat[t].map(a=>a.id));
 check('every template in the catalogue appears',all.every(id=>used.has(id)),`${used.size}/${all.length}`);
 const shapes=new Set(ps.map(P=>P.shape)),sides=new Set(ps.map(P=>P.approach));
 check('sites come in irregular shapes and face every side',shapes.size>=3&&sides.size===4,[...shapes].join(','));
 check('small POIs cluster beside bigger ones',ps.filter(P=>P.cluster).length>ps.length*0.15);
 const cells=[];for(let i=-5;i<5;i++)for(let j=-5;j<5;j++)cells.push(W.poiCell(i,j));
 const d=cells.map(c=>c.density),quiet=cells.filter(c=>c.pois.length<=2).length;
 check('density has a rhythm of busy and quiet cells',Math.max(...d)/Math.min(...d)>3&&quiet>0,`${quiet} quiet of ${cells.length}`);
}

// ---- blueprints on their sites
{
 const sample=W.poisIn(-320,-320,320,320);let failed=0,bad=0,ms=0;
 for(const P of sample){
  const t0=Date.now(),b=W.poiBuilding(P);ms+=Date.now()-t0;
  if(b.error){failed++;continue;}
  const local=P.rects.map(q=>[q[0]-P.bbox[0],q[1]-P.bbox[1],q[2]-P.bbox[0],q[3]-P.bbox[1]]);
  // a room rect may span two site rects: test each kit-grid cell against the union
  const inside=(r)=>{for(let x=r[0]+0.25;x<r[2];x+=0.5)for(let y=r[1]+0.25;y<r[3];y+=0.5)
   if(!local.some(q=>x>q[0]&&x<q[2]&&y>q[1]&&y<q[3]))return false;return true;};
  const main=b.portals.find(p=>p.main);
  if(!b.rooms.every(rm=>rm.rects.every(inside))||!main||main.side!==P.approach||b.archetype!==P.archetype)bad++;
 }
 check('every POI gets a blueprint on its allotted site',failed===0,`${sample.length} built, ${failed} failed, ${(ms/Math.max(1,sample.length)).toFixed(1)} ms avg`);
 check('blueprints stay inside the site and face the planned side',bad===0);
 const P=sample.find(p=>p.tier==='medium'),W2=new BR.World(seed,{limits:{buildings:1}});
 W2.poisIn(5000,5000,5300,5300);W2.poiBuilding(W2.poisIn(-100,-100,100,100)[0]);
 const strip=b=>JSON.stringify(b,(k,v)=>k==='ms'?undefined:v);
 check('a POI blueprint is the same whatever was built before',strip(W2.poiBuilding(W2.poi(P.id)))===strip(W.poiBuilding(P)));
}

// ---- data hooks
{
 const src=TPL.archetypes.closet;
 TPL.registerArchetype(Object.assign({},src,{id:'zz_pool_closet',name:'Pool closet',areas:{poolrooms:30}}));
 const W2=new BR.World(seed),hits=W2.poisIn(-1500,-1500,1500,1500).filter(P=>P.archetype==='zz_pool_closet');
 check('archetype.areas limits a template to its areas',hits.length>0&&hits.every(P=>P.area==='poolrooms'),`${hits.length} placed`);
 delete TPL.archetypes.zz_pool_closet;
 BR.AREAS.parking.poi={density:0};
 const W3=new BR.World(seed),cs=[];for(let i=-8;i<8;i++)for(let j=-8;j<8;j++)cs.push(W3.poiCell(i,j));
 const pk=cs.filter(c=>c.area==='parking');
 check('AREAS[area].poi.density scales POIs inside an area',pk.length>0&&pk.every(c=>c.pois.length===0),`${pk.length} parking cells`);
 delete BR.AREAS.parking.poi;
 check('removing the hooks restores the original placement',fp(new BR.World(seed),Q)===base);
}

// ---- cost
{
 const W2=new BR.World(seed),t0=Date.now();W2.poisIn(-2000,-2000,2000,2000);
 const per=(Date.now()-t0)/W2.stats.poiCellsBuilt;
 check('planning a cell is cheap',per<3,`${per.toFixed(2)} ms per cell, ${W2.stats.poiCellsBuilt} cells`);
}
finish();
