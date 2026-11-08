import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyze,candles,DEFAULT_SETTINGS,validateSettings,hydrateNames,candidateDiagnostics,upgradeLegacyScanCoverage,inspectListing,fiatMinimumStatus,applyFiatMinimum} from './core.mjs';
import {scanMarket} from './market.mjs';
import {fetchFiatRates} from './fiat.mjs';
import {executeLiveBuy,setAllowedContracts} from './trade.mjs';
import {LOCAL_VERSION,GITHUB_REPO,checkForUpdates,prepareUpdate,startWindowsUpdate,canAutoCheck} from './updates.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.HABBO_DESKTOP_APP==='1' && process.env.HABBO_DATA_DIR?path.resolve(process.env.HABBO_DATA_DIR):path.join(HERE,'data');fs.mkdirSync(dataDir,{recursive:true});
const storePath=path.join(dataDir,'state.json');
function dotenv(){try{for(const line of fs.readFileSync(path.join(HERE,'.env'),'utf8').split(/\r?\n/)){
 const m=line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*)\s*$/i);
 if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');
 }}catch{}}
dotenv();
function readState(){try{const old=JSON.parse(fs.readFileSync(storePath,'utf8'));
 const nextSettings=upgradeLegacyScanCoverage(old.settings,old.schemaVersion??0);
 return {settings:nextSettings,updatePrefs:{autoInstall:old.updatePrefs?.autoInstall!==false},metadata:old.metadata??{},scanProgress:Object.fromEntries(Object.entries(old.scanProgress??{}).filter(([k,v])=>/^0x[a-f0-9]{40}:FILLED$/.test(k) && (v===null||(typeof v==='string'&&v.length<4096)))),historicalSales:(old.historicalSales??[]).filter(x=>!String(x?.id??'').startsWith('demo-') && !String(x?.name??'').includes(' · sample')),
 liveTrades:old.liveTrades??[],events:old.events??[]};
 }catch{return {settings:validateSettings(DEFAULT_SETTINGS),updatePrefs:{autoInstall:true},metadata:{},scanProgress:{},historicalSales:[],liveTrades:[],events:[]};}}
const state=readState();
let lastCheckedUpdate=null;
let updating=false;
let autoUpdateTimer=null,nextAutoUpdateAttempt=0;
let updateStatus={phase:'idle',message:'Auto-update is enabled. Checks start after the app opens.',lastCheckedAt:null,availableVersion:null};
let liveArmed=false,liveBuyInFlight=false,scanning=false,serverTimer=null,activeListings=[],displayRows=[],chartSales=[],warnings=[],scannedAt=0;
let fiatRates=null,fiatRateError='',nextFiatCheckAt=0;
async function refreshFiatRates(){
 if(Date.now()<nextFiatCheckAt)return;
 nextFiatCheckAt=Date.now()+5*60*1000; // one public price request every five minutes
 try{fiatRates=await fetchFiatRates();fiatRateError='';}
 catch(error){
  fiatRateError=String(error?.message??error).slice(0,200);
  nextFiatCheckAt=Date.now()+60*1000; // retry failures at most once a minute
 }
}
let stats={pages:0,metadata:0,sales:0,truncated:0,rawOrders:0,failedRequests:0,successfulRequests:0,quoteTypes:[],rejected:{},diagnostics:[],coverage:null,candidateDiagnostics:null,historyPending:0,historyCompleted:0};
function save(){const output={schemaVersion:9,settings:state.settings,updatePrefs:state.updatePrefs,metadata:state.metadata,scanProgress:state.scanProgress,historicalSales:state.historicalSales.slice(-16000),liveTrades:state.liveTrades.slice(-1000),events:state.events.slice(-400)};
 const tmp=storePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(output,null,2));fs.renameSync(tmp,storePath);}
