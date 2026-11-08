import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_SETTINGS,applyFiatMinimum,analyze,inspectListing,candidateDiagnostics,effectiveAudSettings} from '../core.mjs';
import {applyConservativeResale,scoreOpportunityRows,sortByOpportunity} from '../opportunity.mjs';

const NOW=1762670000000,DAY=86400000,SPOT=5000;
const CONTRACT='0x'+'a'.repeat(40),KEY=CONTRACT+'|metadata:pure-emerald';
const settings={...DEFAULT_SETTINGS,minEstimatedProfitAud:1,estimatedExtraCostsAud:0,minimumFiatPrice:0};
const order=(id,aud,opts={})=>({
 id,contract:CONTRACT,collection:'Clothes',key:KEY,tokenId:String(id),
 metadataResolved:true,quantity:1,price:aud/SPOT,totalWithFeesEth:aud/SPOT,
 eligible:true,reference:48.75/SPOT,discount:42.83,netEdge:50,sales30d:6,
 ...opts
});
const history=Array.from({length:6},(_,i)=>({
 id:'sold-'+i,key:KEY,metadataResolved:true,price:48.75/SPOT,
 timestamp:NOW-(9+i*2)*DAY
}));
const price=(rows,historyToUse=history,strategy=settings)=>{
 const priced=applyFiatMinimum(rows,strategy,{aud:SPOT,usd:3000,fetchedAt:NOW},NOW);
 return applyConservativeResale(priced,historyToUse,strategy,{now:NOW,audSpot:SPOT});
};
test('Pure Emerald Skin regression: $27.87 ask vs $28.82 competition and $48.75 history is a LOSS, not $17 gain',()=>{
 const rows=[
  order('buy',27.87),
  order('other-1',28.82),order('other-2',29.36),order('other-3',29.36),
  order('other-4',30.51),order('other-5',30.51),order('other-6',32.81)
 ];
 const out=price(rows),r=out[0];
 assert.ok(Math.abs(r.currentCompetitorAskEth*SPOT-28.82)<1e-8);
 assert.ok(Math.abs(r.conservativeResaleEth*SPOT-28.82*0.98)<1e-8);
 assert.equal(r.resaleEstimateBasis,'2% under next competing ACTIVE asking price');
 assert.ok(r.historicalProfitAud>14);
 assert.ok(r.estimatedProfitAud<-1);
 assert.equal(r.minProfitPassed,false);
 assert.equal(r.conservativeDiscountPassed,false);
 assert.equal(r.conservativeNetEdgePassed,false);
 assert.equal(r.eligible,false);
 assert.equal(r.marketEvidencePassed,true);
 const score=scoreOpportunityRows(out,history,{now:NOW})[0];
 assert.ok(score.opportunityScore<=25,'Negative expected profit cannot display an attractive score');
 assert.equal(sortByOpportunity([score])[0].eligible,false);
 const detail=inspectListing(score,history,settings,NOW,NOW);
 assert.ok(detail.estimate.expectedProceedsEth<detail.listing.reference);
 assert.equal(detail.listing.estimatedProfitAud,r.estimatedProfitAud);
 assert.equal(detail.listing.currentCompetitorCount,6);
});
test('recent 7D median overrides inflated historical median and higher live asks',()=>{
 const recent=[
  ...history,
  {id:'last1',key:KEY,metadataResolved:true,price:32/SPOT,timestamp:NOW-DAY},
  {id:'last2',key:KEY,metadataResolved:true,price:33/SPOT,timestamp:NOW-2*DAY},
  {id:'last3',key:KEY,metadataResolved:true,price:31/SPOT,timestamp:NOW-3*DAY}
 ];
 const r=price([order('low',20),order('higher',45)],recent)[0];
 assert.equal(r.resaleEstimateBasis,'7-day completed-sale median');
 assert.ok(Math.abs(r.conservativeResaleEth*SPOT-32)<1e-8);
 assert.ok(r.estimatedProfitAud<(48.75*.925-20));
});
test('historical-only profitable NFT stays watch without separate competing live order',()=>{
 const [r]=price([order('solo',10)]);
 assert.ok(r.estimatedProfitAud>0,'Historical-only figure can be shown provisionally');
 assert.equal(r.marketEvidencePassed,false);
 assert.equal(r.eligible,false);
 const scored=scoreOpportunityRows([r],history,{now:NOW})[0];
 assert.ok(scored.opportunityScore<=49);
 assert.ok(scored.scoreCautions.some(x=>x.includes('No separate comparable')));
 const cd=candidateDiagnostics([r],settings);
 assert.equal(cd.noComparableCurrentAsk,1);
});
test('expired and multi-unit offers cannot manufacture comparable current market evidence',()=>{
 const [r]=price([order('item',10),order('old',15,{expiresAt:NOW-60_000}),order('multi',20,{quantity:5})]);
 assert.equal(r.currentCompetitorAskEth,null);
 assert.equal(r.marketEvidencePassed,false);
});
test('realistic profitable discount with competing asks still qualifies, including gas allowance',()=>{
 const strategy={...settings,estimatedExtraCostsAud:2};
 const rows=[order('low',15,{reference:45/SPOT}),order('other',40,{reference:45/SPOT})];
 const out=price(rows,history,strategy);
 const r=out[0];
 assert.equal(r.marketEvidencePassed,true);
 assert.ok(r.conservativeResaleEth*SPOT<=40*.98+1e-8);
 assert.ok(r.estimatedProfitAud>10);
 assert.ok(r.conservativeNetEdgePassed);
 assert.ok(r.conservativeDiscountPassed);
 assert.ok(r.minProfitPassed);
 assert.ok(r.eligible);
 const risk=effectiveAudSettings(strategy,{aud:SPOT,usd:3000,fetchedAt:NOW},NOW);
 assert.ok(Math.abs(risk.settings.estimatedExtraCostsEth-2/SPOT)<1e-15);
});
test('live settlement, inspector, and UI all rely on conservative resale, not historical quote',()=>{
 const trade=readFileSync(new URL('../trade.mjs',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(trade,/Number\(candidate\.conservativeResaleEth\)/);
 assert.match(trade,/candidate\.marketEvidencePassed!==true/);
 assert.doesNotMatch(trade,/const ref=Number\(candidate\.reference\)/);
 assert.match(server,/applyConservativeResale\(priced,chartSales/);
 assert.match(server,/verifyReadOnlyStackFloor\(target,true\)/);
 assert.match(html,/RESALE CEILING/);
 assert.match(app,/r\.conservativeResaleEth/);
 assert.match(app,/r\.currentCompetitorAskEth/);
});
