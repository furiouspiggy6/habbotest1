import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {cheapestPerCollectible} from '../public/listing-views.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
function offer(id,key,price,extra={}){
 return {id,contract:'0xface',key,name:'Camouflage Face Paint',metadataResolved:true,
  tokenId:id,price,totalWithFeesEth:price+0.00001,eligible:true,...extra};
}
test('collapse copies of one verified collectible to the lowest visible listing',()=>{
 const key='0xface|name:camouflage face paint';
 const input=[
  offer('a',key,0.003),
  offer('b',key,0.001),
  offer('c',key,0.002)
 ];
 const result=cheapestPerCollectible(input);
 assert.equal(result.length,1);
 assert.equal(result[0].id,'b');
 assert.equal(result[0].groupedOfferCount,3);
 assert.equal(input.length,3);
 assert.equal(input[1].groupedOfferCount,undefined);
});
test('when display prices tie, prefer the cheaper fee-inclusive purchase',()=>{
 const key='0xface|name:camouflage face paint';
 const chosen=cheapestPerCollectible([
  offer('more-fees',key,0.001,{totalWithFeesEth:0.0014}),
  offer('less-fees',key,0.001,{totalWithFeesEth:0.0012})
 ]);
 assert.equal(chosen.length,1);
 assert.equal(chosen[0].id,'less-fees');
});
test('cheapest visible NFT is chosen by buyer total even when base ask is lower',()=>{
 const key='0xface|name:camouflage face paint';
 const group=cheapestPerCollectible([
  offer('cheap-base-expensive-fees',key,0.00286,{totalWithFeesEth:0.0032}),
  offer('higher-base-cheaper-to-buy',key,0.0029,{totalWithFeesEth:0.0031})
 ]);
 assert.equal(group[0].id,'higher-base-cheaper-to-buy');
 assert.equal(group[0].groupedOfferCount,2);
});
test('different collectible identities and collections never get incorrectly merged',()=>{
 const result=cheapestPerCollectible([
  offer('a','0xface|name:camouflage face paint',0.004),
  offer('b','0xface|name:different mask',0.003),
  offer('c','0xdifferent|name:camouflage face paint',0.002,{contract:'0xdifferent'})
 ]);
 assert.equal(result.length,3);
 assert.deepEqual(result.map(x=>x.groupedOfferCount),[1,1,1]);
});
test('unresolved NFT metadata stays on separate token rows even with same guessed name',()=>{
 const result=cheapestPerCollectible([
  offer('one','0xface|name:unknown',0.001,{metadataResolved:false}),
  offer('two','0xface|name:unknown',0.002,{metadataResolved:false}),
  offer('three','0xface|name:unknown',0.003,{metadataResolved:false})
 ]);
 assert.equal(result.length,3);
});
test('grouping only alters the visible list, not candidate status or eligibility',()=>{
 const key='0xface|name:camouflage face paint';
 const candidates=[offer('a',key,0.001,{eligible:true}),offer('b',key,0.002,{eligible:false})];
 const result=cheapestPerCollectible(candidates);
 assert.equal(result[0].eligible,true);
 assert.equal(candidates[0].eligible,true);
 assert.equal(candidates[1].eligible,false);
 assert.equal(result[0].groupedOfferCount,2);
});
test('unpriced entries cannot displace valid cheaper offers and offer count remains correct',()=>{
 const key='0xface|name:camouflage face paint';
 const result=cheapestPerCollectible([offer('bad',key,NaN),offer('valid',key,0.002)]);
 assert.equal(result[0].id,'valid');
 assert.equal(result[0].groupedOfferCount,2);
});
test('desktop serves the grouping module and exposes a reversible default-on toggle',()=>{
 const server=read('server.mjs'),js=read('public/app.js'),html=read('public/index.html');
 assert.match(server,/\['\/listing-views\.mjs','public\/listing-views\.mjs'\]/);
 assert.match(server,/endsWith\('\.mjs'\)/);
 assert.match(html,/id="cheapestOnly" checked/);
 assert.match(js,/import \{cheapestPerCollectible\} from '\.\/listing-views\.mjs'/);
 assert.match(js,/grouped\?cheapestPerCollectible\(matched\):matched/);
 assert.match(js,/\['cheapestOnly','change'\]/);
 assert.match(js,/groupedOfferCount>1/);
 assert.match(js,/const matched=\(data\?\.rows\?\?\[\]\)\.filter/);
 assert.equal(js.split('async function sync()').length-1,1);
});
