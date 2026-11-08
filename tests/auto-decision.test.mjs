import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WETH} from '../core.mjs';
import {parseDirectBid,addBidEvidence,decideAutomatically,decisionSummary} from '../bid-market.mjs';
import {createReadClients,scanMarket} from '../market.mjs';
import {scoreOpportunityRows} from '../opportunity.mjs';
const col={address:'0x'+'c'.repeat(40),name:'Clothes',enabled:true};
const other={address:'0x'+'b'.repeat(40),name:'Furni'};
const NOW=1762670000000;
const bid=(p={})=>({id:'bid-123',status:{name:'ACTIVE'},
 buy:[{type:'ERC721',contract_address:col.address,token_id:'123'}],
 sell:[{type:'ERC20',contract_address:WETH,start_amount:'50000000000000000'}],
 fees:[],start_at:new Date(NOW-1000).toISOString(),end_at:new Date(NOW+600000).toISOString(),...p});
const row=(id,eligible,profit)=>({id,name:'Sample',contract:col.address,tokenId:'123',
 metadataResolved:true,sales30d:5,reference:.05,totalWithFeesEth:.01,
 estimatedProfitAud:profit,eligible,marketEvidencePassed:true,
 conservativeDiscountPassed:true,conservativeNetEdgePassed:true,
 minProfitPassed:profit>=2,bestOfferPassed:true,scorePassed:true});
test('parse only active exact-token bids in the verified WETH currency',()=>{
 const valid=parseDirectBid(bid(),col,NOW);
 assert.equal(valid.priceEth,.05);
 assert.equal(valid.tokenId,'123');
 assert.equal(valid.id,'bid-123');
 for(const bad of [
  {status:{name:'CANCELLED'}},
  {sell:[{type:'ERC20',contract_address:other.address,start_amount:'50000000000000000'}]},
  {buy:[{type:'ERC721_COLLECTION',contract_address:col.address,token_id:'123'}]},
  {buy:[{type:'ERC721',contract_address:other.address,token_id:'123'}]},
  {buy:[{type:'ERC721',contract_address:col.address}]},
  {buy:[{type:'ERC721',contract_address:col.address,token_id:'123',start_amount:'2'}]},
  {end_at:new Date(NOW-1).toISOString()},
  {fees:[{amount:'50000000000000000'}]}
 ])assert.equal(parseDirectBid(bid(bad),col,NOW),null);
});
test('direct bids are informational and do not automatically approve purchases',()=>{
 const b=parseDirectBid(bid(),col,NOW);
 const priced=addBidEvidence([row('new',false,3),row('qualified',true,8)],[b],
  {estimatedResaleFeesPct:7.5,estimatedExtraCostsAud:1},3000);
 assert.equal(priced[0].highestDirectBidEth,.05);
 assert.ok(priced[0].bidExitProfitAud>0);
 assert.equal(priced[0].eligible,false);
 assert.equal(priced[1].eligible,true);
 const scored=scoreOpportunityRows(priced,[],{now:NOW});
 assert.equal(scored[0].buyOffersVerified,true);
});
test('automated decisions never turn an unqualified watch into a buy',()=>{
 const settings={minSales30d:3,minEstimatedProfitAud:2};
 const entries=decideAutomatically([
  row('ready',true,12),
  row('watch',false,5),
  {...row('bad',false,-2),marketEvidencePassed:false},
  {...row('unknown',false,null),sales30d:0}
 ],settings);
 assert.deepEqual(entries.map(r=>r.autoDecision),['BUY READY','AUTO WATCH','PASS','PASS']);
 assert.equal(decisionSummary(entries).ready,1);
 assert.equal(decisionSummary(entries).watched,1);
 assert.match(entries[1].autoDecisionReason,/other|requirement|margin|sale/i);
 assert.equal(entries[2].autoDecisionReason,'No separate comparable current asking price confirmed.');
});
test('read-only Immutable bids endpoint uses exact collection filter',async()=>{
 let url='';
 const fetcher=async u=>{url=u;return new Response(JSON.stringify({result:[],page:{}}),{status:200})};
 await createReadClients('',fetcher).orderbook.listBids({buyItemContractAddress:col.address,status:'ACTIVE',pageSize:50});
 assert.match(url,/\/orders\/bids/);
 assert.match(url,/buy_item_contract_address=0x/);
 assert.match(url,/status=ACTIVE/);
});
test('scan returns verified direct bid observations without breaking price data',async()=>{
 const rawBid=bid({end_at:new Date(Date.now()+3600000).toISOString(),start_at:new Date(Date.now()-3600000).toISOString()});
 const clients={orderbook:{
  listListings:async()=>({result:[],page:{}}),
  listBids:async()=>({result:[rawBid],page:{}})
 },blockchainData:{getNFT:async()=>({})}};
 const settings={collections:[col],pagesPerCollection:1,publishableKey:''};
 const result=await scanMarket(settings,{}, {},clients,[]);
 assert.equal(result.bids.length,1);
 assert.equal(result.bidDiagnostics[0].accepted,1);
 assert.equal(result.listings.length,0);
 assert.equal(result.failedRequests,0);
});
test('dashboard makes unattended decisions primary while preserving explicit live wallet lock',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(html,/<option value="auto" selected>Automated decisions<\/option>/);
 assert.match(html,/id="autoDecisionHeadline"/);
 assert.match(js,/function renderStats\(\)/);
 assert.match(js,/AUTO WATCH/);
 assert.match(server,/automatedSummary=decisionSummary\(displayRows\)/);
 assert.match(server,/const withBids=addBidEvidence\(/);
 assert.match(server,/if\(liveArmed\)/);
});
