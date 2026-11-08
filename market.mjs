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
  try {response=await fetcher(url.toString(),{method:'GET',headers,signal:AbortSignal.timeout(16000)});}
  catch(err){throw new Error(`Immutable API request failed (${url.pathname}): ${String(err?.message??err).slice(0,160)}. Check internet, DNS or firewall.`);}
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
export async function collectPage(client,col,status,limit){
 let cursor=null,seen=new Set(),all=[],pages=0,limited=false,received=0;
 const quoteTypes=new Set(),rejections=new Map();let sampleShape=null;
 for(let i=0;i<limit;i++){
  const request={sellItemContractAddress:col.address,status,pageSize:50};
  if(cursor)request.pageCursor=cursor;
  const response=await client.listListings(request);
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
 return {orders:all,limited,pages,received,quoteTypes:[...quoteTypes],rejections:Object.fromEntries(rejections),sampleShape};
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
export async function resolveMetadata(client,orders,cache,limit=80){
 const items=[...new Map(orders.map(o=>[`${o.contract}|${o.tokenId}`,o])).values()];
 const needed=items.filter(o=>!cache[`${o.contract}|${o.tokenId}`]).slice(0,limit);
 let ok=0,failed=0,index=0,firstError='';
 async function worker(){while(index<needed.length){const o=needed[index++];try{
  const r=await client.getNFT({chainName,contractAddress:o.contract,tokenId:o.tokenId});
  const m=metadataFromNFT(r);
  if(m){cache[`${o.contract}|${o.tokenId}`]=m;ok++;}else failed++;
  }catch(err){failed++;if(!firstError)firstError=String(err?.message??err).slice(0,170);}await sleep(65);}}
 await Promise.all(Array.from({length:Math.min(4,needed.length)},worker));
 return {cache,ok,failed,firstError,remaining:items.filter(o=>!cache[`${o.contract}|${o.tokenId}`]).length};
}
export async function scanMarket(settings,cache){
 const clients=createReadClients(settings.publishableKey);
 let listings=[],filled=[],warnings=[],pages=0,truncated=0,received=0,failedRequests=0,successfulRequests=0;
 const diagnostics=[];const rejected={};
 const quotes=new Set();
 for(const col of settings.collections.filter(c=>c.enabled)){
  for(const status of ['ACTIVE','FILLED']){
   try{
    const result=await collectPage(clients.orderbook,col,status,settings.pagesPerCollection);
    pages+=result.pages;received+=result.received;successfulRequests++;
    for(const [reason,count] of Object.entries(result.rejections)){rejected[reason]=(rejected[reason]??0)+count;}
    diagnostics.push({collection:col.name,status,raw:result.received,accepted:result.orders.length,pages:result.pages,filtered:result.rejections,shape:result.sampleShape});
    result.quoteTypes.forEach(t=>quotes.add(t));
    if(status==='ACTIVE')listings.push(...result.orders);else filled.push(...result.orders);
    if(result.limited){truncated++;warnings.push(`${col.name} ${status}: only the first ${settings.pagesPerCollection} pages were scanned`);}
   }catch(e){failedRequests++;const message=String(e?.message??e).slice(0,220);warnings.push(`${col.name} ${status} request failed: ${message}`);diagnostics.push({collection:col.name,status,error:message});}
  }
 }
 if(!listings.length){
  if(!successfulRequests)warnings.unshift('ALL IMMUTABLE REQUESTS FAILED: Check internet access, Node.js 24+, your Immutable Hub publishable key and the detailed errors below.');
  else if(received>0)warnings.unshift(`Immutable returned ${received} raw orders, but none passed the WETH NFT filters. Filter reasons: ${JSON.stringify(rejected).slice(0,250)}. Returned currencies: ${[...quotes].slice(0,6).join(', ')||'unknown'}.`);
  else warnings.unshift('Immutable returned zero orders for the selected collections. Check contracts, API key, and marketplace coverage.');
 }
 const meta=await resolveMetadata(clients.blockchainData,[...listings,...filled],cache);
 listings=hydrateNames(listings,cache);filled=hydrateNames(filled,cache);
 if(meta.remaining)warnings.push(`${meta.remaining} NFT token IDs have no verified metadata yet, so those items cannot trigger buys.${meta.firstError?' Metadata API error: '+meta.firstError:''}`);
 if(filled.length===0)warnings.push('No usable completed orders retrieved. No purchase signals will be generated.');
 return {listings,filled,warnings,meta,pages,truncated,received,failedRequests,successfulRequests,quoteTypes:[...quotes],rejected,diagnostics};
}
