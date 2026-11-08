import {cheapestPerCollectible} from './listing-views.mjs';
const $=id=>document.getElementById(id);
const htmlSafe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,places=6)=>Number.isFinite(Number(n))?Number(n).toFixed(places):'—';
const percent=n=>Number.isFinite(Number(n))?Number(n).toFixed(1)+'%':'—';
const relative=ms=>!ms?'Not scanned yet':(Date.now()-ms<10000?'Just now':`${Math.max(1,Math.floor((Date.now()-ms)/60000))}m ago`);
function listingDate(ms){
 const d=Number(ms);if(!Number.isFinite(d)||d<=0)return 'Not provided';
 return new Date(d).toLocaleString('en-AU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function listingAge(ms){
 const t=Number(ms);if(!Number.isFinite(t)||t<=0)return 'Unknown';
 const delta=Date.now()-t;if(delta<0)return 'Starts later';
 const mins=Math.floor(delta/60000);
 if(mins<1)return 'Just listed';
 if(mins<60)return mins+'m ago';
 const hours=Math.floor(mins/60);
 if(hours<48)return hours+'h ago';
 return Math.floor(hours/24)+'d ago';
}
function listingExpiry(ms){
 const end=Number(ms);if(!Number.isFinite(end)||end<=0)return 'Unknown';
 const diff=end-Date.now();
 if(diff<=0)return 'Expired — verify';
 const hours=Math.ceil(diff/3600000);
 if(hours<48)return hours+'h left';
 const days=Math.ceil(diff/86400000);
 if(days<365)return days+'d left';
 return Math.round(days/30)+'mo left';
}
function inspectWeth(value){
 if(value===null||value===undefined||!Number.isFinite(Number(value)))return 'Not supplied';
 return Number(value).toFixed(8)+' WETH';
}
// User-facing prices are AUD estimates from the live ETH/AUD spot quote.
const audSpot=()=>{const q=data?.fiatQuote,rate=Number(q?.spot);return q?.available&&q.currency==='AUD'&&Number.isFinite(rate)&&rate>0?rate:null;};
function audCash(value){
 if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';
 const rate=audSpot();if(!rate)return '— (AUD quote unavailable)';
 const x=Number(value)*rate,precision=x!==0&&Math.abs(x)<.01?6:Math.abs(x)<1?4:2;
 return 'A$'+x.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:precision});
}
const audLimit=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':'A$'+Number(value).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
const editableAud=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'':Number(Number(value).toFixed(4));
let data=null,selectedId=null,selectedKey=null,currentTab='market',days=30,currentChart=null,settingsLoaded=false,lastChartRequest=0;
const ROWS_PER_PAGE=100;
let pageIndex=0, cachedRows=[], cachedScanAt=null, audControlsReady=false, visibleRows=[];
let cachedOpenSeaFeed=null,openSeaTestBusy=false;
let toastTimer;
let availableUpdate=null, updateBusy=false;
function toast(message,error=false){const e=$('toast');e.textContent=message;e.className='toast'+(error?' error':'');e.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.hidden=true,4500);}
async function api(url,body=null){const r=await fetch(url,body===null?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const out=await r.json();if(!r.ok)throw new Error(out.error??`HTTP ${r.status}`);return out;}
function view(tab){currentTab=tab;for(const t of ['market','trades','settings'])$(t+'Tab').hidden=t!==tab;
 document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='trades')renderTrades();if(tab==='settings')renderReadiness();}
