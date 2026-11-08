import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');

test('scanner defaults to AUD price-range visibility but retains candidates and all listings',()=>{
 const html=read('public/index.html');
 assert.match(html,/<select id="signalFilter"[^>]*><option value="range" selected>Within my price range<\/option>/);
 assert.match(html,/<option value="eligible">Candidates only<\/option>/);
 assert.match(html,/<option value="all">All listings<\/option>/);
});
test('AUD price range uses displayed listing price and fee-inclusive total, without changing candidate eligibility',()=>{
 const js=read('public/app.js');
 assert.match(js,/function withinAudRange\(row\)/);
 assert.match(js,/Number\(row\.price\)\*spot/);
 assert.match(js,/Number\(row\.totalWithFeesEth\)\*spot/);
 assert.match(js,/list>=minimum&&total>=withFees&&total<=maximum/);
 assert.match(js,/signal==='eligible'\?x\.eligible:withinAudRange\(x\)/);
 assert.match(js,/signal==='all'/);
 assert.match(js,/visibleRows=found/);
 assert.match(js,/function selectedRow\(\)\{return visibleRows\.find/);
});
test('empty candidates are reported as no qualifying NFTs, not as connection or listing failure',()=>{
 const js=read('public/app.js');
 assert.match(js,/No NFTs currently qualify as buying candidates/);
 assert.match(js,/No NFTs found within your configured AUD price range/);
 assert.match(js,/AUD price-range filter needs a fresh exchange rate/);
 assert.match(js,/No live NFT listings received yet/);
 assert.match(js,/Number\(data\?\.listingCount\)/);
 assert.equal(js.split('async function sync()').length-1,1);
});
