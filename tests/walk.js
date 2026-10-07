// A walker 1 m wide, from a blueprint's JSON alone (a filler or a building,
// ground level). It stands on 2 x 2 cells of 0.5 m floor with no wall,
// partition or column between them, and steps 0.5 m at a time. A gap under
// 1 m stops it, however the room graph joins the two sides.
//
// walk1m(b) -> { floor (cells), unreached (floor cells no walker standing
//   behind a portal reaches), at (where the first few are, metres), stuck (portal ids with nowhere to stand behind),
//   pieces (walker areas that hold a portal), missed (room ids it never
//   enters) }. With no portals it walks from the first place to stand.
const G = 0.5, WALK = { door: 1, double: 1, opening: 1, slider: 1, vehicle: 1 };

function walk1m(b) {
  const W = Math.round(b.site.w / G), H = Math.round(b.site.h / G), N = W * H;
  const cell = new Int32Array(N).fill(-1), rooms = b.rooms.filter((r) => !r.level);
  rooms.forEach((r, k) => { for (const q of r.rects) for (let y = Math.round(q[1] / G); y < Math.round(q[3] / G); y++) for (let x = Math.round(q[0] / G); x < Math.round(q[2] / G); x++) cell[y * W + x] = k; });
  const own = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : cell[y * W + x]);
  // edges between cells: 1 open, 0 blocked; unset = the rule for its rooms
  const pass = new Map(), ek = (x0, y0, x1, y1) => (x0 < x1 || y0 < y1 ? x0 + ',' + y0 + ',' + x1 + ',' + y1 : x1 + ',' + y1 + ',' + x0 + ',' + y0);
  const along = (a, c, fn) => {
    const horiz = a[1] === c[1], line = Math.round((horiz ? a[1] : a[0]) / G);
    const s0 = Math.round(Math.min(horiz ? a[0] : a[1], horiz ? c[0] : c[1]) / G), s1 = Math.round(Math.max(horiz ? a[0] : a[1], horiz ? c[0] : c[1]) / G);
    for (let s = s0; s < s1; s++) fn(horiz ? ek(s, line - 1, s, line) : ek(line - 1, s, line, s), s, line, horiz);
  };
  for (const op of b.openings) if (!op.level && WALK[op.kind]) along(op.a, op.b, (k) => pass.set(k, 1));
  for (const w of b.walls) if (!w.level && w.kind === 'open') along(w.a, w.b, (k) => pass.set(k, 1));
  for (const w of b.walls) if (!w.level && w.kind === 'partition') along(w.a, w.b, (k) => pass.set(k, 0));
  const col = new Uint8Array(N);
  for (const c of b.columns || []) for (let y = Math.round(c.rect[1] / G); y < Math.round(c.rect[3] / G); y++) for (let x = Math.round(c.rect[0] / G); x < Math.round(c.rect[2] / G); x++) col[y * W + x] = 1;
  const can = (x0, y0, x1, y1) => {
    const a = own(x0, y0), c = own(x1, y1);
    if (a < 0 || c < 0) return false;
    const k = pass.get(ek(x0, y0, x1, y1));
    return a === c ? k !== 0 : k === 1;
  };
  const stand = (x, y) => {
    if (x < 0 || y < 0 || x + 1 >= W || y + 1 >= H) return false;
    for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) if (own(cx, cy) < 0 || col[cy * W + cx]) return false;
    return can(x, y, x + 1, y) && can(x, y + 1, x + 1, y + 1) && can(x, y, x, y + 1) && can(x + 1, y, x + 1, y + 1);
  };
  // walker areas
  const area = new Int32Array(N).fill(-1);
  let areas = 0;
  for (let i = 0; i < N; i++) {
    const x0 = i % W, y0 = (i - x0) / W;
    if (area[i] >= 0 || !stand(x0, y0)) continue;
    const st = [i];
    area[i] = areas;
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (area[k] < 0 && stand(nx, ny)) { area[k] = areas; st.push(k); }
      }
    }
    areas++;
  }
  // the areas each portal opens into: places to stand on the cells just inside it
  const held = new Set(), stuck = [];
  const ground = (b.portals || []).filter((p) => !p.level);
  for (const p of ground) {
    const op = b.openings.find((o) => o.id === p.opening), got = new Set();
    along(op.a, op.b, (k, s, line, horiz) => {
      const inside = horiz ? [[s, line - 1], [s, line]] : [[line - 1, s], [line, s]];
      for (const [cx, cy] of inside) {
        if (own(cx, cy) < 0) continue;
        for (const [bx, by] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) if (bx >= 0 && by >= 0 && bx < W && by < H && area[by * W + bx] >= 0 && stand(bx, by)) got.add(area[by * W + bx]);
      }
    });
    if (!got.size) stuck.push(p.id);
    for (const a of got) held.add(a);
  }
  if (!ground.length && areas) held.add(0);
  const cover = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (area[i] >= 0 && held.has(area[i])) { cover[i] = cover[i + 1] = cover[i + W] = cover[i + W + 1] = 1; }
  let floor = 0, unreached = 0;
  const inRoom = new Set(), at = [];
  for (let i = 0; i < N; i++) if (cell[i] >= 0 && !col[i]) { floor++; if (!cover[i]) { unreached++; if (at.length < 8) at.push([(i % W) * G, Math.floor(i / W) * G]); } else inRoom.add(cell[i]); }
  return { floor, unreached, at, stuck, pieces: held.size, missed: rooms.filter((r, k) => !inRoom.has(k)).map((r) => r.id) };
}

module.exports = { walk1m };
