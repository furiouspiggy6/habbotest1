/**
 * Read-only, heuristic ranking of market opportunities.
 * No wallet functions; scores are not predictions or guarantees of resale.
 * Only verified Immutable FILLED orders and currently scanned ACTIVE offers count.
 */
import {median} from './core.mjs';
const DAY=86400000;
const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const identity=r=>typeof r?.key==='string'&&r.metadataResolved===true?r.key:null;
const pct=(a,b)=>finite(a)&&finite(b)&&b>0?(a/b-1)*100:null;

/** Enrich each listing with transparent, evidence-limited market signals. */
export function scoreOpportunityRows(rows,history,{now=Date.now(),partialCollections=[]}={}){
 const partial=new Set(partialCollections);
 const observedOffers=new Map(),sold=new Map();
 for(const r of rows){
  const key=identity(r);
  if(!key)continue;
  if(!observedOffers.has(key))observedOffers.set(key,[]);
  observedOffers.get(key).push(r);
 }
 for(const r of history){
  const key=identity(r),time=Number(r?.timestamp),price=Number(r?.price);
  if(!key||!finite(time)||time>now||now-time>30*DAY||!finite(price)||price<=0)continue;
  if(!sold.has(key))sold.set(key,[]);
  sold.get(key).push(r);
 }
 return rows.map(r=>{
  const key=identity(r);
  const sales=key?(sold.get(key)||[]):[];
  const offers=key?(observedOffers.get(key)||[]):[];
  const sales7=sales.filter(x=>now-Number(x.timestamp)<=7*DAY);
  const mostRecent=sales.length?Math.max(...sales.map(x=>Number(x.timestamp))):null;
  const lastSaleAgeDays=mostRecent===null?null:Math.max(0,(now-mostRecent)/DAY);
  const reference30=median(sales.map(s=>Number(s.price)));
  const reference7=sales7.length>=3?median(sales7.map(s=>Number(s.price))):null;
  const trendPct=reference7===null?null:pct(reference7,reference30);
  const cost=Number(r.totalWithFeesEth),price=Number(r.price);
  const competitors=offers.filter(o=>o.id!==r.id&&finite(Number(o.totalWithFeesEth))&&Number(o.quantity)===1);
  const cheaperOffers=competitors.filter(o=>Number(o.totalWithFeesEth)<cost-1e-10).length;
  const nearPriceOffers=competitors.filter(o=>Number(o.totalWithFeesEth)<=cost*1.05+1e-10).length;
  const partialCoverage=partial.has(r.collection);
  const profitAud=r.estimatedProfitAud;
  const hasEstimate=r.metadataResolved===true&&sales.length>=3&&finite(profitAud)&&finite(r.estimatedFiatCost)&&r.estimatedFiatCost>0&&finite(r.netEdge);
  let opportunityScore=null;
  if(hasEstimate){
   const margin=clamp(profitAud/Math.max(5,r.estimatedFiatCost*0.25),0,1);
   const netEdge=clamp(r.netEdge/30,0,1);
   const activity=clamp(Math.log2(1+sales.length)/Math.log2(13),0,1);
   const recency=lastSaleAgeDays===null?0:clamp(1-lastSaleAgeDays/30,0,1);
   const competition=clamp(12-cheaperOffers*4-nearPriceOffers,0,12);
   const momentum=trendPct===null?4:clamp(4+trendPct/10,0,8);
   opportunityScore=Math.round(clamp(25*margin+15*netEdge+25*activity+15*recency+competition+momentum,0,100));
  }
  const liquidity=sales.length>=10&&lastSaleAgeDays!==null&&lastSaleAgeDays<=7?'high':
    sales.length>=5&&lastSaleAgeDays!==null&&lastSaleAgeDays<=14?'medium':'low';
  const confidence=sales.length>=10&&sales7.length>=2&&!partialCoverage?'high':
    sales.length>=5&&!partialCoverage?'medium':'low';
  const cautions=[];
  if(partialCoverage)cautions.push('Only part of this collection’s ACTIVE orderbook was scanned.');
  if(sales.length<5)cautions.push('Limited verified 30-day sales evidence.');
  if(sales7.length===0)cautions.push('No verified sale of this collectible during the last 7 days.');
  if(cheaperOffers)cautions.push(cheaperOffers+' cheaper competing offer(s) were observed.');
  if(trendPct!==null&&trendPct<=-10)cautions.push('Recent 7-day median is at least 10% below the 30-day median.');
  return {...r,opportunityScore,liquidity,confidence,observedActiveOffers:offers.length,
   observedCheaperOffers:cheaperOffers,observedNearPriceOffers:nearPriceOffers,
   verifiedSales7d:sales7.length,lastSaleAt:mostRecent,trendPct:trendPct===null?null:Number(trendPct.toFixed(1)),
   partialActiveCoverage:partialCoverage,scoreCautions:cautions,
   buyOffersVerified:false};
 });
}

/** Deterministic trading/display priority: qualify first, then strength and AUD profit. */
export function sortByOpportunity(rows){
 return [...rows].sort((a,b)=>Number(b.eligible===true)-Number(a.eligible===true)||
  (b.opportunityScore??-1)-(a.opportunityScore??-1)||
  (b.estimatedProfitAud??-Infinity)-(a.estimatedProfitAud??-Infinity)||
  (b.discount??-Infinity)-(a.discount??-Infinity));
}
