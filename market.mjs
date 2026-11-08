import {COLLECTIONS,normalizeOrder,orderRejectionReason,hydrateNames} from './core.mjs';

const chainName='imtbl-zkevm-mainnet';
const API_BASE='https://api.immutable.com';
const readHeaders=key=>({
  Accept:'application/json',
  ...(key?{'x-immutable-publishable-key':key}:{})
});
// Read-only endpoints, using Node's built-in fetch. No installed SDK or wallet is needed
// for the marketplace monitor, price history, and metadata lookup.
export function createReadClients(publishableKey='',fetcher=globalThis.fetch,apiBase=API_BASE){
 if(typeof fetcher!=='function')throw new Error('Node.js fetch API is unavailable (Node 24+ required).');
 const headers=readHeaders(publishableKey);
 async function read(path,query={}){
  const url=new URL(path,apiBase);
  for(const [name,value] of Object.entries(query))if(value!==undefined && value!==null && String(value)!=='')url.searchParams.set(name,String(value));
  let response;
  // Retry one transient HTTP failure or timeout. Never retry 401/403 or
  // other non-transient errors. Keep retry budget bounded for deep scans.
  for(let attempt=0;attempt<2;attempt++){
   try {response=await fetcher(url.toString(),{method:'GET',headers,signal:AbortSignal.timeout(20000)});}
   catch(err){
    const detail=String(err?.message??err).slice(0,160);
    const isTimeout=err?.name==='TimeoutError'||(err?.name==='AbortError'&&/timeout|timed out|aborted due to timeout/i.test(detail))||/operation was aborted due to timeout/i.test(detail);
    if(attempt===0&&isTimeout){await sleep(1000);continue;}
    throw new Error(`Immutable API request failed (${url.pathname}): ${detail}.${isTimeout?' Request timed out after retry; earlier pages were preserved.':' Check internet, DNS or firewall.'}`);
   }
   if(attempt===0&&[429,500,502,503,504].includes(response.status)){
    const retryAfter=Number(response.headers?.get?.('retry-after'));
    const delay=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter*1000,3000):800;
    try{await response.body?.cancel?.();}catch{}
    await sleep(delay);
    continue;
   }
   break;
  }
  let result;
  const body=await response.text();
  try{result=JSON.parse(body);}catch{
   if(response.ok)throw new Error(`Immutable API returned invalid JSON for ${url.pathname}`);
   result={message:body.slice(0,160).replace(/<[^>]+>/g,' ').trim()};
  }
  if(!response.ok){
   const detail=String(result?.message??result?.error?.message??result?.error??'request refused').slice(0,180);
   const instruction=[401,403].includes(response.status)?' Check the Immutable Hub publishable key in Strategy & Settings.':response.status===429?' Rate limited: increase the refresh interval.':'';
   throw new Error(`Immutable HTTP ${response.status}: ${detail}.${instruction}`);
  }
  return result;
 }
 return {
  orderbook:{listListings:request=>read(`/v1/chains/${chainName}/orders/listings`,{
    sell_item_contract_address:request.sellItemContractAddress,
    status:request.status,
    page_size:request.pageSize,
    page_cursor:request.pageCursor
  })},
  blockchainData:{getNFT:request=>read(`/v1/chains/${chainName}/collections/${encodeURIComponent(request.contractAddress)}/nfts/${encodeURIComponent(request.tokenId)}`)}
 };
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const unwrap=x=>x?.result?.result??x?.result??x;
export function unpackPage(x){
 // Immutable SDK responses have appeared as both {result:[...],page:{...}}
 // and {result:{result:[...],page:{...}}}. Keep the page next to its array.
 const layers=[x,x?.result,x?.result?.result,x?.data].filter(Boolean);
 let data=[];
 for(const layer of layers){
  const items=Array.isArray(layer)?layer:layer?.results??layer?.orders??layer?.listings??layer?.data;
  if(Array.isArray(items)){data=items;break;}
 }
 let next=null;
 for(const layer of layers){
  const page=layer?.page??layer?.pagination??{};
  next=page.next_cursor??page.nextCursor??layer?.next_cursor??layer?.nextCursor??null;
  if(typeof next==='string'&&next.length)break;
 }
 return {data,next:typeof next==='string'&&next.length?next:null};
}

