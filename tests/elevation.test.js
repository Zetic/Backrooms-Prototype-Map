const assert = require('node:assert/strict');
const { BR, MODE } = require('./helpers');
require('../src/tpl/elevation'); require('../src/band-world');
const E = BR.ELEV, copy = (b) => JSON.parse(JSON.stringify(b));
let builds = 0;
function good(b) { assert.deepEqual(E.validate(b).errors, [], b.name); builds++; }
function bad(b, pattern) { assert(E.validate(b).errors.some((s) => pattern.test(s)), E.validate(b).errors.join('; ')); }

const fixture = E.ladderVariant(BR.TPL.generate({ archetype: 'closet', seed: 7, wrongness: 0 }));
const start = fixture.connectors[0].from, end = fixture.connectors[0].to;
good(fixture);
assert.equal(E.reachable(fixture, [start]).size, fixture.surfaces.length);
{
  const b = copy(fixture); b.navigation.edges = []; bad(b, /unreachable/);
  assert(!E.reachable(b, [start]).has(end));
  const overlap = copy(fixture); overlap.rooms[1].floorZ = 1; E.refresh(overlap); bad(overlap, /overlaps.*in 3D/);
  const landing = copy(fixture); landing.connectors[0].landings[0][2] += .5; bad(landing, /landing does not meet/);
  const reservation = copy(fixture); reservation.volumes = reservation.volumes.filter((v) => v.id !== reservation.connectors[0].reservations[0].id); bad(reservation, /no spatial reservation/);
  const holes = copy(fixture); holes.holes = []; bad(holes, /cutouts/);
  const low = copy(fixture); low.rooms[0].ceiling = 1; low.rooms[0].ceilingZ = low.rooms[0].floorZ + 1; E.refresh(low); bad(low, /headroom/);
  const directed = copy(fixture); directed.connectors[0].direction = 'forward'; E.refresh(directed);
  assert(E.reachable(directed, [start]).has(end)); assert(!E.reachable(directed, [end]).has(start));
}
console.log('ok   physical ladder endpoints, cuts, reservations, clearance, overlaps and directed reachability');
{
  const ledger = new E.ReservationIndex();
  const protectedVoid = [{ id: 'void', kind: 'void', rects: [[0,0,4,4]], z0: 0, z1: 8 }];
  assert(ledger.reserve('owner', protectedVoid).ok);
  const intruder = [{ id: 'room', kind: 'room', rects: [[1,1,2,2]], z0: 3, z1: 6 }];
  assert(!ledger.reserve('neighbor', intruder).ok); assert.equal(ledger.snapshot().length, 1);
  const free = [{ id: 'free', kind: 'room', rects: [[5,0,6,2]], z0: 0, z1: 3 }];
  assert(ledger.reserve('neighbor', free).ok);
  const saved = ledger.snapshot(); assert(!ledger.reserve('owner', protectedVoid.concat(free)).ok);
  assert.deepEqual(ledger.snapshot(), saved);
  assert(ledger.reserve('owner', protectedVoid).ok);
  const detached = ledger.snapshot(); detached[0].volumes[0].z0 = -100; assert.notDeepEqual(ledger.snapshot(), detached);
  assert.throws(() => ledger.reserve('broken', [{ rects: [[0,0,1,1]], z0: 2, z1: 1 }]), /invalid/);
  ledger.release('neighbor'); assert.equal(ledger.snapshot().length, 1);
}
console.log('ok   protected voids, atomic reservation replacement and detached snapshots');

