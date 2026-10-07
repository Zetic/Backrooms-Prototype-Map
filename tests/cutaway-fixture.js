// Presentation fixture only. Not registered as a generation template.
module.exports = function fixture() {
  const rects = [[0,0,10,8], [4,0,10,4], [7,1,10,4], [11,0,15,8]];
  const rooms = rects.map((q,k)=>({id:'r'+k,name:['Lower rooms','Mezzanine','Upper pocket','Tall hall'][k],type:'room',zone:k===1?'circulation':'public',level:k===3?0:k,floorZ:[0,2.75,5.5,0][k],ceiling:[2.5,2.5,2.5,8][k],rects:[q],area:(q[2]-q[0])*(q[3]-q[1]),tags:[]}));
  const walls = rooms.flatMap((r)=>{const q=r.rects[0], ps=[[q[0],q[1]],[q[2],q[1]],[q[2],q[3]],[q[0],q[3]]];return ps.map((a,k)=>({id:r.id+':w'+k,kind:'exterior',level:r.level,floorZ:r.floorZ,rooms:[r.id,null],a,b:ps[(k+1)%4]}));});
  const path = [[1,6,0],[9,6,1.75],[9,2,2.75]];
  return {schema:'br.elevation/0.1',site:{w:15,h:8,rects:[[0,0,15,8]]},name:'Display fixture',rooms,walls,openings:[],portals:[],levels:[{index:0,elevation:0},{index:1,elevation:2.75},{index:2,elevation:5.5}],graph:{nodes:rooms.map((r)=>r.id),edges:[]},holes:[],surfaces:rooms.map((r)=>({id:'s:'+r.id,room:r.id,floorZ:r.floorZ,rects:r.rects})),connectors:[{id:'ramp',kind:'ramp',from:'s:r0',to:'s:r1',width:1.5,path,landings:[path[0],path[path.length-1]],reservation:{rects:[[1,5.25,9,6.75]]}}]};
};
