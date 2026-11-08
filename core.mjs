/** Pure pricing and risk logic. No network or wallet access in this file. */
export const WETH = '0x52a6c53869ce09a731cd772f245b97a4401d3348';
export const COLLECTIONS = [
  {name:'Furni',address:'0x33976ee1477c75171b2b34814d75ebc37413e589',enabled:true},
  {name:'Clothes',address:'0xdbf185750d135ea5581f9853db9f9657fb843a62',enabled:true},
  {name:'Addons',address:'0x2da5094f8c6cd42f5b3b24803f998a28b40a398f',enabled:true},
  {name:'Pets',address:'0xb7727da90019d072a5f8fdd58ff4522f796a20c5',enabled:true},
  {name:'Tokens',address:'0xe06f06a4128373ecc5444881a6a26fc18723487a',enabled:true},
  {name:'Legacy Furni 1155',address:'0x1486faae8ee170fdaac3fdea761a5a421e406ae2',enabled:true},
  {name:'Legacy Clothes 1155',address:'0xe39e60393d25adb35158052572b06af2294d98cc',enabled:true}
];
export const DEFAULT_SETTINGS = Object.freeze({
  mode:'live', refreshSeconds:90, pagesPerCollection:20,
  minDiscountPct:25, minSales30d:3, minNetEdgePct:12, minEstimatedProfitAud:1,
  estimatedResaleFeesPct:7.5, maximumPriceEth:0.015,
  minPriceEth:0.00005, minimumFiatPrice:5, fiatCurrency:'AUD', dailyBudgetEth:0.05, maxPurchasesPerDay:5,
  maximumPriceAud:null, dailyBudgetAud:null, minPriceAud:null,
  collections:COLLECTIONS, publishableKey:'',openSeaApiKey:''
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
 // Immutable v1 now returns fees[] (buyer_fees is deprecated). All listed
 // royalty/protocol/marketplace fees are paid by the taker at settlement.
 // Do not add old and new arrays together if both are present.
 const feeEntries=Array.isArray(raw.fees)?raw.fees:
  Array.isArray(raw.buyer_fees)?raw.buyer_fees:
  Array.isArray(raw.buyerFees)?raw.buyerFees:[];
 const fees=feeEntries.reduce((a,fee)=>a+weiToEth(fee.amount??'0'),0);
 if(!Number.isFinite(fees)||fees<0)return null;
 const date=status==='FILLED'?(raw.updated_at??raw.update_time??raw.updatedAt??raw.created_at??raw.create_time):(raw.created_at??raw.create_time??raw.createdAt);
 const when=safeTime(date);
 // Immutable orderbook's creation and expiration fields are independent.
 // Never use scan time as an invented original listing timestamp.
 const listedAt=safeTime(raw.created_at??raw.create_time??raw.createdAt)||null;
 const startsAt=safeTime(raw.start_at??raw.start_time??raw.startAt??raw.startTime)||null;
 const expiresAt=safeTime(raw.end_at??raw.end_time??raw.endAt??raw.endTime??raw.protocol_data?.end_time)||null;
 // Missing actual sale timestamp should not count as historical evidence.
 if(status==='FILLED'&&!when)return null;
 const unitPrice=total/quantity;
 return {id:String(raw.id),contract,collection:collection.name,tokenId,key:`${contract}|token:${tokenId}`,
   name:`${collection.name} #${tokenId}`,price:round(unitPrice,10),totalPrice:round(total,10),quantity,
   feeEstimateEth:round(fees,10),totalWithFeesEth:round(total+fees,10),currency:'WETH',status,
   listedAt,startsAt,expiresAt,timestamp:when||(status==='ACTIVE'?Date.now():0),href:`https://tokentrove.com/collection/Habbo`,
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
// Approximate ETH spot exchange rates; WETH can deviate from ETH. In the absence
// of a fresh verified quote, a positive fiat minimum blocks all buy candidates.
export function fiatMinimumStatus(settings,quote,now=Date.now()){
 const currency=settings?.fiatCurrency==='USD'?'USD':'AUD';
 const minimum=Number(settings?.minimumFiatPrice??0);
 const spot=Number(quote?.[currency.toLowerCase()]);
 const fetchedAt=Number(quote?.fetchedAt);
 const fresh=Number.isFinite(spot)&&spot>0&&Number.isFinite(fetchedAt)&&
  fetchedAt>0&&now>=fetchedAt&&now-fetchedAt<=15*60*1000;
 return {currency,minimum,available:fresh,spot:fresh?spot:null,
  equivalentWeth:minimum>0&&fresh?minimum/spot:null,
  fetchedAt:fresh?fetchedAt:null,required:minimum>0};
}
// AUD limits are authoritative once saved; existing installations use their
// old WETH caps until the owner saves the AUD inputs for the first time.
export function audRateRequired(settings){
 return Number(settings?.minimumFiatPrice)>0 ||
  ['maximumPriceAud','dailyBudgetAud','minPriceAud'].some(k=>settings?.[k]!==null&&settings?.[k]!==undefined);
}
export function effectiveAudSettings(settings,quote,now=Date.now()){
 const q=fiatMinimumStatus({...settings,fiatCurrency:'AUD'},quote,now);
 const enabled=audRateRequired(settings);
 if(!q.available)return {settings:{...settings},available:!enabled,spot:null,required:enabled};
 const convert=(k,old)=>settings[k]===null||settings[k]===undefined?settings[old]:settings[k]/q.spot;
 // Preserve the original absolute WETH safety caps even when AUD limits are high.
 return {settings:{...settings,maximumPriceEth:Math.min(2,convert('maximumPriceAud','maximumPriceEth')),
  dailyBudgetEth:Math.min(5,convert('dailyBudgetAud','dailyBudgetEth')),
  minPriceEth:convert('minPriceAud','minPriceEth'),
  minimumTotalPriceEth:Number(settings.minimumFiatPrice)>0?
   Number(settings.minimumFiatPrice)/(settings.fiatCurrency==='USD'?Number(quote.usd):q.spot):0,
  minimumProfitEth:Number(settings.minEstimatedProfitAud??0)/q.spot},
  available:true,spot:q.spot,required:enabled};
}
export function audLimitSummary(settings,quote,now=Date.now()){
 const q=fiatMinimumStatus({...settings,fiatCurrency:'AUD'},quote,now);
 const toAud=(k,old)=>settings[k]!==null&&settings[k]!==undefined?settings[k]:
   q.available?settings[old]*q.spot:null;
 return {maximumPriceAud:toAud('maximumPriceAud','maximumPriceEth'),
  dailyBudgetAud:toAud('dailyBudgetAud','dailyBudgetEth'),
  minPriceAud:toAud('minPriceAud','minPriceEth'),
  available:q.available};
}
export function applyFiatMinimum(rows,settings,quote,now=Date.now()){
 const threshold=fiatMinimumStatus(settings,quote,now);
 const minimumProfitAud=Number(settings?.minEstimatedProfitAud??0);
 const resaleFeesPct=Number(settings?.estimatedResaleFeesPct);
 return rows.map(row=>{
  const total=Number(row.totalWithFeesEth);
  const estimatedFiatCost=threshold.available&&Number.isFinite(total)?total*threshold.spot:null;
  const fiatMinPassed=!threshold.required||
   (estimatedFiatCost!==null&&estimatedFiatCost+1e-8>=threshold.minimum);
  // Same fee-aware resale projection used by Inspect. This is an estimate,
  // not a guaranteed floor bid: realized proceeds and gas may differ.
  const reference=row.reference===null||row.reference===undefined?null:Number(row.reference);
  const qty=Number(row.quantity);
  const estimatedProfitEth=reference!==null&&Number.isFinite(reference)&&reference>0&&
   Number.isFinite(qty)&&qty>0&&Number.isFinite(total)&&
   Number.isFinite(resaleFeesPct)
    ?reference*qty*(1-resaleFeesPct/100)-total:null;
  const estimatedProfitAud=threshold.available&&estimatedProfitEth!==null?estimatedProfitEth*threshold.spot:null;
  const minProfitPassed=estimatedProfitAud!==null &&
   estimatedProfitAud+1e-8>=minimumProfitAud;
  return {...row,estimatedFiatCost,fiatMinPassed,estimatedProfitEth,
   estimatedProfitAud,minProfitPassed,eligible:row.eligible===true&&fiatMinPassed&&minProfitPassed};
 });
}

/** An external marketplace SEARCH, not a claim that a specific order is still active. */
export function marketplaceSearchUrl(row){
 const category={Furni:'HabboFurni',Clothes:'HabboClothes',Tokens:'HabboTokens'}[row.collection]||'Habbo';
 const u=new URL(`https://tokentrove.com/collection/${category}`);
 if(category!=='Habbo'&&row.metadataResolved&&row.name)u.searchParams.set('search',String(row.name).slice(0,100));
 return u.href;
}
/** Read-only inspection of a listing and locally cached, verified comparable fills.
 * Time of an Immutable FILLED record is its order update timestamp, which may
 * differ from transaction settlement time. Projections are not sale promises.
 */
export function inspectListing(row,history,settings,lastScan,now=Date.now()){
 if(!row)return null;
 const DAY=86400000;
 const comparable=history.filter(s=>s.metadataResolved&&s.key===row.key&&Number.isFinite(s.timestamp)&&
  s.timestamp<=now&&s.timestamp>=now-90*DAY&&Number.isFinite(s.price)&&s.price>0);
 const sold30=comparable.filter(s=>s.timestamp>=now-30*DAY);
 const quantity=Number(row.quantity)||1;
 const totalCost=Number(row.totalWithFeesEth);
 const reference=Number(row.reference)>0?Number(row.reference):null;
 const resaleFeePct=Number(settings.estimatedResaleFeesPct);
 const expectedProceeds=reference===null?null:reference*quantity*(1-resaleFeePct/100);
 const profit=expectedProceeds===null||!Number.isFinite(totalCost)?null:expectedProceeds-totalCost;
 const roi=profit!==null&&totalCost>0?profit/totalCost*100:null;
 return {
  listing:{id:String(row.id),name:String(row.name),collection:row.collection,
   contract:row.contract,tokenId:String(row.tokenId),quantity,tokenType:row.tokenType,
   price:row.price,feeEstimateEth:row.feeEstimateEth,totalWithFeesEth:row.totalWithFeesEth,
   reference:row.reference,discount:row.discount,netEdge:row.netEdge,sales30d:row.sales30d,
   listedAt:row.listedAt??null,startsAt:row.startsAt??null,expiresAt:row.expiresAt??null,
   floor:row.floor??null,
   eligible:row.eligible===true,metadataResolved:row.metadataResolved===true,image:row.image||'',
    estimatedFiatCost:row.estimatedFiatCost??null,fiatMinPassed:row.fiatMinPassed!==false,
    estimatedProfitAud:row.estimatedProfitAud??null,minProfitPassed:row.minProfitPassed!==false},
  lastScan,marketplaceUrl:marketplaceSearchUrl(row),
  estimate:{resaleFeePct,expectedProceedsEth:expectedProceeds===null?null:round(expectedProceeds,10),
   estimatedProfitEth:profit===null?null:round(profit,10),estimatedRoiPct:roi===null?null:round(roi,1)},
  history:{count30d:sold30.length,count90d:comparable.length,
   returned:Math.min(comparable.length,180),limited:comparable.length>180,
   sales:comparable.sort((a,b)=>b.timestamp-a.timestamp).slice(0,180).map(s=>({
    id:String(s.id),timestamp:s.timestamp,price:s.price,quantity:s.quantity,tokenId:String(s.tokenId)
   }))}
 };
}
/** Explain why genuine listings are not actionable; first blocking gate per NFT. */
export function candidateDiagnostics(rows,settings){
 const counts={eligible:0,missingMetadata:0,insufficientComparableSales:0,priceOutsideLimits:0,belowFiatMinimum:0,discountTooSmall:0,netEdgeTooSmall:0,belowEstimatedProfit:0,multiQuantity:0};
 for(const r of rows){
  if(r.eligible){counts.eligible++;continue;}
  if(!r.metadataResolved){counts.missingMetadata++;continue;}
  if(!Number.isFinite(r.reference)||r.sales30d<settings.minSales30d){counts.insufficientComparableSales++;continue;}
  if(r.quantity!==1){counts.multiQuantity++;continue;}
  if(r.price<settings.minPriceEth||r.totalWithFeesEth>settings.maximumPriceEth){counts.priceOutsideLimits++;continue;}
  if(r.fiatMinPassed===false){counts.belowFiatMinimum++;continue;}
  if(!Number.isFinite(r.discount)||r.discount<settings.minDiscountPct){counts.discountTooSmall++;continue;}
  if(!Number.isFinite(r.netEdge)||r.netEdge<settings.minNetEdgePct){counts.netEdgeTooSmall++;continue;}
  if(r.minProfitPassed===false){counts.belowEstimatedProfit++;continue;}
  // Never silently label a listing actionable if a future safety gate is added.
  counts.insufficientComparableSales++;
 }
 return counts;
}
export function candles(sales,key,now=Date.now()){
 const valid=sales.filter(s=>s.key===key&&s.metadataResolved&&s.timestamp<=now&&now-s.timestamp<=90*86400000).sort((a,b)=>a.timestamp-b.timestamp);
 const result=new Map();for(const s of valid){const day=new Date(s.timestamp).toISOString().slice(0,10);
  if(!result.has(day))result.set(day,[]);result.get(day).push(s.price);}
 return [...result].map(([date,values])=>({date,open:values[0],close:values.at(-1),high:Math.max(...values),low:Math.min(...values),volume:values.length}));
}
export function validateSettings(s){
 const n=JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
 for(const [k,min,max] of [['refreshSeconds',30,900],['pagesPerCollection',1,40],['minDiscountPct',0,95],['minSales30d',3,100],['minNetEdgePct',0,1000],['estimatedResaleFeesPct',0,60],['maximumPriceEth',0.00001,2],['dailyBudgetEth',0.0001,5],['minPriceEth',0,0.5],['minimumFiatPrice',0,100000],['minEstimatedProfitAud',0,1000000],['maxPurchasesPerDay',1,50]]){
  const x=Number(s?.[k]??n[k]);if(!Number.isFinite(x)||x<min||x>max)throw new Error(`${k} must be between ${min} and ${max}`);
  n[k]=['refreshSeconds','pagesPerCollection','minSales30d','maxPurchasesPerDay'].includes(k)?Math.floor(x):x;
 }
 if(n.dailyBudgetEth<n.maximumPriceEth)throw new Error('Daily budget must be >= maximum purchase price');
 n.fiatCurrency=String(s?.fiatCurrency??n.fiatCurrency).toUpperCase();
 if(!['AUD','USD'].includes(n.fiatCurrency))throw new Error('fiatCurrency must be AUD or USD');
 for(const [key,min,max] of [['maximumPriceAud',0.01,1000000],['dailyBudgetAud',0.01,1000000],['minPriceAud',0,1000000]]){
  const raw=s?.[key]??null;
  if(raw===null){n[key]=null;continue;}
  const value=Number(raw);
  if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${key} must be between ${min} and ${max} AUD`);
  n[key]=value;
 }
 if(n.maximumPriceAud!==null&&n.dailyBudgetAud!==null&&n.dailyBudgetAud<n.maximumPriceAud)
  throw new Error('Daily AUD budget must be at least the maximum AUD purchase price');
 n.mode='live'; // Ignore obsolete persisted demo and paper-trading settings.
 n.publishableKey=String(s?.publishableKey??'').trim().slice(0,200);
 n.openSeaApiKey=String(s?.openSeaApiKey??'').trim().slice(0,512);
 n.collections=COLLECTIONS.map(c=>({...c,enabled:(s?.collections??COLLECTIONS).some(x=>x.address===c.address&&x.enabled)}));
 if(!n.collections.some(x=>x.enabled))throw new Error('Choose at least one collection');return n;
}

// Upgrade only the pre-v2.0.1 default scan depth and default five-collection
// selection. Preserve custom depths, disabled collections and future preferences.
export function upgradeLegacyScanCoverage(settings, schemaVersion=0){
 const n=validateSettings(settings);
 if(Number(schemaVersion)>=8)return n;
 if(Number(settings?.pagesPerCollection??6)===6)n.pagesPerCollection=20;
 const regular=n.collections.filter(c=>!c.name.startsWith('Legacy '));
 const legacy=n.collections.filter(c=>c.name.startsWith('Legacy '));
 if(legacy.length===2&&regular.every(c=>c.enabled)&&legacy.every(c=>!c.enabled)){
  for(const c of legacy)c.enabled=true;
 }
 return n;
}
