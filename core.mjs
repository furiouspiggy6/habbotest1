/** Pure pricing and risk logic. No network or wallet access in this file. */
export const WETH = '0x52a6c53869ce09a731cd772f245b97a4401d3348';
export const COLLECTIONS = [
  {name:'Furni',address:'0x33976ee1477c75171b2b34814d75ebc37413e589',enabled:true},
  {name:'Clothes',address:'0xdbf185750d135ea5581f9853db9f9657fb843a62',enabled:true},
  {name:'Addons',address:'0x2da5094f8c6cd42f5b3b24803f998a28b40a398f',enabled:true},
  {name:'Pets',address:'0xb7727da90019d072a5f8fdd58ff4522f796a20c5',enabled:true},
  {name:'Tokens',address:'0xe06f06a4128373ecc5444881a6a26fc18723487a',enabled:true},
  {name:'Legacy Furni 1155',address:'0x1486faae8ee170fdaac3fdea761a5a421e406ae2',enabled:false},
  {name:'Legacy Clothes 1155',address:'0xe39e60393d25adb35158052572b06af2294d98cc',enabled:false}
];
export const DEFAULT_SETTINGS = Object.freeze({
  mode:'live', refreshSeconds:90, pagesPerCollection:6,
  minDiscountPct:25, minSales30d:3, minNetEdgePct:12,
  estimatedResaleFeesPct:7.5, maximumPriceEth:0.015,
  minPriceEth:0.00005, dailyBudgetEth:0.05, maxPurchasesPerDay:5,
  collections:COLLECTIONS, publishableKey:''
});
export const round=(v,d=8)=>Number(Number(v).toFixed(d));
export const median=values=>{const a=values.filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b); if(!a.length)return null;const p=Math.floor(a.length/2);return a.length%2?a[p]:(a[p-1]+a[p])/2;};
export const weiToEth=v=>{try {if(!/^\d+$/.test(String(v)))return NaN;return Number(BigInt(v))/1e18;}catch{return NaN;}};
const rawValue=i=>i?.start_amount??i?.startAmount??i?.amount??i?.end_amount??i?.endAmount;
export const safeTime=v=>{
 if(v===undefined||v===null||v==='')return 0;
 const numeric=(typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&/^\d{10,13}$/.test(v.trim()));
 const value=numeric?Number(v):null;
 const d=numeric?new Date(value>=1e12?value:value*1000):new Date(v);
 return Number.isFinite(d.getTime())?d.getTime():0;
};
const unwrap=raw=>raw?.result?.result??raw?.result??raw;
export function orderRejectionReason(input,collection,status='ACTIVE'){
 const raw=unwrap(input);
 if(!raw?.id)return 'missing order ID';
 if(!Array.isArray(raw.buy)||!Array.isArray(raw.sell)||raw.buy.length!==1||raw.sell.length!==1)return 'unsupported order shape';
 const buy=raw.buy[0],sell=raw.sell[0];
 const actual=String(raw.status?.name??raw.status??'').toUpperCase();
 if(actual&&actual!==status)return 'status mismatch';
 if(String(buy.item_type??buy.type??'').toUpperCase()!=='ERC20')return 'not ERC20 priced';
 if(String(buy.contract_address??buy.contractAddress??'').toLowerCase()!==WETH)return 'not WETH priced';
 if(!['ERC721','ERC1155'].includes(String(sell.item_type??sell.type??'').toUpperCase()))return 'not NFT';
 if(String(sell.contract_address??sell.contractAddress??'').toLowerCase()!==collection.address.toLowerCase())return 'collection mismatch';
 if(!/^\d+$/.test(String(sell.token_id??sell.tokenId??'')))return 'missing token ID';
 const quantity=Number(rawValue(sell)??'1');
 if(!Number.isSafeInteger(quantity)||quantity<=0)return 'invalid quantity';
 if(!Number.isFinite(weiToEth(rawValue(buy)))||weiToEth(rawValue(buy))<=0)return 'invalid quote';
 const d=raw.updated_at??raw.update_time??raw.updatedAt??raw.created_at??raw.create_time;
 if(status==='FILLED'&&!safeTime(d))return 'invalid sale timestamp';
 return 'other unsupported order';
}
export function normalizeOrder(input,collection,status='ACTIVE'){
 const raw=unwrap(input);
 if(!raw?.id || !Array.isArray(raw.buy) || !Array.isArray(raw.sell) || raw.buy.length!==1 ||raw.sell.length!==1)return null;
 const buy=raw.buy[0],sell=raw.sell[0];
 const actual=String(raw.status?.name??raw.status??'').toUpperCase();
 if(actual && actual!==status)return null;
 if(String(buy.item_type??buy.type??'').toUpperCase()!=='ERC20')return null;
 // ETH is bridged ERC20 on Immutable zkEVM; native IMX must NEVER be treated as ETH.
 if(String(buy.contract_address??buy.contractAddress??'').toLowerCase()!==WETH)return null;
 if(!['ERC721','ERC1155'].includes(String(sell.item_type??sell.type??'').toUpperCase()))return null;
 const contract=String(sell.contract_address??sell.contractAddress??'').toLowerCase();
 if(contract!==collection.address.toLowerCase())return null;
 const tokenId=String(sell.token_id??sell.tokenId??'');if(!/^\d+$/.test(tokenId))return null;
 const amount=rawValue(buy),qty=rawValue(sell)??'1';
 const total=weiToEth(amount),quantity=Number(qty);
 if(!Number.isFinite(total)||total<=0||!Number.isSafeInteger(quantity)||quantity<=0)return null;
 const fees=(raw.buyer_fees??raw.buyerFees??[]).reduce((a,fee)=>a+weiToEth(fee.amount??'0'),0);
 if(!Number.isFinite(fees)||fees<0)return null;
 const date=status==='FILLED'?(raw.updated_at??raw.update_time??raw.updatedAt??raw.created_at??raw.create_time):(raw.created_at??raw.create_time??raw.createdAt);
 const when=safeTime(date);
 // Missing actual sale timestamp should not count as historical evidence.
 if(status==='FILLED'&&!when)return null;
 const unitPrice=total/quantity;
 return {id:String(raw.id),contract,collection:collection.name,tokenId,key:`${contract}|token:${tokenId}`,
   name:`${collection.name} #${tokenId}`,price:round(unitPrice,10),totalPrice:round(total,10),quantity,
   feeEstimateEth:round(fees,10),totalWithFeesEth:round(total+fees,10),currency:'WETH',status,
   timestamp:when||(status==='ACTIVE'?Date.now():0),href:`https://tokentrove.com/collection/Habbo`,
   metadataResolved:false,tokenType:String(sell.item_type??sell.type).toUpperCase()};
}
export function hydrateNames(orders,metadata={}){
 return orders.map(o=>{const m=metadata[`${o.contract}|${o.tokenId}`];if(!m?.name)return o;
  const name=String(m.name).trim().slice(0,100);if(!name)return o;
  // Only group by verified metadata identity; never assume ERC721 token IDs are comparable.
  const identity=m.metadataId?`metadata:${String(m.metadataId)}`:`name:${name.toLowerCase()}`;
  return {...o,name,key:`${o.contract}|${identity}`,metadataResolved:true,image:m.image||''};
 });
}
function robustMedian(prices){if(prices.length<3)return null;const m=median(prices);const trimmed=prices.filter(n=>n>=m*.5&&n<=m*2);return median(trimmed.length>=3?trimmed:prices);}
export function analyze(listings,filled,settings,now=Date.now()){
 const byKey=new Map();for(const s of filled){if(!s.metadataResolved||s.timestamp>now||now-s.timestamp>30*86400000)continue;
  if(!byKey.has(s.key))byKey.set(s.key,[]);byKey.get(s.key).push(s);}
 const floors=new Map();for(const l of listings){floors.set(l.key,Math.min(floors.get(l.key)??Infinity,l.price));}
 return listings.map(l=>{const history=byKey.get(l.key)||[];
  const reference=robustMedian(history.map(s=>s.price));
  const discount=reference?(1-l.price/reference)*100:null;
  // Conservative fees include buyer fees observed in the listing plus estimated resale fees.
  const effectiveBuy=l.totalWithFeesEth/l.quantity;
  const netEdge=reference?((reference*(1-settings.estimatedResaleFeesPct/100)-effectiveBuy)/effectiveBuy*100):null;
  const eligible=!!(l.metadataResolved&&reference&&history.length>=settings.minSales30d&&discount>=settings.minDiscountPct&&netEdge>=settings.minNetEdgePct&&l.price>=settings.minPriceEth&&l.totalWithFeesEth<=settings.maximumPriceEth&&l.quantity===1);
  return {...l,reference:reference?round(reference,9):null,floor:round(floors.get(l.key),9),sales30d:history.length,
   discount:discount===null?null:round(discount,1),netEdge:netEdge===null?null:round(netEdge,1),eligible};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.discount??-1000)-(a.discount??-1000));
}
export function candles(sales,key,now=Date.now()){
 const valid=sales.filter(s=>s.key===key&&s.metadataResolved&&s.timestamp<=now&&now-s.timestamp<=90*86400000).sort((a,b)=>a.timestamp-b.timestamp);
 const result=new Map();for(const s of valid){const day=new Date(s.timestamp).toISOString().slice(0,10);
  if(!result.has(day))result.set(day,[]);result.get(day).push(s.price);}
 return [...result].map(([date,values])=>({date,open:values[0],close:values.at(-1),high:Math.max(...values),low:Math.min(...values),volume:values.length}));
}
export function validateSettings(s){
 const n=JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
 for(const [k,min,max] of [['refreshSeconds',30,900],['pagesPerCollection',1,20],['minDiscountPct',0,95],['minSales30d',3,100],['minNetEdgePct',0,1000],['estimatedResaleFeesPct',0,60],['maximumPriceEth',0.00001,2],['dailyBudgetEth',0.0001,5],['minPriceEth',0,0.5],['maxPurchasesPerDay',1,50]]){
  const x=Number(s?.[k]??n[k]);if(!Number.isFinite(x)||x<min||x>max)throw new Error(`${k} must be between ${min} and ${max}`);
  n[k]=['refreshSeconds','pagesPerCollection','minSales30d','maxPurchasesPerDay'].includes(k)?Math.floor(x):x;
 }
 if(n.dailyBudgetEth<n.maximumPriceEth)throw new Error('Daily budget must be >= maximum purchase price');
 n.mode='live'; // Ignore obsolete persisted demo and paper-trading settings.
 n.publishableKey=String(s?.publishableKey??'').trim().slice(0,200);
 n.collections=COLLECTIONS.map(c=>({...c,enabled:(s?.collections??COLLECTIONS).some(x=>x.address===c.address&&x.enabled)}));
 if(!n.collections.some(x=>x.enabled))throw new Error('Choose at least one collection');return n;
}
