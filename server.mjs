import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const requireTradingSdk=createRequire(import.meta.url);
import {analyze,candles,DEFAULT_SETTINGS,validateSettings,hydrateNames,candidateDiagnostics,upgradeLegacyScanCoverage,inspectListing,normalizeOrder,fiatMinimumStatus,applyFiatMinimum,effectiveAudSettings,audLimitSummary} from './core.mjs';
import {scanMarket,createReadClients} from './market.mjs';
import {scoreOpportunityRows,sortByOpportunity,applyConservativeResale} from './opportunity.mjs';
import {addBidEvidence,decideAutomatically,decisionSummary} from './bid-market.mjs';
import {fetchFiatRates} from './fiat.mjs';
import {fetchOpenSeaAvatarListings,summarizeOpenSeaConnection} from './opensea.mjs';
import {parseStackFloor} from './market-floor.mjs';
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
let automatedSummary={ready:0,watched:0,passed:0,bidsObserved:0,best:null};
let nextDeepScanAt=0,lastDeepScanAt=0,scanMode='regular',scanPages=0;
let openSeaFeed={status:'needs-key',rows:[],pages:0,truncated:false,error:'Set an OpenSea API key to enable separate Ethereum NFT listings.',checkedAt:0};
let openSeaInProgress=false,nextOpenSeaCheckAt=0;
let openSeaConnection={status:'unchecked',checkedAt:0,message:'Waiting for the first OpenSea connection check.'};
let openSeaTestInProgress=false,lastOpenSeaTestAt=0;
function recordOpenSeaConnection(result){
 const summary=summarizeOpenSeaConnection(result);
 if(summary.checkedAt>=openSeaConnection.checkedAt)openSeaConnection=summary;
}
async function refreshOpenSea(){
 if(openSeaInProgress||Date.now()<nextOpenSeaCheckAt)return;
 const key=state.settings.openSeaApiKey;
 if(!key){
  openSeaFeed={status:'needs-key',rows:[],pages:0,truncated:false,error:'Set an OpenSea API key in Settings to enable official Ethereum Habbo Avatar listings.',checkedAt:Date.now()};
  recordOpenSeaConnection(openSeaFeed);
  nextOpenSeaCheckAt=Date.now()+10*60*1000;return;
 }
 openSeaInProgress=true;nextOpenSeaCheckAt=Date.now()+10*60*1000;
 try{
  const result=await fetchOpenSeaAvatarListings(key);
  if(key===state.settings.openSeaApiKey){openSeaFeed=result;recordOpenSeaConnection(result);}
 }catch{
  if(key===state.settings.openSeaApiKey){
   openSeaFeed={status:'error',rows:[],pages:0,truncated:false,error:'OpenSea connection failed. Check internet access or API availability.',checkedAt:Date.now()};
   recordOpenSeaConnection(openSeaFeed);
  }
 }finally{
  openSeaInProgress=false;
  if(key!==state.settings.openSeaApiKey){nextOpenSeaCheckAt=0;void refreshOpenSea();}
 }
}
const orderVerificationCache=new Map();
const stackFloorCache=new Map();
async function verifyReadOnlyStackFloor(row,forceFresh=false){
 const now=Date.now();
 const prefix=row.contract+'|metadata:';
 const stackId=typeof row.key==='string'&&row.key.startsWith(prefix)?row.key.slice(prefix.length):null;
 if(!stackId)return {status:'unavailable',checkedAt:now,reason:'No verified metadata stack ID was provided for this NFT'};
 const key=row.contract+'|'+stackId,cached=stackFloorCache.get(key);
 if(!forceFresh&&cached&&now-cached.checkedAt<2*60_000)return cached;
 let floor;
 try{
  const client=createReadClients(state.settings.publishableKey);
  const response=await client.blockchainData.getStack(stackId);
  floor={...parseStackFloor(response,row.contract,stackId),checkedAt:now};
 }catch(err){floor={status:'unavailable',checkedAt:now,reason:'Independent stack floor request failed: '+String(err?.message??err).slice(0,150)};}
 if(stackFloorCache.size>250)stackFloorCache.clear();
 stackFloorCache.set(key,floor);
 return floor;
}
async function verifyReadOnlyOrder(row){
 const now=Date.now(),cached=orderVerificationCache.get(row.id);
 if(cached&&now-cached.checkedAt<45_000)return cached;
 let result={status:'unverified',checkedAt:now,message:'Immutable has not confirmed this individual order.'};
 try{
  const client=createReadClients(state.settings.publishableKey);
  const response=await client.orderbook.getListing(row.id);
  const raw=response?.result?.result??response?.result??response;
  const current=normalizeOrder(raw,{name:row.collection,address:row.contract},'ACTIVE');
  if(current&&String(current.id)===String(row.id)&&current.tokenId===row.tokenId){
   result={status:'confirmed',checkedAt:now,priceEth:current.price,
    totalCostEth:current.totalWithFeesEth,
    listedAt:current.listedAt,expiresAt:current.expiresAt,
    priceChanged:Math.abs(current.price-row.price)>1e-9,
    feesChanged:Math.abs(current.totalWithFeesEth-row.totalWithFeesEth)>1e-9,
    message:'Individual order rechecked through Immutable; TokenTrove may use a different order or FX rate.'};
  }else result={status:'unverified',checkedAt:now,
   message:'Immutable returned an order that could not be matched to this exact active NFT listing; do not assume the cached price is executable.'};
 }catch(err){
  result={status:'unverified',checkedAt:now,
   message:'Individual order verification unavailable: '+String(err?.message??err).slice(0,160)};
 }
 if(orderVerificationCache.size>=250)orderVerificationCache.clear();
 orderVerificationCache.set(row.id,result);
 return result;
}
async function refreshFiatRates(){
 if(Date.now()<nextFiatCheckAt)return;
 nextFiatCheckAt=Date.now()+5*60*1000; // one public price request every five minutes
 try{
  fiatRates=await fetchFiatRates();fiatRateError='';
  // Migrate any previously saved USD minimum to an equivalent AUD minimum,
  // rounding UP to the next cent so an existing protection is not relaxed.
  if(state.settings.fiatCurrency==='USD'){
   const converted=Math.ceil(state.settings.minimumFiatPrice*fiatRates.aud/fiatRates.usd*100)/100;
   if(converted<=100000&&Number.isFinite(converted)){
    state.settings.minimumFiatPrice=converted;
    state.settings.fiatCurrency='AUD';
    liveArmed=false;save();
    event('system','Existing USD purchase minimum converted to AUD using a fresh FX quote.');
   }else{
    liveArmed=false;
    fiatRateError='Saved USD minimum is too large to migrate safely; review your price floor.';
   }
  }
 }
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
function usedBudgetAud(trades,spot){
 const d=today(Date.now());
 let total=0;
 for(const t of trades.filter(t=>today(t.timestamp)===d&&['completed','pending'].includes(t.status))){
  const saved=Number(t.costAud);
  if(t.costAud!==undefined&&t.costAud!==null&&Number.isFinite(saved)&&saved>=0){total+=saved;continue;}
  if(!Number.isFinite(spot)||spot<=0)return null;
  total+=(Number(t.costEth)||0)*spot;
 }
 return total;
}
function dayCount(trades){const d=today(Date.now());return trades.filter(t=>today(t.timestamp)===d && ['completed','pending'].includes(t.status)).length;}
function safeSummary(){return {
 appVersion:LOCAL_VERSION,installDirectory:HERE,updateRepository:GITHUB_REPO,updatePrefs:state.updatePrefs,updateStatus,
 settings:{...state.settings,openSeaApiKey:''},
 deepScan:{enabled:state.settings.deepScanEnabled===true,nextAt:nextDeepScanAt||null,
  lastAt:lastDeepScanAt||null,lastMode:scanMode,scanPages},
 openSeaKeyConfigured:Boolean(state.settings.openSeaApiKey),
 openSeaConnection:{...openSeaConnection,loading:openSeaInProgress||openSeaTestInProgress},
 openSea:{status:openSeaFeed.status,count:openSeaFeed.rows.length,checkedAt:openSeaFeed.checkedAt??0,
  pages:openSeaFeed.pages,truncated:openSeaFeed.truncated,error:openSeaFeed.error||'',loading:openSeaInProgress},
 scanning,lastScan:scannedAt,now:Date.now(),armed:liveArmed,
 hasDedicatedWallet:/^0x[a-fA-F0-9]{64}$/.test(process.env.HABBO_BOT_PRIVATE_KEY||''),
 liveEnvironmentEnabled:process.env.HABBO_ENABLE_LIVE_BUYS==='YES',warnings,stats,
 fiatQuote:{...fiatMinimumStatus({...state.settings,fiatCurrency:'AUD'},fiatRates),source:fiatRates?.source??'CoinGecko ETH spot',error:fiatRateError},
 audLimits:audLimitSummary(state.settings,fiatRates),
 autoDecision:automatedSummary,
 listingCount:displayRows.length,candidateCount:displayRows.filter(x=>x.eligible).length,
 rows:displayRows.slice(0,50),events:state.events.slice(0,60),
 liveTrades:state.liveTrades.slice(-100).reverse(),
 liveSpentToday:usedBudget(state.liveTrades),
 liveSpentTodayAud:usedBudgetAud(state.liveTrades,fiatMinimumStatus({...state.settings,fiatCurrency:'AUD'},fiatRates).spot)
 };}
function eligibleForBudget(r,trades,limits,spot){return r.eligible &&
  !trades.some(t=>t.orderId===r.id)&&
  usedBudget(trades)+r.totalWithFeesEth<=limits.dailyBudgetEth &&
  (state.settings.dailyBudgetAud===null||state.settings.dailyBudgetAud===undefined||
   (Number.isFinite(spot)&&spot>0&&usedBudgetAud(trades,spot)!==null&&
    usedBudgetAud(trades,spot)+r.totalWithFeesEth*spot<=state.settings.dailyBudgetAud)) &&
  dayCount(trades)<limits.maxPurchasesPerDay;}
async function doAutoTrades(){
 if(!displayRows.length)return;
 if(liveArmed){
  const risk=effectiveAudSettings(state.settings,fiatRates);
  if(!risk.available){liveArmed=false;event('error','Live buying disarmed: AUD conversion rate stale or unavailable.');return;}
  if(process.env.HABBO_ENABLE_LIVE_BUYS!=='YES'||!/^0x[a-fA-F0-9]{64}$/.test(process.env.HABBO_BOT_PRIVATE_KEY||'')){
   liveArmed=false;event('error','Live buying disarmed: dedicated wallet configuration missing.');return;
  }
  setAllowedContracts(state.settings.collections);
  // One live purchase per scan; never retry an ambiguous or failed order automatically.
  const target=displayRows.find(x=>eligibleForBudget(x,state.liveTrades,risk.settings,risk.spot)&&
    x.metadataResolved&&x.sales30d>=state.settings.minSales30d&&
    x.marketEvidencePassed===true&&x.conservativeDiscountPassed===true&&
    x.conservativeNetEdgePassed===true&&x.minProfitPassed===true&&
    Number.isFinite(x.conservativeResaleEth)&&x.conservativeResaleEth>0);
  if(!target)return;
  const attempt={timestamp:Date.now(),orderId:target.id,name:target.name,collection:target.collection,
    costEth:target.totalWithFeesEth,costAud:target.totalWithFeesEth*risk.spot,fairValueEth:target.reference,discount:target.discount,status:'pending',mode:'live'};
  // Do not shut down for an updater while any wallet transaction is in flight,
  // even if the user disarms buying after that transaction was submitted.
  liveBuyInFlight=true;
  try {
   state.liveTrades.push(attempt);save();event('live',`Trying LIVE purchase: ${target.name}`);
   // Independent stack-floor lookup bypasses the cached inspector response.
   // On partial orderbook coverage a cheaper competing order may be missing.
   const stackFloor=await verifyReadOnlyStackFloor(target,true);
   if(stackFloor.status!=='available')throw new Error('Cannot independently verify current comparable Immutable stack floor; live buy blocked.');
   if(stackFloor.orderId&&stackFloor.orderId!==target.id&&
      stackFloor.totalCostEth+1e-9<target.totalWithFeesEth)
    throw new Error('Independent Immutable stack floor contains a cheaper offer; live buy blocked.');
   const result=await executeLiveBuy(target,risk.settings,process.env.HABBO_BOT_PRIVATE_KEY);
   attempt.status='completed';attempt.hash=result.hash;attempt.costEth=result.priceEth;attempt.costAud=result.priceEth*risk.spot;
   event('success',`LIVE purchase confirmed ${target.name} — ${result.hash}`);
  }catch(error){attempt.status='failed';attempt.error=String(error?.message??error).slice(0,280);
   liveArmed=false;event('error',`LIVE attempt failed; buying DISARMED: ${attempt.error}`);
  }finally{liveBuyInFlight=false;save();}
 }
}
async function scan(forceDeep=false){if(scanning||updating)return;scanning=true;
 const now=Date.now();
 const interval=Number(state.settings.deepScanIntervalMinutes??30)*60_000;
 let deep=forceDeep===true;
 if(state.settings.deepScanEnabled){
  if(!nextDeepScanAt)nextDeepScanAt=now+interval;
  if(now>=nextDeepScanAt)deep=true;
  if(deep)nextDeepScanAt=now+interval;
 }else nextDeepScanAt=0;
 const requestedPages=deep?Math.max(state.settings.pagesPerCollection,state.settings.deepScanPages):state.settings.pagesPerCollection;
 try {
  // A failed spot-price lookup must NOT discard real Immutable NFT listings.
  // Instead, the dollar floor fails closed and no new live buys qualify.
  await refreshFiatRates();
  void refreshOpenSea(); // separate read-only feed; never blocks Immutable scanner
  const r=await scanMarket({...state.settings,pagesPerCollection:requestedPages},state.metadata,state.scanProgress,undefined,state.historicalSales);
  const {listings,filled}=r;
  warnings=r.warnings;
  scanMode=deep?'deep':'regular';scanPages=requestedPages;
  if(deep)lastDeepScanAt=Date.now();
  stats={pages:r.pages,metadata:r.meta.ok,sales:filled.length,bids:(r.bids??[]).length,bidDiagnostics:r.bidDiagnostics??[],truncated:r.truncated,rawOrders:r.received,failedRequests:r.failedRequests,successfulRequests:r.successfulRequests,quoteTypes:r.quoteTypes,rejected:r.rejected,diagnostics:r.diagnostics,coverage:r.coverage,candidateDiagnostics:null,historyPending:r.historyPending,historyCompleted:r.historyCompleted};
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
  // A deep market scan can outlive the FX quote TTL.
  await refreshFiatRates();
  const risk=effectiveAudSettings(state.settings,fiatRates);
  const partialCollections=r.diagnostics.filter(d=>d.status==='ACTIVE'&&(d.hasMore||d.error)).map(d=>d.collection);
  const priced=applyFiatMinimum(analyze(listings,chartSales,risk.settings),state.settings,fiatRates);
  const repriced=applyConservativeResale(priced,chartSales,state.settings,{audSpot:risk.spot});
  const withBids=addBidEvidence(repriced,r.bids??[],state.settings,risk.spot);
  const scored=scoreOpportunityRows(withBids,chartSales,{partialCollections});
  displayRows=decideAutomatically(sortByOpportunity(scored.map(row=>{
   const scorePassed=state.settings.minOpportunityScore<=0||
     (row.opportunityScore!==null&&row.opportunityScore>=state.settings.minOpportunityScore);
   const bestOfferPassed=row.observedCheaperOffers===0;
   return {...row,scorePassed,bestOfferPassed,
    eligible:row.eligible&&risk.available&&scorePassed&&bestOfferPassed,
    fiatMinPassed:row.fiatMinPassed&&risk.available};
  })),state.settings);
  automatedSummary=decisionSummary(displayRows);
  if(!risk.available){
   warnings.unshift('Live AUD quote unavailable or older than 15 minutes: dollar-denominated signals and purchases are BLOCKED until the rate is refreshed.'+(fiatRateError?' '+fiatRateError:''));
  }
  stats.candidateDiagnostics=candidateDiagnostics(displayRows,risk.settings);
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
const assets=new Map([['/','public/index.html'],['/app.js','public/app.js'],['/listing-views.mjs','public/listing-views.mjs'],['/style.css','public/style.css']]);
const server=http.createServer(async(req,res)=>{
 try{
  const uri=new URL(req.url,`http://127.0.0.1:${PORT}`);
  if(req.method==='GET'&&assets.has(uri.pathname)){
   const file=path.join(HERE,assets.get(uri.pathname));return send(res,200,fs.readFileSync(file,'utf8'),(uri.pathname.endsWith('.js')||uri.pathname.endsWith('.mjs'))?'text/javascript; charset=utf-8':uri.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  }
  if(req.method==='GET'&&uri.pathname==='/api/state')return send(res,200,safeSummary());
  // Fetch the complete real order set on demand, rather than truncating at 800
  // or transferring thousands of rows on every 4-second status refresh.
  if(req.method==='GET'&&uri.pathname==='/api/listings')return send(res,200,{lastScan:scannedAt,total:displayRows.length,rows:displayRows});
  if(req.method==='GET'&&uri.pathname==='/api/opensea/listings')
   return send(res,200,{...openSeaFeed,rate:fiatMinimumStatus({...state.settings,fiatCurrency:'AUD'},fiatRates)});
  if(req.method==='GET'&&uri.pathname==='/api/listing-details'){
   const id=uri.searchParams.get('id');
   if(!id||id.length>250)return send(res,400,{error:'A valid live order ID is required.'});
   const listing=displayRows.find(row=>row.id===id);
   if(!listing)return send(res,404,{error:'This listing is no longer in the most recent live scan. Refresh and inspect again.'});
   const details=inspectListing(listing,state.historicalSales,state.settings,scannedAt);
   const [audit,stackFloor]=await Promise.all([
    verifyReadOnlyOrder(listing),verifyReadOnlyStackFloor(listing)
   ]);
   const rate=fiatMinimumStatus({...state.settings,fiatCurrency:'AUD'},fiatRates);
   return send(res,200,{...details,priceAudit:audit,stackFloor,
    audRate:{available:rate.available,spot:rate.spot,fetchedAt:rate.fetchedAt,source:fiatRates?.source||'CoinGecko ETH spot'},
    coveragePartial:stats.truncated>0});
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
   const header='collection,name,token_id,price_aud,historical_30d_median_aud,conservative_resale_ceiling_aud,next_competitor_ask_aud,resale_estimate_basis,total_cost_aud,old_historical_profit_aud,conservative_profit_aud,extra_cost_allowance_aud,conservative_resale_discount_pct,current_ask_verified,opportunity_score,confidence,liquidity,verified_sales_7d,observed_active_offers,observed_cheaper_offers,price_trend_7d_vs_30d_pct,partial_active_coverage,old_historical_discount_pct,net_edge_pct,sales_30d,eligible,order_id,eth_aud_rate,conversion_time\n';
   const quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';
   const rate=fiatMinimumStatus({...state.settings,fiatCurrency:'AUD'},fiatRates);
   const aud=x=>rate.available&&x!==null&&x!==undefined&&Number.isFinite(Number(x))?(Number(x)*rate.spot).toFixed(4):'';
   const csv=header+displayRows.map(row=>[row.collection,row.name,row.tokenId,aud(row.price),aud(row.reference),aud(row.conservativeResaleEth),aud(row.currentCompetitorAskEth),row.resaleEstimateBasis??'',aud(row.totalWithFeesEth),row.historicalProfitAud===null||row.historicalProfitAud===undefined?'':Number(row.historicalProfitAud).toFixed(4),row.estimatedProfitAud===null||row.estimatedProfitAud===undefined?'':Number(row.estimatedProfitAud).toFixed(4),row.estimatedExtraCostsAud??0,row.conservativeDiscountPct??'',row.marketEvidencePassed===true,row.opportunityScore??'',row.confidence??'',row.liquidity??'',row.verifiedSales7d??'',row.observedActiveOffers??'',row.observedCheaperOffers??'',row.trendPct??'',row.partialActiveCoverage===true,row.discount,row.netEdge,row.sales30d,row.eligible,row.id,rate.available?rate.spot:'',rate.available?new Date(rate.fetchedAt).toISOString():''].map(quote).join(',')).join('\n');
   return send(res,200,csv,'text/csv; charset=utf-8');
  }
  if(req.method!=='POST'||!['/api/settings','/api/refresh','/api/scan/deep','/api/opensea/test','/api/arm','/api/disarm','/api/update/install','/api/update/preferences'].includes(uri.pathname))return send(res,404,{error:'Not found'});
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
  if(uri.pathname==='/api/opensea/test'){
    if(updating)return send(res,409,{error:'Update installation is in progress.'});
    const key=state.settings.openSeaApiKey;
    if(!key)return send(res,409,{error:'Save an OpenSea API key first, then test the saved key.'});
    if(openSeaTestInProgress)return send(res,409,{error:'OpenSea connection test is already running.'});
    if(Date.now()-lastOpenSeaTestAt<5000)return send(res,429,{error:'Please allow five seconds between connection tests.'});
    lastOpenSeaTestAt=Date.now();openSeaTestInProgress=true;
    try{
     const result=await fetchOpenSeaAvatarListings(key,{maxPages:1});
     const summary=summarizeOpenSeaConnection(result);
     if(key===state.settings.openSeaApiKey)recordOpenSeaConnection(result);
     return send(res,200,key===state.settings.openSeaApiKey?summary:
      {status:'unchecked',checkedAt:Date.now(),message:'The API key changed during the test. Please test the new saved key.'});
    }catch{
     const result={status:'error',checkedAt:Date.now(),message:'Could not reach OpenSea to verify the key.'};
     if(key===state.settings.openSeaApiKey)openSeaConnection=result;
     return send(res,200,result);
    }finally{openSeaTestInProgress=false;}
   }
   if(uri.pathname==='/api/settings'){
   if(updating)return send(res,409,{error:'Update installation is in progress.'});
   const updated=validateSettings({
    ...body,
    openSeaApiKey:body.clearOpenSeaKey?'':(String(body.openSeaApiKey??'').trim()||state.settings.openSeaApiKey)
   });
   // Changing the trading floor requires explicit re-arming before money can move.
   if(state.settings.minimumFiatPrice!==updated.minimumFiatPrice||state.settings.fiatCurrency!==updated.fiatCurrency||
       ['maximumPriceAud','dailyBudgetAud','minPriceAud','minEstimatedProfitAud'].some(k=>state.settings[k]!==updated[k]))liveArmed=false;
   const keyChanged=state.settings.openSeaApiKey!==updated.openSeaApiKey;
   state.settings=updated;nextDeepScanAt=0;save();schedule();event('system','Live market settings saved');
   if(keyChanged){
     nextOpenSeaCheckAt=0;
     openSeaConnection={status:updated.openSeaApiKey?'checking':'needs-key',checkedAt:0,message:updated.openSeaApiKey?'Verifying the newly saved OpenSea key…':'No OpenSea API key has been saved.'};
     openSeaFeed={status:'checking',rows:[],pages:0,truncated:false,checkedAt:0,error:''};
     void refreshOpenSea();
    }
   void scan();return send(res,200,{ok:true});
  }
  if(uri.pathname==='/api/refresh'){void scan();return send(res,200,{ok:true});}
  if(uri.pathname==='/api/scan/deep'){
   if(updating||scanning)return send(res,409,{error:'A market scan or update is already running.'});
   if(liveArmed)return send(res,409,{error:'Disarm live buying before running a manual deep scan.'});
   void scan(true);
   return send(res,200,{ok:true,mode:'deep',pageLimit:Math.max(state.settings.pagesPerCollection,state.settings.deepScanPages)});
  }
  if(uri.pathname==='/api/disarm'){liveArmed=false;event('system','Live autobuyer disarmed');return send(res,200,{ok:true});}
  if(uri.pathname==='/api/arm'){
   if(updating)return send(res,409,{error:'Cannot arm live buying during update installation.'});
   if(body.phrase!=='ENABLE LIVE NFT BUYING')return send(res,400,{error:'Type the exact confirmation phrase.'});
   if(process.env.HABBO_ENABLE_LIVE_BUYS!=='YES')return send(res,400,{error:'Live buying disabled by .env safeguard.'});
   if(!/^0x[a-fA-F0-9]{64}$/.test(process.env.HABBO_BOT_PRIVATE_KEY||''))return send(res,400,{error:'No valid dedicated wallet private key configured.'});
   // Fail before arming if packaged trading dependencies cannot be loaded.
   // Missing SDK was previously discovered only after a real purchase attempt.
   try{
    const sdk=requireTradingSdk('@imtbl/sdk');
    const ethers=await import('ethers');
    if(typeof sdk.orderbook?.Orderbook!=='function'||typeof ethers.Wallet!=='function')
     return send(res,503,{error:'The installed SDK does not expose required trading interfaces. Buying is disabled.'});
   }catch{return send(res,503,{error:'Trading dependencies unavailable in this installation. Buying remains disarmed.'});}
   if(!scannedAt||Date.now()-scannedAt>state.settings.refreshSeconds*3000||!stats.sales)return send(res,400,{error:'Refresh live market data first; verified sales history is required.'});
   if(!effectiveAudSettings(state.settings,fiatRates).available)return send(res,409,{error:'Cannot arm live buying: a fresh AUD conversion quote is required for the AUD buying limits.'});
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
