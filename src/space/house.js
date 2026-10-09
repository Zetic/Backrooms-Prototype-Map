/*
 * Room relationships, canonical house connections and the mansion experiment.
 * Load after shapes.js. Vehicle openings are not pedestrian house connections.
 */
(function(root){
  'use strict';
  const BR=root.BR, SP=BR.SPACE, SH=SP.SHAPES, I=SP._internal;
  const generate=SP.generate, verify=SP.verify;
  const {cm,snap,hashStr,bboxOf,W,H}=I;
  const extra={
    drawing:['public',4,[35,60],'drawing room'], sitting:['public',3,[16,28],'sitting room'],
    conservatory:['public',4,[30,50],'conservatory'], sunroom:['public',3.5,[22,38],'sunroom'],
    ballroom:['public',6,[90,140],'ballroom'], reception:['public',4,[35,55],'reception room'],
    breakfast:['public',3,[14,24],'breakfast room'], prep:['service',2.8,[16,28],'preparation kitchen'],
    butler:['service',2,[8,14],"butler's pantry"], wine:['service',2.4,[10,18],'wine room'],
    library:['public',4,[32,55],'library'], study:['private',3,[14,24],'study'],
    reading:['public',2.8,[12,20],'reading room'], music:['public',3.5,[22,36],'music room'],
    gallery:['public',3,[25,45],'art gallery'], collection:['public',3,[18,30],'collection room'],
    billiards:['public',4,[28,42],'billiards room'], games:['public',3.5,[24,38],'games room'],
    cinema:['public',4,[35,55],'home cinema'], gym:['public',4,[30,50],'gym'],
    pool:['public',6,[90,130],'indoor pool'], sauna:['service',2,[8,12],'sauna'],
    changing:['service',2.4,[12,20],'changing room'], shower:['service',1.6,[5,8],'shower room'],
    guest:['private',3.4,[20,32],'guest bedroom'], dressing:['private',2.4,[10,18],'dressing room'],
    nursery:['private',3,[16,24],'nursery'], playroom:['public',3.5,[24,36],'playroom'],
    homework:['public',3,[16,24],'homework room'], hobby:['public',3.5,[22,36],'hobby room'],
    equipment:['service',2.4,[12,20],'equipment room'], housekeeping:['service',1.8,[6,10],'housekeeping store'],
    storage:['service',2.4,[12,22],'storage room'], workshop:['service',3.5,[25,40],'workshop'],
    staff:['private',2.8,[12,18],'staff bedroom'], vestibule:['circulation',2,[8,14],'garage vestibule']
  };
  for(const [type,[zone,min,area,label]] of Object.entries(extra))SP.MODULES[type]={zone,min,area,label,asp:2.5};
  // These hosts apply to mansion rooms without a more specific relationship.
  for(const type of Object.keys(extra))SP.HOSTS[type]=['hall','loft','family'];
  SP.RECIPES.mansion={name:'Mansion experiment (three floors)',experiment:true,floors:3,
    connections:{primary:1,secondary:[2,3]},hall:[1.8,2.2],openPlan:0.4};

  function mansionProgram(seed,secondary){
    const rng=new BR.Rng(BR.hash4(seed,hashStr('mansion'),0x704d,1)), hall=snap(cm(rng.range(1.8,2.2)));
    const entry=(type,floor,range,host)=>({type,floor,area:Math.round(rng.range(...(range||SP.MODULES[type].area))*1e4),...(host?{requiredHost:host}:{})});
    const foyer=entry('foyer',0,[35,50]), living=entry('living',0,[60,90]), reception=entry('reception',0), family=entry('family',1,[40,60]),loft=entry('loft',2,[35,55]);
    const corridor=floor=>({type:'hall',floor,len:snap(cm(rng.range(8,12))),area:0});
    const stair=floor=>({type:'stair',floor,area:0});
    const seededSecondary=rng.int(2,3);
    const P={hall,stairWidth:150,stairLength:450,passageExit:true,wrongness:0,openPlan:true,secondaryCount:secondary===undefined?seededSecondary:secondary,
      path:[foyer,living,corridor(0),reception,corridor(0),stair(0),corridor(1),family,corridor(1),stair(1),corridor(2),loft,corridor(2)],sides:[],requirements:[]};
    const add=(type,floor,range,host)=>{const e=entry(type,floor,range,host);P.sides.push(e);if(host)P.requirements.push([host,e]);return e;};
    // Ground: the dining/kitchen and service groups occupy the same floor.
    const kitchen=add('kitchen',0,[65,85]);
    const dining=add('dining',0,[45,65],kitchen);
    add('prep',0,null,kitchen);add('pantry',0,[10,16],kitchen);
    add('breakfast',0,null,dining);add('butler',0,null,dining);
    const vestibule=add('vestibule',0,[30,45]);
    P.sides.push({type:'garage',floor:0,w:900,d:850,door:650,area:0,requiredHost:vestibule});
    const garage=P.sides[P.sides.length-1];
    P.requirements.push([vestibule,garage]);
    add('mudroom',0,[10,16],vestibule);add('workshop',0,null,garage);
    const library=add('library',0);add('reading',0,null,library);
    add('drawing',0);add('powder',0,[5,8]);
    for(const type of ['ballroom','conservatory','sunroom','music','wine'])if(rng.f()<0.6)add(type,0);
    if(rng.f()<0.7){const pool=add('pool',0),changing=add('changing',0,null,pool);add('shower',0,null,changing);add('sauna',0,null,changing);add('equipment',0,null,pool);}
    // Middle: a primary suite and family bedrooms with dedicated bathrooms.
    const master=add('master',1,[45,65]);
    add('dressing',1,[18,26],master);add('ensuite',1,[16,22],master);add('sitting',1,null,master);
    for(let k=0,n=rng.int(3,4);k<n;k++){const bedroom=add('bedroom',1,[20,30]);add('ensuite',1,[8,12],bedroom);if(k<2)add('closet',1,[5,8],bedroom);}
    add('laundry',1,[16,24]);add('linen',1,[5,8]);add('study',1);add('playroom',1);add('homework',1);
    if(rng.f()<0.5)add('nursery',1);
    // Top: guest suites and recreation; no kitchen relocations upstairs.
    for(let k=0,n=rng.int(2,3);k<n;k++){const guest=add('guest',2);add('ensuite',2,[8,12],guest);}
    add('cinema',2);add('games',2);add('gym',2);add('hobby',2);add('storage',2);add('housekeeping',2);
    for(const type of ['billiards','gallery','collection','staff'])if(rng.f()<0.65)add(type,2);
    return P;
  }
  SP.MANSION={program:mansionProgram};

  function mansion(spec){
    const seed=spec.seed===undefined?1:spec.seed, start=performance.now();
    if(spec.secondaryConnections!==undefined&&![2,3].includes(spec.secondaryConnections))throw Error('mansion requires 2 or 3 secondary connections');
    const options={hall:'mixed',living:'mixed',...spec.shapes};
    if(!['mixed','straight','L','T'].includes(options.hall)||!['mixed','rectangle','L','alcove'].includes(options.living))throw Error('unknown shape profile');
    const P=mansionProgram(seed,spec.secondaryConnections);let best=null,valid=0,attempts=0;
    for(;attempts<240&&(attempts<60||!best);attempts++){
      const k=attempts;
      const ctx=SH.build(P,options,new BR.Rng(BR.hash4(seed,hashStr('mansion'),0x5a9e,k)));
      if(!ctx)continue;valid++;
      const b=bboxOf(ctx.rooms),score=W(b)*H(b);
      if(!best||score<best.score)best={ctx,score};
    }
    if(!best)return {schema:'br.space/0.3',recipe:'mansion',seed,error:'no complete mansion layout',meta:{ms:Math.round((performance.now()-start)*10)/10}};
    const h=SH.emit(best.ctx,{...spec,recipe:'mansion',seed},P,options,start);
    if(spec.site&&(h.site.w>spec.site.w||h.site.h>spec.site.h))return {schema:h.schema,recipe:'mansion',seed,error:'mansion exceeds requested site'};
    if(spec.site)h.site={w:spec.site.w,h:spec.site.h};
    h.meta.plan='mansion';h.meta.candidates=attempts;h.meta.validCandidates=valid;h.meta.roomRelationships=true;
    h.meta.programRooms=P.path.length+P.sides.length+2; // duplicate stair landings
    return h;
  }
  function connections(h){
    if(h.error)return h;
    h.connections=[];
    for(const op of h.openings){
      if(op.rooms[1]!==null||op.kind==='vehicle')continue;
      const primary=op.role==='front door'||op.role==='primary connection';
      if(!primary&&!['exit','back door','secondary connection'].includes(op.role))continue;
      op.legacyRole=op.legacyRole||op.role;
      op.role=primary?'primary connection':'secondary connection';
      h.connections.push({id:'c'+h.connections.length,role:primary?'primary':'secondary',opening:op.id,
        room:op.rooms[0],floor:op.floor,side:op.side,width:op.width,rect:op.rect.slice()});
    }
    h.meta.roomRelationships=!!h.meta.roomRelationships;
    return h;
  }
  SP.generate=function(spec){
    if(spec.recipe==='mansion')return connections(mansion(spec));
    // Relationships are enabled in the current house API. Explicit false
    // retains the original placement for comparisons and archived fixtures.
    return connections(generate({...spec,relationships:spec.relationships!==false}));
  };
  function passageChecks(h,bad,byId){
    const route=h.route||[],on=new Set(route),adj=new Map(h.spaces.map(s=>[s.id,new Set()]));
    for(const o of h.openings)if(o.rooms[1]!==null){const [a,b]=o.rooms;if(adj.has(a)&&adj.has(b)){adj.get(a).add(b);adj.get(b).add(a);}}
    for(const v of h.verticals){const [a,b]=v.rooms;if(adj.has(a)&&adj.has(b)){adj.get(a).add(b);adj.get(b).add(a);}}
    if(!route.length||h.connections.find(c=>c.role==='primary')?.room!==route[0])bad.push('passage must start at primary connection');
    for(let k=0;k<route.length;k++){
      if(!byId.has(route[k])||!(SP.PASS.has(byId.get(route[k]).type)||byId.get(route[k]).type==='reception'))bad.push('invalid passage room');
      if(k&&!adj.get(route[k-1])?.has(route[k]))bad.push('broken mansion passage');
    }
    const done=new Set();
    for(const s of h.spaces){if(on.has(s.id)||done.has(s.id))continue;
      const stack=[s.id],touch=new Set();done.add(s.id);
      while(stack.length)for(const id of adj.get(stack.pop())){if(on.has(id))touch.add(id);else if(!done.has(id)){done.add(id);stack.push(id);}}
      if(touch.size>1)bad.push('side rooms bypass mansion passage');
    }
  }
  SP.verify=function(h){
    if(h.error)return [h.error];
    const legacy={...h,openings:h.openings.map(o=>o.legacyRole?{...o,role:o.legacyRole}:o)};
    const bad=verify(legacy),byId=new Map(h.spaces.map(s=>[s.id,s]));
    const external=h.openings.filter(o=>['primary connection','secondary connection'].includes(o.role));
    if(!Array.isArray(h.connections))return bad.concat('missing house connections');
    if(h.connections.filter(c=>c.role==='primary').length!==1)bad.push('requires one primary connection');
    if(h.recipe==='mansion'){
      if(h.floors!==3)bad.push('mansion requires three floors');
      if(![2,3].includes(h.connections.filter(c=>c.role==='secondary').length))bad.push('mansion requires 2 or 3 secondary connections');
      if(!h.connections.some(c=>c.role==='secondary'&&c.floor===1))bad.push('mansion requires a middle-floor connection');
      if(!h.connections.some(c=>c.role==='secondary'&&c.floor===2&&c.room===h.route?.at(-1)))bad.push('mansion passage must end at a top-floor connection');
      passageChecks(h,bad,byId);
    }
    if(h.connections.length!==external.length||new Set(h.connections.map(c=>c.opening)).size!==external.length)bad.push('connection opening mismatch');
    for(const c of h.connections){
      const op=h.openings.find(o=>o.id===c.opening),sp=byId.get(c.room);
      if(!op||!sp||op.rooms[1]!==null||op.kind==='vehicle'||op.role!==c.role+' connection'||op.rooms[0]!==c.room||sp.floor!==c.floor||op.floor!==c.floor||op.side!==c.side||op.width!==c.width||JSON.stringify(op.rect)!==JSON.stringify(c.rect)){bad.push('invalid connection '+c.id);continue;}
      if(c.role==='primary'&&c.floor!==0)bad.push('primary connection must be on ground floor');
      // Independently confirm an exposed room edge and an unobstructed
      // approach. Integer centimetres avoid float equality at door jambs.
      const rs=(sp.floorRects||[sp.rect]).map(r=>r.map(v=>Math.round(v*100))),es=SH.edges(rs),r=op.rect.map(v=>Math.round(v*100));
      const hz=['N','S'].includes(c.side),axis=c.side==='N'?r[3]:c.side==='S'?r[1]:c.side==='W'?r[2]:r[0],s0=hz?r[0]:r[1],s1=hz?r[2]:r[3];
      if(!es.some(e=>e.side===c.side&&e.c===axis&&e.s0<=s0&&e.s1>=s1))bad.push('connection is not on exposed floor edge');
      const d={N:[0,-1],S:[0,1],W:[-1,0],E:[1,0]}[c.side];
      const approach=hz?[s0-60,Math.min(axis,axis+d[1]*200),s1+60,Math.max(axis,axis+d[1]*200)]:[Math.min(axis,axis+d[0]*200),s0-60,Math.max(axis,axis+d[0]*200),s1+60];
      if(h.spaces.filter(s=>s.floor===c.floor).some(s=>(s.floorRects||[s.rect]).some(q=>{q=q.map(v=>Math.round(v*100));return Math.min(q[2],approach[2])>Math.max(q[0],approach[0])&&Math.min(q[3],approach[3])>Math.max(q[1],approach[1]);})))bad.push('blocked connection approach');
    }
    for(const q of h.requirements||[]){const [a,b]=q.rooms.map(id=>byId.get(id));if(!a||!b||a.floor!==b.floor||!h.openings.some(o=>o.rooms.includes(a.id)&&o.rooms.includes(b.id)))bad.push('missing direct room relationship');}
    if(h.meta.roomRelationships)for(const dining of h.spaces.filter(s=>s.type==='dining'))if(h.spaces.some(s=>s.type==='kitchen')&&!h.openings.some(o=>o.rooms.includes(dining.id)&&o.rooms.some(id=>byId.get(id)?.type==='kitchen')))bad.push('dining must connect directly to kitchen');
    return [...new Set(bad)];
  };
})(typeof window!=='undefined'?window:globalThis);