function selectedRow(){return visibleRows.find(r=>r.id===selectedId)??visibleRows[0]??null;}
function renderBanner(){
 const hasListings=Number(data?.listingCount)>0;
 const connected=Number(data.stats?.successfulRequests)>0;
 $('modeBadge').textContent=hasListings?'● LIVE NFT LISTINGS':connected?'● LIVE CONNECTED · NO LISTINGS':'● LIVE NOT CONNECTED';
 $('updatedText').textContent=relative(data.lastScan);
 const b=$('banner');b.className='banner '+(connected?'live-banner':'error-banner');
 let title=hasListings?'Live Habbo NFT listings received':connected?'No matching NFT listings found':'Waiting for Immutable marketplace';
 let copy=hasListings?'Showing real orderbook listings. Real-money buying remains OFF until separately armed.':connected?'Marketplace reached, but no supported Habbo NFT offers have been found. See scan diagnostics.':'No real orders received. Check the API diagnostics and network connection.';
 if(data.warnings?.length){
  const failureCount=Number(data.stats?.failedRequests)||0;
  const activeCapped=Number(data.stats?.truncated)>0;
  const specificError=data.warnings.find(w=>/request failed|backfill stopped|history continuation failed|ACTIVE stopped|Live scan failed/i.test(w));
  b.className='banner '+(failureCount?'error-banner':'live-banner');
  if(!data.fiatQuote?.available){
   b.className='banner error-banner';
   title='AUD conversion unavailable — purchases blocked';
   copy='The current ETH/AUD spot quote is unavailable or too old. AUD prices cannot be verified, and purchases are blocked. '+(data.fiatQuote.error||'');
  }else if(failureCount){
   title=`Immutable requests failed (${failureCount})`;
   copy=specificError||'Some collection requests failed. Open scan details for the exact error.';
  }else if(activeCapped){
   title='Live listing coverage limited by scan depth';
   copy=data.warnings.find(w=>/ACTIVE: more listings exist|PARTIAL ACTIVE COVERAGE/i.test(w))||data.warnings[0];
  }else{
   title='Live market indexing in progress';
   copy=data.warnings[0];
  }
 }
 $('bannerGo').textContent='View scan details →';
 b.querySelector('b').textContent=title;b.querySelector('span:not(.banner-icon)').textContent=copy;
 $('connectionPill').innerHTML='<span class="pulse-dot"></span> '+(data.scanning?'SCANNING':hasListings?'LIVE LISTINGS':connected?'CONNECTED · EMPTY':'LIVE OFFLINE');
}
function renderStats(){
 const bot=data?.autoDecision??{ready:0,watched:0,passed:0,bidsObserved:0,best:null};
 $('autoDecisionHeadline').textContent=bot.ready>0?
  bot.ready+' BUY READY · bot already selected the strongest opportunities':
  'NO SAFE BUY RIGHT NOW · automated monitoring continues';
 $('autoDecisionDetails').textContent=bot.ready>0
  ?(bot.best?.name||'Best candidate')+' · conservative estimated profit '+audLimit(bot.best?.profitAud)+
    ' · '+bot.watched+' other(s) automatically watched · '+bot.bidsObserved+' direct-token bid(s) matched. '+
    (data.armed?'Live autobuyer is armed and will perform its safety checks.':'Purchases remain disabled until you arm the wallet autobuyer.')
  :bot.watched+' NFT(s) on automatic watch · '+bot.passed+' rejected/insufficient evidence · '+
   bot.bidsObserved+' matched direct-token bid(s). The bot keeps scanning automatically; you do not need to inspect listings.';
 $('statListings').textContent=data.listingCount??0;$('statOpportunities').textContent=data.candidateCount??0;
 $('statSales').textContent=data.stats?.historicalSales??data.stats?.sales??0;$('statSpend').textContent=audLimit(data.liveSpentTodayAud);
 $('riskLimit').textContent=audLimit(data.audLimits?.maximumPriceAud);$('riskDiscount').textContent=data.settings.minDiscountPct+'%';
 if($('fiatRateText')){
  const q=data.fiatQuote;
  $('fiatRateText').textContent=q?.available
   ?`All values shown in AUD. Current ETH/AUD spot estimate: A$${Number(q.spot).toFixed(2)} per ETH · updated ${new Date(q.fetchedAt).toLocaleTimeString()}. The actual transaction settles in WETH.`
   :'Waiting for a fresh ETH/AUD conversion rate. AUD prices cannot be verified; buys are blocked. '+(q?.error||'');
 }
 const canBuy=data.armed;$('autobuyIndicator').textContent=canBuy?'● LIVE ARMED':'● DISARMED';
 $('autobuyIndicator').style.color=canBuy?'#f87982':'#55e0bc';
 $('engineText').textContent=canBuy?'REAL MONEY purchasing is active. One eligible NFT at most per scan; it disarms on error or restart.':'Live market scanner is running. Real buying is OFF until separately enabled with a dedicated wallet and confirmation phrase.';
 $('coverageText').textContent=`${data.listingCount??0} LIVE offers across ${data.settings.collections.filter(c=>c.enabled).length} collections · up to ${data.settings.pagesPerCollection} ACTIVE pages per collection · ${data.stats.pages} pages read · ${data.stats.truncated?'PARTIAL coverage':'page scan complete'} · ${data.stats.failedRequests??0} failed requests · ${data.deepScan?.lastMode==='deep'?'DEEP':'regular'} scan (${data.deepScan?.scanPages??data.settings.pagesPerCollection} pages limit)`;
 const cv=data.stats.coverage,cd=data.stats.candidateDiagnostics;
 const coverage=cv?`Verified NFT identity: ${cv.activeResolved}/${cv.activeTotal} active · ${cv.salesResolved}/${cv.salesTotal} sold · ${cv.fetchedThisScan} resolved this scan, ${cv.failedThisScan} failed.`:'Metadata coverage not available yet.';
 const historyLine=`Historical sales: ${data.stats.historyPending??0} collection(s) still indexing older pages; ${data.stats.historyCompleted??0} reached the end this scan. ${data.stats.historicalSales??0} unique sales cached locally.`;
 const reasons=cd?`Automatic decision diagnostics (first rejected criterion per listing): ${cd.missingMetadata} missing NFT metadata; ${cd.insufficientComparableSales} insufficient comparable sales; ${cd.priceOutsideLimits} outside AUD price limits; ${cd.belowFiatMinimum??0} below dollar minimum or missing exchange rate; ${cd.discountTooSmall} below discount threshold; ${cd.netEdgeTooSmall} below net-edge threshold; ${cd.noComparableCurrentAsk??0} without a competing current ask; ${cd.belowConservativeDiscount??0} below conservative resale discount; ${cd.belowEstimatedProfit??0} below A$ profit minimum; ${cd.cheaperComparableOffer??0} cheaper competing comparable offer; ${cd.belowOpportunityScore??0} below optional opportunity score; ${cd.multiQuantity} multi-quantity; ${cd.eligible} eligible.`:'Candidate breakdown not available yet.';
 $('scanDiagnostics').textContent=([`Immutable scan segments: ${data.stats.successfulRequests??0} completed / ${data.stats.failedRequests??0} failed or interrupted. ${data.stats.rawOrders??0} raw orders received.`,coverage,historyLine,reasons,...data.warnings,`Direct bids: ${data.stats?.bids??0} valid exact-token orders; ${JSON.stringify(data.stats?.bidDiagnostics??[])}`,`Rejected orders: ${JSON.stringify(data.stats.rejected||{})}`, ...((data.stats.diagnostics||[]).map(d=>`${d.collection} ${d.status}: ${d.error||`${d.accepted}/${d.raw} accepted (${d.pages} pages)${d.shape?' shape='+JSON.stringify(d.shape):''}`}`))].join('\n')); 
}
function withinAudRange(row){
 const spot=audSpot(),limits=data?.audLimits,settings=data?.settings;
 if(!spot||!limits||!settings)return false;
 const list=Number(row.price)*spot,total=Number(row.totalWithFeesEth)*spot;
 const minimum=Number(limits.minPriceAud),maximum=Number(limits.maximumPriceAud),withFees=Number(settings.minimumFiatPrice);
 return Number.isFinite(list)&&Number.isFinite(total)&&
  Number.isFinite(minimum)&&Number.isFinite(maximum)&&Number.isFinite(withFees)&&
  list>=minimum&&total>=withFees&&total<=maximum;
}
function filterRows(){const text=$('searchInput').value.trim().toLowerCase(),collection=$('collectionFilter').value,signal=$('signalFilter').value;
 const minimumProfit=Number(data?.settings?.minEstimatedProfitAud??0);
 const matched=(data?.rows??[]).filter(x=>(!text||(`${x.name} ${x.tokenId} ${x.collection}`).toLowerCase().includes(text))&&(!collection||x.collection===collection)&&
  (signal==='all'||(signal==='eligible'?x.eligible:signal==='auto'?
   withinAudRange(x)&&['BUY READY','AUTO WATCH'].includes(x.autoDecision):withinAudRange(x)))&&
  (!$('profitOnly').checked||minimumProfit<=0||
   (Number.isFinite(Number(x.estimatedProfitAud))&&x.estimatedProfitAud!==null&&x.estimatedProfitAud!==undefined&&x.estimatedProfitAud+1e-8>=minimumProfit)));
 if($('profitOnly').checked&&minimumProfit>0)matched.sort((a,b)=>Number(b.eligible===true)-Number(a.eligible===true)||(b.opportunityScore??-1)-(a.opportunityScore??-1)||(b.estimatedProfitAud??-1e12)-(a.estimatedProfitAud??-1e12));
 const grouped=$('cheapestOnly').checked;
 const found=grouped?cheapestPerCollectible(matched):matched;
 visibleRows=found;
 if(!found.some(r=>r.id===selectedId))selectedId=found[0]?.id??null;
 $('scannerCount').textContent=found.filter(x=>x.eligible).length;
 $('resultCount').textContent=grouped
  ?`${found.length} distinct items · ${matched.length} matching listings`
  :matched.length===data.listingCount?`${matched.length} live listings`:`${matched.length} matching of ${data.listingCount??0} live listings`;
 const totalPages=Math.max(1,Math.ceil(found.length/ROWS_PER_PAGE));
 pageIndex=Math.min(pageIndex,totalPages-1);
 const start=pageIndex*ROWS_PER_PAGE;
 const limited=found.slice(start,start+ROWS_PER_PAGE),body=$('marketRows');
 $('pageSummary').textContent=found.length?`Showing ${start+1}–${start+limited.length} of ${found.length} · Page ${pageIndex+1}/${totalPages}`:'No matching listings';
 $('pagePrev').disabled=pageIndex===0;
 $('pageNext').disabled=pageIndex>=totalPages-1;
 body.innerHTML=limited.map(r=>`<tr class="${r.id===selectedId?'selected':''}" data-order="${htmlSafe(r.id)}"><td><div class="nft-name">${htmlSafe(r.name)}</div><div class="nft-sub">${htmlSafe(r.collection)} · token ${htmlSafe(r.tokenId)}${r.groupedOfferCount>1?' · '+r.groupedOfferCount+' offers':''}</div></td><td class="price">${audCash(r.totalWithFeesEth)}</td><td class="${r.estimatedProfitAud!==null&&r.estimatedProfitAud>=0?'positive':'neutral'}">${r.estimatedProfitAud===null||r.estimatedProfitAud===undefined?'—':audLimit(r.estimatedProfitAud)}</td><td><span class="opportunity-score ${r.opportunityScore!==null&&r.opportunityScore>=70?'strong':''}" title="${htmlSafe((r.scoreCautions||[]).join(' | ')||'Heuristic score, not a resale guarantee')}">${r.opportunityScore===null?'—':r.opportunityScore+'/100'}</span><small class="score-confidence">${htmlSafe((r.confidence||'low').toUpperCase())} confidence</small></td><td>${audCash(r.conservativeResaleEth)}</td><td class="${r.conservativeDiscountPct>=0?'positive':'neutral'}">${r.conservativeDiscountPct==null?'—':(r.conservativeDiscountPct>0?'-':'')+percent(Math.abs(r.conservativeDiscountPct))}</td><td>${r.sales30d}</td><td title="${htmlSafe(listingDate(r.listedAt))}">${htmlSafe(listingAge(r.listedAt))}</td><td title="${htmlSafe(listingDate(r.expiresAt))}">${htmlSafe(listingExpiry(r.expiresAt))}</td><td><span class="signal ${r.eligible?'buy':''}">${htmlSafe(r.autoDecision??(r.eligible?'BUY READY':'PASS'))}</span></td><td><button class="row-inspect" type="button" data-inspect-order="${htmlSafe(r.id)}">Inspect →</button></td></tr>`).join('');
 body.querySelectorAll('tr').forEach(tr=>tr.addEventListener('click',()=>{selectedId=tr.dataset.order;renderMarket();void loadChart(true);}));
 body.querySelectorAll('.row-inspect').forEach(btn=>btn.addEventListener('click',event=>{
  event.stopPropagation();selectedId=btn.dataset.inspectOrder;
  renderMarket();void loadChart(true);void openInspect(selectedId);
 }));
 const empty=$('emptyRows');
 empty.hidden=limited.length>0;
 if(!limited.length){
  const heading=empty.querySelector('b'),help=empty.querySelector('small');
  if(!Number(data?.listingCount)){
   heading.textContent='No live NFT listings received yet.';
   help.textContent='Check the Immutable connection diagnostics, then refresh.';
  }else if(signal==='auto'){
    heading.textContent='No buy-ready or positive-watch deals in your spending range.';
    help.textContent='Automated market analysis is working. The bot will keep checking live bids, sales and competing asks on each refresh; no manual research is needed. Zero qualifying buys is a valid result.';
   }else if(signal==='eligible'){
   heading.textContent='No NFTs currently qualify as buying candidates.';
   help.textContent=`${data.listingCount} real listings were scanned, but none passed all of your buying rules. Select “Within my price range” to see affordable listings that are still on watch.`;
  }else if(signal==='range'&&!audSpot()){
   heading.textContent='AUD price-range filter needs a fresh exchange rate.';
   help.textContent='The ETH/AUD quote is unavailable. Listings are still available under “All listings”; buying stays blocked until a fresh quote is received.';
  }else if(signal==='range'){
   heading.textContent='No NFTs found within your configured AUD price range.';
   help.textContent=`Your range is ${audLimit(data.audLimits?.minPriceAud)} minimum listing price to ${audLimit(data.audLimits?.maximumPriceAud)} maximum total price, plus a ${audLimit(data.settings?.minimumFiatPrice)} minimum including fees. Try “All listings” or change the spending settings.`;
  }else{
   heading.textContent='No listings match these filters.';
   help.textContent=$('profitOnly').checked&&minimumProfit>0?
    'No listings passed your A$'+minimumProfit.toFixed(2)+' estimated profit minimum. Uncheck the profit filter above to inspect lower-profit items.':
    'Clear the search or collection filter. The market still has live listings.';
  }
 }
}
function renderOpenSea(){
 if(!data)return;
 const external=data.openSeaFeed??{rows:[],status:'needs-key'};
 const rows=external.rows??[],meta=data.openSea??{};
 $('openSeaCount').textContent=rows.length;
 const status=meta.loading?'CHECKING':String(meta.status??'needs-key').toUpperCase().replaceAll('-',' ');
 $('openSeaStatus').textContent=status;
 $('openSeaHelp').textContent=rows.length
  ?`${rows.length} verified Ethereum Habbo Avatar orders · ${external.pages??0} pages · last checked ${listingDate(external.checkedAt)}. ${external.truncated?'More pages exist. ':''}These are watch-only; estimated profit is not available without separate verified Ethereum sales history.`
  :meta.loading?'Contacting OpenSea API for Ethereum Habbo Avatars…':
   external.error||'Set an OpenSea API key in Strategy & Settings to scan Habbo Avatars.';
 $('openSeaRows').innerHTML=rows.slice(0,200).map(r=>`<tr><td><b>${htmlSafe(r.name)}</b><div class="nft-sub">Ethereum · Token ${htmlSafe(r.tokenId)}</div></td>
  <td class="price">${audCash(r.buyerTotalEth)}</td><td>${htmlSafe(Number(r.buyerTotalEth).toFixed(6))} ${htmlSafe(r.currency)}</td>
  <td title="${htmlSafe(listingDate(r.listedAt))}">${htmlSafe(listingAge(r.listedAt))}</td>
  <td title="${htmlSafe(listingDate(r.expiresAt))}">${htmlSafe(listingExpiry(r.expiresAt))}</td>
  <td><a href="${htmlSafe(r.href)}" target="_blank" rel="noopener noreferrer">View NFT ↗</a></td></tr>`).join('');
}
function renderMarket(){if(!data)return;renderBanner();renderStats();filterRows();renderDetail();renderOpenSea();}
function renderDetail(){const r=selectedRow();
 $('inspectSelectedBtn').disabled=!r;
 if(!r){$('chartTitle').textContent='Select an NFT';$('detailPrice').textContent='—';$('detailDiscount').textContent='—';$('detailSales').textContent='—';$('detailMedian').textContent='—';$('detailEdge').textContent='—';return;}
 $('chartTitle').textContent=r.name;$('detailPrice').textContent=audCash(r.totalWithFeesEth);$('detailDiscount').textContent=r.conservativeDiscountPct===null?'Unpriced':(r.conservativeDiscountPct>0?'↓ ':'↑ ')+percent(Math.abs(r.conservativeDiscountPct));
 $('detailDiscount').style.color=r.conservativeDiscountPct>0?'#55e0bc':'#8497a9';$('detailSales').textContent=r.sales30d;
 $('detailMedian').textContent=audCash(r.conservativeResaleEth);$('detailEdge').textContent=percent(r.netEdge);
}
// Deep inspection uses a snapshot of the live order and ONLY cached, verified filled orders.
let inspectedOrderId=null;
let inspectReturnFocus=null;
function inspectPrice(value){return audCash(value);}
function inspectPct(value){return value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value).toFixed(1)+'%';}
function inspectDate(ms){const d=new Date(Number(ms));return Number.isFinite(d.getTime())?d.toLocaleString():'Unknown';}
function inspectPair(label,value){return `<div class="inspect-pair"><span>${htmlSafe(label)}</span><strong>${htmlSafe(value)}</strong></div>`;}
function renderInspection(info){
 const r=info.listing,estimate=info.estimate,h=info.history;
 const safeMarketplace=(()=>{try{const u=new URL(info.marketplaceUrl);return u.protocol==='https:'&&u.hostname==='tokentrove.com'?u.href:null;}catch{return null;}})();
 $('inspectTitle').textContent=r.name;
 const img=typeof r.image==='string'&&/^https:\/\//.test(r.image)&&r.image.length<2048?`<img src="${htmlSafe(r.image)}" alt="${htmlSafe(r.name)}" referrerpolicy="no-referrer">`:'';
 const metric=(label,value,cls='')=>`<div class="inspect-metric"><small>${htmlSafe(label)}</small><b class="${cls}">${htmlSafe(value)}</b></div>`;
 const enough=h.count30d>=3;
 const historyRows=h.sales.map(s=>`<tr><td>${htmlSafe(inspectDate(s.timestamp))}</td><td>${htmlSafe(inspectPrice(s.price))}</td><td>${htmlSafe(s.tokenId)}</td><td>${htmlSafe(String(s.id))}</td></tr>`).join('');
 const totalCost=Number(r.totalWithFeesEth);
 const rate=info.audRate,liveCheck=info.priceAudit,stackFloor=info.stackFloor;
 const stackedFloor=stackFloor?.status==='available'
  ?inspectWeth(stackFloor.priceEth)+' (order '+String(stackFloor.orderId||'unknown')+')'
  :'Not available — '+(stackFloor?.reason||'No separate quote');
 const latestOrder=(liveCheck?.status==='confirmed'
  ?(liveCheck.priceChanged||liveCheck.feesChanged?'Changed — verify before buying':'Matched original Immutable order')
  :'Not independently verified — '+(liveCheck?.message||'API unavailable'));
 const ref=r.reference===null?'Not enough data':inspectPrice(r.reference);
 const resale=r.conservativeResaleEth===null?'Not verified':inspectPrice(r.conservativeResaleEth);
 const breakEvenAud=Number.isFinite(r.estimatedFiatCost)&&
  Number(estimate.resaleFeePct)<100?
  (r.estimatedFiatCost+Number(r.estimatedExtraCostsAud??0))/(1-Number(estimate.resaleFeePct)/100):null;
 const estimateProfit=estimate.estimatedProfitEth;
 const profitClass=estimateProfit===null?'':estimateProfit>=0?'good':'bad';
 const qualified=r.autoDecision==='BUY READY'?'● BUY READY':r.autoDecision==='AUTO WATCH'?'● AUTO WATCH':'● PASS / NOT PROFITABLE';
 $('inspectStatus').textContent='';
 $('inspectContent').innerHTML=`
  <div class="inspect-intro">${img}<div><h3>${htmlSafe(r.name)}</h3><small>${htmlSafe(r.collection)} · ${htmlSafe(r.tokenType||'NFT')} · Token #${htmlSafe(r.tokenId)}</small><div><span class="inspect-signal ${r.eligible?'':'watch'}">${qualified}</span></div></div></div>
  <div class="inspect-metrics">
   ${metric('Seller asking price (excl. fees)',inspectPrice(r.price))}
   ${metric('30D completed-sale median',ref)}
   ${metric('Conservative resale ceiling',resale)}
   ${metric('Discount vs resale ceiling',inspectPct(r.conservativeDiscountPct),r.conservativeDiscountPct>=0?'good':'bad')}
   ${metric('Estimated net profit (after extra costs)',r.estimatedProfitAud===null?'—':audLimit(r.estimatedProfitAud),r.estimatedProfitAud>=0?'good':'bad')}
   ${metric('Opportunity score',r.opportunityScore===null?'—':r.opportunityScore+'/100')}
   ${metric('Liquidity / confidence',String(r.liquidity||'low').toUpperCase()+' / '+String(r.confidence||'low').toUpperCase())}
   ${metric('Bot decision',r.autoDecision||'PASS')}
  </div>
  <div class="inspect-rows">
   ${inspectPair('Quantity',String(r.quantity))}
   ${inspectPair('Listed at (your local time)',listingDate(r.listedAt))}
   ${inspectPair('Order starts at',listingDate(r.startsAt))}
   ${inspectPair('Order expires at',listingDate(r.expiresAt))}
   ${inspectPair('Time until expiry',listingExpiry(r.expiresAt))}
   ${inspectPair('Original Immutable asking price',inspectWeth(r.price))}
   ${inspectPair('Ask incl. recorded buyer fees',inspectWeth(r.totalWithFeesEth))}
   ${inspectPair('ETH/AUD rate used',rate?.available?'A$'+Number(rate.spot).toFixed(2)+' per ETH · '+listingDate(rate.fetchedAt):'Unavailable or stale')}
   ${inspectPair('Immutable order recheck',latestOrder)}
   ${liveCheck?.status==='confirmed'?`${inspectPair('Rechecked Immutable asking price',inspectWeth(liveCheck.priceEth))}${inspectPair('Rechecked fee-inclusive total',inspectWeth(liveCheck.totalCostEth))}`:''}
   ${inspectPair('Lowest ask among scanned copies',r.floor===null||r.floor===undefined?'Unavailable':inspectWeth(r.floor))}
   ${inspectPair('Independent Immutable stack floor',stackedFloor)}
   ${stackFloor?.status==='available'?`${inspectPair('Stack floor fee-inclusive cost',inspectWeth(stackFloor.totalCostEth))}`:''}
   ${inspectPair('Buyer fees shown by Immutable',inspectPrice(r.feeEstimateEth))}
   ${inspectPair('Total purchase cost incl. buyer fees',inspectPrice(r.totalWithFeesEth))}
   ${inspectPair('Dollar minimum satisfied',r.fiatMinPassed?'Yes':'No — listing excluded')}
   ${inspectPair('Profit requirement satisfied',r.minProfitPassed?'Yes':'No — below configured A$ minimum')}
   ${inspectPair('Assumed resale fee',inspectPct(estimate.resaleFeePct))}
    ${inspectPair('30D historical sale median',ref)}
    ${inspectPair('7D verified sales median',r.recentSevenDayMedianEth===null?'Insufficient verified recent sales':inspectPrice(r.recentSevenDayMedianEth))}
    ${inspectPair('Next competing ACTIVE asking price',r.currentCompetitorAskEth===null?'None found in scan':inspectPrice(r.currentCompetitorAskEth))}
    ${inspectPair('Conservative resale ceiling',resale)}
    ${inspectPair('Why this resale ceiling',r.resaleEstimateBasis||'Unknown')}
    ${inspectPair('Assumed undercut on next ask',Number(r.resaleUndercutPct??2).toFixed(1)+'%')}
    ${inspectPair('Break-even resale price (AUD)',breakEvenAud===null?'Unknown':audLimit(breakEvenAud))}
    ${inspectPair('Separate comparable live ask required',r.marketEvidencePassed?'Verified in scan':'No — watch only')}
    ${inspectPair('Reserved extra costs (AUD)',audLimit(r.estimatedExtraCostsAud??0))}
    ${inspectPair('Optional minimum score satisfied',r.scorePassed?'Yes':'No — below your score minimum')}
    ${inspectPair('Cheapest observed comparable offer',r.bestOfferPassed?'Yes':'No — cheaper live offer seen')}
    ${inspectPair('Verified comparable sales in 7D',String(r.verifiedSales7d??0))}
    ${inspectPair('Observed competing active offers',String(Math.max(0,(r.observedActiveOffers??1)-1)))}
    ${inspectPair('Observed cheaper competing offers',String(r.observedCheaperOffers??0))}
    ${inspectPair('7D median vs 30D median',r.trendPct===null?'Insufficient recent sales':inspectPct(r.trendPct))}
    ${inspectPair('Highest matched exact-token Immutable bid',r.highestDirectBidEth===null?'No direct token bid observed':inspectPrice(r.highestDirectBidEth))}
    ${inspectPair('Indicative direct-bid exit P&L (AUD)',r.bidExitProfitAud===null?'Unavailable':audLimit(r.bidExitProfitAud))}
    ${inspectPair('Bot decision reason',r.autoDecisionReason||'Not available')}
    ${inspectPair('Direct bid exit limitations','Bid can expire or lose funds; selling automatically is not implemented')}
   ${inspectPair('Est. resale proceeds after fee',inspectPrice(estimate.expectedProceedsEth))}
   ${inspectPair('Est. return on purchase cost',inspectPct(estimate.estimatedRoiPct))}
   ${inspectPair('Completed comparable sales in 30D',String(h.count30d))}
   ${inspectPair('Completed comparable sales in 90D',String(h.count90d))}
   ${inspectPair('Last completed scan',inspectDate(info.lastScan))}
   ${inspectPair('Listing price filter',r.eligible?'Qualified':'Review strategy limits')}
  </div>
  <h3 class="inspect-section-title">Opportunity scoring and risks</h3>
   <p class="inspect-meta">Heuristic ranking only. Profit uses the lowest of the 30-day sale median, 7-day median (with at least 3 sales), and 2% below the nearest other live asking price. Seller asks are not guaranteed buyer bids. It is not a resale probability.</p>
   <div class="inspect-warning">${(r.scoreCautions&&r.scoreCautions.length?r.scoreCautions:['No additional score warnings identified in the scanned data.']).map(htmlSafe).join(' · ')} Unobserved listings and bids may affect liquidity.</div>
   <h3 class="inspect-section-title">Comparable completed sales — last 90 days</h3>
  <p class="inspect-meta">${h.count30d} within 30 days; ${h.count90d} within 90 days. These are other orders with matching verified collectible identity, not necessarily sales of this token ID.</p>
  <div class="inspect-evidence">${h.sales.length?`<table><thead><tr><th>Immutable order updated</th><th>Sold unit price</th><th>Token ID</th><th>Order ID</th></tr></thead><tbody>${historyRows}</tbody></table>`:'<div class="inspect-status">No verified matching FILLED records in the last 90 days.</div>'}</div>
  ${h.limited?`<p class="inspect-meta">Showing the newest ${h.returned} of ${h.count90d} verified matches.</p>`:''}
  <div class="inspect-actions">
   ${safeMarketplace?`<a class="button accent-btn" href="${htmlSafe(safeMarketplace)}" target="_blank" rel="noopener noreferrer">Search on TokenTrove ↗</a>`:''}
   <button class="button ghost inspect-copy" type="button" data-copy="${htmlSafe(r.tokenId)}">Copy token ID</button>
   <button class="button ghost inspect-copy" type="button" data-copy="${htmlSafe(r.id)}">Copy order ID</button>
  </div>
  <div class="inspect-warning">${info.coveragePartial?'The Immutable scan has partial active-listing coverage, so a cheaper marketplace offer may be missing from this feed. ':''}${stackFloor?.status==='available'&&stackFloor.priceEth<r.price-1e-9?'Immutable\'s separately indexed stack floor shows a cheaper WETH-priced offer than the selected cached listing. Compare both order IDs before any purchase. ':''}TokenTrove's AUD conversion and marketplace order may differ from this app. Compare the underlying ETH/WETH price and exact order rather than AUD alone. No TokenTrove live price was retrieved automatically. AUD estimates use the current ETH/AUD rate, not the exchange rate on historical sale dates. Immutable settlement is in WETH. Estimates assume resale at the conservative ceiling, which may be lower than the historical median. They subtract the configured ${htmlSafe(inspectPct(estimate.resaleFeePct))} resale fee and the listing's observed buyer fees. They exclude unbudgeted gas, slippage, future price changes, additional marketplace charges, and time-to-sell. Any configured extra cost reserve is deducted from the AUD profit display, but is not a live gas quote. A buyer is not guaranteed. Immutable FILLED order update timestamps may differ from actual settlement times. Data and live order availability can change after the last scan. Always confirm the offer on TokenTrove.</div>
  <div class="inspect-meta">Orderbook source: Immutable zkEVM · Cached scan ${htmlSafe(listingDate(info.lastScan))} · Rechecked ${htmlSafe(listingDate(liveCheck?.checkedAt))}<br>Collection contract: ${htmlSafe(r.contract)}<br>Immutable order ID: ${htmlSafe(r.id)}<br>The TokenTrove link opens a collection search, not a verified deep link to this exact order.</div>`;
 $('inspectContent').querySelectorAll('.inspect-copy').forEach(btn=>btn.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(btn.dataset.copy);toast('Copied to clipboard');}
  catch{toast('Could not copy automatically. Select the ID shown in the inspection details.',true);}
 }));
}
async function openInspect(orderId){
 if(!orderId)return;
 inspectReturnFocus=document.activeElement;
 inspectedOrderId=orderId;
 $('inspectOverlay').hidden=false;document.body.classList.add('inspect-open');
 $('inspectStatus').textContent='Loading actual listing and recorded sales…';
 $('inspectContent').replaceChildren();$('inspectTitle').textContent='Inspect collectible';
 $('inspectClose').focus();
 try{
  const result=await api('/api/listing-details?id='+encodeURIComponent(orderId));
  if(inspectedOrderId===orderId)renderInspection(result);
 }catch(error){if(inspectedOrderId===orderId){$('inspectStatus').textContent='Unable to inspect this order: '+error.message;$('inspectContent').replaceChildren();}}
}
function closeInspect(){
 inspectedOrderId=null;$('inspectOverlay').hidden=true;document.body.classList.remove('inspect-open');
 if(inspectReturnFocus?.isConnected)inspectReturnFocus.focus();else $('inspectSelectedBtn').focus();
}
$('inspectSelectedBtn').addEventListener('click',()=>{const row=selectedRow();if(row)void openInspect(row.id);});
$('inspectClose').addEventListener('click',closeInspect);
$('inspectOverlay').addEventListener('click',event=>{if(event.target===$('inspectOverlay'))closeInspect();});
document.addEventListener('keydown',event=>{
 if($('inspectOverlay').hidden)return;
 if(event.key==='Escape'){event.preventDefault();closeInspect();return;}
 if(event.key==='Tab'){
  const controls=[...$('inspectDialog').querySelectorAll('button:not(:disabled),a[href]')];
  if(!controls.length){event.preventDefault();return;}
  if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1).focus();}
  else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}
 }
});
function makeSvg(tag,attrs={},txt){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));if(txt!==undefined)el.textContent=String(txt);return el;}
function drawChart(items,daysRange){const svg=$('priceChart');svg.innerHTML='';
 if(!audSpot()){$('chartHint').textContent='AUD chart unavailable until a fresh ETH/AUD quote is received.';return;}
 const now=Date.now(),filtered=items.filter(i=>new Date(i.date+'T23:59:59Z').getTime()>=now-daysRange*86400000).slice(-95);
 if(!filtered.length){svg.append(makeSvg('text',{x:260,y:118,fill:'#70899d','font-size':13,'text-anchor':'middle'},'No completed-sale candles in this period'));$('chartHint').textContent='Candles require completed orders. Empty days are not interpolated.';return;}
 const vMin=Math.min(...filtered.map(x=>x.low)),vMax=Math.max(...filtered.map(x=>x.high)),pad=Math.max((vMax-vMin)*.15,vMin*.02,.0000001);
 const lo=Math.max(0,vMin-pad),hi=vMax+pad,plot={x:18,y:12,w:410,h:181};
 const y=v=>plot.y+plot.h-(v-lo)/(hi-lo)*plot.h;
 for(let i=0;i<=4;i++){const val=lo+(hi-lo)*(4-i)/4,yy=plot.y+(plot.h*i/4);
 svg.append(makeSvg('line',{x1:plot.x,y1:yy,x2:plot.x+plot.w,y2:yy,stroke:'#2b3c4c','stroke-width':1,'stroke-dasharray':'3 5'}));
 svg.append(makeSvg('text',{x:437,y:yy+4,fill:'#7890a6','font-size':11},audCash(val)));}
 const step=plot.w/filtered.length,w=Math.max(3,Math.min(13,step*.57));
 filtered.forEach((d,i)=>{const xx=plot.x+(i+.5)*step,up=d.close>=d.open,color=up?'#55e0bc':'#ef818a';
 const wick=makeSvg('line',{x1:xx,y1:y(d.high),x2:xx,y2:y(d.low),stroke:color,'stroke-width':1.4});
 const box=makeSvg('rect',{x:xx-w/2,y:Math.min(y(d.open),y(d.close)),width:w,height:Math.max(1.5,Math.abs(y(d.open)-y(d.close))),fill:color,rx:1});
 box.append(makeSvg('title',{},`${d.date} | O ${audCash(d.open)} · H ${audCash(d.high)} · L ${audCash(d.low)} · C ${audCash(d.close)} | ${d.volume} sale(s)`));
 svg.append(wick,box);});
 svg.append(makeSvg('text',{x:plot.x,y:218,fill:'#8295a9','font-size':10},filtered[0].date.slice(5)));
 svg.append(makeSvg('text',{x:plot.x+plot.w,y:218,fill:'#8295a9','font-size':10,'text-anchor':'end'},filtered.at(-1).date.slice(5)));
 $('chartHint').textContent=`${filtered.length} trading day(s) · Open / High / Low / Close from completed transactions · AUD base sale prices (excludes buyer fees), current BUY TOTAL includes fees`;
}
async function loadChart(force=false){const r=selectedRow();if(!r){drawChart([],days);return;}
 if(!force&&selectedKey===r.key&&Date.now()-lastChartRequest<20000){if(currentChart)drawChart(currentChart,days);return;}
 selectedKey=r.key;lastChartRequest=Date.now();try{const result=await api('/api/candles?key='+encodeURIComponent(r.key));if(selectedKey!==result.key)return;currentChart=result.candles;drawChart(currentChart,days);}catch(e){$('chartHint').textContent=e.message;}}
