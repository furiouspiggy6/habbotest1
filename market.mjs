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
 let cursor=null,seen=new Set(),all=[],pages=0,limited=false;
 for(let i=0;i<limit;i++){
  const request={sellItemContractAddress:col.address,status,pageSize:50};
  if(cursor)request.pageCursor=cursor;
  const response=await client.listListings(request);
  const {data,next}=unpackPage(response);
  for(const raw of data){const n=normalizeOrder(raw,col,status);if(n&&!seen.has(n.id)){all.push(n);seen.add(n.id);}}
  pages++;
  if(!next||seen.has(`cursor:${next}`)){cursor=null;break;}
  seen.add(`cursor:${next}`);cursor=next;
  // small gap to avoid bursting requests
  await sleep(75);
 }
 if(cursor)limited=true;
 return {orders:all,limited,pages};
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
 let ok=0,failed=0,index=0;
 async function worker(){while(index<needed.length){const o=needed[index++];try{
  const r=await client.getNFT({chainName,contractAddress:o.contract,tokenId:o.tokenId});
  const m=metadataFromNFT(r);
  if(m){cache[`${o.contract}|${o.tokenId}`]=m;ok++;}else failed++;
  }catch{failed++;}await sleep(65);}}
 await Promise.all(Array.from({length:Math.min(4,needed.length)},worker));
 return {cache,ok,failed,remaining:items.filter(o=>!cache[`${o.contract}|${o.tokenId}`]).length};
}
export async function scanMarket(settings,cache){
 const clients=await makeClients(settings.publishableKey);
 let listings=[],filled=[],warnings=[],pages=0,truncated=0;
 for(const col of settings.collections.filter(c=>c.enabled)){
  for(const status of ['ACTIVE','FILLED']){
   try{
    const result=await collectPage(clients.orderbook,col,status,settings.pagesPerCollection);
    pages+=result.pages;
    if(status==='ACTIVE')listings.push(...result.orders);else filled.push(...result.orders);
    if(result.limited){truncated++;warnings.push(`${col.name} ${status}: only the first ${settings.pagesPerCollection} pages were scanned`);}
   }catch(e){warnings.push(`${col.name} ${status}: ${String(e?.message??e).slice(0,180)}`);}
  }
 }
 if(!listings.length)warnings.push('No matching active WETH-priced Habbo NFT listings were retrieved. Check Immutable API access and collection contracts.');
 const meta=await resolveMetadata(clients.blockchainData,[...listings,...filled],cache);
 listings=hydrateNames(listings,cache);filled=hydrateNames(filled,cache);
 if(meta.remaining)warnings.push(`${meta.remaining} NFT token IDs have no verified metadata yet, so those items cannot trigger buys.`);
 if(filled.length===0)warnings.push('No usable completed orders retrieved. No purchase signals will be generated.');
 return {listings,filled,warnings,meta,pages,truncated};
}