// Keep physical ramp validation covered after removing the atrium generator.
{
  const rooms = [{id:'from',floorZ:0,band:'ground',rects:[[0,0,2,4]]},{id:'to',floorZ:4,band:'up',rects:[[18,0,20,4]]}].map((r)=>({...r,ceiling:3,ceilingZ:r.floorZ+3,tags:[]}));
  const path = [[2,2,0],[18,2,4]];
  const b = {fillId:'ramp-fixture',site:{w:20,h:4},rooms,bands:[{id:'ground',elevation:0},{id:'up',elevation:4}],walls:rooms.map((r,k)=>({id:'w'+k,kind:'exterior',floorZ:r.floorZ,a:[k?18:2,0],b:[k?18:2,4],rooms:[r.id,null]})),openings:rooms.map((r,k)=>({id:'op'+k,wall:'w'+k,kind:'door',floorZ:r.floorZ,a:[k?18:2,1],b:[k?18:2,3],rooms:[r.id,null],width:2,height:2.2})),portals:[{id:'main',room:'from',opening:'op0',main:true}],graph:{nodes:['from','to'],edges:[]},holes:[],voids:[],route:path,connectors:[{id:'ramp',kind:'ramp',from:'s:from',to:'s:to',width:2,clearance:2.2,direction:'both',state:'connected',path,landings:copy(path),reservation:{id:'ramp-volume',kind:'connector',rects:[[2,1,18,3]],z0:-.25,z1:6.2}}]};
  E.refresh(b); good(b);
  const steep=copy(b);steep.connectors[0].path[1][0]=17;bad(steep,/too steep/);
  const wide=copy(b);wide.connectors[0].width=3;bad(wide,/full width outside/);
  const missing=copy(b);missing.openings=missing.openings.slice(0,1);bad(missing,/matching physical opening/);
}
console.log('ok   ramps enforce slope, occupied width, landing openings and reservations');

