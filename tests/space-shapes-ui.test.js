// Execute the real test-bed controller with a minimal DOM/canvas adapter.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
for(const f of ['core','space/recipes','space/space','space/route','space/shapes','space/render'])require('../src/'+f+'.js');
const html=fs.readFileSync(__dirname+'/../space.html','utf8');
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.checked=true;this.value='';this.clientWidth=900;this._html='';this.classList={add(){},toggle(){}};}
 get innerHTML(){return this._html;}set innerHTML(s){this._html=s;this.children=[];}
 appendChild(e){this.children.push(e);}insertAdjacentHTML(_,s){this._html+=s;}
 querySelector(){return this;}getContext(){return new Proxy({},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});}
}
const els=new Map([...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/gi)].map(m=>[m[2],new Element(m[1])]));
const $=id=>els.get(id),window={innerWidth:1200,innerHeight:850,devicePixelRatio:1,addEventListener(){}};
let saved='';const storage={getItem:()=>JSON.stringify({recipe:'passage1',seed:1,view:'one'}),setItem:(_,s)=>{saved=s;}};
vm.runInNewContext([...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'),{BR,window,document:{getElementById:$,createElement:tag=>new Element(tag)},localStorage:storage,navigator:{},setTimeout:f=>f(),console});
assert.equal(window.house.schema,'br.space/0.2');
$('experiment').checked=true;$('experiment').onchange();assert.equal(window.house.schema,'br.space/0.3');
$('hallShape').value='T';$('hallShape').onchange();assert(window.house.spaces.some(s=>s.shape==='T'));
$('livingShape').value='alcove';$('livingShape').onchange();assert(window.house.spaces.some(s=>s.shape==='alcove'));
$('vCompare').onclick();assert.equal($('compare').children.length,2);assert($('compare').children[0].innerHTML.includes('Original'));assert($('compare').children[1].innerHTML.includes('Shape experiment'));
$('vOne').onclick();assert.equal(window.house.seed,1);assert.equal(JSON.parse(saved).hallShape,'T');
$('experiment').checked=false;$('experiment').onchange();assert.equal(window.house.schema,'br.space/0.2');
console.log('ok shape controls, actual controller, comparison, saved options and original mode');