function event(kind,message){state.events.unshift({kind,message,time:Date.now()});state.events=state.events.slice(0,400);console.log(`[${kind}] ${message}`);}
function today(t){return new Date(t).toISOString().slice(0,10);}
function usedBudget(trades){const d=today(Date.now());return trades.filter(t=>today(t.timestamp)===d && ['completed','pending'].includes(t.status)).reduce((v,t)=>v+t.costEth,0);}
function dayCount(trades){const d=today(Date.now());return trades.filter(t=>today(t.timestamp)===d && ['completed','pending'].includes(t.status)).length;}
function safeSummary(){return {
 appVersion:LOCAL_VERSION,installDirectory:HERE,updateRepository:GITHUB_REPO,updatePrefs:state.updatePrefs,updateStatus,
 settings:state.settings,scanning,lastScan:scannedAt,now:Date.now(),armed:liveArmed,
 hasDedicatedWallet:/^0x[a-fA-F0-9]{64}$/.test(process.env.HABBO_BOT_PRIVATE_KEY||''),
 liveEnvironmentEnabled:process.env.HABBO_ENABLE_LIVE_BUYS==='YES',warnings,stats,
 fiatQuote:{...fiatMinimumStatus(state.settings,fiatRates),source:fiatRates?.source??'CoinGecko ETH spot',error:fiatRateError},
 listingCount:displayRows.length,candidateCount:displayRows.filter(x=>x.eligible).length,
 rows:displayRows.slice(0,50),events:state.events.slice(0,60),
 liveTrades:state.liveTrades.slice(-100).reverse(),
 liveSpentToday:usedBudget(state.liveTrades)
 };}
function eligibleForBudget(r,trades){return r.eligible &&
  !trades.some(t=>t.orderId===r.id)&&
  usedBudget(trades)+r.totalWithFeesEth<=state.settings.dailyBudgetEth &&
  dayCount(trades)<state.settings.maxPurchasesPerDay;}
