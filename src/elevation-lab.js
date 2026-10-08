(function () {
  'use strict';
  const E = BR.ELEV, $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const args = new URLSearchParams(location.hash.slice(1));
  let current = null, selected = 0, height = 0, frame = null;
  const option = (group, value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; group.appendChild(o); };
  const templates = document.createElement('optgroup'); templates.label = 'Templates · compact connection variants';
  for (const a of BR.TPL.listArchetypes().sort((a, b) => a.name.localeCompare(b.name))) option(templates, 'template:' + a.id, a.name);
  $('template').appendChild(templates);
  const fillers = document.createElement('optgroup'); fillers.label = 'Fillers · compact connection variants';
  for (const a of BR.FILL.list().sort((a, b) => a.name.localeCompare(b.name))) option(fillers, 'filler:' + a.id, a.name);
  $('template').appendChild(fillers);
  // journeys (journeys.js): a stack of templates climbing from band 0 to band 1
  if (BR.JOURNEY) {
    const journeys = document.createElement('optgroup'); journeys.label = 'Journeys · templates stacked between two bands';
    option(journeys, 'journey:any', 'Journey · style from the seed');
    for (const k of Object.keys(BR.JOURNEY.STYLES)) option(journeys, 'journey:' + k, 'Journey · ' + k);
    $('template').appendChild(journeys);
  }
  const isJourney = () => $('template').value.startsWith('journey:');
  function defaults() {
    const id = $('template').value;
    if (isJourney()) { $('width').value = 48; $('depth').value = 40; return; }
    const a = id.startsWith('template:') ? BR.TPL.archetypes[id.slice(9)] : BR.FILL.fillers[id.slice(7)];
    $('width').value = Math.round((a.site.w[0] + a.site.w[1])) / 2;
    $('depth').value = Math.round((a.site.h[0] + a.site.h[1])) / 2;
  }
  $('template').value = 'filler:circular_hall';
  if (args.has('template') && [...$('template').options].some((o) => o.value === args.get('template'))) $('template').value = args.get('template');
  defaults();
  for (const id of ['seed', 'width', 'depth']) if (args.has(id)) $(id).value = args.get(id);
  if (['up', 'down', 'none'].includes(args.get('connection'))) $('connection').value = args.get('connection');
  if (['auto', 'ladder', 'stair', 'ramp'].includes(args.get('type'))) $('type').value = args.get('type');
  if (args.has('rise')) $('rise').value = args.get('rise');
  const typeOf = () => $('type').value || 'auto', riseOf = () => (String($('rise').value).trim() === '' ? undefined : Number($('rise').value));
  for (const id of ['ghost','labels']) if (args.has(id)) $(id).checked = args.get(id) !== '0';
  $('mode').value = args.get('mode') === 'exact' ? 'exact' : 'cutaway';

  function fit(canvas, height) {
    const width = canvas.getBoundingClientRect().width, ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const g = canvas.getContext('2d'); g.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { g, width, height };
  }
  function draw() {
    if (!current) return;
    const h = $('plan').getBoundingClientRect().height, { g, width } = fit($('plan'), h);
    g.clearRect(0, 0, width, h);
    const scale = Math.min((width - 32) / current.site.w, (h - 32) / current.site.h);
    frame = { scale, ox: (width - current.site.w * scale) / 2, oy: (h - current.site.h * scale) / 2 };
    E.drawCutaway(g, current, { ...frame, cutZ: height, exact: $('mode').value === 'exact', ghost: $('ghost').checked, labels: $('labels').checked, zones: $('connection').value === 'none' });
    const profile = fit($('profile'), 180);
    E.drawProfile(profile.g, current, profile.width, 180, height);
  }
  function chooseFloor(level) {
    if (!current) return;
    selected = level; $('floor').value = String(level); $('mode').value = 'exact'; setHeight(current.levels.find((l) => l.index === level).elevation, false);
  }
  /** a journey's climbs and stages, in place of a template's capabilities */
  function journeyReport(b) {
    const src = b.source, legs = src.stages.filter((st) => st.leg);
    return '<div><b>' + esc(src.style) + '</b> journey · ' + legs.length + ' climbs: ' + legs.map((st, k) => esc(st.leg) + ' ' + E.zLabel(src.rises[k])).join(', ') + '</div>' +
      '<div class="muted">' + src.stages.map((st) => esc(st.filler) + ' at ' + E.zLabel(b.bands[0].elevation + st.z)).join(' → ') + '</div>';
  }
  function report(b) {
    const check = E.validate(b);
    $('status').innerHTML = '<span class="' + (check.errors.length ? 'bad' : 'good') + '">' + (check.errors.length ? check.errors.length + ' spatial issue(s)' : 'Spatial checks passed') + '</span>' +
      (check.errors.length ? '<br>' + check.errors.map(esc).join('<br>') : '') + (check.warnings.length ? '<br><span class="warn">' + check.warnings.map(esc).join('<br>') + '</span>' : '');
    $('capabilities').innerHTML = b.kind === 'journey' ? journeyReport(b) : ['up', 'down'].map((dir) => {
      const c = b.capabilities[dir], fits = (b.connectionZones || []).filter((z) => z.direction === dir);
      return '<div>' + (dir === 'up' ? '↑ Upward' : '↓ Downward') + ' · ' + (c.candidates.length ? 'fits ' + (fits.map((z) => z.type + (z.shape !== 'shaft' ? ' (' + z.shape + ')' : '')).join(', ') || 'ladder') : 'needs another layout') +
        (c.selected ? ' · <b>' + esc(c.type || 'connected') + '</b> in this variant' : ' · optional') + '</div>';
    }).join('') + '<div class="muted">Prefers ' + esc(E.preferenceOf(b).join(' → ')) + '</div>';
    $('summary').textContent = b.rooms.length + ' rooms · ' + b.levels.length + ' floor elevations · ' + b.bands.length + ' reference bands';
    $('rooms').innerHTML = b.rooms.map((r) => '<tr><td><button type="button" data-level="' + r.level + '">' + esc(r.name) + '</button></td><td>' + E.zLabel(r.floorZ) + '</td><td>' + r.ceiling + ' m</td><td>' + esc(r.band) + '</td></tr>').join('');
    const surfaces = new Map(b.surfaces.map((s) => [s.id, s]));
    $('links').innerHTML = b.connectors.map((c) => '<tr><td>' + esc(c.kind) + (c.shape ? ' · ' + esc(c.shape) : '') + '</td><td>' + E.zLabel(surfaces.get(c.from).floorZ) + '</td><td>' + E.zLabel(surfaces.get(c.to).floorZ) + '</td><td>' + c.width + ' m</td><td>' + (c.kind === 'ladder' ? 'vertical' : (c.path.slice(1).reduce((n, p, k) => n + Math.hypot(p[0] - c.path[k][0], p[1] - c.path[k][1]), 0)).toFixed(1) + ' m · ' + Math.round(Math.atan(c.slope) * 180 / Math.PI) + '°') + '</td><td>' + E.reservationsOf(c).length + '</td><td>' + esc(c.direction === 'both' ? 'Both ways' : c.direction) + '</td></tr>').join('') || '<tr><td colspan="7" class="muted">No physical connection selected: zones below are opportunities only (no cutout, reservation or edge).</td></tr>';
    $('zones').innerHTML = (b.connectionZones || []).map((z) => '<tr><td>' + (z.direction === 'up' ? '↑ up' : '↓ down') + '</td><td>' + esc(z.type) + '</td><td>' + esc(z.shape) + '</td><td>' + esc((b.rooms.find((r) => r.id === z.room) || {}).name || z.room) + '</td><td>' + E.zLabel(z.targetZ - z.floorZ) + '</td><td>' + (() => { const r = BR.TG.bbox(z.rects); return (r[2] - r[0]).toFixed(1) + ' × ' + (r[3] - r[1]).toFixed(1) + ' m'; })() + '</td><td>' + (z.state === 'connected' ? '<b>connected</b>' : 'available') + '</td></tr>').join('') || '<tr><td colspan="7" class="muted">No zones.</td></tr>';
    $('rooms').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => chooseFloor(+button.dataset.level)));
  }
  function build() {
    window.__ready = false; current = null;
    $('export').disabled = true; $('error').style.display = 'none'; $('planwrap').style.display = 'block';
    $('hover').textContent = ''; $('status').textContent = 'Building…';
    try {
      const seed = Number($('seed').value), w = Number($('width').value), h = Number($('depth').value), id = $('template').value, direction = $('connection').value;
      if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295 || ![w,h].every((v) => Number.isFinite(v) && v >= 1 && v <= 128 && v * 2 % 1 === 0)) throw new Error('Use a whole seed and site dimensions from 1–128 m in 0.5 m increments.');
      const site = { w, h };
      for (const k of ['connection', 'type', 'rise']) $(k).disabled = isJourney();
      if (isJourney()) {
        current = BR.JOURNEY.generate({ id: 'journey:lab', seed, w, h, lower: 0, style: id === 'journey:any' ? undefined : id.slice(8) });
        current.capabilities = E.capabilities(current); // as the world export has it
      }
      else {
      const source = id.startsWith('template:') ? BR.TPL.generate({ archetype: id.slice(9), seed, site, wrongness: 0 }) : BR.FILL.generate({ filler: id.slice(7), seed, site, connections: BR.FILL.sampleConnections(site, 2, seed) });
      current = direction === 'none' ? E.prepare(source) : E.connectionVariant(source, { direction, type: typeOf(), rise: riseOf() });
      }
      $('floor').innerHTML = current.levels.map((l) => {
        const band = current.bands.find((b) => b.elevation === l.elevation);
        return '<option value="' + l.index + '">' + E.zLabel(l.elevation) + (band ? ' · ' + esc(band.id) + ' band' : ' · internal floor') + '</option>';
      }).join('');
      selected = current.levels.find((l) => l.elevation === current.bands[0].elevation).index;
      height = current.levels.find((l) => l.index === selected).elevation;
      $('floor').value = String(selected);
      if (args.has('cut') && Number.isFinite(Number(args.get('cut')))) height = Number(args.get('cut'));
      args.delete('cut');
      const restored = current.levels.find((l) => l.elevation === height);
      if (restored) { selected = restored.index; $('floor').value = String(selected); }
      if ($('mode').value === 'exact' && !current.levels.some((l) => l.elevation === height)) $('mode').value = 'cutaway';
      heightControls(); report(current); draw(); saveHash(); $('export').disabled = false;
    } catch (err) {
      current = null; $('error').textContent = err.message; $('error').style.display = 'block'; $('planwrap').style.display = 'none';
      $('status').textContent = 'This instance needs a different layout or territory.';
      $('summary').textContent = ''; $('capabilities').textContent = ''; $('floor').innerHTML = ''; $('rooms').innerHTML = ''; $('links').innerHTML = ''; $('zones').innerHTML = '';
      const p = fit($('profile'), 180); p.g.clearRect(0, 0, p.width, 180);
    }
    window.__ready = true;
  }
  for (const id of ['connection','type','rise','seed','width','depth']) $(id).addEventListener('change', build);
  $('template').addEventListener('change', () => { defaults(); build(); });
  $('next').addEventListener('click', () => { $('seed').value = (Number($('seed').value) + 1) >>> 0; build(); });
  $('floor').addEventListener('change', () => chooseFloor(Number($('floor').value)));
  for (const id of ['ghost','labels']) $(id).addEventListener('change', () => { draw(); saveHash(); });
  $('mode').addEventListener('change', () => { if (!current) return; if ($('mode').value === 'exact') height = current.levels.find((l) => l.index === selected).elevation; heightControls(); draw(); saveHash(); });
  $('height').addEventListener('input', () => setHeight(Number($('height').value), true));
  $('height-value').addEventListener('change', () => setHeight($('height-value').value.trim() ? Number($('height-value').value) : NaN, true));
  $('export').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = 'elevation-' + (current.archetype || current.filler || current.kind) + '-' + current.seed + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('plan').addEventListener('pointermove', (event) => {
    if (!current || !frame) return;
    const r = $('plan').getBoundingClientRect(), x = (event.clientX - r.left - frame.ox) / frame.scale, y = (event.clientY - r.top - frame.oy) / frame.scale;
    const hit = E.hitCutaway(current, x, y, height);
    const room = $('mode').value === 'exact' ? (hit && hit.floorZ === height ? hit.room : null) : hit && hit.room;
    $('hover').textContent = room ? room.name + ' · floor ' + E.zLabel(room.floorZ) + ' · ceiling ' + E.zLabel(room.ceilingZ) + ' · home band ' + room.band : '';
  });
  $('plan').addEventListener('click', (event) => {
    if (!current || !frame) return;
    const r = $('plan').getBoundingClientRect(), c = E.connectionAt(current, (event.clientX - r.left - frame.ox) / frame.scale, (event.clientY - r.top - frame.oy) / frame.scale, height, $('ghost').checked);
    if (!c) return;
    const ends = c.landings.map((p) => p[2]), z = ends.find((z) => z > height + 1e-7) ?? Math.min(...ends);
    chooseFloor(current.levels.find((l) => l.elevation === z).index);
  });
  function heightControls() {
    const floors = E.floorElevations(current);
    $('height').min = Math.min(floors[0] - 1, height); $('height').max = Math.max(floors[floors.length - 1] + 1, height);
    $('height').value = String(height); $('height-value').value = String(height);
  }
  function setHeight(z, cutaway) {
    if (!current || !Number.isFinite(z)) { if (current) heightControls(); return; }
    height = z; if (cutaway) $('mode').value = 'cutaway';
    const floor = current.levels.find((l) => l.elevation === z); if (floor) { selected = floor.index; $('floor').value = String(selected); }
    heightControls(); $('hover').textContent = ''; draw(); saveHash();
  }
  function saveHash() {
    if (!current) return;
    const q = new URLSearchParams({ template: $('template').value, seed: String(current.seed), connection: $('connection').value, type: typeOf(), rise: riseOf() === undefined ? '' : String(riseOf()), width: String(current.site.w), depth: String(current.site.h), cut: String(height), mode: $('mode').value, ghost: $('ghost').checked ? '1' : '0', labels: $('labels').checked ? '1' : '0' });
    history.replaceState(null, '', '#' + q);
  }
  $('plan').addEventListener('pointerleave', () => { $('hover').textContent = ''; });
  new ResizeObserver(draw).observe($('workspace'));
  window.__elevationLab = { build, get blueprint() { return current; } };
  build();
})();
