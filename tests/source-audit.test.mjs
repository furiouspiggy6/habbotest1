import test from 'node:test';
import assert from 'node:assert/strict';
import {WETH,COLLECTIONS,normalizeOrder,inspectListing,safeTime} from '../core.mjs';
import {createReadClients} from '../market.mjs';
import {parseStackFloor} from '../market-floor.mjs';

const contract=COLLECTIONS[1].address;
const listed='2026-11-05T08:15:00Z',expires='2026-11-30T08:15:00Z';
function raw(){
 return {id:'00123',status:{name:'ACTIVE'},created_at:listed,start_at:listed,end_at:expires,
  buy:[{item_type:'ERC20',contract_address:WETH,start_amount:'3121000000000000'}],
  sell:[{item_type:'ERC721',contract_address:contract,token_id:'7654'}]};
}
test('Immutable ACTIVE listing preserves created/start/expiry times separate from scan time',()=>{
 const order=normalizeOrder(raw(),COLLECTIONS[1],'ACTIVE');
 assert.equal(order.listedAt,safeTime(listed));
 assert.equal(order.startsAt,safeTime(listed));
 assert.equal(order.expiresAt,safeTime(expires));
 assert.equal(order.price,0.003121);
 assert.equal(order.timestamp,order.listedAt);
 const result=inspectListing({...order,name:'Camouflage Face Paint',key:contract+'|metadata:stack-one',metadataResolved:true},[],{estimatedResaleFeesPct:7.5},Date.now());
 assert.equal(result.listing.listedAt,order.listedAt);
 assert.equal(result.listing.expiresAt,order.expiresAt);
 assert.equal(result.listing.startsAt,order.startsAt);
});
test('Missing listing expiry stays unknown, never inferred from scan date',()=>{
 const order=raw();delete order.end_at;delete order.created_at;delete order.start_at;
 const norm=normalizeOrder(order,COLLECTIONS[1]);
 assert.equal(norm.listedAt,null);
 assert.equal(norm.expiresAt,null);
 assert.equal(norm.startsAt,null);
});
test('Unsupported or malformed end dates do not invent an expiry',()=>{
 const order=raw();order.end_at='bad-value';
 assert.equal(normalizeOrder(order,COLLECTIONS[1]).expiresAt,null);
});
function stack(orderToken={type:'ERC20',contract_address:WETH}){
 return {result:[{stack:{contract_address:contract,stack_id:'stack-one',name:'Camouflage Face Paint'},
  stack_count:340,
  market:{floor_listing:{listing_id:'order-floor',token_id:'7654',
   price_details:{token:orderToken,amount:'3121000000000000',fee_inclusive_amount:'3230000000000000'}}}}]};
}
test('Independent stack floor verifies contract, metadata stack and WETH source',()=>{
 const x=parseStackFloor(stack(),contract,'stack-one');
 assert.equal(x.status,'available');
 assert.equal(x.priceEth,0.003121);
 assert.equal(x.totalCostEth,0.00323);
 assert.equal(x.orderId,'order-floor');
 assert.equal(x.assetCount,340);
});
test('Never mislabel unrelated NFT stack or non-WETH priced floor as comparable',()=>{
 assert.equal(parseStackFloor(stack(),COLLECTIONS[0].address,'stack-one').status,'unavailable');
 assert.equal(parseStackFloor(stack(),contract,'different').status,'unavailable');
 assert.equal(parseStackFloor(stack({type:'NATIVE',symbol:'IMX'}),contract,'stack-one').status,'other-currency');
 assert.equal(parseStackFloor(stack({type:'ERC20',contract_address:'0xabcd'}),contract,'stack-one').status,'other-currency');
});
test('Invalid amounts and missing floor are rejected instead of inventing price',()=>{
 const noFloor=stack();delete noFloor.result[0].market.floor_listing;
 assert.equal(parseStackFloor(noFloor,contract,'stack-one').status,'unavailable');
 const bad=stack();bad.result[0].market.floor_listing.price_details.amount='not wei';
 assert.equal(parseStackFloor(bad,contract,'stack-one').status,'unavailable');
});
test('Read-only Immutable clients call exact listing and stack endpoints, never send purchases',async()=>{
 const urls=[];
 const fetcher=async(url,options)=>{
  urls.push(url);
  assert.equal(options.method,'GET');
  return new Response(JSON.stringify({result:raw()}),{status:200});
 };
 const c=createReadClients('',fetcher);
 const one=await c.orderbook.getListing('00123');
 const two=await c.blockchainData.getStack('stack-one');
 assert.equal(one.result.id,'00123');
 assert.equal(two.result.id,'00123');
 assert.equal(urls.length,2);
 assert.match(urls[0],/\/orders\/listings\/00123/);
 assert.match(urls[1],/\/stacks\/stack-one/);
});
