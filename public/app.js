const $=id=>document.getElementById(id);
const htmlSafe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,places=6)=>Number.isFinite(Number(n))?Number(n).toFixed(places):'—';
const percent=n=>Number.isFinite(Number(n))?Number(n).toFixed(1)+'%':'—';
const relative=ms=>!ms?'Not scanned yet':(Date.now()-ms<10000?'Just now':`${Math.max(1,Math.floor((Date.now()-ms)/60000))}m ago`);
const money=n=>n===null||n===undefined?'—':Number(n).toFixed(6);
let data=null,selectedId=null,selectedKey=null,currentTab='market',days=30,currentChart=null,settingsLoaded=false,lastChartRequest=0;
let toastTimer;
let availableUpdate=null, updateBusy=false;
function toast(message,error=false){const e=$('toast');e.textContent=message;e.className='toast'+(error?' error':'');e.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.hidden=true,4500);}
async function api(url,body=null){const r=await fetch(url,body===null?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const out=await r.json();if(!r.ok)throw new Error(out.error??`HTTP ${r.status}`);return out;}
function view(tab){currentTab=tab;for(const t of ['market','trades','settings'])$(t+'Tab').hidden=t!==tab;
 document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='trades')renderTrades();if(tab==='settings')renderReadiness();}
function selectedRow(){return data?.rows?.find(r=>r.id===selectedId)??data?.rows?.[0]??null;}
function renderBanner(){
 const hasListings=Number(data?.rows?.length)>0;
 const connected=Number(data.stats?.successfulRequests)>0;
 $('modeBadge').textContent=hasListings?'● LIVE NFT LISTINGS':connected?'● LIVE CONNECTED · NO LISTINGS':'● LIVE NOT CONNECTED';
 $('updatedText').textContent=relative(data.lastScan);
 const b=$('banner');b.className='banner '+(connected?'live-banner':'error-banner');
 let title=hasListings?'Live Habbo NFT listings received':connected?'No matching NFT listings found':'Waiting for Immutable marketplace';
 let copy=hasListings?'Showing real orderbook listings. Real-money buying remains OFF until separately armed.':connected?'Marketplace reached, but no supported Habbo NFT offers have been found. See scan diagnostics.':'No real orders received. Check the API diagnostics and network connection.';
 if(data.warnings?.length){b.className='banner error-banner';title=data.stats.failedRequests?'Immutable API connection problems':'Live market scan warnings';copy=data.warnings[0];}
 $('bannerGo').textContent='View scan details →';
 b.querySelector('b').textContent=title;b.querySelector('span:not(.banner-icon)').textContent=copy;
 $('connectionPill').innerHTML='<span class="pulse-dot"></span> '+(data.scanning?'SCANNING':hasListings?'LIVE LISTINGS':connected?'CONNECTED · EMPTY':'LIVE OFFLINE');
}
function renderStats(){const rows=data.rows||[];$('statListings').textContent=rows.length;$('statOpportunities').textContent=rows.filter(x=>x.eligible).length;
 $('statSales').textContent=data.stats?.sales??0;$('statSpend').textContent=fmt(data.liveSpentToday,4);
 $('riskLimit').textContent=fmt(data.settings.maximumPriceEth,4)+' WETH';$('riskDiscount').textContent=data.settings.minDiscountPct+'%';
 const canBuy=data.armed;$('autobuyIndicator').textContent=canBuy?'● LIVE ARMED':'● DISARMED';
 $('autobuyIndicator').style.color=canBuy?'#f87982':'#55e0bc';
 $('engineText').textContent=canBuy?'REAL MONEY purchasing is active. One eligible NFT at most per scan; it disarms on error or restart.':'Live market scanner is running. Real buying is OFF until separately enabled with a dedicated wallet and confirmation phrase.';
 $('coverageText').textContent=`${data.stats.rawOrders??0} real raw orders · ${data.stats.pages} pages · ${data.stats.failedRequests??0} failed requests · ${data.stats.truncated?'PARTIAL coverage':'page scan complete'} · ${data.warnings.length} warnings`;
 const cv=data.stats.coverage,cd=data.stats.candidateDiagnostics;
 const coverage=cv?`Verified NFT identity: ${cv.activeResolved}/${cv.activeTotal} active · ${cv.salesResolved}/${cv.salesTotal} sold · ${cv.fetchedThisScan} resolved this scan, ${cv.failedThisScan} failed.`:'Metadata coverage not available yet.';
 const reasons=cd?`Why no candidates (first failing criterion per listing): ${cd.missingMetadata} missing NFT metadata; ${cd.insufficientComparableSales} insufficient comparable sales; ${cd.priceOutsideLimits} outside price limits; ${cd.discountTooSmall} below discount threshold; ${cd.netEdgeTooSmall} below net-edge threshold; ${cd.multiQuantity} multi-quantity; ${cd.eligible} eligible.`:'Candidate breakdown not available yet.';
 $('scanDiagnostics').textContent=([`Immutable requests: ${data.stats.successfulRequests??0} successful / ${data.stats.failedRequests??0} failed. ${data.stats.rawOrders??0} raw orders received.`,coverage,reasons,...data.warnings,`Rejected orders: ${JSON.stringify(data.stats.rejected||{})}`, ...((data.stats.diagnostics||[]).map(d=>`${d.collection} ${d.status}: ${d.error||`${d.accepted}/${d.raw} accepted (${d.pages} pages)${d.shape?' shape='+JSON.stringify(d.shape):''}`}`))].join('\n')); 
}
function filterRows(){const text=$('searchInput').value.trim().toLowerCase(),collection=$('collectionFilter').value,signal=$('signalFilter').value;
 const found=(data?.rows??[]).filter(x=>(!text||(`${x.name} ${x.tokenId} ${x.collection}`).toLowerCase().includes(text))&&(!collection||x.collection===collection)&&(signal!=='eligible'||x.eligible));
 $('scannerCount').textContent=data?.rows?.filter(x=>x.eligible).length??0;$('resultCount').textContent=found.length+' results';
 const limited=found.slice(0,250),body=$('marketRows');
 body.innerHTML=limited.map(r=>`<tr class="${r.id===selectedId?'selected':''}" data-order="${htmlSafe(r.id)}"><td><div class="nft-name">${htmlSafe(r.name)}</div><div class="nft-sub">${htmlSafe(r.collection)} · token ${htmlSafe(r.tokenId)}</div></td><td class="price">${fmt(r.price,6)}</td><td>${money(r.reference)}</td><td class="${r.discount>=0?'positive':'neutral'}">${r.discount==null?'—':(r.discount>0?'-':'')+percent(Math.abs(r.discount))}</td><td>${r.sales30d}</td><td><span class="signal ${r.eligible?'buy':''}">${r.eligible?'● CANDIDATE':r.reference?'WATCH':'NO HISTORY'}</span></td></tr>`).join('');
 body.querySelectorAll('tr').forEach(tr=>tr.addEventListener('click',()=>{selectedId=tr.dataset.order;renderMarket();void loadChart(true);}));
 $('emptyRows').hidden=limited.length>0;
}
function renderMarket(){if(!data)return;renderBanner();renderStats();filterRows();renderDetail();}
function renderDetail(){const r=selectedRow();
 if(!r){$('chartTitle').textContent='Select an NFT';$('detailPrice').textContent='—';$('detailDiscount').textContent='—';$('detailSales').textContent='—';$('detailMedian').textContent='—';$('detailEdge').textContent='—';return;}
 $('chartTitle').textContent=r.name;$('detailPrice').textContent=fmt(r.price,6);$('detailDiscount').textContent=r.discount===null?'Unpriced':(r.discount>0?'↓ ':'↑ ')+percent(Math.abs(r.discount));
 $('detailDiscount').style.color=r.discount>0?'#55e0bc':'#8497a9';$('detailSales').textContent=r.sales30d;
 $('detailMedian').textContent=money(r.reference);$('detailEdge').textContent=percent(r.netEdge);
}
function makeSvg(tag,attrs={},txt){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));if(txt!==undefined)el.textContent=String(txt);return el;}
function drawChart(items,daysRange){const svg=$('priceChart');svg.innerHTML='';
 const now=Date.now(),filtered=items.filter(i=>new Date(i.date+'T23:59:59Z').getTime()>=now-daysRange*86400000).slice(-95);
 if(!filtered.length){svg.append(makeSvg('text',{x:260,y:118,fill:'#70899d','font-size':13,'text-anchor':'middle'},'No completed-sale candles in this period'));$('chartHint').textContent='Candles require completed orders. Empty days are not interpolated.';return;}
 const vMin=Math.min(...filtered.map(x=>x.low)),vMax=Math.max(...filtered.map(x=>x.high)),pad=Math.max((vMax-vMin)*.15,vMin*.02,.0000001);
 const lo=Math.max(0,vMin-pad),hi=vMax+pad,plot={x:18,y:12,w:410,h:181};
 const y=v=>plot.y+plot.h-(v-lo)/(hi-lo)*plot.h;
 for(let i=0;i<=4;i++){const val=lo+(hi-lo)*(4-i)/4,yy=plot.y+(plot.h*i/4);
 svg.append(makeSvg('line',{x1:plot.x,y1:yy,x2:plot.x+plot.w,y2:yy,stroke:'#2b3c4c','stroke-width':1,'stroke-dasharray':'3 5'}));
 svg.append(makeSvg('text',{x:437,y:yy+4,fill:'#7890a6','font-size':11},val.toFixed(5)));}
 const step=plot.w/filtered.length,w=Math.max(3,Math.min(13,step*.57));
 filtered.forEach((d,i)=>{const xx=plot.x+(i+.5)*step,up=d.close>=d.open,color=up?'#55e0bc':'#ef818a';
 const wick=makeSvg('line',{x1:xx,y1:y(d.high),x2:xx,y2:y(d.low),stroke:color,'stroke-width':1.4});
 const box=makeSvg('rect',{x:xx-w/2,y:Math.min(y(d.open),y(d.close)),width:w,height:Math.max(1.5,Math.abs(y(d.open)-y(d.close))),fill:color,rx:1});
 box.append(makeSvg('title',{},`${d.date} | O ${fmt(d.open,7)} · H ${fmt(d.high,7)} · L ${fmt(d.low,7)} · C ${fmt(d.close,7)} | ${d.volume} sale(s)`));
 svg.append(wick,box);});
 svg.append(makeSvg('text',{x:plot.x,y:218,fill:'#8295a9','font-size':10},filtered[0].date.slice(5)));
 svg.append(makeSvg('text',{x:plot.x+plot.w,y:218,fill:'#8295a9','font-size':10,'text-anchor':'end'},filtered.at(-1).date.slice(5)));
 $('chartHint').textContent=`${filtered.length} trading day(s) · Open / High / Low / Close from completed transactions · WETH`;
}
async function loadChart(force=false){const r=selectedRow();if(!r){drawChart([],days);return;}
 if(!force&&selectedKey===r.key&&Date.now()-lastChartRequest<20000){if(currentChart)drawChart(currentChart,days);return;}
 selectedKey=r.key;lastChartRequest=Date.now();try{const result=await api('/api/candles?key='+encodeURIComponent(r.key));if(selectedKey!==result.key)return;currentChart=result.candles;drawChart(currentChart,days);}catch(e){$('chartHint').textContent=e.message;}}