async function doAutoTrades(){
 if(!displayRows.length)return;
 if(liveArmed){
  if(process.env.HABBO_ENABLE_LIVE_BUYS!=='YES'||!/^0x[a-fA-F0-9]{64}$/.test(process.env.HABBO_BOT_PRIVATE_KEY||'')){
   liveArmed=false;event('error','Live buying disarmed: dedicated wallet configuration missing.');return;
  }
  setAllowedContracts(state.settings.collections);
  // One live purchase per scan; never retry an ambiguous or failed order automatically.
  const target=displayRows.find(x=>eligibleForBudget(x,state.liveTrades)&&
    x.metadataResolved&&x.sales30d>=state.settings.minSales30d);
  if(!target)return;
  const attempt={timestamp:Date.now(),orderId:target.id,name:target.name,collection:target.collection,
    costEth:target.totalWithFeesEth,fairValueEth:target.reference,discount:target.discount,status:'pending',mode:'live'};
  // Do not shut down for an updater while any wallet transaction is in flight,
  // even if the user disarms buying after that transaction was submitted.
  liveBuyInFlight=true;
  try {
   state.liveTrades.push(attempt);save();event('live',`Trying LIVE purchase: ${target.name}`);
   const result=await executeLiveBuy(target,state.settings,process.env.HABBO_BOT_PRIVATE_KEY);
   attempt.status='completed';attempt.hash=result.hash;attempt.costEth=result.priceEth;
   event('success',`LIVE purchase confirmed ${target.name} — ${result.hash}`);
  }catch(error){attempt.status='failed';attempt.error=String(error?.message??error).slice(0,280);
   liveArmed=false;event('error',`LIVE attempt failed; buying DISARMED: ${attempt.error}`);
  }finally{liveBuyInFlight=false;save();}
 }
}
async function scan(){if(scanning||updating)return;scanning=true;
 try {
  // A failed spot-price lookup must NOT discard real Immutable NFT listings.
  // Instead, the dollar floor fails closed and no new live buys qualify.
  await refreshFiatRates();
  const r=await scanMarket(state.settings,state.metadata,state.scanProgress);
  const {listings,filled}=r;
  warnings=r.warnings;
  stats={pages:r.pages,metadata:r.meta.ok,sales:filled.length,truncated:r.truncated,rawOrders:r.received,failedRequests:r.failedRequests,successfulRequests:r.successfulRequests,quoteTypes:r.quoteTypes,rejected:r.rejected,diagnostics:r.diagnostics,coverage:r.coverage,candidateDiagnostics:null,historyPending:r.historyPending,historyCompleted:r.historyCompleted};
  if(r.truncated)warnings.unshift('PARTIAL ACTIVE COVERAGE: at least one collection has more live offers than were retrieved. The page limit or a failed request interrupted its scan; see collection details.');
  // Refresh historical records as metadata arrives. Earlier versions persisted
  // unresolved FILLED orders permanently, even when subsequent scans found identity.
  const salesById=new Map(state.historicalSales.map(s=>[s.id,s]));
  for(const sale of filled){
   const prior=salesById.get(sale.id);
   if(!prior||(!prior.metadataResolved&&sale.metadataResolved))salesById.set(sale.id,sale);
  }
  const threshold=Date.now()-93*86400000;
  state.historicalSales=hydrateNames([...salesById.values()],state.metadata).filter(x=>x.timestamp>=threshold).slice(-16000);
  chartSales=state.historicalSales;
  activeListings=listings;
  displayRows=applyFiatMinimum(analyze(listings,chartSales,state.settings),state.settings,fiatRates)
    .sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.discount??-1000)-(a.discount??-1000));
  const fiatStatus=fiatMinimumStatus(state.settings,fiatRates);
  if(fiatStatus.required&&!fiatStatus.available){
   warnings.unshift('Dollar minimum cannot be checked: live ETH/AUD-USD conversion unavailable or older than 15 minutes. All purchase candidates are BLOCKED until a fresh quote is received.'+(fiatRateError?' '+fiatRateError:''));
  }
  stats.candidateDiagnostics=candidateDiagnostics(displayRows,state.settings);
  stats.historicalSales=state.historicalSales.length;
  scannedAt=Date.now();
  if(stats.sales===0)warnings.push('No completed sale records in this response; trades require credible local sales history.');
  await doAutoTrades();save();event('scan',`LIVE: ${listings.length} real listings, ${filled.length} completed orders, ${displayRows.filter(x=>x.eligible).length} candidates.`);
 }catch(e){liveArmed=false;displayRows=[];activeListings=[];scannedAt=0;stats={pages:0,metadata:0,sales:0,truncated:0,rawOrders:0,failedRequests:1,successfulRequests:0,quoteTypes:[],rejected:{},diagnostics:[],coverage:null,candidateDiagnostics:null,historyPending:0,historyCompleted:0};warnings=[`Live scan failed: ${String(e?.message??e)}`];event('error',warnings[0]);}
 finally{scanning=false;}
}
function schedule(){if(serverTimer)clearInterval(serverTimer);serverTimer=setInterval(()=>{scan().catch(e=>event('error',String(e)));},state.settings.refreshSeconds*1000);}
// GitHub release auto-updates (Windows only). Never run while a scan or live buy is in flight.
// The verified ZIP installer replaces code but preserves .env and data/state.json.
function markUpdate(phase,message,extra={}){
 updateStatus={phase,message,lastCheckedAt:updateStatus.lastCheckedAt,availableVersion:updateStatus.availableVersion,...extra};
}
function beginRestart(version){
 liveArmed=false;
 markUpdate('installing',`Installing v${version}; application will restart.`,{availableVersion:version});
 event('system',`Verified GitHub update v${version} downloaded; closing Market Radar to install.`);
 save();
 setTimeout(()=>{
  if(serverTimer)clearInterval(serverTimer);
  if(autoUpdateTimer)clearInterval(autoUpdateTimer);
  server.close(()=>process.exit(0));
  // Prevent an open browser connection from holding the old server process alive forever.
  setTimeout(()=>process.exit(0),4500).unref();
 },400).unref();
}
async function installCandidate(candidate){
 if(!updating)throw Error('Updater lock was not acquired');
 if(liveArmed||scanning)throw Error('Auto-update deferred: an NFT scan or live buying is active');
 markUpdate('downloading',`Downloading and validating v${candidate.latest}.`,{availableVersion:candidate.latest});
 const downloaded=await prepareUpdate(candidate,dataDir);
 // Recheck before spawning the updater; a real purchase cannot be interrupted.
 if(liveArmed||scanning)throw Error('An NFT scan or live purchase started during the update');
 const result=await startWindowsUpdate(downloaded);
 beginRestart(downloaded.version);
 return result;
}
async function waitForScanToFinish(){
 // Updating locks out new scans immediately. Allow an in-progress request to
 // finish before touching files; never interrupt a wallet transaction.
 const deadline=Date.now()+5*60*1000;
 while(scanning&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));}
 if(scanning)throw Error('A market scan did not finish within five minutes. Will retry the update later.');
 if(liveArmed)throw Error('Real-money autobuying is armed. Update postponed until disarmed.');
}
async function autoUpdateTick(){
 if(!canAutoCheck({enabled:state.updatePrefs.autoInstall,platform:process.platform,armed:liveArmed,updating,now:Date.now(),nextAttemptAt:nextAutoUpdateAttempt}))return;
 updating=true;
 nextAutoUpdateAttempt=Date.now()+6*60*60*1000; // Up-to-date: check again every 6 hours.
 markUpdate('checking','Checking GitHub for automatic updates.');
 let installing=false;
 try{
  const candidate=await checkForUpdates();
  lastCheckedUpdate=candidate;
  markUpdate(candidate.available?'available':'current',candidate.available?`Found v${candidate.latest}; installing automatically.`:`Up to date (v${LOCAL_VERSION}).`,{lastCheckedAt:Date.now(),availableVersion:candidate.available?candidate.latest:null});
  if(candidate.available){
   markUpdate('waiting','Update found. Waiting for the current market scan to finish.',{availableVersion:candidate.latest});
   await waitForScanToFinish();
   await installCandidate(candidate);
   installing=true;
  }
 }catch(err){
  nextAutoUpdateAttempt=Date.now()+15*60*1000; // Retry failed downloads; do not retry in a tight loop.
  markUpdate('error',`Automatic update failed: ${String(err?.message??err).slice(0,240)}`);
  event('error',updateStatus.message);
 }finally{if(!installing)updating=false;}
}
function scheduleAutoUpdates(){
 if(autoUpdateTimer)clearInterval(autoUpdateTimer);
 if(process.env.HABBO_DESKTOP_APP==='1'){markUpdate('desktop','Updates are managed by the installed Windows desktop app.');return;}
 if(process.platform!=='win32'){
  markUpdate('unsupported','Automatic installation is available on Windows only.');
  return;
 }
 if(!state.updatePrefs.autoInstall){markUpdate('disabled','Automatic updates are turned off.');return;}
 markUpdate('scheduled','Automatic updates are ON. Checking at startup and every 6 hours.');
 autoUpdateTimer=setInterval(()=>{void autoUpdateTick();},60*1000);
 // Let first market initialization proceed, then check. Busy scans defer to next tick.
 setTimeout(()=>{void autoUpdateTick();},12000).unref();
}