function renderTrades(){if(!data)return;
 $('liveSpent').textContent=audLimit(data.liveSpentTodayAud);
 $('liveCount').textContent=data.liveTrades.filter(t=>t.status==='completed').length;
 const all=[...data.liveTrades].sort((a,b)=>b.timestamp-a.timestamp).slice(0,100);
 $('tradeLog').innerHTML=all.length?all.map(t=>`<div class="log-line"><div><div class="log-main">${htmlSafe(t.name)} <small style="color:#869ab0">· LIVE</small></div><div class="log-sub">${new Date(t.timestamp).toLocaleString()} · ${t.costAud!==null&&t.costAud!==undefined?audLimit(t.costAud):audCash(t.costEth)} ${t.error?'· '+htmlSafe(t.error):''} ${t.hash?'· '+htmlSafe(t.hash):''}</div></div><b class="log-status ${t.status==='failed'?'error':''}">${htmlSafe(t.status.toUpperCase())}</b></div>`).join(''):'<div class="empty">No trades recorded yet.</div>';
 $('eventLog').innerHTML=data.events.length?data.events.slice(0,30).map(e=>`<div class="log-line"><div><div class="log-main">${htmlSafe(e.message)}</div><div class="log-sub">${new Date(e.time).toLocaleString()}</div></div><b class="log-status ${e.kind==='error'?'error':''}">${htmlSafe(e.kind.toUpperCase())}</b></div>`).join(''):'<div class="empty">No events recorded.</div>';
}
const audFields=['maximumPriceAud','dailyBudgetAud','minPriceAud'];
const fields=['minDiscountPct','minSales30d','minNetEdgePct','estimatedResaleFeesPct','minEstimatedProfitAud','minOpportunityScore','estimatedExtraCostsAud','minimumFiatPrice','maxPurchasesPerDay','refreshSeconds','pagesPerCollection','deepScanPages','deepScanIntervalMinutes'];
function renderOpenSeaConnection(){
 if(!data)return;
 const c=data.openSeaConnection??{};
 const status=!data.openSeaKeyConfigured?'needs-key':
  (c.loading&&(!c.checkedAt||c.status==='unchecked')?'checking':c.status??'unchecked');
 const labels={
  connected:'● CONNECTED',invalid:'● INVALID / EXPIRED',forbidden:'● ACCESS DENIED',
  'rate-limited':'● RATE LIMITED',error:'● CONNECTION FAILED',
  'needs-key':'● NO KEY SAVED',checking:'● CHECKING',unchecked:'● NOT VERIFIED'
 };
 const badge=$('openSeaKeyStatus');
 badge.textContent=labels[status]??labels.error;
 badge.dataset.status=status;
 const lastCheck=c.checkedAt?'Last checked '+new Date(c.checkedAt).toLocaleString()+' · ':'';
 $('openSeaConnectionDetails').textContent=!data.openSeaKeyConfigured
  ?'Save an OpenSea API key first, then use Test OpenSea connection.'
  :lastCheck+(c.message||'The saved key has not been verified yet. Click Test OpenSea connection.').trim()+
   (c.loading?' Checking OpenSea now…':'')+' Tests use the saved key, not unsaved text in the field.';
 const button=$('testOpenSeaBtn');
 button.disabled=!data.openSeaKeyConfigured||Boolean(c.loading)||openSeaTestBusy;
 button.textContent=openSeaTestBusy?'Testing…':'↻ Test OpenSea connection';
}
function fillSettings(){const s=data.settings;
 fields.forEach(k=>$(k).value=s[k]);
 $('deepScanEnabled').checked=s.deepScanEnabled===true;
 $('openSeaApiKey').value='';
 $('openSeaApiKey').placeholder=data.openSeaKeyConfigured?'Saved — paste to replace':'Paste OpenSea API key to enable';
 $('openSeaKeyHelp').textContent=data.openSeaKeyConfigured
  ?'An OpenSea API key is saved locally. It is not returned in the dashboard status. Select Remove saved key to disable this feed.'
  :'An OpenSea API key is needed for the verified Ethereum Habbo Avatar feed. Free read-only keys are available from OpenSea.';
 audFields.forEach(k=>{const val=data.audLimits?.[k];$(k).value=editableAud(val);$(k).placeholder=val===null||val===undefined?'Waiting for AUD quote':'AUD amount';});
 $('publishableKey').value=s.publishableKey||'';
 $('collectionOptions').innerHTML=s.collections.map(c=>`<label class="collection-label"><input data-contract="${htmlSafe(c.address)}" type="checkbox" ${c.enabled?'checked':''}><span>${htmlSafe(c.name)}</span></label>`).join('');}
