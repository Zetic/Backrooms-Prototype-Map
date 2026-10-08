// Actual lab controller with a dependency-free DOM/canvas adapter. This checks
// interactions and real generated exports, not browser layout or paint output.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { BR } = require('./helpers');
require('../src/tpl/render2d'); require('../src/tpl/elevation'); require('../src/tpl/elevation-view');
const html = fs.readFileSync(path.join(__dirname,'..','elevation.html'),'utf8');
const context2d = new Proxy({measureText:(t)=>({width:String(t).length*6})}, {get:(target,key)=>key in target ? target[key] : (()=>{}), set:(target,key,v)=>{target[key]=v;return true;}});
let downloaded = null;
class Element {
  constructor(tag='div') { this.tagName=tag.toUpperCase(); this.children=[]; this.events={}; this.style={}; this.dataset={}; this._value=''; this._html=''; this.textContent=''; this.checked=false; this.disabled=false; }
  get options() { return this.children.flatMap((c)=>c.tagName==='OPTION'?[c]:c.options); }
  get value() { return this._value || (this.tagName==='SELECT'&&this.options[0]?this.options[0]._value:''); }
  set value(v) { this._value=String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(s) {
    this._html=s; this.children=[];
    for (const m of s.matchAll(/<option value="([^"]+)">([^<]*)<\/option>/g)) {const e=new Element('option');e.value=m[1];e.textContent=m[2];this.children.push(e);}
    for (const m of s.matchAll(/<button[^>]*data-level="([^"]+)"[^>]*>([^<]*)<\/button>/g)) {const e=new Element('button');e.dataset.level=m[1];e.textContent=m[2];this.children.push(e);}
  }
  appendChild(e) { this.children.push(e); }
  addEventListener(k,f) { (this.events[k]||(this.events[k]=[])).push(f); }
  dispatch(k,e={}) { for(const f of this.events[k]||[]) f({target:this,...e}); }
  click() { if(this.tagName==='A') downloaded={href:this.href,filename:this.download}; this.dispatch('click'); }
  querySelector(s) { if(s.startsWith('[value=')) return this.options.find((o)=>o.value===s.slice(8,-2)); return this.querySelectorAll(s)[0]||null; }
  querySelectorAll(s) { return this.children.filter((c)=>c.tagName===s.toUpperCase()).concat(this.children.flatMap((c)=>c.querySelectorAll(s))); }
  getBoundingClientRect() { return {width:736,height:this.id==='profile'?180:500,left:0,top:0}; }
  getContext() { return context2d; }
}
const elements=new Map();
for(const m of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {const e=new Element(m[1]);e.id=m[2];const v=m[0].match(/\bvalue="([^"]*)"/);if(v)e.value=v[1];e.checked=/\bchecked\b/.test(m[0]);elements.set(e.id,e);}
elements.get('connection').innerHTML='<option value="none">Potential only</option><option value="up">Upward</option><option value="down">Downward</option>';
elements.get('connection').value='up';
elements.get('type').innerHTML='<option value="auto">Auto</option><option value="ladder">Ladder</option><option value="stair">Stair</option><option value="ramp">Ramp</option>';
elements.get('type').value='auto';
const document={getElementById:(id)=>elements.get(id),createElement:(tag)=>new Element(tag)};
const location={hash:''},history={replaceState:(a,b,hash)=>{location.hash=hash;}},window={devicePixelRatio:1};
let blob=null;
const context={BR,window,document,location,history,URLSearchParams,console,Blob,
  URL:{createObjectURL:(b)=>{blob=b;return 'blob:lab-test';},revokeObjectURL:()=>{}},setTimeout:()=>1,
  ResizeObserver:class {constructor(f){this.f=f;}observe(){}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','src/elevation-lab.js'),'utf8'),context,{filename:'elevation-lab.js',timeout:20000});
const $=(id)=>elements.get(id), b=()=>window.__elevationLab.blueprint;
// at 23 × 17 m the hall's curved wall leaves no straight run for a ramp: preference gives way to fit
assert(window.__ready&&b().kind==='stair-variant','the circular hall prefers a ramp, but only a stair fits its curved wall');
assert.equal(b().filler,'circular_hall');
assert(!$('template').options.some((o)=>o.value==='terraced_atrium'));
assert($('capabilities').innerHTML.includes('Prefers ramp'));
$('width').value='30';$('width').dispatch('change');$('depth').value='24';$('depth').dispatch('change');
assert.equal(b().kind,'ramp-variant','a bigger hall has a wing wall long enough for its ramp');
assert(b().connectors[0].reservations.length>4,'a ramp reserves its slope piece by piece');
assert($('zones').innerHTML.includes('connected'));
$('width').value='23';$('width').dispatch('change');$('depth').value='17';$('depth').dispatch('change');
$('type').value='ladder';$('type').dispatch('change');
assert.equal(b().kind,'ladder-variant');
assert.equal(b().bands[1].elevation,8);assert(location.hash.includes('type=ladder'));
$('floor').value='1';$('floor').dispatch('change');
assert.equal(Number($('floor').value),1);
assert.equal($('mode').value,'exact');
$('height-value').value='2.75';$('height-value').dispatch('change');
assert.equal($('mode').value,'cutaway');assert(location.hash.includes('cut=2.75'));
assert.equal(b().levels.length,2,'slider positions add no floors');
$('height').value='9';$('height').dispatch('input');
assert.equal(Number($('height').max),9,'dragging to the end does not extend the slider');
$('height-value').value='12.125';$('height-value').dispatch('change');
assert.equal(Number($('height').max),12.125,'numeric entry can extend the range');
$('ghost').checked=false;$('ghost').dispatch('change');
$('connection').value='down';$('connection').dispatch('change');
assert.equal(b().bands[1].elevation,-8);
assert.equal(b().levels[Number($('floor').value)].elevation,0,'downward starts on the ground slice');
assert(location.hash.includes('connection=down'));
$('next').click();assert.equal(b().seed,8);
$('template').value='template:closet';$('template').dispatch('change');
assert.equal(b().kind,'ladder-variant');assert.equal(b().connectors[0].kind,'ladder');
$('type').value='stair';$('type').dispatch('change');
assert.equal(b(),null,'a stair that does not fit a closet is refused, not forced');assert(/no stair/.test($('error').textContent));
$('type').value='auto';$('type').dispatch('change');assert.equal(b().connectors[0].kind,'ladder','auto falls back to the ladder');
assert.equal(b().rooms.length,2);
$('connection').value='none';$('connection').dispatch('change');
assert.equal(b().connectors.length,0);assert(b().capabilities.up.candidates.length&&b().capabilities.down.candidates.length);
$('connection').value='up';$('connection').dispatch('change');
$('template').value='template:ranch';$('template').dispatch('change');
assert.equal(b().connectors[0].kind,'stair','a house prefers a stair');
$('rise').value='3.37';$('rise').dispatch('change');
assert.equal(b().rooms.find((r)=>r.id.startsWith('elev:landing')).floorZ,3.37,'an explicit rise is kept exactly');
$('rise').value='';$('rise').dispatch('change');
$('connection').value='none';$('connection').dispatch('change');
assert(b().connectionZones.some((z)=>z.type==='stair')&&!b().holes.length&&!b().connectors.length,'zones alone cut nothing');
$('template').value='template:closet';$('template').dispatch('change');
$('connection').value='up';$('connection').dispatch('change');
$('export').click();assert(blob&&downloaded.filename.includes('closet'));
assert.equal(blob.type,'application/json');
$('template').value='filler:circular_hall';$('template').dispatch('change');
assert(b()&&b().curves.length&&b().connectors.length===1);
$('type').value='auto';$('type').dispatch('change');
assert.deepEqual(BR.ELEV.validate(b()).errors,[]);
$('seed').value='-1';$('seed').dispatch('change');
assert.equal(b(),null);assert($('export').disabled);assert.equal($('error').style.display,'block');
$('seed').value='7';$('seed').dispatch('change');assert(b());
// a journey: templates stacked from band 0 to band 1, its route the profile
$('template').value='journey:ramps';$('template').dispatch('change');
assert.equal(b().kind,'journey');assert.equal(b().source.style,'ramps');assert.equal(Number($('width').value),48);
assert($('connection').disabled&&$('type').disabled&&$('rise').disabled,'a journey chooses its own climbs');
assert(b().source.stages.some((st)=>st.leg==='ramp'),'a ramp-heavy journey has ramps');
assert.equal(b().bands[1].elevation,16);
assert(b().route.length>2&&b().route[0][2]===0&&b().route[b().route.length-1][2]===16,'the profile runs from a door on band 0 to a door on band 1');
assert($('capabilities').innerHTML.includes('ramps</b> journey'));
assert.deepEqual(BR.ELEV.validate(b()).errors.filter((e)=>!/^no physical/.test(e)),[]);
$('floor').value=String(b().levels[b().levels.length-1].index);$('floor').dispatch('change');assert.equal(Number($('height-value').value),16);
$('export').click();assert(downloaded.filename.includes('journey'));
$('template').value='filler:circular_hall';$('template').dispatch('change');assert(!$('connection').disabled&&b().kind!=='journey');
assert(!html.includes('src/world.js'),'lab does not generate the flat infinite world');
for(const m of html.matchAll(/<script src="([^"]+)"/g)) assert(fs.existsSync(path.join(__dirname,'..',m[1])),m[1]);
console.log('ok   lab starts, switches floors/direction/template, handles compact variants, exports JSON and recovers from invalid input');
