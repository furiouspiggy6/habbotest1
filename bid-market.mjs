/** Read-only direct-token bids from Immutable zkEVM. They are not guaranteed exits:
 * bidders can cancel, spend their funds or lose token allowance before fulfillment.
 * Metadata/collection/trait bids are deliberately NOT treated as token-specific.
 */
import {WETH,weiToEth,safeTime} from './core.mjs';
export function parseDirectBid(input,collection,now=Date.now()){
 const r=input?.result?.result??input?.result??input;
 if(!r?.id||!Array.isArray(r.buy)||r.buy.length!==1||!Array.isArray(r.sell)||r.sell.length!==1)return null;
 if(String(r.status?.name??r.status??'').toUpperCase()!=='ACTIVE')return null;
 const nft=r.buy[0],payment=r.sell[0];
 if(!['ERC721','ERC1155'].includes(String(nft.item_type??nft.type??'').toUpperCase()))return null;
 if(String(nft.contract_address??nft.contractAddress??'').toLowerCase()!==collection.address.toLowerCase())return null;
 const tokenId=String(nft.token_id??nft.tokenId??'');
 if(!/^\d+$/.test(tokenId))return null; // no collection-wide or metadata guess
 if(String(payment.item_type??payment.type??'').toUpperCase()!=='ERC20'||
  String(payment.contract_address??payment.contractAddress??'').toLowerCase()!==WETH)return null;
 const qty=Number(nft.start_amount??nft.startAmount??nft.amount??1);
 if(qty!==1)return null;
 const price=weiToEth(payment.start_amount??payment.startAmount??payment.amount);
 if(!Number.isFinite(price)||price<=0)return null;
 const startsAt=safeTime(r.start_at??r.startAt),expiresAt=safeTime(r.end_at??r.endAt);
 if((startsAt&&startsAt>now)||(expiresAt&&expiresAt<=now))return null;
 const feeEntries=Array.isArray(r.fees)?r.fees:[];
 let fees=0;
 for(const entry of feeEntries){
  const amount=weiToEth(entry?.amount??'0');
  if(!Number.isFinite(amount)||amount<0)return null;
  fees+=amount;
 }
 if(fees>=price)return null;
 return {id:String(r.id),contract:collection.address.toLowerCase(),tokenId,priceEth:price,
  feeEstimateEth:fees,proceedsBeforeGasEth:price-fees,expiresAt:expiresAt||null};
}
export function addBidEvidence(rows,bids,settings,audSpot){
 const keyOf=r=>String(r.contract??'').toLowerCase()+'|'+String(r.tokenId??'');
 const best=new Map();
 for(const b of bids||[]){
  const key=keyOf(b);
  if(!best.has(key)||b.proceedsBeforeGasEth>best.get(key).proceedsBeforeGasEth)best.set(key,b);
 }
 const spot=Number(audSpot),available=Number.isFinite(spot)&&spot>0;
 const resaleFee=Number(settings.estimatedResaleFeesPct??7.5)/100;
 const extra=Number(settings.estimatedExtraCostsAud??0);
 return rows.map(row=>{
  const bid=best.get(keyOf(row)),cost=Number(row.totalWithFeesEth);
  // Deduct the assumed resale fee as well as any known bid-taker fees:
  // deliberately conservative even if some fees overlap.
  const afterFee=bid?Math.max(0,bid.proceedsBeforeGasEth*(1-resaleFee)):null;
  const bidExitProfitAud=bid&&available&&Number.isFinite(cost)?(afterFee-cost)*spot-extra:null;
  return {...row,highestDirectBidEth:bid?.priceEth??null,directBidId:bid?.id??null,
   directBidExpiresAt:bid?.expiresAt??null,bidExitProfitAud,
   bidOffersObserved:Boolean(bid),buyOffersVerified:Boolean(bid)};
 });
}
/** Analysis is automatic and non-interactive. Eligible == existing *strict* trade gates.
 * A separate positive estimate stays in a watch queue, never silently buys.
 */
export function decideAutomatically(rows,settings){
 return rows.map(r=>{
  const positive=Number.isFinite(r.estimatedProfitAud)&&r.estimatedProfitAud>=Math.max(0,Number(settings.minEstimatedProfitAud)||0);
  const action=r.eligible===true?'BUY READY':positive?'AUTO WATCH':'PASS';
  let reason;
  if(action==='BUY READY')reason='All conservative pricing, sales, competing-offer and wallet-independent strategy checks passed. Purchase still requires explicit live arming.';
  else if(!r.metadataResolved)reason='Collectible identity not yet verified.';
  else if(r.sales30d<settings.minSales30d||r.reference===null)reason='Too few verified comparable completed sales.';
  else if(r.marketEvidencePassed===false)reason='No separate comparable current asking price confirmed.';
  else if(r.bestOfferPassed===false)reason='Cheaper equivalent active listing observed.';
  else if(r.conservativeDiscountPassed===false)reason='Insufficient discount versus the conservative resale ceiling.';
  else if(r.conservativeNetEdgePassed===false)reason='Too little net return after assumed resale fees and costs.';
  else if(!positive)reason='Projected margin is negative or below your A$ profit minimum.';
  else if(r.scorePassed===false)reason='Below your configured opportunity-score minimum.';
  else reason='Other order, price or safety requirement not met.';
  return {...r,autoDecision:action,autoDecisionReason:reason};
 });
}
export function decisionSummary(rows){
 const buy=rows.filter(r=>r.autoDecision==='BUY READY');
 const watch=rows.filter(r=>r.autoDecision==='AUTO WATCH');
 const bids=rows.filter(r=>r.bidOffersObserved);
 return {ready:buy.length,watched:watch.length,passed:rows.length-buy.length-watch.length,
  bidsObserved:bids.length,
  best:buy[0]?{name:buy[0].name,orderId:buy[0].id,profitAud:buy[0].estimatedProfitAud,score:buy[0].opportunityScore}:null};
}