export async function makeClients(key){
 let pkg;
 try {pkg=await import('@imtbl/sdk');} catch (err) {
  throw new Error(`Trading SDK failed to load: ${String(err?.message??err).slice(0,230)}. This affects experimental live buying only; NFT market scanning uses the REST API.`);
 }
 const {config,orderbook,blockchainData}=pkg;
 const cfg={environment:config.Environment.PRODUCTION};
 if(key)cfg.publishableKey=key;
 return {orderbook:new orderbook.Orderbook({baseConfig:cfg}),blockchainData:new blockchainData.BlockchainData({baseConfig:cfg}),pkg};
}
export async function collectPage(client,col,status,limit,pageCursor=null){
 let cursor=pageCursor,seen=new Set(),all=[],pages=0,limited=false,received=0,pageError=null;
 const quoteTypes=new Set(),rejections=new Map();let sampleShape=null;
 for(let i=0;i<limit;i++){
  const request={sellItemContractAddress:col.address,status,pageSize:50};
  if(cursor)request.pageCursor=cursor;
  let response;
  try{response=await client.listListings(request);}
  catch(err){
   // Keep pages already fetched from Immutable; never turn partial real data
   // into an empty collection solely because a later page timed out.
   if(pages===0)throw err;
   pageError=String(err?.message??err).slice(0,240);
   break;
  }
  const {data,next}=unpackPage(response);
  received+=data.length;
  if(data.length&&!sampleShape){const sample=data[0];sampleShape={fields:Object.keys(sample).slice(0,20),status:sample.status?.name??sample.status??null};}
  for(const raw of data){
   const item=raw?.buy?.[0];if(item)quoteTypes.add(`${String(item.item_type??item.type??'unknown').toUpperCase()}:${String(item.contract_address??item.contractAddress??'native').toLowerCase()}`);
   const n=normalizeOrder(raw,col,status);if(n&&!seen.has(n.id)){all.push(n);seen.add(n.id);}
   if(!n){const reason=orderRejectionReason(raw,col,status);rejections.set(reason,(rejections.get(reason)??0)+1);}
  }
  pages++;
  if(!next||seen.has(`cursor:${next}`)){cursor=null;break;}
  seen.add(`cursor:${next}`);cursor=next;
  // small gap to avoid bursting requests
  await sleep(75);
 }
 if(cursor)limited=true;
 return {orders:all,limited,nextCursor:cursor,pages,received,pageError,quoteTypes:[...quoteTypes],rejections:Object.fromEntries(rejections),sampleShape};
}
function metadataFromNFT(response){
 const n=unwrap(response);
 const nft=n?.nft??n?.asset??n;
 const md=nft?.metadata??nft?.metadata_details??nft?.metadataDetails??{};
 const d=typeof md==='string'?(()=>{try{return JSON.parse(md);}catch{return {};}})():md;
 const name=d?.name??nft?.name??null;
 const metadataId=nft?.metadata_id??nft?.metadataId??d?.id??null;
 let image=d?.image??d?.image_url??nft?.image??'';
 if(typeof image!=='string'||!/^https:\/\//.test(image))image='';
 return name?{name:String(name).slice(0,100),metadataId:metadataId?String(metadataId):null,image}:null;
}
// Cache failed NFT lookups for ten minutes. Otherwise malformed/removed NFTs
// at the start of a page block all later metadata lookups indefinitely.
const metadataRetry = new WeakMap();
const metadataKey=o=>`${o.contract}|${o.tokenId}`;
function retryReady(cache,key,now=Date.now()){
 return !cache[key] && (metadataRetry.get(cache)?.get(key)??0)<=now;
}
/** Resolve live listings and matching completed sales in balanced batches.
 * Never spend the entire budget on active orders while historical sales remain unidentified.
 */
export function prioritizedMetadataOrders(listings,filled,cache,limit=120){
 const active=[...listings].sort((a,b)=>a.price-b.price).filter(o=>retryReady(cache,metadataKey(o)));
 const sales=[...filled].sort((a,b)=>b.timestamp-a.timestamp).filter(o=>retryReady(cache,metadataKey(o)));
 const picked=[],seen=new Set();let a=0,b=0;
 const add=o=>{if(o&&!seen.has(metadataKey(o))){picked.push(o);seen.add(metadataKey(o));}};
 while(picked.length<limit&&(a<active.length||b<sales.length)){
  if(a<active.length)add(active[a++]);
  if(picked.length>=limit)break;
  if(b<sales.length)add(sales[b++]);
 }
 return picked;
}
export async function resolveMetadata(client,orders,cache,limit=120){
 const items=[...new Map(orders.map(o=>[metadataKey(o),o])).values()];
 let cooldown=metadataRetry.get(cache);
 if(!cooldown){cooldown=new Map();metadataRetry.set(cache,cooldown);}
 const needed=items.filter(o=>retryReady(cache,metadataKey(o))).slice(0,limit);
 let ok=0,failed=0,index=0,firstError='';
 async function worker(){while(index<needed.length){const o=needed[index++],key=metadataKey(o);try{
  const r=await client.getNFT({chainName,contractAddress:o.contract,tokenId:o.tokenId});
  const m=metadataFromNFT(r);
  if(m){cache[key]=m;cooldown.delete(key);ok++;}
  else{failed++;cooldown.set(key,Date.now()+10*60*1000);}
  }catch(err){failed++;cooldown.set(key,Date.now()+10*60*1000);if(!firstError)firstError=String(err?.message??err).slice(0,170);}await sleep(65);}}
 await Promise.all(Array.from({length:Math.min(4,needed.length)},worker));
 return {cache,ok,failed,attempted:needed.length,firstError,remaining:items.filter(o=>!cache[metadataKey(o)]).length};
}
export async function scanMarket(settings,cache,progress={},clients=createReadClients(settings.publishableKey)){
 let listings=[],filled=[],warnings=[],pages=0,truncated=0,received=0,failedRequests=0,successfulRequests=0;
 const diagnostics=[];const rejected={};
 const quotes=new Set();let historyPending=0,historyCompleted=0;
 const addResult=(result,col,status)=>{
   pages+=result.pages;received+=result.received;
   for(const [reason,count] of Object.entries(result.rejections))rejected[reason]=(rejected[reason]??0)+count;
   result.quoteTypes.forEach(t=>quotes.add(t));
   if(status==='ACTIVE')listings.push(...result.orders);else filled.push(...result.orders);
 };
 for(const col of settings.collections.filter(c=>c.enabled)){
  // ACTIVE asks must be freshly fetched every scan; we never combine possibly
  // expired orders from older scans into an executable listing feed.
  try{
   const active=await collectPage(clients.orderbook,col,'ACTIVE',settings.pagesPerCollection);
   addResult(active,col,'ACTIVE');successfulRequests++;
   diagnostics.push({collection:col.name,status:'ACTIVE',raw:active.received,accepted:active.orders.length,pages:active.pages,filtered:active.rejections,shape:active.sampleShape,hasMore:active.limited,error:active.pageError});
   if(active.pageError){failedRequests++;warnings.push(`${col.name} ACTIVE stopped after ${active.pages} pages; ${active.orders.length} real offers retained. Error: ${active.pageError}`);}
   if(active.limited){truncated++;warnings.push(`${col.name} ACTIVE: more listings exist beyond the ${active.pages} downloaded pages${active.pageError?' (scan interrupted)':' (page limit reached)'}.`);}
  }catch(e){failedRequests++;const message=String(e?.message??e).slice(0,220);warnings.push(`${col.name} ACTIVE request failed: ${message}`);diagnostics.push({collection:col.name,status:'ACTIVE',error:message});}
  // A fresh first page on every scan captures new fills. Older FILLED pages are
  // indexed incrementally using a persisted cursor, rather than starting over
  // from page one on every refresh. Each scan uses a small bounded budget.
  const progressKey=`${col.address.toLowerCase()}:FILLED`;
  try{
   const newest=await collectPage(clients.orderbook,col,'FILLED',1);
   addResult(newest,col,'FILLED');successfulRequests++;
   let pagesThisScan=newest.pages,accepted=newest.orders.length,raw=newest.received;
   const prior=typeof progress?.[progressKey]==='string'&&progress[progressKey].length<4096?progress[progressKey]:null;
   const startingCursor=prior||newest.nextCursor;
   let more=!!startingCursor;
   if(startingCursor && settings.pagesPerCollection>1){
    // At most four older pages per collection per refresh, even when the user
    // chooses a deep active scan. Limit network work while history accumulates.
    try{
     const older=await collectPage(clients.orderbook,col,'FILLED',Math.min(4,settings.pagesPerCollection-1),startingCursor);
     addResult(older,col,'FILLED');successfulRequests++;
     pagesThisScan+=older.pages;accepted+=older.orders.length;raw+=older.received;
     more=older.limited;
     progress[progressKey]=older.nextCursor||null;
     if(older.pageError){
      failedRequests++;
      warnings.push(`${col.name} FILLED backfill stopped after ${older.pages} pages; sales already fetched were retained. Error: ${older.pageError}`);
     }
    }catch(e){
     // A stale/invalidated pagination cursor must not block fresh fills forever.
     progress[progressKey]=newest.nextCursor||null;
     failedRequests++;warnings.push(`${col.name} FILLED history continuation failed; restarting its backfill next scan: ${String(e?.message??e).slice(0,150)}`);
    }
   }else progress[progressKey]=startingCursor||null;
   if(more)historyPending++;else historyCompleted++;
   diagnostics.push({collection:col.name,status:'FILLED',raw,accepted,pages:pagesThisScan,historyMore:more,historyBackfill:true,shape:newest.sampleShape});
  }catch(e){failedRequests++;const message=String(e?.message??e).slice(0,220);warnings.push(`${col.name} FILLED request failed: ${message}`);diagnostics.push({collection:col.name,status:'FILLED',error:message});}
 }
 if(historyPending)warnings.push(`Historical sale indexing continues over successive scans in ${historyPending} collection(s). Fresh sales are checked every scan; older sale pages resume from saved cursors.`);
 if(!listings.length){
  if(!successfulRequests)warnings.unshift('ALL IMMUTABLE REQUESTS FAILED: Check internet access, Node.js 24+, your Immutable Hub publishable key and the detailed errors below.');
  else if(received>0)warnings.unshift(`Immutable returned ${received} raw orders, but none passed the WETH NFT filters. Filter reasons: ${JSON.stringify(rejected).slice(0,250)}. Returned currencies: ${[...quotes].slice(0,6).join(', ')||'unknown'}.`);
  else warnings.unshift('Immutable returned zero orders for the selected collections. Check contracts, API key, and marketplace coverage.');
 }
 const prioritized=prioritizedMetadataOrders(listings,filled,cache,120);
 const meta=await resolveMetadata(clients.blockchainData,prioritized,cache,120);
 listings=hydrateNames(listings,cache);filled=hydrateNames(filled,cache);
 const coverage={activeResolved:listings.filter(o=>o.metadataResolved).length,activeTotal:listings.length,
  salesResolved:filled.filter(o=>o.metadataResolved).length,salesTotal:filled.length,
  fetchedThisScan:meta.ok,failedThisScan:meta.failed,attemptedThisScan:meta.attempted};
 const remainingKeys=new Set([...listings,...filled].filter(o=>!o.metadataResolved).map(metadataKey));
 meta.remaining=remainingKeys.size;
 if(meta.remaining)warnings.push(`NFT identity indexing in progress: ${coverage.activeResolved}/${coverage.activeTotal} live listings and ${coverage.salesResolved}/${coverage.salesTotal} completed sales have verified metadata (${meta.remaining} token IDs outstanding).${meta.firstError?' Metadata API error: '+meta.firstError:''}`);
 if(filled.length===0)warnings.push('No usable completed orders retrieved. No purchase signals will be generated.');
 return {listings,filled,warnings,meta,coverage,pages,truncated,historyPending,historyCompleted,received,failedRequests,successfulRequests,quoteTypes:[...quotes],rejected,diagnostics};
}
