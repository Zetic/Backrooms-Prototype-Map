// Execute the real test-bed controller with a minimal DOM/canvas adapter.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
for(const f of ['core','space/recipes','space/space','space/route','space/shapes','space/house','space/heights','space/render'])require('../src/'+f+'.js');
const html=fs.readFileSync(__dirname+'/../space.html','utf8');
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.checked=true;this.value='';this.clientWidth=900;this._html='';this.classList={add(){},toggle(){}};}
 get innerHTML(){return this._html;}set innerHTML(s){this._html=s;this.children=[];}
 appendChild(e){this.children.push(e);}insertAdjacentHTML(_,s){this._html+=s;}
 querySelector(){return this;}getContext(){return new Proxy({measureText:s=>({width:s.length*7})},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});}
}
const els=new Map([...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/gi)].map(m=>[m[2],new Element(m[1])]));
const $=id=>els.get(id),window={innerWidth:1200,innerHeight:850,devicePixelRatio:1,addEventListener(){}};
let saved='';const storage={getItem:()=>JSON.stringify({recipe:'passage1',seed:1,view:'one',relationships:false,heights:false}),setItem:(_,s)=>{saved=s;}};
vm.runInNewContext([...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'),{BR,window,document:{getElementById:$,createElement:tag=>new Element(tag)},localStorage:storage,navigator:{},setTimeout:f=>f(),console});
assert.equal(window.house.schema,'br.space/0.2');
$('experiment').checked=true;$('experiment').onchange();assert.equal(window.house.schema,'br.space/0.3');assert.equal(window.house.meta.roomRelationships,false);assert.deepEqual(BR.SPACE.verify(window.house),[]);
$('hallShape').value='T';$('hallShape').onchange();assert(window.house.spaces.some(s=>s.shape==='T'));
$('livingShape').value='alcove';$('livingShape').onchange();assert(window.house.spaces.some(s=>s.shape==='alcove'));
$('vCompare').onclick();assert.equal($('compare').children.length,2);assert($('compare').children[0].innerHTML.includes('Original placement'));assert($('compare').children[1].innerHTML.includes('Relationships + shapes'));
$('vOne').onclick();assert.equal(window.house.seed,1);assert.equal(JSON.parse(saved).hallShape,'T');
$('experiment').checked=false;$('experiment').onchange();assert.equal(window.house.schema,'br.space/0.2');
console.log('ok shape controls, actual controller, comparison, saved options and original mode');

$('relationships').checked=true;$('relationships').onchange();assert.equal(window.house.meta.roomRelationships,true);assert.deepEqual(BR.SPACE.verify(window.house),[]);
$('recipe').value='mansion';$('recipe').onchange();assert.equal(window.house.floors,3);assert.equal(window.house.connections.filter(c=>c.role==='primary').length,1);
$('secondary').value='3';$('secondary').onchange();assert.equal(window.house.connections.length,4);assert($('side').innerHTML.includes('House connections'));assert.deepEqual(BR.SPACE.verify(window.house),[]);
assert($('big').height>=1950);assert(parseInt($('big').style.width)>=878);
console.log('ok mansion selector, three floors, secondary-count control and connection panel');

$('floorView').value='1';$('floorView').onchange();assert.equal(window.house.floors,3);assert.equal(JSON.parse(saved).floorView,'1');
assert($('big').height>=650);assert($('big').height<2600);
console.log('ok individual floor control and large stacked floor canvases');

$('recipe').value='galleryhouse';$('recipe').onchange();assert.equal(window.house.schema,'br.space/0.4');assert.equal(window.house.meta.gallery,'L');assert.equal($('section').style.display,'');
$('gallery').value='U';$('gallery').onchange();assert.equal(window.house.meta.gallery,'U');
$('galleryRoom').value='foyer';$('galleryRoom').onchange();const g=window.house.spaces.find(s=>s.type==='gallery_landing');assert.equal(window.house.spaces.find(s=>s.id===g.lowerRoom).type,'foyer');
$('storeyHeight').value='4.2';$('storeyHeight').onchange();assert.equal(window.house.meta.storeyHeight,4.2);assert.deepEqual(BR.SPACE.verify(window.house),[]);
$('vCompare').onclick();assert($('compare').children[0].innerHTML.includes('Flat comparison'));assert($('compare').children[1].innerHTML.includes('Height + gallery'));
$('vOne').onclick();$('heights').checked=false;$('heights').onchange();assert.equal(window.house.schema,'br.space/0.3');assert.equal($('section').style.display,'none');assert($('gallery').disabled);
$('heights').checked=true;$('heights').onchange();$('storeyHeight').value='2';$('storeyHeight').onchange();assert(window.house.error);assert.equal($('section').style.display,'none');
console.log('ok gallery presets, profiles, host, rise, comparison, flat mode and invalid input display');
$('check').onclick();assert($('report').innerHTML.includes('storey height must be'));assert.equal($('check').textContent,'Check 40 seeds of each');
console.log('ok batch checker reports invalid height settings without aborting');
