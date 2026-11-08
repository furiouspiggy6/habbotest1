import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectListing,marketplaceSearchUrl,DEFAULT_SETTINGS,COLLECTIONS} from '../core.mjs';
const HERE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=p=>readFileSync(resolve(HERE,p),'utf8');
const NOW=Date.UTC(2026,10,8,12,0,0);
const DAY=86400000;
function listing(){return {
 id:'live-123',collection:'Furni',contract:COLLECTIONS[0].address,tokenId:'123456',name:'Cefalu Pillar',
 key:`${COLLECTIONS[0].address}|name:cefalu pillar`,status:'ACTIVE',tokenType:'ERC721',metadataResolved:true,
 price:0.000147,quantity:1,feeEstimateEth:0.000003,totalWithFeesEth:0.000150,
 reference:0.000212,discount:30.7,netEdge:30.8,sales30d:4,eligible:true
};}
function sale(name,time,opts={}){return {...listing(),id:name,timestamp:time,status:'FILLED',price:opts.price??0.00021,metadataResolved:opts.metadataResolved??true,key:opts.key??listing().key,tokenId:opts.tokenId??'999'};}
test('inspection shows observed buyer fees, 30-day/90-day comparable fills and estimated profit, never an invented transaction',()=>{
 const history=[sale('recent',NOW-DAY),sale('older',NOW-36*DAY),sale('stale',NOW-91*DAY),
  sale('future',NOW+DAY),sale('unverified',NOW-2*DAY,{metadataResolved:false}),
  sale('different',NOW-DAY,{key:'another-collectible'})];
 const detail=inspectListing(listing(),history,DEFAULT_SETTINGS,NOW-10000,NOW);
 assert.equal(detail.listing.id,'live-123');
 assert.equal(detail.listing.totalWithFeesEth,0.000150);
 assert.equal(detail.history.count30d,1);
 assert.equal(detail.history.count90d,2);
 assert.deepEqual(detail.history.sales.map(x=>x.id),['recent','older']);
 assert.equal(detail.history.sales[0].tokenId,'999'); // other verified instances are comparable
 assert.equal(detail.estimate.expectedProceedsEth,0.0001961);
 assert.equal(detail.estimate.estimatedProfitEth,0.0000461);
 assert.ok(detail.estimate.estimatedRoiPct>30);
 assert.equal(detail.lastScan,NOW-10000);
});
test('inspection declines an estimated resale profit without verified reference',()=>{
 const row={...listing(),reference:null,eligible:false};
 const result=inspectListing(row,[],DEFAULT_SETTINGS,NOW,NOW);
 assert.equal(result.estimate.expectedProceedsEth,null);
 assert.equal(result.estimate.estimatedProfitEth,null);
 assert.equal(result.estimate.estimatedRoiPct,null);
 assert.deepEqual(result.history.sales,[]);
});
test('inspection caps output to 180 newest matching sales and reports count',()=>{
 const sales=Array.from({length:200},(_,i)=>sale('sale-'+i,NOW-i*100000));
 const details=inspectListing(listing(),sales,DEFAULT_SETTINGS,NOW,NOW);
 assert.equal(details.history.count90d,200);
 assert.equal(details.history.sales.length,180);
 assert.equal(details.history.limited,true);
 assert.equal(details.history.returned,180);
});
test('marketplace button points to verified TokenTrove category search, never fabricated order URL',()=>{
 const target=new URL(marketplaceSearchUrl(listing()));
 assert.equal(target.hostname,'tokentrove.com');
 assert.equal(target.pathname,'/collection/HabboFurni');
 assert.equal(target.searchParams.get('search'),'Cefalu Pillar');
 assert.equal(new URL(marketplaceSearchUrl({...listing(),collection:'Tokens'})).pathname,'/collection/HabboTokens');
 assert.equal(new URL(marketplaceSearchUrl({...listing(),collection:'Clothes'})).pathname,'/collection/HabboClothes');
 assert.equal(new URL(marketplaceSearchUrl({...listing(),collection:'Pets'})).pathname,'/collection/Habbo');
 assert.equal(new URL(marketplaceSearchUrl({...listing(),metadataResolved:false})).search,'');
});
test('live listing inspection is read-only and available from scanner row, side panel and keyboard-closable modal',()=>{
 const server=file('server.mjs'),js=file('public/app.js'),html=file('public/index.html');
 assert.match(server,/uri.pathname==='\/api\/listing-details'/);
 assert.match(server,/displayRows\.find\(row=>row\.id===id\)/);
 assert.match(server,/inspectListing\(listing,state\.historicalSales,state\.settings,scannedAt\)/);
 assert.match(js,/data-inspect-order/);
 assert.match(js,/function openInspect\(orderId\)/);
 assert.match(js,/event\.key==='Escape'/);
 assert.match(html,/id="inspectOverlay"/);
 assert.match(html,/aria-modal="true"/);
 assert.match(html,/id="inspectSelectedBtn"/);
 assert.match(html,/role="dialog"/);
});