function renderTrades(){if(!data)return;
 $('liveSpent').textContent=fmt(data.liveSpentToday,4)+' WETH';
 $('liveCount').textContent=data.liveTrades.filter(t=>t.status==='completed').length;
 const all=[...data.liveTrades].sort((a,b)=>b.timestamp-a.timestamp).slice(0,100);
 $('tradeLog').innerHTML=all.length?all.map(t=>`<div class="log-line"><div><div class="log-main">${htmlSafe(t.name)} <small style="color:#869ab0">· LIVE</small></div><div class="log-sub">${new Date(t.timestamp).toLocaleString()} · ${fmt(t.costEth,6)} WETH ${t.error?'· '+htmlSafe(t.error):''} ${t.hash?'· '+htmlSafe(t.hash):''}</div></div><b class="log-status ${t.status==='failed'?'error':''}">${htmlSafe(t.status.toUpperCase())}</b></div>`).join(''):'<div class="empty">No trades recorded yet.</div>';
 $('eventLog').innerHTML=data.events.length?data.events.slice(0,30).map(e=>`<div class="log-line"><div><div class="log-main">${htmlSafe(e.message)}</div><div class="log-sub">${new Date(e.time).toLocaleString()}</div></div><b class="log-status ${e.kind==='error'?'error':''}">${htmlSafe(e.kind.toUpperCase())}</b></div>`).join(''):'<div class="empty">No events recorded.</div>';
}
const fields=['minDiscountPct','minSales30d','minNetEdgePct','estimatedResaleFeesPct','maximumPriceEth','dailyBudgetEth','minPriceEth','maxPurchasesPerDay','refreshSeconds','pagesPerCollection'];
function fillSettings(){const s=data.settings;
 fields.forEach(k=>$(k).value=s[k]);$('publishableKey').value=s.publishableKey||'';
 $('collectionOptions').innerHTML=s.collections.map(c=>`<label class="collection-label"><input data-contract="${htmlSafe(c.address)}" type="checkbox" ${c.enabled?'checked':''}><span>${htmlSafe(c.name)}</span></label>`).join('');}
