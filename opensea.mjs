import {safeTime} from './core.mjs';

export const HABBO_AVATAR_CONTRACT='0x8a1bbef259b00ced668a8c69e50d92619c672176';
export const HABBO_AVATAR_SLUG='habbo-avatars';
const API='https://api.opensea.io/api/v2/listings/collection/habbo-avatars/all';

// OpenSea Ethereum is a separate, read-only source. It does not provide
// comparable Immutable 30-day fills or create Immutable-executable orders.
export function parseOpenSeaAvatarListing(raw){
 if(!raw||String(raw.status).toUpperCase()!=='ACTIVE'||String(raw.chain).toLowerCase()!=='ethereum')return null;
 const asset=raw.asset,contract=String(asset?.contract??'').toLowerCase();
 const tokenId=String(asset?.identifier??'');
 if(contract!==HABBO_AVATAR_CONTRACT||!/^[0-9]+$/.test(tokenId))return null;
 const hash=String(raw.order_hash??'');
 if(!/^0x[0-9a-fA-F]{64}$/.test(hash))return null;
 const price=raw.price?.current;
 const currency=String(price?.currency??'').toUpperCase();
 // Do not accidentally label stablecoins or unrelated ERC20 as ETH.
 if(!['ETH','WETH'].includes(currency))return null;
 const value=String(price?.value??'');
 const decimals=Number(price?.decimals);
 if(decimals!==18||!/^\d+$/.test(value))return null;
 const eth=Number(BigInt(value))/1e18;
 if(!Number.isFinite(eth)||eth<=0||eth>1000000)return null;
 const qty=Number(raw.remaining_quantity??1);
 if(!Number.isSafeInteger(qty)||qty!==1)return null;
 const expiresAt=safeTime(raw.protocol_data?.parameters?.endTime)||null;
 const listedAt=safeTime(raw.order_created_at)||null;
 return {id:hash,source:'OpenSea',chain:'ethereum',collection:'Habbo Avatars',
  contract,tokenId,name:'Habbo Avatar #'+tokenId,
  buyerTotalEth:eth,currency,listedAt,expiresAt,
  href:'https://opensea.io/assets/ethereum/'+HABBO_AVATAR_CONTRACT+'/'+tokenId,
  watchOnly:true,eligible:false};
}

export async function fetchOpenSeaAvatarListings(apiKey,{fetcher=globalThis.fetch,maxPages=2}={}){
 const key=String(apiKey??'').trim();
 if(!key)return {status:'needs-key',rows:[],pages:0,truncated:false,error:'Set a read-only OpenSea API key in Settings to enable Ethereum Habbo Avatar listings.'};
 if(!/^[\x21-\x7e]{10,512}$/.test(key))return {status:'error',rows:[],pages:0,truncated:false,error:'OpenSea API key format is invalid'};
 let next=null,pages=0,truncated=false,firstError='';
 const found=new Map(),cursors=new Set();
 for(let i=0;i<Math.min(Math.max(Number(maxPages)||1,1),3);i++){
  const url=new URL(API);url.searchParams.set('limit','100');
  if(next)url.searchParams.set('next',next);
  let response;
  try{
   response=await fetcher(url.href,{method:'GET',headers:{Accept:'application/json','X-API-KEY':key},signal:AbortSignal.timeout(15000)});
  }catch(err){firstError='OpenSea request timed out or failed: '+String(err?.message??err).slice(0,100);break;}
  if(!response.ok){firstError='OpenSea HTTP '+response.status+(response.status===401||response.status===403?' (check API key)':response.status===429?' (rate-limited)':'');break;}
  let payload;
  try{payload=await response.json();}catch{firstError='OpenSea sent invalid JSON';break;}
  if(!Array.isArray(payload?.listings)){firstError='OpenSea response did not include a listings array';break;}
  pages++;
  for(const item of payload.listings){
   const parsed=parseOpenSeaAvatarListing(item);
   if(parsed&&!found.has(parsed.id))found.set(parsed.id,parsed);
  }
  next=typeof payload.next==='string'&&payload.next.length<2048?payload.next:null;
  if(!next||cursors.has(next)){next=null;break;}
  cursors.add(next);
 }
 truncated=Boolean(next);
 return {status:firstError?(pages?'partial':'error'):'connected',
  rows:[...found.values()].sort((a,b)=>a.buyerTotalEth-b.buyerTotalEth),
  pages,truncated,error:firstError,
  source:'OpenSea API v2 · Ethereum Habbo Avatars only',checkedAt:Date.now()};
}
