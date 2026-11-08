import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WETH,COLLECTIONS,normalizeOrder} from '../core.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=x=>readFileSync(resolve(root,x),'utf8');
function order(){
 return {id:'immutable-current',created_at:'2026-11-08T11:50:00Z',end_at:'2026-12-08T11:50:00Z',
  status:{name:'ACTIVE'},
  buy:[{item_type:'ERC20',contract_address:WETH,start_amount:'2864000000000000'}],
  sell:[{item_type:'ERC721',contract_address:COLLECTIONS[1].address,token_id:'42'}],
  fees:[{amount:'257000000000000',type:'PROTOCOL'}]};
}
test('current Immutable fees[] are charged to buyer and included in actual purchase total',()=>{
 const o=normalizeOrder(order(),COLLECTIONS[1]);
 assert.equal(o.price,0.002864);
 assert.equal(o.feeEstimateEth,0.000257);
 assert.equal(o.totalWithFeesEth,0.003121);
});
test('deprecated buyer_fees remains supported when new fees absent',()=>{
 const x=order();x.buyer_fees=x.fees;delete x.fees;
 const o=normalizeOrder(x,COLLECTIONS[1]);
 assert.equal(o.totalWithFeesEth,0.003121);
});
test('never double-count fees when both current and deprecated fields exist',()=>{
 const x=order();x.buyer_fees=x.fees;x.buyerFees=x.fees;
 const o=normalizeOrder(x,COLLECTIONS[1]);
 assert.equal(o.totalWithFeesEth,0.003121);
});
test('invalid fee amount blocks order rather than showing a fictitious bargain',()=>{
 const x=order();x.fees=[{amount:'NaN'}];
 assert.equal(normalizeOrder(x,COLLECTIONS[1]),null);
});
test('scanner uses fee-inclusive total in AUD, keeping base seller ask visible in inspect',()=>{
 const html=read('public/index.html'),ui=read('public/app.js');
 assert.match(html,/<th>BUY TOTAL<\/th>/);
 assert.match(ui,/audCash\(r\.totalWithFeesEth\)/);
 assert.match(ui,/Seller asking price \(excl\. fees\)/);
 assert.match(ui,/Original Immutable asking price/);
 assert.match(ui,/Ask incl\. recorded buyer fees/);
});
