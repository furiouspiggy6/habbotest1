import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>readFileSync(resolve(root,name),'utf8');
test('scanner exposes source listing and expiration times without duplicating interface init',()=>{
 const html=read('public/index.html'),js=read('public/app.js');
 assert.match(html,/<th>LISTED<\/th><th>EXPIRES<\/th>/);
 assert.match(js,/listingAge\(r\.listedAt\)/);
 assert.match(js,/listingExpiry\(r\.expiresAt\)/);
 assert.match(js,/listingDate\(r\.listedAt\)/);
 assert.match(js,/listingDate\(r\.expiresAt\)/);
 assert.match(js,/Original Immutable asking price/);
 assert.match(js,/ETH\/AUD rate used/);
 assert.match(js,/Independent Immutable stack floor/);
 assert.match(js,/No TokenTrove live price was retrieved automatically/);
 assert.equal(js.split('async function sync()').length-1,1);
});
test('server executes strictly read-only per-order and stack checks when inspector opens',()=>{
 const s=read('server.mjs'),m=read('market.mjs');
 assert.match(s,/verifyReadOnlyOrder\(listing\)/);
 assert.match(s,/verifyReadOnlyStackFloor\(listing\)/);
 assert.match(s,/row\.key\.startsWith\(prefix\)/);
 assert.match(s,/stackFloor,\s*audRate:/);
 assert.match(m,/orderbook:\{/);
 assert.match(m,/getListing:orderId=>read\(/);
 assert.match(m,/getStack:stackId=>read\(/);
 assert.doesNotMatch(s,/TokenTrove API returned/);
});
test('market-floor parser ships in desktop Windows package',()=>{
 const p=JSON.parse(read('package.json'));
 assert.ok(p.build.files.includes('market-floor.mjs'));
});