// Native desktop updates can safely interrupt READ-ONLY HTTP scans. Keep the
// last completed scan in storage; never interrupt an armed or in-flight wallet buy.
// Waiting for hundreds of Immutable API pages used to block updates for 10+ minutes.
export async function pauseForDesktopUpdate(){
 if(liveArmed||liveBuyInFlight||updating)return false;
 updating=true; // No new scans or buys can start once the update is ready.
 try{
  event('system',scanning
   ?'Desktop update ready: closing the read-only market scan; last completed results preserved.'
   :'Desktop update ready: installing and restarting.');
  save();
  return true;
 }catch(err){updating=false;throw err;}
}
export function resumeAfterDesktopUpdate(){updating=false;}

function send(res,status,data,contentType='application/json; charset=utf-8'){
 const buf=typeof data==='string'?data:JSON.stringify(data);
 res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':contentType.startsWith('text/html')?"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'":"default-src 'none'"});res.end(buf);
}
const PORT=Number(process.env.PORT||38571);
function jsonBody(req){return new Promise((resolve,reject)=>{let b='';req.on('data',s=>{b+=s;if(b.length>250000){reject(new Error('Request too large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(b||'{}'));}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);});}
const assets=new Map([['/','public/index.html'],['/app.js','public/app.js'],['/style.css','public/style.css']]);
const server=http.createServer(async(req,res)=>{
 try{
  const uri=new URL(req.url,`http://127.0.0.1:${PORT}`);
  if(req.method==='GET'&&assets.has(uri.pathname)){
   const file=path.join(HERE,assets.get(uri.pathname));return send(res,200,fs.readFileSync(file,'utf8'),uri.pathname.endsWith('.js')?'text/javascript; charset=utf-8':uri.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  }
  if(req.method==='GET'&&uri.pathname==='/api/state')return send(res,200,safeSummary());
  // Fetch the complete real order set on demand, rather than truncating at 800
  // or transferring thousands of rows on every 4-second status refresh.
  if(req.method==='GET'&&uri.pathname==='/api/listings')return send(res,200,{lastScan:scannedAt,total:displayRows.length,rows:displayRows});
  if(req.method==='GET'&&uri.pathname==='/api/listing-details'){
   const id=uri.searchParams.get('id');
   if(!id||id.length>250)return send(res,400,{error:'A valid live order ID is required.'});
   const listing=displayRows.find(row=>row.id===id);
   if(!listing)return send(res,404,{error:'This listing is no longer in the most recent live scan. Refresh and inspect again.'});
   return send(res,200,inspectListing(listing,state.historicalSales,state.settings,scannedAt));
  }
  if(req.method==='GET'&&uri.pathname==='/api/update/check'){
   if(process.env.HABBO_DESKTOP_APP==='1')return send(res,410,{error:'Use the desktop software update button instead.'});
   try {lastCheckedUpdate=await checkForUpdates();return send(res,200,lastCheckedUpdate);} 
   catch(err){lastCheckedUpdate=null;return send(res,503,{error:String(err.message||err),repo:GITHUB_REPO});}
  }
  if(req.method==='GET'&&uri.pathname==='/api/candles'){
   const key=uri.searchParams.get('key');if(!key||key.length>250)return send(res,400,{error:'Invalid key'});
   const chartHistory=state.historicalSales;
   return send(res,200,{key,candles:candles(chartHistory,key),sales:chartHistory.filter(x=>x.key===key).slice(-180).map(({price,timestamp,id})=>({price,timestamp,id}))});
  }
  if(req.method==='GET'&&uri.pathname==='/api/export.csv'){
   const header='collection,name,token_id,price_weth,median_weth,discount_pct,net_edge_pct,sales_30d,eligible,order_id\n';
   const quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';
   const csv=header+displayRows.map(r=>[r.collection,r.name,r.tokenId,r.price,r.reference,r.discount,r.netEdge,r.sales30d,r.eligible,r.id].map(quote).join(',')).join('\n');
   return send(res,200,csv,'text/csv; charset=utf-8');
  }
  if(req.method!=='POST'||!['/api/settings','/api/refresh','/api/arm','/api/disarm','/api/update/install','/api/update/preferences'].includes(uri.pathname))return send(res,404,{error:'Not found'});
  // Local-only API; prevent another browser tab/site from posting by cross-site fetch/forms.
  const origin=req.headers.origin;if(origin&&origin!==`http://127.0.0.1:${PORT}`&&origin!==`http://localhost:${PORT}`)return send(res,403,{error:'Invalid origin'});
  if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(res,415,{error:'Use application/json'});
  const body=await jsonBody(req);
  if(uri.pathname==='/api/update/preferences'){
   if(updating)return send(res,409,{error:'Update installation is in progress.'});
   if(typeof body.autoInstall!=='boolean')return send(res,400,{error:'autoInstall must be true or false.'});
   state.updatePrefs.autoInstall=body.autoInstall;save();
   nextAutoUpdateAttempt=0;scheduleAutoUpdates();
   return send(res,200,{ok:true,updatePrefs:state.updatePrefs,updateStatus});
  }
  if(uri.pathname==='/api/update/install'){
   if(process.env.HABBO_DESKTOP_APP==='1')return send(res,410,{error:'Desktop updates are managed by the installed application.'});
   if(process.platform!=='win32')return send(res,400,{error:'Update installation is currently Windows-only.'});
   if(liveArmed)return send(res,409,{error:'Disarm real-money autobuying before updating.'});
   if(updating)return send(res,409,{error:'Update already in progress.'});
   if(body.confirm!=='INSTALL VERIFIED UPDATE')return send(res,400,{error:'Explicit update confirmation is required.'});
   updating=true;
   try {
    // Do not trust an update check cached in the browser; query GitHub again.
    const candidate=await checkForUpdates();
    if(!candidate.available)throw Error('No newer published release found.');
    if(lastCheckedUpdate?.latest!==candidate.latest)throw Error('Release changed since your last check. Check updates again first.');
    // Queue the manual installation; updating=true blocks NEW scans while the current one completes.
    markUpdate('waiting',scanning?'Update queued: waiting for the current NFT scan to finish.':'Update queued: preparing installation.',{availableVersion:candidate.latest});
    await waitForScanToFinish();
    const result=await installCandidate(candidate);
    return send(res,200,result);
   } catch(err) {updating=false;markUpdate('error',`Update failed: ${String(err?.message??err)}`);return send(res,400,{error:String(err.message||err)});}
  }
  if(uri.pathname==='/api/settings'){
   if(updating)return send(res,409,{error:'Update installation is in progress.'});
   const updated=validateSettings(body);
   // Changing the trading floor requires explicit re-arming before money can move.
   if(state.settings.minimumFiatPrice!==updated.minimumFiatPrice||state.settings.fiatCurrency!==updated.fiatCurrency)liveArmed=false;
   state.settings=updated;save();schedule();event('system','Live market settings saved');
   void scan();return send(res,200,{ok:true});
  }
  if(uri.pathname==='/api/refresh'){void scan();return send(res,200,{ok:true});}
  if(uri.pathname==='/api/disarm'){liveArmed=false;event('system','Live autobuyer disarmed');return send(res,200,{ok:true});}
  if(uri.pathname==='/api/arm'){
   if(updating)return send(res,409,{error:'Cannot arm live buying during update installation.'});
   if(body.phrase!=='ENABLE LIVE NFT BUYING')return send(res,400,{error:'Type the exact confirmation phrase.'});
   if(process.env.HABBO_ENABLE_LIVE_BUYS!=='YES')return send(res,400,{error:'Live buying disabled by .env safeguard.'});
   if(!/^0x[a-fA-F0-9]{64}$/.test(process.env.HABBO_BOT_PRIVATE_KEY||''))return send(res,400,{error:'No valid dedicated wallet private key configured.'});
   if(!scannedAt||Date.now()-scannedAt>state.settings.refreshSeconds*3000||!stats.sales)return send(res,400,{error:'Refresh live market data first; verified sales history is required.'});
   if(state.settings.minimumFiatPrice>0&&!fiatMinimumStatus(state.settings,fiatRates).available)return send(res,409,{error:'Cannot arm live buying: fresh ETH-to-dollar price quote is unavailable. No purchases are permitted until the quote is restored.'});
   liveArmed=true;event('system','LIVE auto-buy ARMED until you disarm, restart or an order fails');return send(res,200,{ok:true});
  }
 }catch(e){return send(res,400,{error:String(e?.message??e)});}
});
server.on('error',async error=>{
 if(error?.code==='EADDRINUSE'){
  let previousVersion='unknown';
  try{
   const remote=await fetch(`http://127.0.0.1:${PORT}/api/state`,{signal:AbortSignal.timeout(2000)});
   const state=await remote.json();previousVersion=String(state?.appVersion??'unknown');
  }catch{}
  console.error(`\nANOTHER MARKET RADAR IS ALREADY RUNNING on port ${PORT}.`);
  console.error(`The running app reports version ${previousVersion}; this folder contains v${LOCAL_VERSION}.`);
  console.error('Close the older Market Radar window before opening the updated one.');
  console.error(`Current installation folder: ${HERE}\n`);
 } else console.error('Market Radar could not start:',error?.message??error);
 process.exitCode=1;
});
server.listen(PORT,'127.0.0.1',()=>{console.log(`\nHabbo NFT Market Radar v${LOCAL_VERSION} at http://127.0.0.1:${PORT}`);console.log(`Installation folder: ${HERE}\n`);schedule();scheduleAutoUpdates();void scan();});
process.on('SIGINT',()=>{liveArmed=false;save();server.close(()=>process.exit(0));});
