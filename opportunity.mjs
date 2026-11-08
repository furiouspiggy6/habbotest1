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

/**
 * Conservative, auditable resale ceiling. Other ACTIVE asks are seller prices,
 * not executable bids, so 2% undercutting is an assumption, not a sale promise.
 * Critically, an old 30D median may NEVER override lower observed competition.
 *
 * A separate comparable current ask is mandatory to qualify for live buying:
 * without one the projected value is historical-only and must remain WATCH.
 * Calling this before scoring ensures the rank and all buy gates use the same
 * (possibly negative) fee-adjusted profit rather than a stale historical median.
 */
export function applyConservativeResale(rows,history,settings,{now=Date.now(),audSpot=null,undercutPct=2}={}){
 const asks=new Map(),sales7=new Map();
 for(const r of rows){
  const k=identity(r);
  if(!k||Number(r.quantity)!==1||!finite(r.price)||r.price<=0)continue;
  if(r.expiresAt&&Number(r.expiresAt)<=now)continue;
  if(r.startsAt&&Number(r.startsAt)>now)continue;
  if(!asks.has(k))asks.set(k,[]);
  asks.get(k).push(r);
 }
 for(const s of history){
  const k=identity(s),time=Number(s.timestamp),price=Number(s.price);
  if(!k||!finite(time)||time>now||now-time>7*DAY||!finite(price)||price<=0)continue;
  if(!sales7.has(k))sales7.set(k,[]);
  sales7.get(k).push(price);
 }
 const fee=Number(settings?.estimatedResaleFeesPct);
 const extra=Number(settings?.estimatedExtraCostsAud??0);
 const minProfit=Number(settings?.minEstimatedProfitAud??0);
 const minNetEdge=Number(settings?.minNetEdgePct??0);
 const minDiscount=Number(settings?.minDiscountPct??0);
 const spot=Number(audSpot);
 const rateValid=finite(spot)&&spot>0;
 const undercut=1-clamp(Number(undercutPct),0,20)/100;
 return rows.map(row=>{
  const k=identity(row),cost=Number(row.totalWithFeesEth),reference=Number(row.reference);
  const otherAsks=k?(asks.get(k)||[]).filter(x=>String(x.id)!==String(row.id)):[];
  const nextAsk=otherAsks.length?Math.min(...otherAsks.map(x=>x.price)):null;
  const recentPrices=k?(sales7.get(k)||[]):[];
  const sevenDayMedian=recentPrices.length>=3?median(recentPrices):null;
  const caps=[
   finite(reference)&&reference>0?{source:'30-day completed-sale median',value:reference}:null,
   sevenDayMedian!==null?{source:'7-day completed-sale median',value:sevenDayMedian}:null,
   nextAsk!==null?{source:'2% under next competing ACTIVE asking price',value:nextAsk*undercut}:null
  ].filter(Boolean);
  const best=caps.length?caps.reduce((a,b)=>a.value<=b.value?a:b):null;
  const resale=best?.value??null;
  const profitEth=resale!==null&&finite(fee)&&finite(cost)&&cost>0?
   resale*(1-fee/100)-cost:null;
  const beforeExtra=profitEth!==null&&rateValid?profitEth*spot:null;
  const profitAud=beforeExtra!==null?beforeExtra-extra:null;
  const netEdge=profitAud!==null&&rateValid&&cost>0?profitAud/(cost*spot)*100:null;
  const conservativeDiscount=resale!==null&&resale>0?100*(1-Number(row.price)/resale):null;
  const marketEvidencePassed=nextAsk!==null;
  const minProfitPassed=profitAud!==null&&profitAud+1e-8>=minProfit;
  const conservativeNetEdgePassed=netEdge!==null&&netEdge+1e-9>=minNetEdge;
  const conservativeDiscountPassed=conservativeDiscount!==null&&conservativeDiscount+1e-9>=minDiscount;
  return {...row,
   historicalProfitAud:row.estimatedProfitAud??null,
   currentCompetitorAskEth:nextAsk,
   currentCompetitorCount:otherAsks.length,
   recentSevenDayMedianEth:sevenDayMedian,
   conservativeResaleEth:resale,
   resaleEstimateBasis:best?.source??'No verifiable resale evidence',
   resaleUndercutPct:clamp(Number(undercutPct),0,20),
   conservativeDiscountPct:conservativeDiscount,
   estimatedProfitEth:profitEth,
   estimatedProfitBeforeExtraCostsAud:beforeExtra,
   estimatedProfitAud:profitAud,
   minProfitPassed,marketEvidencePassed,conservativeNetEdgePassed,conservativeDiscountPassed,
   netEdge:netEdge,
   eligible:row.eligible===true&&marketEvidencePassed&&minProfitPassed&&
    conservativeNetEdgePassed&&conservativeDiscountPassed
  };
 });
}
