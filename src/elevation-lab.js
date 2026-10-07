(function () {
  'use strict';
  const E = BR.ELEV, $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const args = new URLSearchParams(location.hash.slice(1));
  let current = null, selected = 0, frame = null;
  const option = (group, value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; group.appendChild(o); };
  option($('template'), 'terraced_atrium', 'Terraced atrium · vertical exploration');
  const templates = document.createElement('optgroup'); templates.label = 'Templates · compact connection variants';
  for (const a of BR.TPL.listArchetypes().sort((a, b) => a.name.localeCompare(b.name))) option(templates, 'template:' + a.id, a.name);
  $('template').appendChild(templates);
  const fillers = document.createElement('optgroup'); fillers.label = 'Fillers · compact connection variants';
  for (const a of BR.FILL.list().sort((a, b) => a.name.localeCompare(b.name))) option(fillers, 'filler:' + a.id, a.name);
  $('template').appendChild(fillers);
  function defaults() {
    const id = $('template').value, journey = id === 'terraced_atrium';
    const a = journey ? { site: { w: [40, 40], h: [36, 36] } } : id.startsWith('template:') ? BR.TPL.archetypes[id.slice(9)] : BR.FILL.fillers[id.slice(7)];
    $('width').value = Math.round((a.site.w[0] + a.site.w[1])) / 2;
    $('depth').value = Math.round((a.site.h[0] + a.site.h[1])) / 2;
    $('connection').querySelector('[value="none"]').disabled = journey;
    if (journey && $('connection').value === 'none') $('connection').value = 'up';
  }
  if (args.has('template') && [...$('template').options].some((o) => o.value === args.get('template'))) $('template').value = args.get('template');
  defaults();
  for (const id of ['seed', 'width', 'depth']) if (args.has(id)) $(id).value = args.get(id);
  if (['up', 'down', 'none'].includes(args.get('connection'))) $('connection').value = args.get('connection');
  if ($('template').value === 'terraced_atrium' && $('connection').value === 'none') $('connection').value = 'up';

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
    E.draw(g, current, Object.assign({}, frame, { level: selected, ghost: $('ghost').checked, territories: $('territories').checked, labels: $('labels').checked }));
    const profile = fit($('profile'), 180);
    E.drawProfile(profile.g, current, profile.width, 180, current.levels[selected].elevation);
  }
  function chooseFloor(level) {
    selected = level; $('floor').value = String(level); $('hover').textContent = ''; draw();
  }
  function report(b) {
    const check = E.validate(b);
    $('status').innerHTML = '<span class="' + (check.errors.length ? 'bad' : 'good') + '">' + (check.errors.length ? check.errors.length + ' spatial issue(s)' : 'Spatial checks passed') + '</span>' +
      (check.errors.length ? '<br>' + check.errors.map(esc).join('<br>') : '') + (check.warnings.length ? '<br><span class="warn">' + check.warnings.map(esc).join('<br>') + '</span>' : '');
    $('capabilities').innerHTML = ['up', 'down'].map((dir) => {
      const c = b.capabilities[dir];
      return '<div>' + (dir === 'up' ? '↑ Upward' : '↓ Downward') + ' · ' + (c.candidates.length ? 'supported' : 'needs another layout') + (c.selected ? ' · connected in this variant' : ' · optional') + '</div>';
    }).join('');
    $('summary').textContent = b.rooms.length + ' rooms · ' + b.levels.length + ' floor elevations · ' + b.bands.length + ' reference bands';
    $('rooms').innerHTML = b.rooms.map((r) => '<tr><td><button type="button" data-level="' + r.level + '">' + esc(r.name) + '</button></td><td>' + E.zLabel(r.floorZ) + '</td><td>' + r.ceiling + ' m</td><td>' + esc(r.band) + '</td></tr>').join('');
    const surfaces = new Map(b.surfaces.map((s) => [s.id, s]));
    $('links').innerHTML = b.connectors.map((c) => '<tr><td>' + esc(c.kind) + '</td><td>' + E.zLabel(surfaces.get(c.from).floorZ) + '</td><td>' + E.zLabel(surfaces.get(c.to).floorZ) + '</td><td>' + c.width + ' m</td><td>' + esc(c.direction === 'both' ? 'Both ways' : c.direction) + '</td></tr>').join('') || '<tr><td colspan="5" class="muted">Up/down candidates are available; no physical connection selected.</td></tr>';
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
      if (id === 'terraced_atrium') current = E.generate({ seed, site, direction: direction === 'none' ? 'up' : direction });
      else {
        const source = id.startsWith('template:') ? BR.TPL.generate({ archetype: id.slice(9), seed, site, wrongness: 0 }) : BR.FILL.generate({ filler: id.slice(7), seed, site, connections: BR.FILL.sampleConnections(site, 2, seed) });
        current = direction === 'none' ? E.prepare(source) : E.ladderVariant(source, { direction });
      }
      const q = new URLSearchParams({ template: id, seed: String(seed), connection: direction, width: String(w), depth: String(h) });
      history.replaceState(null, '', '#' + q);
      $('floor').innerHTML = current.levels.map((l) => {
        const band = current.bands.find((b) => b.elevation === l.elevation);
        return '<option value="' + l.index + '">' + E.zLabel(l.elevation) + (band ? ' · ' + esc(band.id) + ' band' : ' · internal floor') + '</option>';
      }).join('');
      selected = current.levels.find((l) => l.elevation === current.bands[0].elevation).index;
      $('floor').value = String(selected);
      report(current); draw(); $('export').disabled = false;
    } catch (err) {
      current = null; $('error').textContent = err.message; $('error').style.display = 'block'; $('planwrap').style.display = 'none';
      $('status').textContent = 'This instance needs a different layout or territory.';
      $('summary').textContent = ''; $('capabilities').textContent = ''; $('floor').innerHTML = ''; $('rooms').innerHTML = ''; $('links').innerHTML = '';
      const p = fit($('profile'), 180); p.g.clearRect(0, 0, p.width, 180);
    }
    window.__ready = true;
  }
  for (const id of ['connection','seed','width','depth']) $(id).addEventListener('change', build);
  $('template').addEventListener('change', () => { defaults(); build(); });
  $('next').addEventListener('click', () => { $('seed').value = (Number($('seed').value) + 1) >>> 0; build(); });
  $('floor').addEventListener('change', () => chooseFloor(Number($('floor').value)));
  for (const id of ['ghost','territories','labels']) $(id).addEventListener('change', draw);
  $('export').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = 'elevation-' + current.archetype + '-' + current.seed + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('plan').addEventListener('pointermove', (event) => {
    if (!current || !frame) return;
    const r = $('plan').getBoundingClientRect(), x = (event.clientX - r.left - frame.ox) / frame.scale, y = (event.clientY - r.top - frame.oy) / frame.scale;
    const room = current.rooms.find((r) => r.level === selected && r.rects.some((q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]));
    $('hover').textContent = room ? room.name + ' · floor ' + E.zLabel(room.floorZ) + ' · ceiling ' + E.zLabel(room.ceilingZ) + ' · home band ' + room.band : '';
  });
  $('plan').addEventListener('pointerleave', () => { $('hover').textContent = ''; });
  new ResizeObserver(draw).observe($('workspace'));
  window.__elevationLab = { build, get blueprint() { return current; } };
  build();
})();
