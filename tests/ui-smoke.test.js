// Executes the actual HTML controller with a minimal DOM adapter. Generation
// is real; drawing is stubbed (BR.draw builds the sites in view and records
// the call). This is not a browser-engine test.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { BR, harness } = require('./helpers'), { check, finish } = harness();
require('../src/tpl/elevation-view');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let exported = null, download = null;
class Element {
  constructor(tag = 'DIV') {
    this.tagName = tag.toUpperCase(); this.events = {}; this.style = {}; this.value = ''; this.checked = false; this.innerHTML = ''; this.textContent = ''; this.children = [];
    const classes = new Set();
    this.classList = { add: (k) => classes.add(k), remove: (k) => classes.delete(k), toggle: (k) => (classes.has(k) ? classes.delete(k) : classes.add(k)) };
  }
  addEventListener(name, fn) { (this.events[name] || (this.events[name] = [])).push(fn); }
  dispatch(name, extra = {}) { for (const fn of this.events[name] || []) fn({ target: this, preventDefault() {}, ...extra }); }
  appendChild(el) { this.children.push(el); }
  setPointerCapture() {}
  click() { if (this.tagName === 'A') download = { href: this.href, name: this.download }; this.dispatch('click'); }
  getContext() { return {}; }
}
const elements = new Map();
for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/gi)) elements.set(m[2], new Element(m[1]));
const heading = new Element('h1'), document = { getElementById: (id) => elements.get(id) || null, createElement: (tag) => new Element(tag), querySelector: (s) => (s === '#hud h1' ? heading : null) };
const window = new Element('window');
Object.assign(window, { BR, innerWidth: 900, innerHeight: 600, devicePixelRatio: 1 });
const frames = [], timers = new Map(), location = { hash: '#seed=31337&x=0&y=0&z=2' };
let timerID = 0, last = null, clock = 0;
const history = { replaceState(a, b, hash) { location.hash = hash; } };
BR.draw = (ctx, W, view, opts) => {
  last = { W, view: { ...view }, opts: { ...opts } };
  for (const s of W.sitesIn(view.cx - 20, view.cy - 20, view.cx + 20, view.cy + 20)) W.build(s);
  return { tiles: 1, built: 1, mode: view.zoom >= 1 ? 'detail' : 'plan', done: true };
};
const context = {
  window, document, location, history, URLSearchParams, console,
  Blob: class extends Blob { constructor(parts, options) { super(parts, options); exported = JSON.parse(parts.join('')); } },
  URL: { createObjectURL: () => 'blob:world-test', revokeObjectURL() {} },
  performance: { now: () => ++clock }, requestAnimationFrame: (fn) => frames.push(fn),
  setTimeout: (fn) => { timers.set(++timerID, fn); return timerID; }, clearTimeout: (id) => timers.delete(id)
};
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
vm.runInNewContext(scripts.join('\n'), context, { filename: 'index.html', timeout: 20000 });
function flush() { for (const fn of frames.splice(0)) fn(++clock); for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } }
flush();
check('the map page starts with a real template-built world', window.__ready && window.__world().seed === 31337 && window.__world().stats.sitesBuilt > 0);
for (const k of ['outlines', 'graph']) {
  elements.get('o-' + k).checked = true; elements.get('o-' + k).dispatch('change'); flush();
  check('the ' + k + ' toggle reaches the renderer and the URL', last.opts[k] === true && new URLSearchParams(location.hash.slice(1)).get(k) === '1');
}
elements.get('o-labels').checked = false; elements.get('o-labels').dispatch('change'); flush();
check('labels can be turned off and stay off in the URL', last.opts.labels === false && new URLSearchParams(location.hash.slice(1)).get('labels') === '0');
elements.get('c').dispatch('pointermove', { clientX: 450, clientY: 300 }); flush();
check('hovering a site names its template and its connections', /connection/.test(elements.get('info').innerHTML) && last.opts.hover !== null);
elements.get('goto').value = '678,443'; elements.get('goto').dispatch('change'); flush();
check('coordinate navigation moves the view', last.view.cx === 678 && last.view.cy === 443);
elements.get('c').dispatch('wheel', { clientX: 450, clientY: 300, deltaY: -100, deltaMode: 0 }); flush();
check('zoom works', last.view.zoom > 2);
elements.get('seed').value = '7'; elements.get('seed').dispatch('change'); flush();
check('changing the seed makes a new world', window.__world().seed === 7);
elements.get('home').dispatch('click'); flush();
check('the origin button goes home', last.view.cx === 0 && last.view.cy === 0);
elements.get('height-value').value = '2.75'; elements.get('height-value').dispatch('change'); flush();
check('continuous height reaches renderer and URL without an exact slice', last.opts.cutZ === 2.75 && new URLSearchParams(location.hash.slice(1)).get('cut') === '2.75');
const world = window.__world();
let point = null;
for (const site of world.sitesIn(-20,-20,20,20)) {
  const r = world.build(site), bp = r.buildings[0] ? { b: r.buildings[0].b, origin: r.buildings[0].origin } : { b: r.filler, origin: r.fillerOrigin };
  if (!bp.b) continue;
  const q = bp.b.rooms[0].rects[0]; point = [bp.origin[0]+(q[0]+q[2])/2, bp.origin[1]+(q[1]+q[3])/2]; break;
}
elements.get('goto').value = point.join(','); elements.get('goto').dispatch('change'); flush();
elements.get('c').dispatch('pointerdown', { pointerId:1,clientX:450,clientY:300 });
elements.get('c').dispatch('pointerup', { pointerId:1,clientX:450,clientY:300 }); flush();
check('clicking a real blueprint opens its own actual floor selector', window.__cutaway.selected && !elements.get('selection').hidden && /Floor/.test(elements.get('floor').innerHTML));
check('the local selector distinguishes a cut between actual floors', elements.get('floor').value === '');
const selectedKey = window.__cutaway.selected.key;
elements.get('o-ghost').checked = true; elements.get('o-ghost').dispatch('change'); flush();
check('ghosting targets the selected template only', last.opts.ghost && last.opts.focus === selectedKey);
elements.get('export-template').click(); flush();
check('selected template export has world height and exact XY origin', exported?.blueprint?.schema === 'br.elevation/0.1' && exported.origin.length === 2 && download.name.startsWith('template-'));
elements.get('floor').value = '0'; elements.get('floor').dispatch('change'); flush();
check('local floor selection moves the cut to its real elevation', last.opts.cutZ === 0);
elements.get('clear-selection').click(); flush();
check('selection clears ghost focus', !window.__cutaway.selected && !last.opts.focus && elements.get('selection').hidden);
elements.get('band-up').dispatch('click'); flush();
check('band selection resets cut to its reference height', window.__world().band === 1 && last.opts.cutZ === 16 && new URLSearchParams(location.hash.slice(1)).get('band') === '1');
elements.get('export-world').dispatch('click'); flush();
check('world JSON export keeps spatial geometry and matched horizontal connections', exported?.schema === 'br.world-elevation/0.1' && exported.bands.length === 3 && exported.portalMatches.length > 0 && exported.issues.length === 0 && exported.policy.verticalJourneys === 'none');
elements.get('band-down').dispatch('click'); flush();
check('ground band resets to ground zero', window.__world().band === 0 && last.opts.cutZ === 0);
check('retired atrium controls are absent', !elements.has('find-up') && !elements.has('find-down'));
for (const m of html.matchAll(/<script src="([^"]+)"/g)) check('map script exists: ' + m[1], fs.existsSync(path.join(__dirname, '..', m[1])));
finish();
