import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchFiatRates} from '../fiat.mjs';
import {DEFAULT_SETTINGS,validateSettings,fiatMinimumStatus,applyFiatMinimum,candidateDiagnostics} from '../core.mjs';

test('public ETH quote maps into valid AUD/USD spot data without a real network call',async()=>{
 let requested='';
 const quote=await fetchFiatRates(async(url,options)=>{
  requested=url;
  assert.equal(options.method,'GET');
  return new Response(JSON.stringify({ethereum:{aud:5000,usd:3200}}),{status:200});
 },1700000000000);
 assert.match(requested,/api.coingecko.com\/api\/v3\/simple\/price/);
 assert.equal(quote.aud,5000);
 assert.equal(quote.usd,3200);
 assert.equal(quote.fetchedAt,1700000000000);
});
test('invalid rates, HTTP failures and JSON errors do not produce usable quotes',async()=>{
 await assert.rejects(()=>fetchFiatRates(async()=>new Response('{}',{status:429})),/HTTP 429/);
 await assert.rejects(()=>fetchFiatRates(async()=>new Response(JSON.stringify({ethereum:{aud:0,usd:5}}),{status:200})),/invalid ETH/);
});
test('default minimum purchase is 5 AUD, including buyer fees',()=>{
 const s=validateSettings(DEFAULT_SETTINGS);
 assert.equal(s.minimumFiatPrice,5);
 assert.equal(s.fiatCurrency,'AUD');
 const now=1700000000000;
 const quote={aud:5000,usd:3200,fetchedAt:now};
 const rows=[{id:'below',eligible:true,totalWithFeesEth:0.0009},
             {id:'exact',eligible:true,totalWithFeesEth:0.001},
             {id:'above',eligible:true,totalWithFeesEth:0.0011}];
 const out=applyFiatMinimum(rows,s,quote,now);
 assert.deepEqual(out.map(r=>r.eligible),[false,true,true]);
 assert.equal(out[1].estimatedFiatCost,5);
 assert.equal(fiatMinimumStatus(s,quote,now).equivalentWeth,0.001);
});
test('stale or missing spot quote blocks eligible listings safely',()=>{
 const s=DEFAULT_SETTINGS,now=1700000000000;
 for(const quote of [null,{aud:5000,usd:3200,fetchedAt:now-16*60*1000}]){
  const result=applyFiatMinimum([{eligible:true,totalWithFeesEth:0.01}],s,quote,now);
  assert.equal(result[0].eligible,false);
  assert.equal(result[0].fiatMinPassed,false);
 }
});
test('USD selection uses USD price and 0 fiat minimum disables the rule',()=>{
 const now=1700000000000,quote={aud:5000,usd:2500,fetchedAt:now};
 const usd=validateSettings({...DEFAULT_SETTINGS,fiatCurrency:'USD',minimumFiatPrice:5});
 assert.equal(applyFiatMinimum([{eligible:true,totalWithFeesEth:0.001}],usd,quote,now)[0].eligible,false);
 const off=validateSettings({...usd,minimumFiatPrice:0});
 assert.equal(applyFiatMinimum([{eligible:true,totalWithFeesEth:0.001}],off,null,now)[0].eligible,true);
 assert.throws(()=>validateSettings({...usd,fiatCurrency:'EUR'}),/fiatCurrency/);
});
test('candidate diagnostics labels fiat-floor rejection accurately',()=>{
 const s=DEFAULT_SETTINGS;
 const row={eligible:false,metadataResolved:true,reference:0.01,sales30d:4,quantity:1,price:0.002,totalWithFeesEth:0.002,
  fiatMinPassed:false,discount:30,netEdge:20};
 const counts=candidateDiagnostics([row],s);
 assert.equal(counts.belowFiatMinimum,1);
});

test('Windows desktop packages the public rate reader and settings control',async()=>{
 const {readFileSync}=await import('node:fs');
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.ok(pkg.build.files.includes('fiat.mjs'),'fiat module must ship in the Windows installer');
 assert.match(html,/id="minimumFiatPrice"/);
 assert.match(html,/id="fiatCurrency"/);
 assert.ok(ui.includes("fiatCurrency:$('fiatCurrency').value"));
 assert.match(server,/displayRows=applyFiatMinimum\(/);
 assert.match(server,/fiatMinimumStatus\(state.settings,fiatRates\).available/);
});
