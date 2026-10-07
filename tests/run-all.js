// Dependency-free canonical generation and controller regression checks.
const {spawnSync}=require('node:child_process'),path=require('node:path');
let runs=0;
for(const seed of [31337,7,12345,99,4242])for(const suite of ['determinism','circulation']){
 console.log(`\n${suite}: seed ${seed}`);
 const result=spawnSync(process.execPath,[path.join(__dirname,suite+'.test.js'),String(seed)],{stdio:'inherit'});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);runs++;
}
const ui=spawnSync(process.execPath,[path.join(__dirname,'ui-smoke.test.js')],{stdio:'inherit'});
if(ui.error)throw ui.error;if(ui.status!==0)process.exit(ui.status||1);
console.log('\ntemplates');
const tpl=spawnSync(process.execPath,[path.join(__dirname,'templates.test.js')],{stdio:'inherit'});
if(tpl.error)throw tpl.error;if(tpl.status!==0)process.exit(tpl.status||1);
for(const seed of [31337,7]){
 console.log(`\npoi: seed ${seed}`);
 const poi=spawnSync(process.execPath,[path.join(__dirname,'poi.test.js'),String(seed)],{stdio:'inherit'});
 if(poi.error)throw poi.error;if(poi.status!==0)process.exit(poi.status||1);
}
console.log(`\nAll ${runs} canonical suite runs, UI controller, template and POI checks passed.`);
