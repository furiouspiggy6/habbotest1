import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HABBO_AVATAR_CONTRACT,parseOpenSeaAvatarListing,fetchOpenSeaAvatarListings} from '../opensea.mjs';
const hash='0x'+'c'.repeat(64);
const raw=(value='178000000000000000')=>({
 status:'ACTIVE',chain:'ethereum',order_hash:hash,
 asset:{contract:HABBO_AVATAR_CONTRACT,identifier:'1713'},
 remaining_quantity:1,order_created_at:1760000000,
 price:{current:{currency:'ETH',decimals:18,value}},
 protocol_data:{parameters:{endTime:'1790000000'}}
});
test('OpenSea read-only feed accepts real Habbo Ethereum contract and ETH price',()=>{
 const order=parseOpenSeaAvatarListing(raw());
 assert.equal(order.name,'Habbo Avatar #1713');
 assert.equal(order.currency,'ETH');
 assert.equal(order.buyerTotalEth,.178);
 assert.equal(order.chain,'ethereum');
 assert.equal(order.watchOnly,true);
 assert.equal(order.eligible,false);
 assert.match(order.href,/opensea\.io\/assets\/ethereum\/0x8a1bbef2/);
 assert.ok(order.expiresAt>order.listedAt);
});
test('other contracts, networks, currencies, bad hashes, quantity and inactive orders are rejected',()=>{
 for(const edit of [
  x=>x.chain='imtbl-zkevm-mainnet',
  x=>x.asset.contract='0x'+'d'.repeat(40),
  x=>x.price.current.currency='USDC',
  x=>x.price.current.decimals=6,
  x=>x.order_hash='random',
  x=>x.status='CANCELLED',
  x=>x.remaining_quantity=2,
  x=>x.price.current.value='broken'
 ]){
  const x=raw();edit(x);
  assert.equal(parseOpenSeaAvatarListing(x),null);
 }
});
test('OpenSea API uses supplied API key only in request header and bounded pages',async()=>{
 const called=[],key='test-key-long-enough';
 const fetcher=async(url,opts)=>{
  called.push({url,opts});
  assert.equal(opts.headers['X-API-KEY'],key);
  assert.equal(opts.method,'GET');
  if(called.length===1)return new Response(JSON.stringify({listings:[raw()],next:'page-two'}),{status:200});
  const o=raw('190000000000000000');o.order_hash='0x'+'f'.repeat(64);
  return new Response(JSON.stringify({listings:[o],next:null}),{status:200});
 };
 const result=await fetchOpenSeaAvatarListings(key,{fetcher,maxPages:2});
 assert.equal(result.status,'connected');
 assert.equal(result.pages,2);
 assert.equal(result.rows.length,2);
 assert.equal(result.rows[0].buyerTotalEth,.178);
 assert.equal(result.rows[1].buyerTotalEth,.19);
 assert.match(called[0].url,/api\.opensea\.io\/api\/v2\/listings\/collection\/habbo-avatars\/all/);
 assert.match(called[1].url,/next=page-two/);
 assert.doesNotMatch(JSON.stringify(result),/test-key-long-enough/);
});
test('API-key absence, 401 and 429 cause explicit source status without invented listings',async()=>{
 const none=await fetchOpenSeaAvatarListings('');
 assert.equal(none.status,'needs-key');
 assert.deepEqual(none.rows,[]);
 const unauthorized=await fetchOpenSeaAvatarListings('test-key-long-enough',{fetcher:async()=>new Response('{}',{status:401})});
 assert.equal(unauthorized.status,'error');
 assert.match(unauthorized.error,/401/);
 const limited=await fetchOpenSeaAvatarListings('test-key-long-enough',{fetcher:async()=>new Response('{}',{status:429})});
 assert.equal(limited.status,'error');
 assert.match(limited.error,/rate-limited/);
});
test('OpenSea source is separate from tradable Immutable candidates and API key redacted',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(server,/openSeaKeyConfigured/);
 assert.match(server,/settings:\{\.\.\.state\.settings,openSeaApiKey:''\}/);
 assert.match(server,/uri\.pathname==='\/api\/opensea\/listings'/);
 assert.match(server,/void refreshOpenSea\(\)/);
 assert.match(html,/id="openSeaApiKey"/);
 assert.match(html,/id="openSeaRows"/);
 assert.match(html,/OpenSea · Habbo Avatars/);
 assert.match(js,/function renderOpenSea\(/);
 assert.match(js,/watch-only/);
 assert.doesNotMatch(server,/displayRows=\[\.\.\.displayRows,\.\.\.openSeaFeed/);
});
