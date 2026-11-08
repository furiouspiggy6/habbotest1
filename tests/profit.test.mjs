import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,validateSettings,applyFiatMinimum,candidateDiagnostics,effectiveAudSettings} from '../core.mjs';
const NOW=1700000000000,QUOTE={aud:5000,usd:3200,fetchedAt:NOW};
const row=(price,reference)=>({id:String(price),eligible:true,metadataResolved:true,
 price,totalWithFeesEth:price,reference,quantity:1,sales30d:5,
 discount:45,netEdge:25,fiatMinPassed:true});
test('default expected profit floor rejects seven-cent flips and keeps meaningful opportunities',()=>{
 const s=validateSettings(DEFAULT_SETTINGS);
 assert.equal(s.minEstimatedProfitAud,1);
 const low=row(0.001,0.00109); // 0.00109*0.925-0.001=0.00000825 ETH = A$0.04125
 const high=row(0.001,0.0016); // A$2.40 before gas
 const out=applyFiatMinimum([low,high],s,QUOTE,NOW);
 assert.equal(out[0].estimatedProfitAud<0.1,true);
 assert.equal(out[0].eligible,false);
 assert.equal(out[0].minProfitPassed,false);
 assert.equal(out[1].estimatedProfitAud>2,true);
 assert.equal(out[1].eligible,true);
 assert.equal(out[1].minProfitPassed,true);
 assert.equal(candidateDiagnostics(out,s).belowEstimatedProfit,1);
});
test('changing profit minimum to 5 AUD gates opportunities at configurable amount',()=>{
 const s=validateSettings({...DEFAULT_SETTINGS,minEstimatedProfitAud:5});
 const out=applyFiatMinimum([row(0.001,0.0016)],s,QUOTE,NOW);
 assert.equal(out[0].eligible,false);
 assert.equal(out[0].minProfitPassed,false);
 assert.equal(effectiveAudSettings(s,QUOTE,NOW).settings.minimumProfitEth,0.001);
});
test('setting zero disables only the profit threshold, without bypassing existing fiat limits',()=>{
 const s=validateSettings({...DEFAULT_SETTINGS,minEstimatedProfitAud:0});
 const out=applyFiatMinimum([row(0.0001,null),row(0.002,null)],s,QUOTE,NOW);
 assert.equal(out[0].minProfitPassed,true);
 assert.equal(out[0].eligible,false); // A$0.50 below A$5 minimum
 assert.equal(out[1].minProfitPassed,true);
 assert.equal(out[1].eligible,true); // caller retains its independent comparable-sale gating
});
test('missing/stale AUD quote never turns a low-profit signal into a candidate',()=>{
 const s=DEFAULT_SETTINGS;
 for(const quote of [null,{...QUOTE,fetchedAt:NOW-16*60*1000}]){
  const out=applyFiatMinimum([row(0.002,0.004)],s,quote,NOW);
  assert.equal(out[0].eligible,false);
  assert.equal(out[0].estimatedProfitAud,null);
 }
});
test('invalid profit settings are rejected',()=>{
 assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,minEstimatedProfitAud:-1}),/minEstimatedProfitAud/);
 assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,minEstimatedProfitAud:1000001}),/minEstimatedProfitAud/);
});
test('profit threshold is reflected in UI, API and final settlement check',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const trade=readFileSync(new URL('../trade.mjs',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(html,/id="minEstimatedProfitAud"/);
 assert.match(html,/id="profitOnly"/);
 assert.match(html,/EST\. PROFIT \(AUD\)/);
 assert.match(js,/x\.estimatedProfitAud/);
 assert.match(js,/minimumProfit/);
 assert.match(trade,/checkProfit\(fresh\.totalWithFeesEth\)/);
 assert.match(trade,/checkProfit\(checked\.totalWithFeesEth\)/);
 assert.match(server,/'minEstimatedProfitAud'/);
});
