import test from 'node:test';
import assert from 'node:assert/strict';
import {COLLECTIONS,WETH} from '../core.mjs';
import {collectPage,resolveMetadata,unpackPage,createReadClients,prioritizedMetadataOrders} from '../market.mjs';
const col=COLLECTIONS[0];
function order(id,status='ACTIVE',tokenId='12') {return {id,buy:[{item_type:'ERC20',contract_address:WETH,start_amount:'1000000000000000'}],sell:[{item_type:'ERC721',contract_address:col.address,token_id:tokenId,start_amount:'1'}],status:{name:status},created_at:'2026-11-07T09:00:00Z',updated_at:'2026-11-07T12:00:00Z'};}
test('orderbook pagination, deduplication and coverage flag',async()=>{
 const calls=[];
 const fake={listListings:async req=>{calls.push(req);return req.pageCursor?{result:[order('a'),order('b')],page:{}}:{result:[order('a')],page:{next_cursor:'second'}};}};
 const result=await collectPage(fake,col,'ACTIVE',2);
 assert.deepEqual(result.orders.map(x=>x.id),['a','b']);assert.equal(result.limited,false);assert.equal(result.pages,2);assert.equal(result.received,3);assert.ok(result.quoteTypes.some(v=>v.includes('ERC20')));assert.equal(calls[1].pageCursor,'second');
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

test('Immutable nested response preserves pagination',()=>{
 const r=unpackPage({result:{result:[order('abc')],page:{next_cursor:'next-one'}}});
 assert.equal(r.data.length,1);assert.equal(r.next,'next-one');
});
test('reject reports distinguish incompatible currencies',async()=>{
 const raw=order('a');raw.buy[0].contract_address='0x123';
 const out=await collectPage({listListings:async()=>({result:[raw],page:{}})},col,'ACTIVE',1);
 assert.equal(out.received,1);assert.equal(out.orders.length,0);
 assert.equal(out.rejections['not WETH priced'],1);
 assert.equal(out.sampleShape.status,'ACTIVE');
});


test('read-only Immutable REST scanner creates correct URLs and uses publishable key',async()=>{
 const calls=[];
 const fetcher=async (url,options)=>{
  calls.push({url,options});
  if(url.includes('/orders/listings'))return new Response(JSON.stringify({result:[order('live-123')],page:{next_cursor:null}}),{status:200});
  return new Response(JSON.stringify({result:{name:'Golden Dragon',metadata_id:'test-meta',image:'https://example.org/nft.jpg'}}),{status:200});
 };
 const clients=createReadClients('pk_test',fetcher);
 const listings=await collectPage(clients.orderbook,col,'ACTIVE',3);
 assert.equal(listings.received,1);
 assert.equal(listings.orders[0].id,'live-123');
 const req=new URL(calls[0].url);
 assert.equal(req.origin,'https://api.immutable.com');
 assert.equal(req.pathname,'/v1/chains/imtbl-zkevm-mainnet/orders/listings');
 assert.equal(req.searchParams.get('status'),'ACTIVE');
 assert.equal(req.searchParams.get('sell_item_contract_address'),col.address);
 assert.equal(req.searchParams.get('page_size'),'50');
 assert.equal(calls[0].options.headers['x-immutable-publishable-key'],'pk_test');
 const result=await resolveMetadata(clients.blockchainData,listings.orders,{},1);
 assert.equal(result.ok,1);
 assert.equal(result.cache[`${col.address}|12`].name,'Golden Dragon');
 assert.ok(calls[1].url.includes(`/collections/${col.address}/nfts/12`));
});

test('read-only REST scanner supplies actionable Immutable HTTP errors (not a false missing SDK warning)',async()=>{
 const cli=createReadClients('',async()=>new Response(JSON.stringify({message:'Publishable key needed'}),{status:401}));
 await assert.rejects(()=>cli.orderbook.listListings({sellItemContractAddress:col.address,status:'ACTIVE',pageSize:50}),/HTTP 401.*Publishable key needed/);
});

test('scanner supports next page cursor using actual API query parameter',async()=>{
 const calls=[];
 const cli=createReadClients('',async url=>{
  calls.push(new URL(url));
  return new Response(JSON.stringify(calls.length===1?{result:[order('one')],page:{next_cursor:'curs/+/='}}:{result:[order('two')],page:{}}),{status:200});
 });
 const result=await collectPage(cli.orderbook,col,'ACTIVE',2);
 assert.deepEqual(result.orders.map(x=>x.id),['one','two']);
 assert.equal(calls[1].searchParams.get('page_cursor'),'curs/+/=');
});

test('metadata queue progresses through sales and active listings instead of starving history',()=>{
 const make=(tokenId,price=0.002)=>({contract:col.address,tokenId,price,timestamp:Date.now()});
 const active=Array.from({length:150},(_,i)=>make(String(i+1),0.001+i*0.00001));
 const sold=Array.from({length:150},(_,i)=>make(String(500+i)));
 const queue=prioritizedMetadataOrders(active,sold,{},80);
 assert.equal(queue.length,80);
 assert.equal(queue.filter(x=>Number(x.tokenId)<500).length,40);
 assert.equal(queue.filter(x=>Number(x.tokenId)>=500).length,40);
});
test('failed metadata fetch is deferred rather than permanently blocking following NFT lookup',async()=>{
 const cache={};const obj={contract:col.address,tokenId:'999991',timestamp:Date.now()};
 const client={getNFT:async()=>{throw Error('temporarily missing');}};
 const result=await resolveMetadata(client,[obj],cache,1);
 assert.equal(result.failed,1);
 assert.deepEqual(prioritizedMetadataOrders([obj],[],cache,10),[]);
});

test('historical sale backfill advances across refreshes without replaying only the first pages',async()=>{
 const {scanMarket}=await import('../market.mjs');
 const {DEFAULT_SETTINGS}=await import('../core.mjs');
 const contract=col.address;
 const progress={};
 const calls=[];
 const mk=(n)=>order('filled-'+n,'FILLED',String(n));
 const clients={
  orderbook:{listListings:async req=>{
   calls.push({...req});
   if(req.status==='ACTIVE')return {result:[order('active-one','ACTIVE','99')],page:{}};
   const n=Number(req.pageCursor||0);
   return {result:[mk(n)],page:{next_cursor:n<6?String(n+1):null}};
  }},
  blockchainData:{getNFT:async()=>{throw Error('not expected to request cached metadata');}}
 };
 const cache={};
 for(let i=0;i<=6;i++)cache[`${contract}|${i}`]={name:'Known collectible'};
 cache[`${contract}|99`]={name:'Known collectible'};
 const settings={...DEFAULT_SETTINGS,pagesPerCollection:4,collections:DEFAULT_SETTINGS.collections.map(c=>({...c,enabled:c.address===contract}))};
 const first=await scanMarket(settings,cache,progress,clients);
 assert.equal(first.historyPending,1);
 assert.equal(progress[`${contract}:FILLED`],'4');
 assert.deepEqual(first.filled.map(s=>s.id),['filled-0','filled-1','filled-2','filled-3']);
 const second=await scanMarket(settings,cache,progress,clients);
 assert.equal(second.historyPending,0);
 assert.equal(progress[`${contract}:FILLED`],null);
 assert.deepEqual(second.filled.map(s=>s.id),['filled-0','filled-4','filled-5','filled-6']);
 assert.equal(calls.filter(c=>c.status==='ACTIVE').length,2);
 assert.deepEqual(calls.filter(c=>c.status==='ACTIVE').map(c=>c.pageCursor),[undefined,undefined]);
 assert.equal(second.listings.length,1);
 const third=await scanMarket(settings,cache,progress,clients);
 assert.equal(third.historyPending,1);
 assert.equal(progress[`${contract}:FILLED`],'4');
});


test('one transient Immutable HTTP 429 is retried, but auth failures are not',async()=>{
 let calls=0;
 const cli=createReadClients('',async()=>{
  calls++;
  return calls===1?new Response(JSON.stringify({message:'Rate limited'}),{status:429}):new Response(JSON.stringify({result:[],page:{}}),{status:200});
 });
 const result=await cli.orderbook.listListings({sellItemContractAddress:col.address,status:'ACTIVE',pageSize:50});
 assert.deepEqual(result.result,[]);
 assert.equal(calls,2);
 let authCalls=0;
 const forbidden=createReadClients('',async()=>{authCalls++;return new Response(JSON.stringify({message:'Invalid key'}),{status:401});});
 await assert.rejects(()=>forbidden.orderbook.listListings({sellItemContractAddress:col.address,status:'ACTIVE',pageSize:50}),/HTTP 401/);
 assert.equal(authCalls,1);
});

test('failed later page retains already fetched real orders and continuation cursor',async()=>{
 let calls=0;
 const client={listListings:async()=>{
  if(++calls===1)return {result:[order('first-page')],page:{next_cursor:'page-two'}};
  throw Error('Immutable HTTP 503: temporary outage');
 }};
 const out=await collectPage(client,col,'ACTIVE',10);
 assert.equal(out.orders.length,1);
 assert.equal(out.orders[0].id,'first-page');
 assert.equal(out.pages,1);
 assert.equal(out.limited,true);
 assert.equal(out.nextCursor,'page-two');
 assert.match(out.pageError,/HTTP 503/);
 await assert.rejects(()=>collectPage({listListings:async()=>{throw Error('HTTP 503');}},col,'ACTIVE',10),/HTTP 503/);
});

test('scan warns about interrupted ACTIVE data without discarding valid pages',async()=>{
 const {scanMarket}=await import('../market.mjs');
 const {DEFAULT_SETTINGS}=await import('../core.mjs');
 const settings={...DEFAULT_SETTINGS,pagesPerCollection:4,collections:DEFAULT_SETTINGS.collections.map(c=>({...c,enabled:c.address===col.address}))};
 const cache={[`${col.address}|12`]:{name:'Real NFT'}};
 const progress={};
 const calls=[];
 const clients={orderbook:{listListings:async request=>{
  calls.push(request);
  if(request.status==='ACTIVE'){
   if(!request.pageCursor)return {result:[order('real-1')],page:{next_cursor:'second-page'}};
   throw Error('Immutable HTTP 503: unavailable');
  }
  return {result:[],page:{}};
 }},blockchainData:{getNFT:async()=>{throw Error('no metadata request expected');}}};
 const out=await scanMarket(settings,cache,progress,clients);
 assert.deepEqual(out.listings.map(x=>x.id),['real-1']);
 assert.equal(out.failedRequests,1);
 assert.equal(out.truncated,1);
 assert.match(out.warnings.join('\n'),/Furni ACTIVE stopped after 1 pages/);
 assert.match(out.diagnostics.find(d=>d.status==='ACTIVE').error,/HTTP 503/);
});

test('Immutable timeout retries once and preserves successful result',async()=>{
 let calls=0;
 const client=createReadClients('',async()=>{
  if(++calls===1){const error=new Error('The operation was aborted due to timeout');error.name='TimeoutError';throw error;}
  return new Response(JSON.stringify({result:[order('after-retry')],page:{}}),{status:200});
 });
 const res=await collectPage(client.orderbook,col,'ACTIVE',1);
 assert.equal(calls,2);
 assert.equal(res.pageError,null);
 assert.deepEqual(res.orders.map(o=>o.id),['after-retry']);
});
test('Immutable repeated timeout reports useful error after bounded retries',async()=>{
 let calls=0;
 const client=createReadClients('',async()=>{
  calls++;
  const err=new Error('The operation was aborted due to timeout');err.name='TimeoutError';throw err;
 });
 await assert.rejects(()=>client.orderbook.listListings({sellItemContractAddress:col.address,status:'ACTIVE',pageSize:50}),/Request timed out after retry/);
 assert.equal(calls,2);
});
