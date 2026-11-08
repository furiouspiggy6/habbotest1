import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {DEFAULT_SETTINGS,validateSettings,effectiveAudSettings,audLimitSummary} from '../core.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const now=Date.UTC(2026,10,8,10,0,0),quote={aud:5000,usd:3300,fetchedAt:now};
const newSettings={...DEFAULT_SETTINGS,maximumPriceAud:100,dailyBudgetAud:400,minPriceAud:2,minimumFiatPrice:5};
test('AUD strategy settings convert WETH safety limits using a fresh ETH/AUD quote',()=>{
 const settings=validateSettings(newSettings);
 const r=effectiveAudSettings(settings,quote,now);
 assert.equal(r.available,true);
 assert.equal(r.settings.maximumPriceEth,0.02);
 assert.equal(r.settings.dailyBudgetEth,0.08);
 assert.equal(r.settings.minPriceEth,0.0004);
 assert.equal(r.settings.minimumTotalPriceEth,0.001);
 assert.equal(audLimitSummary(settings,quote,now).dailyBudgetAud,400);
 assert.equal(settings.maximumPriceAud,100);
});
test('Australian dollar caps remain constant when the ETH spot rate changes',()=>{
 const settings=validateSettings(newSettings);
 const at5000=effectiveAudSettings(settings,quote,now).settings.maximumPriceEth;
 const at10000=effectiveAudSettings(settings,{...quote,aud:10000},now).settings.maximumPriceEth;
 assert.equal(at5000,0.02);
 assert.equal(at10000,0.01);
});
test('legacy WETH limits are preserved until AUD values are saved explicitly',()=>{
 const legacy=validateSettings(DEFAULT_SETTINGS);
 assert.equal(legacy.maximumPriceAud,null);
 assert.equal(effectiveAudSettings(legacy,quote,now).settings.maximumPriceEth,legacy.maximumPriceEth);
 assert.equal(audLimitSummary(legacy,quote,now).maximumPriceAud,legacy.maximumPriceEth*5000);
});
test('stale or unavailable AUD quote blocks buying and cannot loosen absolute WETH caps',()=>{
 const s=validateSettings(newSettings);
 assert.equal(effectiveAudSettings(s,null,now).available,false);
 assert.equal(effectiveAudSettings(s,{...quote,fetchedAt:now-16*60*1000},now).available,false);
 const extreme=validateSettings({...s,maximumPriceAud:1000000,dailyBudgetAud:1000000});
 const capped=effectiveAudSettings(extreme,quote,now);
 assert.equal(capped.settings.maximumPriceEth,2);
 assert.equal(capped.settings.dailyBudgetEth,5);
});
test('invalid AUD budgets reject and never silently overwrite saved limits',()=>{
 assert.throws(()=>validateSettings({...newSettings,dailyBudgetAud:50}),/Daily AUD budget/);
 assert.throws(()=>validateSettings({...newSettings,maximUmPriceAud:50,maximumPriceAud:-1}),/maximumPriceAud/);
 assert.throws(()=>validateSettings({...newSettings,minPriceAud:'not a price'}),/minPriceAud/);
});
test('dashboard uses only AUD money inputs and preserves single initialization',()=>{
 const html=readFileSync(resolve(root,'public/index.html'),'utf8');
 const js=readFileSync(resolve(root,'public/app.js'),'utf8');
 const server=readFileSync(resolve(root,'server.mjs'),'utf8');
 for(const id of ['maximumPriceAud','dailyBudgetAud','minPriceAud','minimumFiatPrice']){
  assert.match(html,new RegExp('id="'+id+'"'));
  assert.ok(js.includes(id),'dashboard should handle '+id);
 }
 for(const id of ['maximumPriceEth','dailyBudgetEth','minPriceEth','fiatCurrency']){
  assert.doesNotMatch(html,new RegExp('id="'+id+'"'));
 }
 assert.match(js,/function audCash\(/);
 assert.match(js,/audCash\(r\.price\)/);
 assert.match(js,/audCash\(r\.reference\)/);
 assert.match(js,/audCash\(val\)/);
 assert.match(js,/function inspectPrice\(value\)\{return audCash\(value\);\}/);
 assert.match(js,/audLimit\(data\.liveSpentTodayAud\)/);
 assert.match(server,/price_aud,median_aud,total_cost_aud/);
 assert.doesNotMatch(server,/price_weth,median_weth/);
 const trade=readFileSync(resolve(root,'trade.mjs'),'utf8');
 assert.match(trade,/fresh\.totalWithFeesEth<settings\.minimumTotalPriceEth/);
 assert.match(trade,/checked\.totalWithFeesEth<settings\.minimumTotalPriceEth/);
 assert.equal(js.split('async function sync()').length-1,1);
});
