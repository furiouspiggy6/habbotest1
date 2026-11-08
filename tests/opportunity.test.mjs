import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_SETTINGS,validateSettings,applyFiatMinimum,effectiveAudSettings,candidateDiagnostics} from '../core.mjs';
import {scoreOpportunityRows,sortByOpportunity} from '../opportunity.mjs';

const now=1762500000000,DAY=86400000,key='0x'+'c'.repeat(40)+'|metadata:identical';
const listing=(id,cost,profit,group=key)=>({
 id,key:group,contract:'0x'+'c'.repeat(40),collection:'Furni',tokenId:id,
 metadataResolved:true,quantity:1,price:cost,totalWithFeesEth:cost,
 reference:0.02,netEdge:30,discount:30,sales30d:10,
 estimatedFiatCost:cost*5000,estimatedProfitAud:profit,eligible:true
});
const sale=(id,daysAgo,price=0.02)=>({
 id:'sale-'+id,key,metadataResolved:true,timestamp:now-daysAgo*DAY,price
});
test('opportunity score ranks verified liquid profitable NFTs without changing trade IDs',()=>{
 const sales=Array.from({length:12},(_,i)=>sale(i,i*2));
 const rows=[listing('low-margin',0.015,1.5),listing('strong-margin',0.01,8)];
 const out=scoreOpportunityRows(rows,sales,{now});
 assert.equal(out.length,2);
 assert.equal(out[0].observedActiveOffers,2);
 assert.equal(out[0].observedCheaperOffers,1);
 assert.equal(out[1].observedCheaperOffers,0);
 assert.equal(out[1].liquidity,'high');
 assert.equal(out[1].confidence,'high');
 assert.ok(out[1].opportunityScore>out[0].opportunityScore);
 assert.equal(sortByOpportunity(out)[0].id,'strong-margin');
 assert.equal(rows[0].opportunityScore,undefined,'input rows remain immutable');
});
test('scoring exposes unknown recent trend and confidence on partial orderbook coverage',()=>{
 const rows=[listing('solo',0.01,5)];
 const sales=[sale('a',1),sale('b',13),sale('c',24)];
 const [r]=scoreOpportunityRows(rows,sales,{now,partialCollections:['Furni']});
 assert.equal(r.verifiedSales7d,1);
 assert.equal(r.trendPct,null);
 assert.equal(r.confidence,'low');
 assert.equal(r.partialActiveCoverage,true);
 assert.ok(r.scoreCautions.some(t=>t.includes('part')));
 assert.equal(r.buyOffersVerified,false);
});
test('declining 7-day sales median lowers score vs a stable median',()=>{
 const rows=[listing('sample',0.01,7)];
 const stable=Array.from({length:10},(_,i)=>sale(i,i*2,0.02));
 const falling=Array.from({length:10},(_,i)=>sale(i,i*2,i<4?0.012:0.02));
 const stableScore=scoreOpportunityRows(rows,stable,{now})[0];
 const fallingScore=scoreOpportunityRows(rows,falling,{now})[0];
 assert.ok(fallingScore.trendPct<0);
 assert.ok(fallingScore.opportunityScore<stableScore.opportunityScore);
});
test('no verified comparable history never creates an opportunity score',()=>{
 const result=scoreOpportunityRows([listing('unknown',0.01,20)],[],{now})[0];
 assert.equal(result.opportunityScore,null);
 assert.equal(result.liquidity,'low');
 assert.equal(result.confidence,'low');
});
test('extra execution cost allowance lowers projected profit and is enforced at settlement',()=>{
 const settings=validateSettings({...DEFAULT_SETTINGS,minEstimatedProfitAud:2,estimatedExtraCostsAud:1.5});
 const q={aud:5000,usd:3300,fetchedAt:now};
 const data={id:'a',eligible:true,metadataResolved:true,reference:0.003,price:0.002,
  totalWithFeesEth:0.002,quantity:1,discount:40,netEdge:25,sales30d:8};
 const withCosts=applyFiatMinimum([data],settings,q,now)[0];
 const without=applyFiatMinimum([data],{...settings,estimatedExtraCostsAud:0},q,now)[0];
 assert.equal(Number((without.estimatedProfitAud-withCosts.estimatedProfitAud).toFixed(2)),1.5);
 assert.equal(withCosts.estimatedExtraCostsAud,1.5);
 assert.equal(effectiveAudSettings(settings,q,now).settings.minimumProfitEth,(2+1.5)/5000);
 const rejected=applyFiatMinimum([{...data,reference:0.0025}],settings,q,now)[0];
 assert.equal(rejected.minProfitPassed,false);
});
test('configurable score gate and cheaper competitor rejection have independent diagnostics',()=>{
 const a={eligible:false,metadataResolved:true,reference:0.01,sales30d:5,quantity:1,
  price:0.002,totalWithFeesEth:0.002,discount:40,netEdge:25,fiatMinPassed:true,
  minProfitPassed:true,bestOfferPassed:false,scorePassed:true};
 const b={...a,bestOfferPassed:true,scorePassed:false};
 const counts=candidateDiagnostics([a,b],DEFAULT_SETTINGS);
 assert.equal(counts.cheaperComparableOffer,1);
 assert.equal(counts.belowOpportunityScore,1);
});
test('deep scans are optional, bounded and expose status in the desktop dashboard',()=>{
 const config=validateSettings({...DEFAULT_SETTINGS,deepScanEnabled:true,deepScanPages:80,deepScanIntervalMinutes:15,minOpportunityScore:72});
 assert.equal(DEFAULT_SETTINGS.deepScanEnabled,false);
 assert.equal(config.deepScanEnabled,true);
 assert.equal(config.deepScanPages,80);
 assert.equal(config.minOpportunityScore,72);
 assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,deepScanPages:81}),/deepScanPages/);
 assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,deepScanIntervalMinutes:14}),/deepScanIntervalMinutes/);
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 for(const id of ['minOpportunityScore','estimatedExtraCostsAud','deepScanEnabled','deepScanPages','deepScanIntervalMinutes','runDeepScanBtn']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(server,/scoreOpportunityRows\(withBids,chartSales/);
 assert.match(server,/sortByOpportunity\(scored/);
 assert.match(server,/uri\.pathname==='\/api\/scan\/deep'/);
 assert.match(server,/eligible:row\.eligible&&risk\.available&&scorePassed&&bestOfferPassed/);
 assert.match(ui,/opportunityScore/);
 assert.ok(pkg.build.files.includes('opportunity.mjs'));
});