function renderReadiness(){if(!data)return;const checks=[['Live market connected',(data.stats?.successfulRequests??0)>0],['Dedicated wallet configured',data.hasDedicatedWallet],['Environment live-buy safeguard',data.liveEnvironmentEnabled],['Market data scanned',!!data.lastScan],['Completed sales fetched',data.stats.sales>0]];
 $('readiness').innerHTML=checks.map(([label,yes])=>`<p class="${yes?'yes':'no'}">${yes?'✓':'✕'} ${label}</p>`).join('');
 $('armBtn').disabled=data.armed;$('armBtn').textContent=data.armed?'LIVE BUYING ARMED':'Arm live autobuyer';$('armNotice').textContent=data.armed?'REAL MONEY BUYING IS ACTIVE. Use Disarm immediately to stop future orders.':'Live buying never arms on startup. Failed or uncertain trades are not retried automatically.';}
function collectSettings(){const old=data.settings;return {...old,mode:'live',
  ...Object.fromEntries(fields.map(k=>[k,Number($(k).value)])),publishableKey:$('publishableKey').value,
  collections:old.collections.map(c=>({...c,enabled:document.querySelector(`[data-contract="${c.address}"]`)?.checked??false}))};}
async function sync(){try{const incoming=await api('/api/state');
 if(data?.appVersion&&incoming.appVersion!==data.appVersion){window.location.reload();return;}
 data=incoming;
 if($('appVersion'))$('appVersion').textContent='v'+data.appVersion;
 if($('updaterVersion'))$('updaterVersion').textContent='v'+data.appVersion;
 if($('autoInstallUpdates'))$('autoInstallUpdates').checked=data.updatePrefs?.autoInstall??true;
 if(data.updateStatus?.message&&!updateBusy&&!availableUpdate)$('updateDetails').textContent=data.updateStatus.message;
 if(!selectedId||!data.rows.some(r=>r.id===selectedId))selectedId=data.rows[0]?.id||null;
 renderMarket();if(currentTab==='trades')renderTrades();if(currentTab==='settings')renderReadiness();
 if(!settingsLoaded){fillSettings();settingsLoaded=true;}
 if(currentTab==='market')void loadChart();
 }catch(e){$('connectionPill').textContent='RECONNECTING AFTER UPDATE…';if(!data)toast('Cannot contact the local server: '+e.message,true);}}
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>view(b.dataset.tab)));
$('bannerGo').addEventListener('click',()=>view('trades'));
$('engineButton').addEventListener('click',()=>view('settings'));
$('refreshBtn').addEventListener('click',async()=>{try{await api('/api/refresh',{});toast('Market refresh started');}catch(e){toast(e.message,true);}});
$('searchInput').addEventListener('input',filterRows);$('collectionFilter').addEventListener('change',filterRows);$('signalFilter').addEventListener('change',filterRows);
$('exportBtn').addEventListener('click',()=>{window.location.href='/api/export.csv';});
document.querySelectorAll('.period').forEach(b=>b.addEventListener('click',()=>{days=Number(b.dataset.period);document.querySelectorAll('.period').forEach(x=>x.classList.toggle('active',x===b));if(currentChart)drawChart(currentChart,days);else void loadChart(true);}));
$('settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/settings',collectSettings());$('settingsNotice').textContent='Saved';toast('Strategy saved. Market rescan started.');await sync();}catch(err){$('settingsNotice').textContent='';toast(err.message,true);}});
$('armBtn').addEventListener('click',async()=>{try{await api('/api/arm',{phrase:$('armPhrase').value});$('armPhrase').value='';toast('Real-money buying armed');await sync();}catch(e){toast(e.message,true);}});
$('disarmBtn').addEventListener('click',async()=>{try{await api('/api/disarm',{});toast('Live buying is disarmed');await sync();}catch(e){toast(e.message,true);}});

async function checkForUpdate(){
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

await sync();setInterval(sync,4000);
