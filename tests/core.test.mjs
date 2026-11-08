import test from 'node:test';
import assert from 'node:assert/strict';
import {WETH,COLLECTIONS,normalizeOrder,weiToEth,analyze,DEFAULT_SETTINGS,candles,hydrateNames,validateSettings,safeTime,orderRejectionReason} from '../core.mjs';
function mk(status='ACTIVE',token='ERC20',addr=WETH){return {id:'A',buy:[{item_type:token,contract_address:addr,start_amount:'2000000000000000'}],sell:[{item_type:'ERC721',contract_address:COLLECTIONS[0].address,token_id:'42',start_amount:'1'}],status:{name:status},updated_at:'2026-11-05T11:00:00Z'};}
test('ETH amount conversion',()=>{assert.equal(weiToEth('1000000000000000000'),1);assert.equal(weiToEth('500000000000000'),0.0005);});
test('accepts known bridged ETH only (NOT native IMX or unknown ERC20)',()=>{
 assert.equal(normalizeOrder(mk(),COLLECTIONS[0]).price,.002);
 assert.equal(normalizeOrder(mk('ACTIVE','NATIVE'),COLLECTIONS[0]),null);
 assert.equal(normalizeOrder(mk('ACTIVE','ERC20','0x123'),COLLECTIONS[0]),null);
 assert.equal(normalizeOrder(mk('FILLED'),COLLECTIONS[0]),null);
 assert.equal(normalizeOrder(mk('FILLED'),COLLECTIONS[0],'FILLED').status,'FILLED');
});
test('fee aware and quantity grouping',()=>{const a=mk();a.buy[0].start_amount='10000000000000000';a.sell[0].start_amount='5';a.sell[0].item_type='ERC1155';a.buyer_fees=[{amount:'1000000000000000'}];const r=normalizeOrder(a,COLLECTIONS[0]);assert.equal(r.quantity,5);assert.equal(r.price,.002);assert.equal(r.totalWithFeesEth,.011);});
function fixtures(){
 const contract=COLLECTIONS[0].address;
 const base={id:'fixture-listing',contract,collection:'Furni',tokenId:'42',key:`${contract}|name:test-furni`,name:'Test Furni',metadataResolved:true,price:0.001,totalWithFeesEth:0.001,quantity:1};
 const now=Date.now();
 return {listings:[base],filled:Array.from({length:5},(_,i)=>({...base,id:`fixture-sale-${i}`,price:0.002,timestamp:now-(i+1)*86400000,status:'FILLED'}))};
}
test('real scan order analysis is based on complete-sale fixtures, never sample data',()=>{const d=fixtures();const r=analyze(d.listings,d.filled,DEFAULT_SETTINGS);assert.ok(r[0].eligible);assert.ok(candles(d.filled,r[0].key).length>0);});
test('never use active asks as historical transactions',()=>{const d=fixtures();assert.ok(analyze(d.listings,[],DEFAULT_SETTINGS).every(x=>!x.eligible));});
test('never buy unidentified metadata or multi-quantity orders',()=>{const d=fixtures();assert.ok(!analyze([{...d.listings[0],metadataResolved:false},{...d.listings[0],quantity:2}],d.filled,DEFAULT_SETTINGS)[0].eligible);});
test('saved demo preferences are forcibly migrated to live-only',()=>{
 const updated=validateSettings({...DEFAULT_SETTINGS,mode:'demo',paperAutoBuy:true});
 assert.equal(updated.mode,'live');assert.equal('paperAutoBuy' in updated,false);
});
test('group names by metadata ID or exact name inside collection',()=>{const addr=COLLECTIONS[0].address;const orders=[{contract:addr,tokenId:'1'},{contract:addr,tokenId:'2'}];const a=hydrateNames(orders,{[`${addr}|1`]:{name:'Golden Sofa'},[`${addr}|2`]:{name:'Golden Sofa'}});assert.equal(a[0].key,a[1].key);});
test('rejects nonsense risk settings',()=>{assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,minSales30d:0}));assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,dailyBudgetEth:0.001}));assert.equal(validateSettings(DEFAULT_SETTINGS).mode,'live');});

test('Immutable timestamps: numbers, seconds strings, millisecond strings, ISO date',()=>{
 const target=1697498374000;
 assert.equal(safeTime(1697498374),target);
 assert.equal(safeTime('1697498374'),target);
 assert.equal(safeTime('1697498374000'),target);
 assert.equal(safeTime('2023-10-16T23:19:34.000Z'),target);
 const sample=mk('FILLED');sample.updated_at='1697498374';
 assert.equal(normalizeOrder(sample,COLLECTIONS[0],'FILLED').timestamp,target);
 assert.equal(orderRejectionReason(mk('ACTIVE','NATIVE'),COLLECTIONS[0]),'not ERC20 priced');
});
