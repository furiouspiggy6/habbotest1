/**
 * Optional GitHub Releases updater. The application never silently installs code.
 * Releases must include a version-named ZIP and a SHA-256 sidecar produced by CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const GITHUB_REPO='furiouspiggy6/habbotest1';
const REPO_URL=`https://github.com/${GITHUB_REPO}`;
const RELEASE_API=`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const HERE=path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PACKAGE=JSON.parse(fs.readFileSync(path.join(HERE,'package.json'),'utf8'));
export const LOCAL_VERSION=LOCAL_PACKAGE.version;
const MAX_BYTES=30*1024*1024;
const REQ_HEADERS={'Accept':'application/vnd.github+json','User-Agent':'Habbo-NFT-Market-Radar-Update-Checker','X-GitHub-Api-Version':'2022-11-28'};

// Pure scheduling guard: never interrupt scanning or real-money trading.
export function canAutoUpdate({enabled,platform,armed,scanning,updating,now,nextAttemptAt}){
 return enabled===true && platform==='win32' && !armed && !scanning && !updating && now>=nextAttemptAt;
}
export function versionParts(version){
 const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version??''));
 return m?m.slice(1).map(Number):null;
}
export function isNewer(candidate,installed){
 const a=versionParts(candidate),b=versionParts(installed);
 if(!a||!b)throw Error('Unexpected update version format');
 for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}
 return false;
}
export function expectedAssetNames(version){
 const clean=String(version).replace(/^v/,'');
 if(!versionParts(clean))throw Error('Invalid release version');
 const zip=`Habbo_NFT_Market_Radar_Windows_v${clean}.zip`;
 return {zip,checksum:`${zip}.sha256`};
}
function requireGithubAsset(asset,name){
 if(!asset||asset.name!==name||typeof asset.browser_download_url!=='string')throw Error(`Missing GitHub release asset: ${name}`);
 const u=new URL(asset.browser_download_url);
 if(u.protocol!=='https:'||u.hostname!=='github.com'||u.pathname!==`/${GITHUB_REPO}/releases/download/${asset.tag}/${name}`){
  throw Error('Release asset is not on the expected GitHub repository');
 }
 return u.toString();
}
function publicRelease(rel){
 const version=String(rel.tag_name??'').replace(/^v/,'');
 if(!versionParts(version))throw Error('Latest GitHub release has an invalid version tag');
 const names=expectedAssetNames(version);
 const assets=(rel.assets??[]).map(x=>({...x,tag:rel.tag_name}));
 const zip=assets.find(x=>x.name===names.zip),checksum=assets.find(x=>x.name===names.checksum);
 const downloadUrl=requireGithubAsset(zip,names.zip);
 const checksumUrl=requireGithubAsset(checksum,names.checksum);
 if(zip.size>MAX_BYTES)throw Error('Release download exceeds size limit');
 return {installed:LOCAL_VERSION,latest:version,available:isNewer(version,LOCAL_VERSION),
  releaseUrl:`${REPO_URL}/releases/tag/${encodeURIComponent(rel.tag_name)}`,
  repoUrl:REPO_URL,downloadUrl,checksumUrl,filename:names.zip,notes:typeof rel.body==='string'?rel.body.slice(0,1200):'',publishedAt:rel.published_at??null};
}
export async function checkForUpdates(fetcher=fetch){
 let response;
 try{
  response=await fetcher(RELEASE_API,{headers:REQ_HEADERS,signal:AbortSignal.timeout(15000)});
 }catch(error){throw Error(`GitHub check failed: ${error.message}`);}
 if(response.status===404)throw Error('No published GitHub release yet. The repository must be created and the first version published.');
 if(!response.ok)throw Error(`GitHub returned HTTP ${response.status} checking releases`);
 return publicRelease(await response.json());
}
export function parseChecksum(body,filename){
 const matches=String(body).trim().split(/\r?\n/).map(x=>x.match(/^([a-f\d]{64})\s+\*?([^\\/]+)$/i)).filter(Boolean);
 const line=matches.find(m=>m[2]===filename);
 if(!line)throw Error('Release checksum is missing the expected filename');
 return line[1].toLowerCase();
}
async function getAssetBuffer(url,fetcher=fetch,limit=MAX_BYTES){
 // Use only the prevalidated HTTPS URL supplied by GitHub's official Releases API.
 const r=await fetcher(url,{headers:REQ_HEADERS,redirect:'follow',signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw Error(`GitHub asset download failed: HTTP ${r.status}`);
 const length=Number(r.headers.get('content-length')??'0');
 if(length>limit)throw Error('GitHub asset is too large');
 const chunks=[];let size=0;
 for await(const chunk of r.body){size+=chunk.length;if(size>limit)throw Error('GitHub asset exceeds download limit');chunks.push(chunk);}
 return Buffer.concat(chunks);
}
export async function prepareUpdate(info,dataDirectory,fetcher=fetch){
 if(!info.available)throw Error('No newer version is available');
 const checksumData=await getAssetBuffer(info.checksumUrl,fetcher,4096);
 const want=parseChecksum(checksumData.toString('utf8'),info.filename);
 const archive=await getAssetBuffer(info.downloadUrl,fetcher);
 if(archive.subarray(0,4).toString('hex')!=='504b0304')throw Error('Release is not a ZIP file');
 const got=crypto.createHash('sha256').update(archive).digest('hex');
 if(want!==got)throw Error('Downloaded release failed SHA-256 verification');
 const updateDir=path.join(dataDirectory,'updates');
 fs.mkdirSync(updateDir,{recursive:true});
 const zipPath=path.join(updateDir,`verified-${info.latest}-${crypto.randomUUID()}.zip`);
 fs.writeFileSync(zipPath,archive,{flag:'wx',mode:0o600});
 return {zipPath,sha256:got,version:info.latest};
}
export async function startWindowsUpdate({zipPath,sha256,version},parentPID=process.pid){
 if(process.platform!=='win32')throw Error('Automatic update installation is currently Windows-only');
 const script=path.join(HERE,'UPDATE_WINDOWS.ps1');
 if(!fs.existsSync(script))throw Error('Windows update script is missing');
 const stageScript=path.join(path.dirname(zipPath),'install-'+crypto.randomUUID()+'.ps1');
 fs.copyFileSync(script,stageScript);
 const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',stageScript,
  '-InstallDir',HERE,'-ZipPath',zipPath,'-Version',version,'-ExpectedHash',sha256,'-ParentProcessId',String(parentPID)];
 return await new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',args,{cwd:HERE,detached:true,stdio:'ignore',windowsHide:true});
  child.once('error',reject);
  child.once('spawn',()=>{
   child.unref();
   resolve({ok:true,message:'Verified update downloaded. Application will close, install the update and restart.'});
  });
 });
}
