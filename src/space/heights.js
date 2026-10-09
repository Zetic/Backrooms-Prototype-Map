/* Height/opening experiment. Load after house.js, before render.js.
 * Integer centimetres during placement; metres in br.space/0.4.
 * Surfaces and connector paths are authoritative for walkable geometry.
 */
(function(root){
  'use strict';
  const BR=root.BR,SP=BR.SPACE,SH=SP.SHAPES,I=SP._internal;
  const generate=SP.generate,verify=SP.verify,HE=SP.HEIGHTS={};
  const SLAB=25,HEAD=200,LAND=100,LANE=120,OPP={N:'S',S:'N',E:'W',W:'E'};
  const box=rs=>[Math.min(...rs.map(r=>r[0])),Math.min(...rs.map(r=>r[1])),Math.max(...rs.map(r=>r[2])),Math.max(...rs.map(r=>r[3]))];
  const xy=(a,b)=>Math.min(a[2],b[2])>Math.max(a[0],b[0])+1e-7&&Math.min(a[3],b[3])>Math.max(a[1],b[1])+1e-7;
  const zOverlap=(a,b)=>Math.min(a.z1,b.z1)>Math.max(a.z0,b.z0)+1e-7;
  const mid=r=>[(r[0]+r[2])/2,(r[1]+r[3])/2];
  const area=rs=>rs.reduce((a,r)=>a+(r[2]-r[0])*(r[3]-r[1]),0);
  function cut(a,b){
    if(!xy(a,b))return [a];
    const x0=Math.max(a[0],b[0]),x1=Math.min(a[2],b[2]),y0=Math.max(a[1],b[1]),y1=Math.min(a[3],b[3]);
    return [[a[0],a[1],a[2],y0],[a[0],y1,a[2],a[3]],[a[0],y0,x0,y1],[x1,y0,a[2],y1]].filter(r=>r[2]>r[0]+1e-7&&r[3]>r[1]+1e-7);
  }
  const subtract=(rs,cuts)=>cuts.reduce((out,c)=>out.flatMap(r=>cut(r,c)),rs);
  function rotate(rs,turns,frame){
    for(let k=0;k<turns;k++){rs=rs.map(r=>[-r[3],r[0],-r[1],r[2]]);if(frame)frame=frame.map(r=>[-r[3],r[0],-r[1],r[2]]);}
    const b=box(frame||rs);return rs.map(r=>[r[0]-b[0],r[1]-b[1],r[2]-b[0],r[3]-b[1]]);
  }
  SP.MODULES.gallery_landing={zone:'circulation',min:1.6,asp:99,area:[12,30],label:'upper gallery'};
  SP.RECIPES.galleryhouse={...SP.RECIPES.passage,name:'Gallery house (two floors)',experiment:true,
    route:{script:['foyer','living','stair','hall','loft','hall'],hallLen:[4,7],wrong:0},
    rooms:{...SP.RECIPES.passage.rooms,foyer:{area:[12,18]},living:{area:[55,75]},loft:{area:[22,30]},
      kitchen:{area:[18,25]},dining:{area:[16,22]},master:{area:[18,24],ensuite:1,wic:1},bedroom:{n:[2,3],area:[12,16]}},garage:null};
  HE.prepare=function(P,spec){
    const o={storeyHeight:3.2,gallery:'off',galleryRoom:'living',...spec,...(typeof spec.heights==='object'?spec.heights:{})};
    if(!Number.isFinite(o.storeyHeight)||o.storeyHeight<2.8||o.storeyHeight>4.2)throw Error('storey height must be 2.8–4.2 m');
    if(!['off','balcony','L','U'].includes(o.gallery))throw Error('unknown gallery profile');
    if(!['living','foyer'].includes(o.galleryRoom))throw Error('gallery room must be living or foyer');
    const step=I.snap(I.cm(o.storeyHeight));
    const roomHeights=o.roomHeights||{};for(const v of Object.values(roomHeights))if(!Number.isFinite(v)||v<2.2||v>12)throw Error('room heights must be 2.2–12 m');
    if(roomHeights.stair!==undefined||roomHeights.gallery_landing!==undefined)throw Error('stair and gallery heights are derived from the floor rise');
    if(roomHeights.garage!==undefined&&roomHeights.garage<2.4)throw Error('garage height must fit the 2.4 m vehicle opening');
    P.height={step,slab:SLAB,gallery:o.gallery,galleryRoom:o.galleryRoom,roomHeights};
    P.stairWidth=150;P.stairLength=I.snapUp(step/0.7)+2*LAND;
    let floor=0;for(const e of P.path){e.floor=floor;if(e.type==='stair')floor++;}
    if(o.gallery==='off'||!P.path.some(e=>e.type==='stair'))return;
    const si=P.path.findIndex(e=>e.type==='stair');
    let hi=P.path.slice(0,si).findIndex(e=>o.galleryRoom==='foyer'?e.type==='foyer':['living','family'].includes(e.type));
    if(hi<0)throw Error('no lower public room for gallery');
    const lower=P.path[hi],stair=P.path[si],moved=P.path.slice(hi+1,si);
    lower.galleryLower=true;stair.galleryStair=true;lower.sourceArea=lower.area;const g=P.hall+40,min=o.gallery==='U'?2*g+280:g+280;lower.area=Math.max(lower.area,min*min);
    const gallery={type:'gallery_landing',area:0,floor:lower.floor+1,lower};
    P.path.splice(hi+1,si-hi,stair,gallery);
    let host=lower;for(const e of moved){e.requiredHost=host;e.floor=lower.floor;host=e;}
    P.sides.unshift(...moved);
    for(const e of P.sides)if(!e.requiredHost&&!e.of&&!e.through&&['master','bedroom','office','study','linen'].includes(e.type))e.hosts=[...(SP.HOSTS[e.type]||['hall']),'gallery_landing'];
    P.galleryEntry=gallery;
  };
  HE.lowerShapes=function(e,P){
    const g=P.hall+40,min=P.height.gallery==='U'?2*g+280:g+280;
    const w=Math.max(min,I.snap(Math.sqrt(e.area/1.2))),d=Math.max(min,I.snap(e.area/w));
    return [{kind:'rectangle',parts:[[0,0,w,d]]},{kind:'rectangle',parts:[[0,0,d,w]]}].filter(v=>P.height.gallery!=='U'||v.parts[0][2]>=min&&v.parts[0][3]>=min);
  };
  HE.stairShapes=function(P){
    const length=I.snapUp(P.height.step/2/0.7)+2*LAND;
    return [0,1,2,3].map(k=>({kind:'rectangle',parts:rotate([[0,0,260,length]],k),entrySide:['S','W','N','E'][k],exitSide:['S','W','N','E'][k]}));
  };
  function volumes(n,P){
    if(n.heightParts)return n.heightParts;
    const z0=n.floor*P.height.step,z1=z0+(P.height.roomHeights[n.type]===undefined?P.height.step-SLAB:I.cm(P.height.roomHeights[n.type]));
    return n.parts.map(rect=>({rect,z0,z1}));
  }
  HE.fits=function(parts,floor,e,ctx,P,ignore){
    const z0=floor*P.height.step-SLAB,z1=floor*P.height.step+(P.height.roomHeights[e.type]===undefined?P.height.step-SLAB:I.cm(P.height.roomHeights[e.type]));
    for(const n of ctx.rooms){if(n.floor===floor||n===ignore)continue;
      for(const v of volumes(n,P))if(zOverlap({z0,z1},v)&&parts.some(r=>xy(r,v.rect)))return false;
    }
    return true;
  };
  HE.placed=function(n,ctx,P){
    if(n.e.galleryLower){
      n.heightParts=n.parts.map(rect=>({rect,z0:n.floor*P.height.step,z1:Math.max((n.floor+2)*P.height.step-SLAB,n.floor*P.height.step+I.cm(P.height.roomHeights[n.type]||0))}));
      (ctx.keep[n.floor+1]||=[]).push(n.r.slice());
    }
  };
  HE.gallery=function(e,stair,ctx,P){
    const lower=ctx.rooms.find(n=>n.e===e.lower&&n.floor===e.lower.floor);if(!lower)return null;
    const face=OPP[stair.entrySide],turn={N:0,E:1,S:2,W:3}[face],r=lower.r;
    const w=turn%2?r[3]-r[1]:r[2]-r[0],d=turn%2?r[2]-r[0]:r[3]-r[1],g=P.hall+40;
    let local=[[0,0,w,g]];
    if(P.height.gallery!=='balcony')local.push([0,g,g,d]);
    if(P.height.gallery==='U')local.push([w-g,g,w,d]);
    const parts=rotate(local,turn,[[0,0,w,d]]).map(q=>[q[0]+r[0],q[1]+r[1],q[2]+r[0],q[3]+r[1]]);
    if(!SH.fits(parts,ctx.rooms.filter(n=>n.floor===stair.floor),[]))return null;
    const n={type:e.type,e,floor:stair.floor,parts,r:box(parts),edges:SH.edges(parts),shape:P.height.gallery,entrySide:face,lower};
    const join=SH.contacts(stair,n).find(j=>j.s1-j.s0>=120);if(!join)return null;
    const holes=subtract(lower.parts,parts);
    if(!holes.length||area(holes)<280*280)return null;
    lower.heightParts=[...parts.map(rect=>({rect,z0:lower.floor*P.height.step,z1:stair.floor*P.height.step-SLAB})),...holes.map(rect=>({rect,z0:lower.floor*P.height.step,z1:Math.max((stair.floor+1)*P.height.step-SLAB,lower.floor*P.height.step+I.cm(P.height.roomHeights[lower.type]||0))}))];
    n.heightParts=parts.map(rect=>({rect,z0:stair.floor*P.height.step,z1:(stair.floor+1)*P.height.step-SLAB}));
    n.holes=holes;
    // Keep a shell allowance outside the tall room's exposed upper void.
    for(const q of holes)(ctx.keep[stair.floor]||=[]).push([q[0]-30,q[1]-30,q[2]+30,q[3]+30]);
    if(!HE.fits(parts,stair.floor,e,ctx,P))return null;
    return {n,join};
  };
  function frame(v){
    const r=v.rect,w=(v.up==='N'||v.up==='S')?r[2]-r[0]:r[3]-r[1],len=(v.up==='N'||v.up==='S')?r[3]-r[1]:r[2]-r[0];
    const map=(x,y,z)=>v.up==='N'?[r[0]+x,r[3]-y,z]:v.up==='S'?[r[2]-x,r[1]+y,z]:v.up==='E'?[r[0]+y,r[1]+x,z]:[r[2]-y,r[3]-x,z];
    const rect=(x0,y0,x1,y1)=>box([map(x0,y0).slice(0,2).concat(map(x0,y0).slice(0,2)),map(x1,y1).slice(0,2).concat(map(x1,y1).slice(0,2))]);
    return {w,len,map,rect};
  }
  function connector(v,lower,upper,step){
    const f=frame(v),z0=lower.floor*step,z1=upper.floor*step,switchback=!!lower.galleryStair;
    // Switchbacks return to the entry face; frame's forward direction is
    // opposite v.up because v.up points toward the upper exit.
    const back=switchback?frame({...v,up:OPP[v.up]}):f,L=1,width=switchback?1.2:f.w;
    const F=switchback?back:f;
    const lowRect=F.rect(0,0,F.w,L),highRect=switchback?lowRect:F.rect(0,F.len-L,F.w,F.len);
    const path=switchback?
      [[0.6,0.5,z0],[0.6,L,z0],[0.6,F.len-L,(z0+z1)/2],[0.6,F.len-0.6,(z0+z1)/2],[F.w-0.6,F.len-0.6,(z0+z1)/2],[F.w-0.6,F.len-L,(z0+z1)/2],[F.w-0.6,L,z1],[F.w-0.6,0.5,z1]].map(p=>F.map(...p)):
      [[F.w/2,0.5,z0],[F.w/2,L,z0],[F.w/2,F.len-L,z1],[F.w/2,F.len-0.5,z1]].map(p=>F.map(...p));
    const reservations=[];
    for(let k=1;k<path.length;k++){
      const a=path[k-1],b=path[k],len=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.max(1,Math.ceil(len/0.5));
      for(let j=0;j<steps;j++){
        const p=a.map((v,i)=>v+(b[i]-v)*j/steps),q=a.map((v,i)=>v+(b[i]-v)*(j+1)/steps),along=Math.abs(b[1]-a[1])>=Math.abs(b[0]-a[0]);
        reservations.push({rect:along?[p[0]-width/2,Math.min(p[1],q[1]),p[0]+width/2,Math.max(p[1],q[1])]:[Math.min(p[0],q[0]),p[1]-width/2,Math.max(p[0],q[0]),p[1]+width/2],z0:Math.min(p[2],q[2])-0.2,z1:Math.max(p[2],q[2])+2});
      }
    }
    return {id:v.id,kind:'stair',shape:switchback?'switchback':'straight',rooms:v.rooms.slice(),surfaces:v.rooms.map(id=>'surface:'+id),floors:v.floors.slice(),width,headroom:2,rise:z1-z0,slope:(z1-z0)/(switchback?2*(F.len-2*L):F.len-2*L),path,entry:{rect:lowRect,z:z0},exit:{rect:highRect,z:z1},reservations,rect:v.rect.slice()};
  }
  HE.finish=function(h,ctx,P,dx,dy){
    h.sourceSchema=h.schema;h.schema='br.space/0.4';h.meta.heights=true;h.meta.storeyHeight=P.height.step/100;h.meta.slabThickness=0.25;
    const metre=q=>q.map(v=>v/100),shift=q=>[q[0]+dx,q[1]+dy,q[2]+dx,q[3]+dy];
    h.holes=[];h.voids=[];h.guards=[];h.surfaces=[];h.connectors=[];h.volumes=[];
    ctx.rooms.forEach((n,k)=>{
      const s=h.spaces[k],vs=volumes(n,P);
      s.floorZ=n.floor*P.height.step/100;s.ceilingZ=Math.max(...vs.map(v=>v.z1))/100;s.height=s.ceilingZ-s.floorZ;if(n.e.sourceArea){s.sourceTarget=n.e.sourceArea/1e4;s.target=n.e.area/1e4;}
      // heightParts were authored before the common XY translation.
      s.clearVolumes=vs.map(v=>({rect:metre(n.heightParts?shift(v.rect):v.rect),z0:v.z0/100,z1:v.z1/100}));
      if(n.type==='stair'){s.planRects=s.floorRects.map(r=>r.slice());s.galleryStair=!!n.e.galleryStair;}
      if(n.type==='gallery_landing'){
        s.lowerRoom=h.spaces[ctx.rooms.indexOf(n.lower)].id;s.target=null;
        const rects=n.holes.map(q=>metre(shift(q))),z0=s.floorZ-0.25,z1=h.spaces.find(q=>q.id===s.lowerRoom).ceilingZ;
        const hole={id:'hole:'+h.holes.length,kind:'open-to-below',floor:s.floor,room:s.lowerRoom,gallery:s.id,rects,z0,z1:s.floorZ};h.holes.push(hole);
        h.voids.push({id:'void:'+h.voids.length,kind:'open-to-below',room:s.lowerRoom,gallery:s.id,rects,z0,z1});
        for(const e of SH.edges(s.floorRects))for(const q of rects){
          const hz=['N','S'].includes(e.side),c=e.side==='N'?q[3]:e.side==='S'?q[1]:e.side==='W'?q[2]:q[0],a=Math.max(e.s0,hz?q[0]:q[1]),b=Math.min(e.s1,hz?q[2]:q[3]);
          if(Math.abs(c-e.c)>1e-7||b<=a)continue;
          h.guards.push({id:'guard:'+h.guards.length,room:s.id,floor:s.floor,floorZ:s.floorZ,height:1.1,line:hz?[[a,e.c],[b,e.c]]:[[e.c,a],[e.c,b]]});
        }
      }
    });
    for(const v of h.verticals){
      const low=h.spaces.find(s=>s.id===v.rooms[0]),up=h.spaces.find(s=>s.id===v.rooms[1]);
      const c=connector(v,low,up,P.height.step/100);h.connectors.push(c);Object.assign(v,{shape:c.shape,rise:c.rise,path:c.path,width:c.width,headroom:c.headroom});
      for(const [s,r] of [[low,c.entry.rect],[up,c.exit.rect]]){s.floorRects=[r];s.rect=r.slice();s.size=[r[2]-r[0],r[3]-r[1]];s.area=area([r]);s.poly=[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]];s.clearVolumes=[{rect:r,z0:s.floorZ,z1:s.floorZ+P.height.step/100-0.25}];s.ceilingZ=s.clearVolumes[0].z1;s.height=s.ceilingZ-s.floorZ;}
      h.holes.push({id:'hole:'+h.holes.length,kind:'stair',floor:up.floor,connector:c.id,rects:subtract([c.rect],[c.exit.rect]),z0:up.floorZ-0.25,z1:up.floorZ});
    }
    // Remove slab/solid infill and full-height walls at the protected opening.
    for(const l of h.levels){l.floorZ=l.floor*P.height.step/100;const cuts=h.holes.filter(q=>q.floor===l.floor).flatMap(q=>q.rects);for(const key of ['walls','pockets'])l.solids[key]=subtract(l.solids[key],cuts);l.pocketArea=area(l.solids.pockets);}
    h.walls=h.walls.flatMap(w=>subtract([w.rect],h.holes.filter(q=>q.floor===w.floor&&q.kind==='open-to-below').flatMap(q=>q.rects)).map(r=>({...w,rect:r})));
    // Split tall-room wall segments at ceiling-patch boundaries. Gallery
    // perimeter walls start on the upper floor, above the lower covered strip.
    h.walls=h.walls.flatMap(w=>{
      const hz=Math.abs(w.line[0][1]-w.line[1][1])<1e-7,axis=hz?0:1,lo=w.rect[axis],hi=w.rect[axis+2],owners=w.rooms.map(id=>h.spaces.find(s=>s.id===id)).filter(Boolean);
      const cuts=[...new Set([lo,hi,...owners.flatMap(s=>s.clearVolumes.flatMap(v=>[v.rect[axis],v.rect[axis+2]]).filter(v=>v>lo&&v<hi))])].sort((a,b)=>a-b);
      return cuts.slice(1).map((end,k)=>{const r=w.rect.slice();r[axis]=cuts[k];r[axis+2]=end;const p=mid(r);
        const tops=owners.map(s=>s.type==='stair'?s.floorZ+P.height.step/100:s.clearVolumes.map(v=>({v,d:Math.hypot(Math.max(v.rect[0]-p[0],0,p[0]-v.rect[2]),Math.max(v.rect[1]-p[1],0,p[1]-v.rect[3]))})).sort((a,b)=>a.d-b.d)[0]?.v.z1||s.ceilingZ);
        return {...w,id:'',rect:r,floorZ:w.floor*P.height.step/100,ceilingZ:Math.max(...tops),line:hz?[[r[0],(r[1]+r[3])/2],[r[2],(r[1]+r[3])/2]]:[[(r[0]+r[2])/2,r[1]],[(r[0]+r[2])/2,r[3]]]};});
    });h.walls.forEach((w,k)=>w.id='w'+k);
    for(const s of h.spaces){
      h.surfaces.push({id:'surface:'+s.id,room:s.id,floor:s.floor,floorZ:s.floorZ,rects:s.floorRects.map(r=>r.slice()),slabThickness:0.25});
      for(const v of s.clearVolumes)h.volumes.push({...v,id:'volume:'+h.volumes.length,kind:'room',room:s.id});
    }
    for(const o of h.openings){o.floorZ=o.floor*P.height.step/100;o.height=o.kind==='vehicle'?2.4:2.1;o.ceilingZ=o.floorZ+o.height;}
    h.meta.gallery=P.galleryEntry?P.height.gallery:'off';h.meta.pocketArea=h.levels.reduce((a,l)=>a+l.pocketArea,0);
  };
  // Height mode always uses placement constraints; never add a gallery to an
  // already completed flat layout. Explicit heights:false preserves history.
  SP.generate=function(spec){
    if(spec.recipe==='galleryhouse')spec={...spec,heights:spec.heights===false?false:(spec.heights||true),gallery:spec.gallery||'L'};
    if(!spec.heights)return generate(spec);
    const h=generate({...spec,relationships:spec.relationships!==false,shapes:spec.shapes||{hall:'straight',living:'rectangle'}});
    if(!h.error){for(const c of h.connections||[]){c.floorZ=c.floor*h.meta.storeyHeight;c.height=h.openings.find(o=>o.id===c.opening).height;}}
    return h;
  };
  HE.legacy=function(h){
    const v={...h,schema:h.sourceSchema,spaces:h.spaces.map(s=>{
      if(!s.planRects)return s;const r=box(s.planRects);return {...s,rect:r,poly:[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]],floorRects:s.planRects,size:[r[2]-r[0],r[3]-r[1]],area:area(s.planRects)};
    })};return v;
  };
  HE.subtract=subtract;HE.overlap=xy;
  SP.verify=function(h){
    if(h.schema!=='br.space/0.4'||h.error)return verify(h);
    const bad=verify(HE.legacy(h)),fail=(ok,msg)=>{if(!ok)bad.push(msg);};
    const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),near=(a,b)=>Math.abs(a-b)<1e-7;
    const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[2]>r[0]&&r[3]>r[1];
    const covered=(rs,by)=>area(subtract(rs,by))<1e-7;
    const pointIn=(p,rs)=>rs.some(r=>p[0]>=r[0]-1e-7&&p[0]<=r[2]+1e-7&&p[1]>=r[1]-1e-7&&p[1]<=r[3]+1e-7);
    const roomVolumes=h.spaces.flatMap(s=>(s.clearVolumes||[]).map(v=>({...v,room:s.id})));
    fail(eq(h.volumes.map(v=>[v.room,v.rect,v.z0,v.z1]),roomVolumes.map(v=>[v.room,v.rect,v.z0,v.z1])),'volume export does not match rooms');
    fail(h.connectors.length===h.verticals.length&&h.verticals.every(v=>h.connectors.some(c=>c.id===v.id&&eq(c.rooms,v.rooms))),'missing physical stair connector');
    for(const l of h.levels)fail(near(l.floorZ,l.floor*h.meta.storeyHeight),'invalid level elevation');
    for(let i=0;i<roomVolumes.length;i++)for(let j=i+1;j<roomVolumes.length;j++){
      const a=roomVolumes[i],b=roomVolumes[j];fail(!(xy(a.rect,b.rect)&&zOverlap(a,b)),'occupied room volumes overlap');
    }
    for(const w of h.walls){
      fail(validRect(w.rect)&&near(w.floorZ,h.levels.find(l=>l.floor===w.floor)?.floorZ)&&w.ceilingZ>w.floorZ,'invalid wall height');
      for(const v of roomVolumes)fail(!(xy(w.rect,v.rect)&&zOverlap({z0:w.floorZ,z1:w.ceilingZ},v)),'wall intersects occupied room height');
    }
    for(const g of h.spaces.filter(s=>s.type==='gallery_landing')){
      fail(h.voids.some(v=>v.gallery===g.id&&v.room===g.lowerRoom),'gallery missing reserved void');
    }
    fail(h.surfaces?.length===h.spaces.length,'missing height surfaces');
    for(const s of h.spaces){
      fail(Number.isFinite(s.floorZ)&&Number.isFinite(s.ceilingZ)&&s.height>=2.2&&near(s.height,s.ceilingZ-s.floorZ)&&near(s.floorZ,h.levels.find(l=>l.floor===s.floor)?.floorZ),'invalid room height');
      const rs=(s.clearVolumes||[]).map(v=>v.rect);
      fail(rs.length&&rs.every(validRect)&&covered(s.floorRects,rs)&&covered(rs,s.floorRects),'clear volumes do not cover room floor');
      fail(near(s.ceilingZ,Math.max(...(s.clearVolumes||[]).map(v=>v.z1))),'ceiling does not match clear volumes');
      const sf=h.surfaces.find(x=>x.room===s.id);fail(sf&&sf.floor===s.floor&&sf.floorZ===s.floorZ&&sf.slabThickness===0.25&&JSON.stringify(sf.rects)===JSON.stringify(s.floorRects),'surface does not match room floor');
      for(const v of s.clearVolumes||[])fail(v.z0===s.floorZ&&v.z1-v.z0>=2.2,'insufficient room headroom');
    }
    for(const hole of h.holes||[])for(const r of hole.rects){
      fail(validRect(r)&&near(hole.z1,h.levels.find(l=>l.floor===hole.floor)?.floorZ)&&hole.z1>hole.z0&&Math.abs(hole.z1-hole.z0-0.25)<1e-7,'invalid slab opening height');
      for(const sf of h.surfaces.filter(s=>s.floor===hole.floor))fail(!sf.rects.some(q=>xy(r,q)),'floor crosses protected opening');
      const level=h.levels.find(l=>l.floor===hole.floor);fail(level&&!level.solids.walls.concat(level.solids.pockets).some(q=>xy(r,q)),'solid crosses protected opening');
    }
    for(const sf of h.surfaces)for(const r of sf.rects)for(const v of h.volumes){
      if(v.room===sf.room)continue;fail(!(xy(r,v.rect)&&zOverlap({z0:sf.floorZ-sf.slabThickness,z1:sf.floorZ},v)),'slab intersects occupied room height');
    }
    for(const v of h.voids||[]){
      fail(h.holes.some(q=>q.kind==='open-to-below'&&q.room===v.room&&q.gallery===v.gallery&&JSON.stringify(q.rects)===JSON.stringify(v.rects)),'missing open-to-below cutout');
      const g=h.spaces.find(s=>s.id===v.gallery),low=h.spaces.find(s=>s.id===v.room);fail(g&&low&&g.floor===low.floor+1&&g.floorZ===v.z0+0.25&&low.ceilingZ>=v.z1,'invalid gallery height relationship');
      for(const r of v.rects)for(const s of h.spaces)if(s.id!==v.room)for(const q of s.clearVolumes)fail(!(xy(r,q.rect)&&zOverlap(v,q)),'room occupies reserved void');
      fail(g&&low&&near(v.z1,low.ceilingZ)&&v.z1>g.floorZ,'invalid void clearance');
      if(g)for(const edge of SH.edges(g.floorRects))for(const q of v.rects){
        const hz=['N','S'].includes(edge.side),axis=hz?0:1,c=edge.side==='N'?q[3]:edge.side==='S'?q[1]:edge.side==='W'?q[2]:q[0],lo=Math.max(edge.s0,q[axis]),hi=Math.min(edge.s1,q[axis+2]);
        if(!near(c,edge.c)||hi<=lo)continue;
        const spans=h.guards.filter(x=>x.room===g.id&&x.floor===g.floor&&near(x.floorZ,g.floorZ)&&x.height>=1.1&&x.line.every(p=>near(p[1-axis],edge.c))).map(x=>[Math.min(...x.line.map(p=>p[axis])),Math.max(...x.line.map(p=>p[axis]))]).sort((a,b)=>a[0]-b[0]);
        let end=lo;for(const [a,b] of spans)if(a<=end+1e-7)end=Math.max(end,b);fail(end>=hi-1e-7,'gallery missing guard boundary');
      }
    }
    for(const c of h.connectors||[]){
      const a=h.surfaces.find(s=>s.id===c.surfaces[0]),b=h.surfaces.find(s=>s.id===c.surfaces[1]);
      fail(a&&b&&a.floorZ===c.entry.z&&b.floorZ===c.exit.z&&c.rise===b.floorZ-a.floorZ,'invalid stair endpoint heights');
      fail(a&&b&&covered([c.entry.rect],a.rects)&&covered([c.exit.rect],b.rects)&&[c.entry.rect,c.exit.rect].every(r=>r[2]-r[0]>=1-1e-7&&r[3]-r[1]>=1-1e-7)&&pointIn(c.path[0],[c.entry.rect])&&pointIn(c.path.at(-1),[c.exit.rect])&&pointIn(c.path[0],a.rects)&&pointIn(c.path.at(-1),b.rects)&&near(c.path[0][2],a.floorZ)&&near(c.path.at(-1)[2],b.floorZ),'stair endpoint misses landing');
      const cutout=h.holes.filter(q=>q.connector===c.id&&q.kind==='stair'&&q.floor===b?.floor).flatMap(q=>q.rects),required=subtract([c.rect],[c.exit.rect]);
      fail(covered(required,cutout)&&covered(cutout,required),'stair cutout does not match shaft');
      for(const r of c.reservations){
        fail(validRect(r.rect)&&Number.isFinite(r.z0)&&Number.isFinite(r.z1)&&r.z1>r.z0&&covered([r.rect],[c.rect]),'invalid stair reservation');
        for(const v of roomVolumes)if(!c.rooms.includes(v.room))fail(!(xy(r.rect,v.rect)&&zOverlap(r,v)),'stair reservation intersects room');
        for(const v of h.voids)for(const q of v.rects)fail(!(xy(r.rect,q)&&zOverlap(r,v)),'stair reservation intersects reserved void');
        for(const sf of h.surfaces)if(!c.rooms.includes(sf.room))for(const q of sf.rects)fail(!(xy(r.rect,q)&&zOverlap(r,{z0:sf.floorZ-sf.slabThickness,z1:sf.floorZ})),'stair reservation intersects slab');
      }
      fail(c.headroom>=2&&c.width>=1&&c.slope>=0.45&&c.slope<=0.84,'invalid stair width, slope or headroom');
      for(let k=1;k<c.path.length;k++){
        const a=c.path[k-1],b=c.path[k],run=Math.hypot(b[0]-a[0],b[1]-a[1]);
        fail(run>0,'vertical stair segment');if(b[2]!==a[2])fail(Math.abs(b[2]-a[2])/run<=0.84+1e-7,'stair flight too steep');
        for(let t=0;t<=8;t++){const p=a.map((v,i)=>v+(b[i]-v)*t/8);fail(c.reservations.some(v=>p[0]>=v.rect[0]-1e-7&&p[0]<=v.rect[2]+1e-7&&p[1]>=v.rect[1]-1e-7&&p[1]<=v.rect[3]+1e-7&&p[2]>=v.z0-1e-7&&p[2]+c.headroom<=v.z1+1e-7&&((Math.abs(b[1]-a[1])>=Math.abs(b[0]-a[0]))?v.rect[0]<=p[0]-c.width/2+1e-7&&v.rect[2]>=p[0]+c.width/2-1e-7:v.rect[1]<=p[1]-c.width/2+1e-7&&v.rect[3]>=p[1]+c.width/2-1e-7)),'stair lacks reserved headroom');}
      }
      fail(h.holes.some(q=>q.connector===c.id),'missing stair slab opening');
    }
    for(const o of h.openings)for(const id of o.rooms.filter(Boolean)){
      const s=h.spaces.find(s=>s.id===id),patches=(s?.clearVolumes||[]).map(v=>({v,d:Math.hypot(Math.max(v.rect[0]-o.rect[2],o.rect[0]-v.rect[2],0),Math.max(v.rect[1]-o.rect[3],o.rect[1]-v.rect[3],0))})),d=Math.min(...patches.map(x=>x.d)),top=Math.min(...patches.filter(x=>near(x.d,d)).map(x=>x.v.z1));
      fail(s&&s.floor===o.floor&&s.floorZ===o.floorZ&&o.height>=2&&near(o.ceilingZ,o.floorZ+o.height)&&o.ceilingZ<=top+1e-7,'opening height does not fit room');
    }
    // Rebuild connectivity from physical openings/connectors, never cached graph edges.
    const adj=new Map(h.spaces.map(s=>[s.id,new Set()])),link=([a,b])=>{if(adj.has(a)&&adj.has(b)){adj.get(a).add(b);adj.get(b).add(a);}};
    h.openings.forEach(o=>link(o.rooms));h.connectors.forEach(c=>link(c.rooms));
    const start=h.connections.find(c=>c.role==='primary')?.room,reached=new Set([start]),queue=[start];
    while(queue.length)for(const id of adj.get(queue.shift())||[])if(!reached.has(id)){reached.add(id);queue.push(id);}
    fail(h.spaces.every(s=>reached.has(s.id)),'unreachable room through physical connections');
    if(h.route){
      fail(h.route[0]===start&&h.connections.some(c=>c.role==='secondary'&&c.room===h.route.at(-1)),'invalid passage endpoints');
      for(let k=1;k<h.route.length;k++)fail(adj.get(h.route[k-1])?.has(h.route[k]),'broken physical passage');
      const visited=new Set(h.route);
      for(const s of h.spaces)if(!visited.has(s.id)){
        const touch=new Set(),pending=[s.id];visited.add(s.id);
        while(pending.length)for(const id of adj.get(pending.shift())||[])if(h.route.includes(id))touch.add(id);else if(!visited.has(id)){visited.add(id);pending.push(id);}
        fail(touch.size<=1,'side rooms bypass physical passage');
      }
    }
    return [...new Set(bad)];
  };
})(typeof window!=='undefined'?window:globalThis);
