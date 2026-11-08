import {COLLECTIONS,normalizeOrder,hydrateNames} from './core.mjs';

const chainName='imtbl-zkevm-mainnet';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const unwrap=x=>x?.result?.result??x?.result??x;
function unpackPage(x){
 const body=unwrap(x);
 const data=Array.isArray(body)?body:(body?.results??body?.orders??body?.listings??body?.data??[]);
 // The SDK can return {result: [orders], page: {next_cursor: ...}}.
 // Preserve pagination from the top-level response even when result is an array.
 const p=x?.page??x?.pagination??body?.page??body?.pagination??{};
 const next=p?.next_cursor??p?.nextCursor??x?.next_cursor??x?.nextCursor??body?.next_cursor??body?.nextCursor??null;
 return {data:Array.isArray(data)?data:[],next:typeof next==='string'&&next.length?next:null};
}
export async function makeClients(key){
 let pkg;
 try {pkg=await import('@imtbl/sdk');} catch {
  throw new Error('Immutable SDK is not installed. Run npm install (START_WINDOWS.bat does this).');
 }
 const {config,orderbook,blockchainData}=pkg;
 const cfg={environment:config.Environment.PRODUCTION};
 if(key)cfg.publishableKey=key;
 return {orderbook:new orderbook.Orderbook({baseConfig:cfg}),blockchainData:new blockchainData.BlockchainData({baseConfig:cfg}),pkg};
}
export async function collectPage(client,col,status,limit){
 let cursor=null,seen=new Set(),all=[],pages=0,limited=false,received=0;
 const quoteTypes=new Set();
 for(let i=0;i<limit;i++){
  const request={sellItemContractAddress:col.address,status,pageSize:50};
  if(cursor)request.pageCursor=cursor;
  const response=await client.listListings(request);
  const {data,next}=unpackPage(response);
  received+=data.length;
  for(const raw of data){
   const item=raw?.buy?.[0];if(item)quoteTypes.add(`${String(item.item_type??item.type??'unknown').toUpperCase()}:${String(item.contract_address??item.contractAddress??'native').toLowerCase()}`);
   const n=normalizeOrder(raw,col,status);if(n&&!seen.has(n.id)){all.push(n);seen.add(n.id);}
  }
  pages++;
  if(!next||seen.has(`cursor:${next}`)){cursor=null;break;}
  seen.add(`cursor:${next}`);cursor=next;
  // small gap to avoid bursting requests
  await sleep(75);
 }
 if(cursor)limited=true;
 return {orders:all,limited,pages,received,quoteTypes:[...quoteTypes]};
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
export async function resolveMetadata(client,orders,cache,limit=220){
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
 const clients=await makeClients(settings.publishableKey);
 let listings=[],filled=[],warnings=[],pages=0,truncated=0,received=0,failedRequests=0,successfulRequests=0;
 const quotes=new Set();
 for(const col of settings.collections.filter(c=>c.enabled)){
  for(const status of ['ACTIVE','FILLED']){
   try{
    const result=await collectPage(clients.orderbook,col,status,settings.pagesPerCollection);
    pages+=result.pages;received+=result.received;successfulRequests++;
    result.quoteTypes.forEach(t=>quotes.add(t));
    if(status==='ACTIVE')listings.push(...result.orders);else filled.push(...result.orders);
    if(result.limited){truncated++;warnings.push(`${col.name} ${status}: only the first ${settings.pagesPerCollection} pages were scanned`);}
   }catch(e){failedRequests++;warnings.push(`${col.name} ${status} request failed: ${String(e?.message??e).slice(0,220)}`);}
  }
 }
 if(!listings.length){
  if(!successfulRequests)warnings.unshift('ALL IMMUTABLE REQUESTS FAILED: Check internet access, Node.js 24+, your Immutable Hub publishable key and the detailed errors below.');
  else if(received>0)warnings.unshift(`Immutable returned ${received} raw orders but none matched Habbo WETH NFT filters. Returned currencies: ${[...quotes].slice(0,6).join(', ')||'unknown'}. This is a parser/currency coverage issue, not an empty market.`);
  else warnings.unshift('Immutable returned zero orders for the selected collections. Check contracts, API key, and marketplace coverage.');
 }
 const meta=await resolveMetadata(clients.blockchainData,[...listings,...filled],cache);
 listings=hydrateNames(listings,cache);filled=hydrateNames(filled,cache);
 if(meta.remaining)warnings.push(`${meta.remaining} NFT token IDs have no verified metadata yet, so those items cannot trigger buys.${meta.firstError?' Metadata API error: '+meta.firstError:''}`);
 if(filled.length===0)warnings.push('No usable completed orders retrieved. No purchase signals will be generated.');
 return {listings,filled,warnings,meta,pages,truncated,received,failedRequests,successfulRequests,quoteTypes:[...quotes]};
}