function renderReadiness(){if(!data)return;renderOpenSeaConnection();
 const deep=data.deepScan??{};
 $('deepScanStatus').textContent='Last scan: '+(deep.lastMode||'regular')+
  ' ('+(deep.scanPages||data.settings.pagesPerCollection)+' pages/collection)'+
  (deep.lastAt?' · Last deep: '+new Date(deep.lastAt).toLocaleString():' · No deep scan completed')+
  (deep.enabled&&deep.nextAt?' · Next deep: '+new Date(deep.nextAt).toLocaleString():'');
 $('runDeepScanBtn').disabled=Boolean(data.scanning)||Boolean(data.armed);
 const checks=[['Live market connected',(data.stats?.successfulRequests??0)>0],['Dedicated wallet configured',data.hasDedicatedWallet],['Environment live-buy safeguard',data.liveEnvironmentEnabled],['Market data scanned',!!data.lastScan],['Completed sales fetched',data.stats.sales>0]];
 $('readiness').innerHTML=checks.map(([label,yes])=>`<p class="${yes?'yes':'no'}">${yes?'✓':'✕'} ${label}</p>`).join('');
 $('armBtn').disabled=data.armed;$('armBtn').textContent=data.armed?'LIVE BUYING ARMED':'Arm live autobuyer';$('armNotice').textContent=data.armed?'REAL MONEY BUYING IS ACTIVE. Use Disarm immediately to stop future orders.':'Live buying never arms on startup. Failed or uncertain trades are not retried automatically.';}
