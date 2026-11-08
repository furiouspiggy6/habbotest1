import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {DEFAULT_SETTINGS,COLLECTIONS,upgradeLegacyScanCoverage,validateSettings} from '../core.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>readFileSync(resolve(root,name),'utf8');

test('scanner expands from 6 to 20 pages, with optional 40-page scan and legacy contracts',()=>{
 assert.equal(DEFAULT_SETTINGS.pagesPerCollection,20);
 assert.equal(COLLECTIONS.filter(c=>c.enabled).length,7);
 assert.equal(validateSettings({...DEFAULT_SETTINGS,pagesPerCollection:40}).pagesPerCollection,40);
 assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,pagesPerCollection:41}),/pagesPerCollection/);
});
test('v2.0.0 default scanner settings are upgraded without overriding custom choices',()=>{
 const old={...DEFAULT_SETTINGS,pagesPerCollection:6,collections:COLLECTIONS.map(c=>({...c,enabled:!c.name.startsWith('Legacy ')}))};
 const upgraded=upgradeLegacyScanCoverage(old,7);
 assert.equal(upgraded.pagesPerCollection,20);
 assert.equal(upgraded.collections.filter(c=>c.enabled).length,7);
 assert.equal(upgradeLegacyScanCoverage({...old,pagesPerCollection:10},7).pagesPerCollection,10);
 const custom={...old,collections:old.collections.map(c=>({...c,enabled:c.name!=='Pets'&&!c.name.startsWith('Legacy ')}))};
 assert.equal(upgradeLegacyScanCoverage(custom,7).collections.find(c=>c.name==='Pets').enabled,false);
 assert.equal(upgradeLegacyScanCoverage(old,8).pagesPerCollection,6);
});
test('desktop receives all listings on demand, not a hard cap of 800, and shows 100 per page',()=>{
 const server=read('server.mjs'),ui=read('public/app.js'),html=read('public/index.html');
 assert.match(server,/uri.pathname==='\/api\/listings'/);
 assert.match(server,/rows:displayRows\}/);
 assert.doesNotMatch(server,/displayRows.slice\(0,800\)/);
 assert.match(server,/listingCount:displayRows.length/);
 assert.match(ui,/const ROWS_PER_PAGE=100/);
 assert.match(ui,/api\('\/api\/listings'\)/);
 assert.match(html,/id="pagePrev"/);
 assert.match(html,/id="pageNext"/);
});
