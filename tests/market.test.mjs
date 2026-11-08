import test from 'node:test';
import assert from 'node:assert/strict';
import {COLLECTIONS,WETH} from '../core.mjs';
import {collectPage,resolveMetadata} from '../market.mjs';
const col=COLLECTIONS[0];
function order(id,status='ACTIVE',tokenId='12') {return {id,buy:[{item_type:'ERC20',contract_address:WETH,start_amount:'1000000000000000'}],sell:[{item_type:'ERC721',contract_address:col.address,token_id:tokenId,start_amount:'1'}],status:{name:status},created_at:'2026-11-07T09:00:00Z',updated_at:'2026-11-07T12:00:00Z'};}
test('orderbook pagination, deduplication and coverage flag',async()=>{
 const calls=[];
 const fake={listListings:async req=>{calls.push(req);return req.pageCursor?{result:[order('a'),order('b')],page:{}}:{result:[order('a')],page:{next_cursor:'second'}};}};
 const result=await collectPage(fake,col,'ACTIVE',2);
 assert.deepEqual(result.orders.map(x=>x.id),['a','b']);assert.equal(result.limited,false);assert.equal(result.pages,2);assert.equal(calls[1].pageCursor,'second');
});
test('warn when orderbook pagination capped',async()=>{
 const result=await collectPage({listListings:async()=>({result:[order('x')],page:{next_cursor:'next'}})},col,'ACTIVE',1);
 assert.equal(result.limited,true);
});
test('metadata is only marked verified after a resolved name',async()=>{
 const orders=[{contract:col.address,tokenId:'1'},{contract:col.address,tokenId:'2'}];
 const client={getNFT:async ({tokenId})=>tokenId==='1'?{result:{metadata:{name:'Golden Dragon',image:'https://example.org/img.png'},metadata_id:'meta-1'}}:{result:{metadata:{description:'no name'}}}};
 const result=await resolveMetadata(client,orders,{},2);
 assert.equal(result.ok,1);assert.equal(result.remaining,1);assert.equal(result.cache[`${col.address}|1`].name,'Golden Dragon');
});