function collectSettings(){const old=data.settings;return {...old,mode:'live',
  ...Object.fromEntries(fields.map(k=>[k,Number($(k).value)])),
  ...Object.fromEntries(audFields.map(k=>[k,$(k).value.trim()===''?NaN:Number($(k).value)])),
  fiatCurrency:'AUD',publishableKey:$('publishableKey').value,deepScanEnabled:$('deepScanEnabled').checked,
 openSeaApiKey:$('openSeaApiKey').value.trim(),clearOpenSeaKey:$('clearOpenSeaKey').checked,
  collections:old.collections.map(c=>({...c,enabled:document.querySelector(`[data-contract="${c.address}"]`)?.checked??false}))};}
async function sync(){try{const incoming=await api('/api/state');
 if(data?.appVersion&&incoming.appVersion!==data.appVersion){window.location.reload();return;}
 // The full order set is transferred only when a new scan completes.
 if(cachedScanAt!==incoming.lastScan){
  const full=await api('/api/listings');
  if(full.lastScan===incoming.lastScan){cachedRows=full.rows;cachedScanAt=full.lastScan;}
 }
 if(!cachedOpenSeaFeed||cachedOpenSeaFeed.checkedAt!==incoming.openSea?.checkedAt){
  try{cachedOpenSeaFeed=await api('/api/opensea/listings');}
  catch{cachedOpenSeaFeed={status:'error',rows:[],pages:0,checkedAt:incoming.openSea?.checkedAt??0,error:'OpenSea status temporarily unavailable'};}
 }
 data=incoming;data.rows=cachedRows;data.openSeaFeed=cachedOpenSeaFeed;
 if($('appVersion'))$('appVersion').textContent='v'+data.appVersion;
 if($('updaterVersion'))$('updaterVersion').textContent='v'+data.appVersion;
 if($('autoInstallUpdates')&&!window.marketRadarDesktop)$('autoInstallUpdates').checked=data.updatePrefs?.autoInstall??true;
 if(!window.marketRadarDesktop&&data.updateStatus?.message&&!updateBusy&&!availableUpdate)$('updateDetails').textContent=data.updateStatus.message;
 if(!selectedId||!data.rows.some(r=>r.id===selectedId))selectedId=data.rows[0]?.id||null;
 renderMarket();if(currentTab==='trades')renderTrades();if(currentTab==='settings')renderReadiness();
 if(!settingsLoaded||(!audControlsReady&&data.audLimits?.available)){
   fillSettings();settingsLoaded=true;audControlsReady=Boolean(data.audLimits?.available);
  }
 if(currentTab==='market')void loadChart();
 }catch(e){$('connectionPill').textContent='RECONNECTING AFTER UPDATE…';if(!data)toast('Cannot contact the local server: '+e.message,true);}}
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>view(b.dataset.tab)));
$('bannerGo').addEventListener('click',()=>{view('market');$('scanDiagnostics').scrollIntoView({behavior:'smooth',block:'center'});});
$('engineButton').addEventListener('click',()=>view('settings'));
$('refreshBtn').addEventListener('click',async()=>{try{await api('/api/refresh',{});toast('Market refresh started');}catch(e){toast(e.message,true);}});
for(const [id,ev] of [['searchInput','input'],['collectionFilter','change'],['signalFilter','change'],['cheapestOnly','change'],['profitOnly','change']])$(id).addEventListener(ev,()=>{pageIndex=0;const before=selectedId;filterRows();renderDetail();if(before!==selectedId)void loadChart(true);});
 $('pagePrev').addEventListener('click',()=>{if(pageIndex>0){pageIndex--;filterRows();}});
 $('pageNext').addEventListener('click',()=>{pageIndex++;filterRows();});
