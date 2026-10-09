// Exact-output regression fixtures from upstream a2e0942, plus spatial boundary
// and rollback behavior. Elapsed time is the only field omitted from fixtures.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
for (const f of ['core', 'space/recipes', 'space/space', 'space/route']) require(path.join(__dirname, '..', 'src', f + '.js'));
const SP = globalThis.BR.SPACE, { RoomIndex, fits, addRoom, popRoom } = SP._routeInternal;
const check = (name, fn) => { fn(); console.log('ok   ' + name); };

check('all house outputs match the original revision across seeds and wrongness', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'space-output-fixture.json'), 'utf8'));
  for (const c of fixture.cases) {
    const hash = crypto.createHash('sha256');
    for (const seed of c.seeds) {
      const h = SP.generate({ recipe: c.recipe, seed, ...(c.wrong === null ? {} : { wrong: c.wrong }) });
      if (h.meta) delete h.meta.ms;
      hash.update(JSON.stringify(h) + '\n');
    }
    assert.equal(hash.digest('hex'), c.sha256, c.recipe + ', wrongness ' + c.wrong);
  }
});

check('spatial shortlist agrees with independent wall-pair checks, including negative coordinates', () => {
  const ix = new RoomIndex();
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) ix.add({ r: [x * 1000, y * 1000, x * 1000 + 300, y * 1000 + 300], order: ix.rooms.length });
  const queries = [[315, 0, 615, 300], [359, 0, 659, 300], [360, 0, 660, 300], [361, 0, 661, 300], [-615, -1000, -315, -700], [315, 270, 615, 570], [0, 0, 300, 300]];
  const rng = new BR.Rng(12345);
  for (let k = 0; k < 400; k++) { const x = rng.int(-500, 500) * 5, y = rng.int(-500, 500) * 5; queries.push([x, y, x + rng.int(10, 100) * 5, y + rng.int(10, 100) * 5]); }
  for (const r of queries) {
    const candidate = { r }, ws = SP._internal.pairs(ix.rooms.concat(candidate), {});
    const want = ws ? ws.filter((w) => (w.a === candidate || w.b === candidate) && w.s1 - w.s0 >= 60).length : -1;
    assert.equal(fits(r, ix.query(r, 60), []), want, JSON.stringify(r));
  }
  assert.equal(fits([315, 0, 615, 300], ix.query([315, 0, 615, 300], 60), [[400, 0, 450, 100]]), -1, 'reserved exit ground');
});

check('index covers long rooms across buckets and returns neighbors in placement order', () => {
  const ix = new RoomIndex();
  for (let k = 0; k < 9; k++) ix.add({ r: [k * 2000, 10000, k * 2000 + 300, 10300], order: k });
  const long = { r: [-1800, -600, 1800, -300], order: 9 };
  ix.add(long);
  for (const x of [-1800, -600, 0, 600, 1800]) assert(ix.query([x, -615, x + 5, -610], 15).includes(long));
  const found = ix.query([-3000, -3000, 20000, 20000], 0, true);
  assert.deepEqual(found.map((n) => n.order), Array.from({ length: 10 }, (_, k) => k));
  assert.equal(found.filter((n) => n === long).length, 1);
});

check('temporary branch rollback removes floor occupancy and every incidental wall', () => {
  const ctx = { rooms: [], indexes: [], walls: [] };
  const a = { r: [-600, -600, -300, -300], floor: 0 }, b = { r: [-285, -600, 15, -300], floor: 0 };
  addRoom(ctx, a); addRoom(ctx, b);
  const original = ctx.walls.slice();
  const hall = { r: [-600, -285, 15, -175], floor: 0 };
  addRoom(ctx, hall);
  assert.equal(ctx.walls.length, 3, 'branch touches both earlier rooms');
  popRoom(ctx);
  assert.deepEqual(ctx.walls, original);
  assert(!ctx.indexes[0].query(hall.r).includes(hall));
  addRoom(ctx, { r: [-600, -285, 15, -175], floor: 1 });
  assert.equal(ctx.walls.length, 1, 'different floor has no shared wall');
  popRoom(ctx);
  assert.equal(ctx.indexes[1].rooms.length, 0);
});

check('profiling preserves seeded output and still evaluates all 20 house attempts', () => {
  let rollbacks = 0;
  for (const recipe of ['passage', 'passage1', 'backdoor']) {
    const a = SP.generate({ recipe, seed: 7 }), b = SP.generate({ recipe, seed: 7, profile: true });
    assert.equal(b.meta.candidates, 20);
    assert(b.meta.profile.fitCalls > 0 && b.meta.profile.cacheHits > 0);
    assert(b.meta.profile.roomChecks < b.meta.profile.fullScanRooms);
    rollbacks += b.meta.profile.branchRollbacks;
    delete a.meta.ms; delete b.meta.ms; delete b.meta.profile;
    assert.deepEqual(b, a);
  }
  assert(rollbacks > 0, 'generated houses exercised branch rollback');
});