let potentials = 0, variants = 0;
// Every instance, not just the first seed that works: a house reaching its
// garage wing only through the garage door, or a yard lot built in pieces,
// still gets its compact fallback in both directions.
for (const a of BR.TPL.listArchetypes()) {
  let tested = 0;
  for (let seed = 1; seed <= MODE.size(2, 6); seed++) {
    const source = BR.TPL.generate({ archetype: a.id, seed: seed * 7919, approach: 'SENW'[seed % 4] });
    if (source.error) continue;
    const before = JSON.stringify(source), b = E.prepare(source);
    assert.equal(JSON.stringify(source), before, 'adapter never mutates source');
    assert.deepEqual(E.validate(b).errors, [], a.id + '#' + seed + ' is a valid elevation blueprint as built');
    for (const dir of ['up','down']) assert(b.capabilities[dir].supported && b.capabilities[dir].candidates.length, a.id + ' ' + dir);
    for (const direction of ['up','down']) { good(E.ladderVariant(source, { direction })); variants++; }
    tested++;
  }
  assert(tested, 'could not build ' + a.id);
  potentials++;
}
{
  // the houses that broke the fallback before: wings reached through a second
  // door. The house engine now joins every wing to its front door (`inside`),
  // so they are made here with that off.
  let multi = 0;
  const house = BR.TPL.engines.house, inside = house.inside;
  house.inside = false;
  for (const id of ['ranch', 'bungalow', 'suburban']) for (let seed = 1; seed <= MODE.size(16, 40); seed++) {
    const source = BR.TPL.generate({ archetype: id, seed: seed * 31, approach: 'SENW'[seed % 4] });
    const main = source.portals.find((p) => p.main), adj = new Map(source.rooms.map((r) => [r.id, []]));
    for (const [x, y, k] of source.graph.edges) if (adj.has(x) && adj.has(y) && !['window', 'false'].includes(k)) { adj.get(x).push(y); adj.get(y).push(x); }
    const seen = new Set([main.room]), todo = [main.room];
    while (todo.length) for (const v of adj.get(todo.pop())) if (!seen.has(v)) { seen.add(v); todo.push(v); }
    if (seen.size === source.rooms.length) continue;
    multi++;
    for (const direction of ['up','down']) { good(E.ladderVariant(source, { direction })); variants++; }
  }
  house.inside = inside;
  assert(multi >= 5, 'houses with a wing behind a second door are exercised: ' + multi);
}
{
  // yard lots on the map are built in pieces: the front yard and each door's passage
  const w = new BR.BandWorld(31337); let yards = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of w.cell(i, j, 0).sites) {
    if (s.kind !== 'lot') continue;
    const b = w.spatial(s).filler, a = JSON.parse(JSON.stringify(b)); a.capabilities = E.capabilities(a);
    assert.deepEqual(E.validate(a).errors, [], s.id + ' yard'); yards++;
  }
  assert(yards > 2, 'yard lots checked: ' + yards);
}
for (const f of BR.FILL.list()) {
  const site = { w: Math.round(f.site.w[1] * 2) / 2, h: Math.round(f.site.h[1] * 2) / 2 }, source = BR.FILL.generate({ filler: f.id, site, seed: 7, connections: BR.FILL.sampleConnections(site, 2, 7) });
  assert(!source.error, f.id);
  const b = E.prepare(source);
  for (const dir of ['up','down']) assert(b.capabilities[dir].candidates.length, f.id + ' ' + dir);
  for (const direction of ['up','down']) { good(E.ladderVariant(source, { direction })); variants++; }
  potentials++;
}
for (const direction of ['up','down']) for (const approach of ['S','E','N','W']) for (let seed = 1; seed <= MODE.size(4, 12); seed++) {
  const source = BR.TPL.generate({ archetype:'closet', seed, approach, wrongness:0, site: approach === 'E' || approach === 'W' ? {w:1,h:1.5} : {w:1.5,h:1} });
  const b = E.ladderVariant(source,{direction}); good(b); variants++;
  assert.equal(b.connectors[0].state, 'connected');
  assert.equal(b.capabilities[direction].selected, true);
  assert.equal(b.holes.length, 2);
  assert.equal(E.reachable(b, ['s:r0']).size, 2);
  assert.equal(b.rooms.find((r) => r.id.startsWith('elev:landing')).floorZ, direction === 'up' ? 8 : -8);
}
for (const id of ['circular_hall','twin_domes','radial_suite','sector']) for (const direction of ['up','down']) {
  const source = BR.FILL.generate({ filler:id, seed:7, site:{w:32,h:24}, connections:BR.FILL.sampleConnections({w:32,h:24},2,7) });
  const b = E.ladderVariant(source,{direction}); good(b); variants++;
  for (const c of b.curves || []) assert.equal(b.levels[c.level].elevation, 0, 'curves stay on the original elevation after inserting a lower floor');
}
console.log('ok   ' + potentials + ' templates/fillers support both directions; ' + variants + ' real variants including minimum-size closets and architectural fillers');
assert.equal(E.generate, undefined, 'retired atrium generator is absent');
assert.throws(() => E.ladderVariant(BR.TPL.generate({archetype:'closet',seed:7}),{direction:'sideways'}), /direction/);
assert.throws(() => E.ladderVariant(BR.TPL.generate({archetype:'closet',seed:7}),{rise:2}), /separation/);
{
  const tall = BR.TPL.generate({archetype:'lone_street',seed:7,wrongness:0});
  assert(tall.rooms[0].ceiling > 8);
  const v = E.ladderVariant(tall,{direction:'up'});
  assert(v.connectors[0].landings[1][2] > tall.rooms[0].ceiling + E.SLAB, 'default landing fits above a tall host ceiling');
  assert.throws(() => E.ladderVariant(tall,{direction:'up',rise:8}), /overlaps/, 'an explicit destination elevation cannot move silently');
}
const source = BR.TPL.generate({archetype:'closet',seed:7,wrongness:0}), ledger = new E.ReservationIndex();
const chosen = E.ladderVariant(source,{direction:'up'});
assert(ledger.reserve('occupied',chosen.volumes).ok);
assert.throws(() => E.ladderVariant(source,{direction:'up',reservations:ledger}), /conflicts/);
console.log('All elevation data checks passed (' + builds + ' complete layouts).');