$('exportBtn').addEventListener('click',()=>{window.location.href='/api/export.csv';});
document.querySelectorAll('.period').forEach(b=>b.addEventListener('click',()=>{days=Number(b.dataset.period);document.querySelectorAll('.period').forEach(x=>x.classList.toggle('active',x===b));if(currentChart)drawChart(currentChart,days);else void loadChart(true);}));
$('runDeepScanBtn').addEventListener('click',async()=>{
 if(data?.armed){toast('Disarm live buying before a manual deep scan.',true);return;}
 try{await api('/api/scan/deep',{});toast('One-time deep scan started. The next refreshed scan will show deeper coverage.');await sync();}
 catch(err){toast('Could not start deep scan: '+err.message,true);}
});
$('settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/settings',collectSettings());$('settingsNotice').textContent='Saved';$('openSeaApiKey').value='';$('clearOpenSeaKey').checked=false;toast('Strategy saved. Market rescan started.');await sync();fillSettings();}catch(err){$('settingsNotice').textContent='';toast(err.message,true);}});
$('testOpenSeaBtn').addEventListener('click',async()=>{
 if(openSeaTestBusy)return;
 openSeaTestBusy=true;
 $('openSeaKeyStatus').textContent='● CHECKING';
 $('openSeaKeyStatus').dataset.status='checking';
 $('openSeaConnectionDetails').textContent='Testing the saved API key against the live OpenSea endpoint…';
 $('testOpenSeaBtn').disabled=true;
 $('testOpenSeaBtn').textContent='Testing…';
 try{await api('/api/opensea/test',{});await sync();}
 catch(err){$('openSeaConnectionDetails').textContent='Connection test could not complete: '+err.message;toast(err.message,true);}
 finally{openSeaTestBusy=false;renderOpenSeaConnection();}
});
 $('armBtn').addEventListener('click',async()=>{try{await api('/api/arm',{phrase:$('armPhrase').value});$('armPhrase').value='';toast('Real-money buying armed');await sync();}catch(e){toast(e.message,true);}});
