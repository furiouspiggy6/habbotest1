import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
test('desktop dashboard JavaScript parses before any user interaction',()=>{
 const result=spawnSync(process.execPath,['--check','public/app.js'],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout||'Syntax check failed');
});
test('dashboard click handler registrations and initialization are not duplicated',()=>{
 const js=readFileSync(resolve(root,'public/app.js'),'utf8');
 for(const unique of ['const fields=','async function sync()','function renderMarket()','function fillSettings()','function renderInspection(','await sync();setInterval(sync,4000);']){
  assert.equal(js.split(unique).length-1,1,'Unexpected duplicate or missing UI code: '+unique);
 }
 // The score inspector and scheduled deep-scan settings intentionally expanded the UI.
 assert.ok(js.length<55000,'UI code unexpectedly bloated by duplicate substitution');
 assert.match(js,/document\.querySelectorAll\('\.nav'\)\.forEach\(b=>b\.addEventListener\('click'/);
 assert.doesNotMatch(js,/\$\('fiatCurrency'\)/);
 for(const id of ['maximumPriceAud','dailyBudgetAud','minPriceAud'])assert.ok(js.includes(id));
 assert.match(js,/'minimumFiatPrice'/);
 assert.match(js,/\$\('inspectSelectedBtn'\)\.addEventListener\('click'/);
});
