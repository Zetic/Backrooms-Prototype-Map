/*
 * space/render.js - draws one floor of a house from the reserved-floor
 * generator (space/space.js, space/route.js) on a 2D canvas, from its output
 * alone.
 *
 *   BR.SPACE.draw(ctx, house, { floor, scale, ox, oy, labels, sizes, kinds, lot, route })
 *
 * floor: which floor (0 the ground floor). scale: pixels per metre. ox, oy:
 * where the lot's top-left goes. labels / sizes: room names and their clear
 * floor size. kinds: interior walls in their own shade. lot: the lot outline.
 * route: the way through the house, front door to exit, as a dotted line.
 */
(function (root) {
  'use strict';
  const SP = root.BR.SPACE;

  SP.COLORS = {
    ground: '#3a3f33', lot: 'rgba(255,255,255,0.18)',
    public: '#d9c9a8', private: '#c4cfd8', service: '#cfc6b9', circulation: '#e6dfcf', garage: '#b9b6ae',
    wall: '#2b2724', interior: '#5b524a', pocket: '#7d7268', open: '#e6dfcf',
    door: '#8a5a32', front: '#c8553d', exit: '#8b5bd6', route: '#c8553d', tread: '#a99f8f', text: '#2b2724', size: '#5f574f'
  };

  const mid = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

  // Crop each inspector floor to its actual rooms, walls and connections.
  SP.floorBounds=function(h,floor){
    const rects=h.spaces.filter(s=>s.floor===floor).flatMap(s=>s.planRects||s.floorRects||[s.rect]).concat((h.holes||[]).filter(q=>q.floor===floor).flatMap(q=>q.rects));
    return [Math.min(...rects.map(r=>r[0]))-1.5,Math.min(...rects.map(r=>r[1]))-1.5,
      Math.max(...rects.map(r=>r[2]))+1.5,Math.max(...rects.map(r=>r[3]))+1.5];
  };
  // Inspector centrelines stay inside the actual joined floor, including
  // concave turns. They describe the passage graph, not stair tread geometry.
  function floorPath(parts,start,end){
    const inside=p=>parts.some(r=>p[0]>=r[0]-1e-8&&p[0]<=r[2]+1e-8&&p[1]>=r[1]-1e-8&&p[1]<=r[3]+1e-8);
    const project=p=>parts.map(r=>[Math.max(r[0]+0.2,Math.min(r[2]-0.2,p[0])),Math.max(r[1]+0.2,Math.min(r[3]-0.2,p[1]))]).sort((a,b)=>Math.hypot(a[0]-p[0],a[1]-p[1])-Math.hypot(b[0]-p[0],b[1]-p[1]))[0];
    const a=project(start),b=project(end),xs=[...new Set([a[0],b[0],...parts.flatMap(r=>[r[0]+0.2,(r[0]+r[2])/2,r[2]-0.2])])].sort((x,y)=>x-y),ys=[...new Set([a[1],b[1],...parts.flatMap(r=>[r[1]+0.2,(r[1]+r[3])/2,r[3]-0.2])])].sort((x,y)=>x-y);
    const nodes=xs.flatMap(x=>ys.map(y=>[x,y])).filter(inside),key=p=>p.join(','),ids=new Map(nodes.map((p,i)=>[key(p),i])),from=ids.get(key(a)),to=ids.get(key(b)),dist=nodes.map(()=>Infinity),prev=[],done=new Set();
    dist[from]=0;
    const clear=(p,q)=>{const steps=Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/0.1);for(let k=0;k<=steps;k++)if(!inside([p[0]+(q[0]-p[0])*k/(steps||1),p[1]+(q[1]-p[1])*k/(steps||1)]))return false;return true;};
    for(let k=0;k<nodes.length;k++){
      let i=-1;for(let j=0;j<nodes.length;j++)if(!done.has(j)&&(i<0||dist[j]<dist[i]))i=j;
      if(i<0||!Number.isFinite(dist[i]))return null;if(i===to)break;done.add(i);
      for(let j=0;j<nodes.length;j++){if(done.has(j)||(nodes[i][0]!==nodes[j][0]&&nodes[i][1]!==nodes[j][1])||!clear(nodes[i],nodes[j]))continue;
        const d=dist[i]+Math.hypot(nodes[j][0]-nodes[i][0],nodes[j][1]-nodes[i][1]);if(d<dist[j]){dist[j]=d;prev[j]=i;}}
    }
    if(!Number.isFinite(dist[to]))return null;
    const path=[];for(let i=to;i!==undefined;i=prev[i])path.unshift(nodes[i]);return [start,...path,end];
  }
  SP.passageRuns=function(h){
    if((h.recipe!=='mansion'&&!h.meta.heights)||!h.route)return [];
    const byId=new Map(h.spaces.map(s=>[s.id,s])),primary=h.connections.find(c=>c.role==='primary'),exit=h.connections.find(c=>c.role==='secondary'&&c.room===h.route.at(-1));
    const between=(a,b,id)=>{const op=h.openings.find(o=>o.rooms.includes(a)&&o.rooms.includes(b));if(op)return op;const v=h.verticals.find(v=>v.rooms.includes(a)&&v.rooms.includes(b));if(!v)return null;const c=h.connectors?.find(c=>c.id===v.id);return c?{rect:(id===c.rooms[0]?c.entry:c.exit).rect}:v;};
    return h.route.map((id,k)=>{
      const room=byId.get(id),incoming=k?between(h.route[k-1],id,id):primary,outgoing=k<h.route.length-1?between(id,h.route[k+1],id):exit;
      if(!room||!incoming||!outgoing)return null;
      const points=floorPath(room.floorRects||[room.rect],mid(incoming.rect),mid(outgoing.rect));
      return points?{room:id,floor:room.floor,points}:null;
    }).filter(Boolean);
  };
  SP.drawGallerySection=function(ctx,h,o){
    const g=h.spaces.find(s=>s.type==='gallery_landing');if(!g)return;
    const low=h.spaces.find(s=>s.id===g.lowerRoom),hole=h.holes.find(q=>q.gallery===g.id),primary=g.floorRects[0],bandAxis=(primary[2]-primary[0])>(primary[3]-primary[1])?0:1;
    const axis=g.shape==='U'?bandAxis:1-bandAxis,other=1-axis,point=mid(hole.rects[0])[other],r=low.rect;
    const width=o.width||900,height=o.height||440,margin=56,scale=Math.min((width-2*margin)/(r[axis+2]-r[axis]),(height-90)/(low.ceilingZ-low.floorZ+1));
    const left=(width-(r[axis+2]-r[axis])*scale)/2;const X=x=>left+(x-r[axis])*scale,Y=z=>height-38-(z-low.floorZ)*scale;
    const slice=q=>point>=q[other]&&point<=q[other+2];
    ctx.fillStyle='#302f2c';ctx.fillRect(0,0,width,height);ctx.fillStyle='#e9e3d6';ctx.font='600 15px system-ui, sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText('Gallery section · '+low.name,12,8);
    for(const s of [low,g])for(const v of s.clearVolumes)if(slice(v.rect)){ctx.fillStyle=s===low?'#d9c9a8':'#e6dfcf';ctx.fillRect(X(v.rect[axis]),Y(v.z1),(v.rect[axis+2]-v.rect[axis])*scale,(v.z1-v.z0)*scale);ctx.fillStyle='#2b2724';ctx.fillRect(X(v.rect[axis]),Y(v.z1+0.15),(v.rect[axis+2]-v.rect[axis])*scale,0.15*scale);}
    for(const sf of h.surfaces.filter(sf=>[low.id,g.id].includes(sf.room)))for(const q of sf.rects)if(slice(q)){ctx.fillStyle='#5b524a';ctx.fillRect(X(q[axis]),Y(sf.floorZ),(q[axis+2]-q[axis])*scale,sf.slabThickness*scale);}
    for(const q of h.guards.filter(q=>q.room===g.id))if(Math.abs(q.line[0][axis]-q.line[1][axis])<1e-7&&point>=Math.min(q.line[0][other],q.line[1][other])&&point<=Math.max(q.line[0][other],q.line[1][other])){ctx.strokeStyle='#e5b754';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(X(q.line[0][axis]),Y(q.floorZ));ctx.lineTo(X(q.line[0][axis]),Y(q.floorZ+q.height));ctx.stroke();}
    ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='12px system-ui, sans-serif';ctx.fillStyle='#e9e3d6';
    for(const z of [low.floorZ,g.floorZ,low.ceilingZ])ctx.fillText(z.toFixed(2)+' m',left-52,Y(z));
    const p=mid(hole.rects[0]);ctx.textAlign='center';ctx.fillStyle='#2b2724';ctx.fillText('Open to below',X(p[axis]),Y((g.floorZ+low.ceilingZ)/2));
  };
  SP.draw = function draw(ctx, h, o) {
    o = Object.assign({ floor: 0, scale: 30, ox: 0, oy: 0, labels: true, sizes: true, kinds: true, lot: true, route: true }, o || {});
    const C = SP.COLORS, s = o.scale, X = (x) => o.ox + x * s, Y = (y) => o.oy + y * s, F = o.floor;
    const on = (x) => (x.floor || 0) === F;
    const level = (h.levels || []).find((l) => l.floor === F) || { solids: { walls: [], pockets: [] } };
    const rect = (r, fill) => { ctx.fillStyle = fill; ctx.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * s, (r[3] - r[1]) * s); };
    const spaces = h.spaces.filter(on), openings = h.openings.filter(on);
    ctx.save();
    if (o.lot) {
      rect([0, 0, h.site.w, h.site.h], C.ground);
      ctx.strokeStyle = C.lot; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.strokeRect(X(0) + 0.5, Y(0) + 0.5, h.site.w * s - 1, h.site.h * s - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      if (F === 0) ctx.fillText('street', X(h.site.w / 2), Y(h.site.h) - 4);
    }
    // floors, then the solid parts, then the openings through them
    for (const sp of spaces) for (const r of sp.floorRects || [sp.rect]) rect(r, sp.type === 'garage' ? C.garage : C[sp.zone]);
    for (const r of level.solids.walls) rect(r, C.wall);
    // Tall walls from the lower room remain visible above an opening.
    const viewZ=level.floorZ;
    if(Number.isFinite(viewZ))for(const w of h.walls)if(w.floor!==F&&w.floorZ<=viewZ&&w.ceilingZ>viewZ)rect(w.rect,w.kind==='interior'&&o.kinds?C.interior:C.wall);
    if (o.kinds) for (const w of h.walls) if (on(w) && w.kind === 'interior') rect(w.rect, C.interior);
    for (const r of level.solids.pockets) rect(r, C.pocket);
    for (const op of openings) rect(op.rect, op.kind === 'portal' ? C.exit : op.kind === 'open' ? C.open : C.circulation);
    // A floor opening reveals a lower surface; it is never painted as a
    // walkable upper room. Gallery boundaries receive guards, not walls.
    for(const hole of (h.holes||[]).filter(q=>q.floor===F)){
      for(const r of hole.rects){rect(r,hole.kind==='open-to-below'?'#898477':'#4c4b46');ctx.strokeStyle='#b9aa8a';ctx.lineWidth=1;ctx.setLineDash([5,5]);ctx.strokeRect(X(r[0]),Y(r[1]),(r[2]-r[0])*s,(r[3]-r[1])*s);ctx.setLineDash([]);}
      if(hole.kind==='open-to-below'&&o.labels){const r=hole.rects[0],p=mid(r),low=h.spaces.find(q=>q.id===hole.room);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#eee7d8';ctx.font='12px system-ui, sans-serif';ctx.fillText('Open to '+(low?.name||'below'),X(p[0]),Y(p[1]));ctx.fillText('ceiling '+low.ceilingZ.toFixed(2)+' m',X(p[0]),Y(p[1])+16);}
    }
    for(const g of (h.guards||[]).filter(q=>q.floor===F)){ctx.strokeStyle='#e5b754';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(X(g.line[0][0]),Y(g.line[0][1]));ctx.lineTo(X(g.line[1][0]),Y(g.line[1][1]));ctx.stroke();}
    // stairs: treads across the run, the way up marked
    ctx.lineWidth = 1;
    for (const v of h.verticals || []) {
      if (v.floors[0] !== F && v.floors[1] !== F) continue;
      if(v.path){
        const c=h.connectors.find(c=>c.id===v.id);ctx.strokeStyle=C.tread;
        for(let k=1;k<c.path.length;k++){const a=c.path[k-1],b=c.path[k],len=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/len,uy=(b[1]-a[1])/len;
          ctx.lineWidth=c.width*s;ctx.strokeStyle='#d6cdbc';ctx.beginPath();ctx.moveTo(X(a[0]),Y(a[1]));ctx.lineTo(X(b[0]),Y(b[1]));ctx.stroke();
          if(a[2]!==b[2]){ctx.lineWidth=1;ctx.strokeStyle=C.tread;ctx.beginPath();for(let t=0.2;t<len;t+=0.25){const x=a[0]+ux*t,y=a[1]+uy*t;ctx.moveTo(X(x-uy*c.width/2),Y(y+ux*c.width/2));ctx.lineTo(X(x+uy*c.width/2),Y(y-ux*c.width/2));}ctx.stroke();}
        }
        if(o.route){ctx.strokeStyle=C.route;ctx.lineWidth=2;ctx.setLineDash([3,5]);ctx.beginPath();c.path.forEach((p,k)=>k?ctx.lineTo(X(p[0]),Y(p[1])):ctx.moveTo(X(p[0]),Y(p[1])));ctx.stroke();ctx.setLineDash([]);}
        continue;
      }
      const r = v.rect, along = v.up === 'N' || v.up === 'S';
      ctx.strokeStyle = C.tread; ctx.beginPath();
      if (along) for (let y = r[1] + 0.25; y < r[3] - 0.1; y += 0.25) { ctx.moveTo(X(r[0]), Y(y)); ctx.lineTo(X(r[2]), Y(y)); }
      else for (let x = r[0] + 0.25; x < r[2] - 0.1; x += 0.25) { ctx.moveTo(X(x), Y(r[1])); ctx.lineTo(X(x), Y(r[3])); }
      ctx.stroke();
    }
    // a door: its leaf swung open into the second room, or into the house for the front door
    ctx.lineWidth = Math.max(1, s / 30);
    for (const op of openings) {
      if (op.kind === 'open' || op.kind === 'opening' || op.kind === 'portal') continue;
      const r = op.rect, hz = op.o === 'h';
      ctx.strokeStyle = ['front door','primary connection'].includes(op.role) ? C.front : C.door;
      if (op.kind === 'vehicle') {
        ctx.setLineDash([3, 3]); ctx.beginPath();
        if (hz) { ctx.moveTo(X(r[0]), Y((r[1] + r[3]) / 2)); ctx.lineTo(X(r[2]), Y((r[1] + r[3]) / 2)); } else { ctx.moveTo(X((r[0] + r[2]) / 2), Y(r[1])); ctx.lineTo(X((r[0] + r[2]) / 2), Y(r[3])); }
        ctx.stroke(); ctx.setLineDash([]); continue;
      }
      if (op.kind === 'slider') { ctx.strokeRect(X(r[0]), Y((r[1] + r[3]) / 2) - 1, (r[2] - r[0]) * s, 2); continue; }
      const w = op.width;
      ctx.beginPath();
      if (hz) {
        const down = op.side !== 'S', y0 = down ? r[3] : r[1], dir = down ? 1 : -1;
        ctx.moveTo(X(r[0]), Y(y0)); ctx.lineTo(X(r[0]), Y(y0 + dir * w));
        ctx.arc(X(r[0]), Y(y0), w * s, down ? Math.PI / 2 : -Math.PI / 2, 0, down);
      } else {
        const x0 = r[2];
        ctx.moveTo(X(x0), Y(r[1])); ctx.lineTo(X(x0 + w), Y(r[1]));
        ctx.arc(X(x0), Y(r[1]), w * s, 0, Math.PI / 2);
      }
      ctx.stroke();
    }
    if(o.route&&(h.recipe==='mansion'||h.meta.heights)){
      ctx.strokeStyle=C.route;ctx.lineWidth=2;ctx.setLineDash([3,5]);ctx.globalAlpha=0.85;
      for(const run of SP.passageRuns(h).filter(r=>r.floor===F)){ctx.beginPath();run.points.forEach((p,k)=>k?ctx.lineTo(X(p[0]),Y(p[1])):ctx.moveTo(X(p[0]),Y(p[1])));ctx.stroke();}
      ctx.setLineDash([]);ctx.globalAlpha=1;
    }
    // the way through: front door, each room of the route and the doors between, the exit
    if (o.route && h.route && h.meta.routeOverlay !== false) {
      const byId = new Map(h.spaces.map((x) => [x.id, x]));
      const front = h.openings.find((x) => ['front door','primary connection'].includes(x.role)), exit = h.openings.find((x) => ['exit','secondary connection'].includes(x.role));
      const runs = [];
      let run = [];
      if (front && on(front)) run.push(mid(front.rect));
      h.route.forEach((id, k) => {
        const sp = byId.get(id);
        if (!on(sp)) { if (run.length) runs.push(run); run = []; return; }
        run.push(mid(sp.rect));
        const next = h.route[k + 1], op = next && openings.find((x) => x.rooms.includes(id) && x.rooms.includes(next));
        if (op) run.push(mid(op.rect));
      });
      if (exit && on(exit)) run.push(mid(exit.rect));
      if (run.length) runs.push(run);
      ctx.strokeStyle = C.route; ctx.lineWidth = Math.max(1.5, s / 18); ctx.setLineDash([2, 4]); ctx.globalAlpha = 0.85;
      for (const r of runs) { ctx.beginPath(); r.forEach((p, k) => (k ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // names and clear sizes
    if (o.labels || o.sizes) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const sp of spaces) {
        const r = sp.floorRects ? sp.floorRects.reduce((a,b)=>(a[2]-a[0])*(a[3]-a[1])>(b[2]-b[0])*(b[3]-b[1])?a:b) : sp.rect, cx = X((r[0] + r[2]) / 2), cy = Y((r[1] + r[3]) / 2), wpx = (r[2] - r[0]) * s;
        const label=sp.name.replace('preparation kitchen','prep kitchen').replace("butler's pantry",'butler pantry');
        ctx.font='600 12px system-ui, sans-serif';
        const wordWidth=Math.max(...label.split(' ').map(word=>ctx.measureText(word).width));
        const hpx=(r[3]-r[1])*s,vertical=(wpx<65||wordWidth>wpx-10)&&hpx>wpx*1.2;
        const width=(vertical?hpx:wpx)-10,height=(vertical?wpx:hpx)-8;
        if(width<22||height<13)continue;
        const big=12,small=11;
        ctx.save();ctx.translate(cx,cy);if(vertical)ctx.rotate(-Math.PI/2);
        // Clip to the largest actual floor rectangle; wrap text at readable
        // font sizes instead of horizontally compressing it with maxWidth.
        ctx.beginPath();ctx.rect(-width/2,-height/2,width,height);ctx.clip();
        const lines=[];
        if(o.labels){ctx.font='600 '+big+'px system-ui, sans-serif';let line='';
          for(let word of label.split(' ')){
            const next=line?line+' '+word:word;
            if(line&&ctx.measureText(next).width>width){lines.push(line);line='';}
            while(ctx.measureText(word).width>width&&word.length>1){let take=1;while(take<word.length&&ctx.measureText(word.slice(0,take+1)+'-').width<=width)take++;if(line){lines.push(line);line='';}lines.push(word.slice(0,take)+'-');word=word.slice(take);}
            line=line?line+' '+word:word;
          }if(line)lines.push(line);
        }
        const nameHeight=lines.length*15,sizeText=sp.floorRects?sp.area.toFixed(1)+' m²':sp.size[0].toFixed(2)+' × '+sp.size[1].toFixed(2);
        ctx.font=small+'px system-ui, sans-serif';const showSize=o.sizes&&nameHeight+14<=height&&ctx.measureText(sizeText).width<=width;
        if(nameHeight+(showSize?14:0)<=height){
          let y=-(nameHeight+(showSize?14:0))/2+7.5;
          ctx.fillStyle=C.text;ctx.font='600 '+big+'px system-ui, sans-serif';for(const line of lines){ctx.fillText(line,0,y);y+=15;}
          if(showSize){ctx.fillStyle=C.size;ctx.font=small+'px system-ui, sans-serif';ctx.fillText(sizeText,0,y);}
        }
        ctx.restore();
      }
      const ports=openings.filter(x=>['primary connection','secondary connection','exit','front door'].includes(x.role));
      const secondaries=h.openings.filter(x=>['secondary connection','exit'].includes(x.role));
      for(const op of ports){
        const primary=['primary connection','front door'].includes(op.role),[ex,ey]=mid(op.rect),d={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]}[op.side];
        ctx.fillStyle=primary?C.front:C.exit;ctx.font='600 '+Math.max(9,Math.min(12,s*0.36))+'px system-ui, sans-serif';
        ctx.fillText(primary?'P':'S'+(secondaries.findIndex(x=>x.id===op.id)+1),X(ex+d[0]*0.9),Y(ey+d[1]*0.7));
      }
    }
    ctx.restore();
  };
})(typeof window !== 'undefined' ? window : globalThis);