$('disarmBtn').addEventListener('click',async()=>{try{await api('/api/disarm',{});toast('Live buying is disarmed');await sync();}catch(e){toast(e.message,true);}});

async function checkForUpdate(){
 if(window.marketRadarDesktop){
  $('updateDetails').textContent='Checking GitHub for a native Windows update...';
  try {await window.marketRadarDesktop.checkForUpdates();}catch(err){$('updateDetails').textContent='Desktop update error: '+err.message;}
  return;
 }
 if(updateBusy)return;updateBusy=true;availableUpdate=null;
 $('checkUpdateBtn').disabled=true;$('installUpdateBtn').hidden=true;
 $('updateDetails').textContent='Checking GitHub releases...';
 try{
  const info=await api('/api/update/check');
  if(info.available){
   availableUpdate=info;
   $('updateDetails').textContent=`Update available: v${info.installed} → v${info.latest}. Published ${info.publishedAt?new Date(info.publishedAt).toLocaleDateString():'recently'}.`;
   $('installUpdateBtn').hidden=false;
  }else $('updateDetails').textContent=`You're up to date (v${info.installed}).`;
 }catch(err){$('updateDetails').textContent=err.message;toast('Update check failed: '+err.message,true);}
 finally{updateBusy=false;$('checkUpdateBtn').disabled=false;}
}
$('checkUpdateBtn').addEventListener('click',checkForUpdate);
$('autoInstallUpdates').addEventListener('change',async()=>{
 const enabled=$('autoInstallUpdates').checked;
 try{
  if(window.marketRadarDesktop){
   await window.marketRadarDesktop.setAutoUpdates(enabled);
   toast(enabled?'Desktop auto-updates enabled.':'Desktop auto-updates disabled.');return;
  }
  const result=await api('/api/update/preferences',{autoInstall:enabled});
  $('updateDetails').textContent=result.updateStatus?.message||'Preference saved.';
  toast(enabled?'Automatic updates enabled. No ZIP downloads needed.':'Automatic updates disabled.');
 }catch(err){$('autoInstallUpdates').checked=!enabled;toast(err.message,true);}
});
$('installUpdateBtn').addEventListener('click',async()=>{
 if(!availableUpdate||updateBusy)return;
 if(data?.armed){toast('Disarm real-money autobuying first.',true);return;}
 if(!confirm(`Install v${availableUpdate.latest} from GitHub and restart Market Radar? Local settings and trades will be preserved. The app will close during installation.`))return;
 updateBusy=true;$('installUpdateBtn').disabled=true;$('checkUpdateBtn').disabled=true;
 $('updateDetails').textContent='Update queued. Waiting for any active NFT scan to finish, then verifying and installing. Please keep Market Radar running; do not click again.';
 try{
  const response=await api('/api/update/install',{confirm:'INSTALL VERIFIED UPDATE'});
  $('updateDetails').textContent=response.message+' The dashboard will reconnect after restart.';
  toast('Installing verified update and restarting.');
  // Full page reload ensures fresh JS/CSS after the new server comes online.
  const poll=async()=>{
    try{const r=await fetch('/api/state',{cache:'no-store'});if(r.ok){const s=await r.json();if(s.appVersion===availableUpdate.latest){location.reload();return;}}}catch{}
    setTimeout(poll,2500);
  };
  setTimeout(poll,4000);
 }catch(err){$('updateDetails').textContent='Update failed: '+err.message;toast(err.message,true);}
 finally{updateBusy=false;$('installUpdateBtn').disabled=false;$('checkUpdateBtn').disabled=false;}
});

if(window.marketRadarDesktop){
 $('installUpdateBtn').hidden=true;
 $('nativeFallbackBtn').addEventListener('click',async()=>{
  try{await window.marketRadarDesktop.openLatestInstaller();}
  catch(err){toast('Could not open the official installer: '+err.message,true);}
 });
 window.marketRadarDesktop.onUpdateStatus(info=>{
  $('updateDetails').textContent=info.message||'Desktop auto-updater ready.';
  $('nativeFallbackBtn').hidden=info.phase!=='manual-update';
  if(info.phase==='downloading'||info.phase==='installing'||info.phase==='waiting')$('checkUpdateBtn').disabled=true;
  else $('checkUpdateBtn').disabled=false;
 });
 try{
  const preferences=await window.marketRadarDesktop.getAutoUpdates();
  $('autoInstallUpdates').checked=preferences.enabled;
  if(preferences.status?.message)$('updateDetails').textContent=preferences.status.message;
 }catch(err){$('updateDetails').textContent='Desktop update preferences unavailable: '+err.message;}
}
await sync();setInterval(sync,4000);
