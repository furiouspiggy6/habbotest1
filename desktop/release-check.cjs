'use strict';
// Independent, read-only verification of the official GitHub Windows release.
// Used when electron-updater reports "up to date" due to a stale feed or cache.
const REPO='furiouspiggy6/habbotest1';
const RELEASE_API=`https://api.github.com/repos/${REPO}/releases/latest`;
function numericVersion(version){
 const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
 if(!match)return null;
 return match.slice(1).map(Number);
}
function compareVersions(a,b){
 const first=numericVersion(a),second=numericVersion(b);
 if(!first||!second)throw new Error('Invalid desktop release version');
 for(let i=0;i<3;i++)if(first[i]!==second[i])return first[i]>second[i]?1:-1;
 return 0;
}
function parseGitHubRelease(release,currentVersion){
 if(!release||release.draft||release.prerelease)throw new Error('Latest GitHub release is not public and stable');
 const tag=String(release.tag_name||'');
 const version=tag.replace(/^v/,'');
 if(!numericVersion(version))throw new Error('Latest GitHub release has an invalid version');
 const exe=`Habbo-NFT-Market-Radar-Setup-${version}.exe`;
 const asset=release.assets?.find(item=>item.name===exe);
 const manifest=release.assets?.find(item=>item.name==='latest.yml');
 const installerUrl=`https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(exe)}`;
 if(!asset||asset.browser_download_url!==installerUrl||!manifest||asset.size<10_000_000){
  throw new Error(`Latest release v${version} is missing its Windows installer or auto-update manifest`);
 }
 return {version,latestTag:tag,newer:compareVersions(version,currentVersion)>0,installerUrl,
   releaseUrl:`https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`};
}
async function fetchLatestRelease(currentVersion,fetcher=globalThis.fetch){
 // Cache busting prevents intermediary caches from providing an older version.
 const url=`${RELEASE_API}?_=${Date.now()}`;
 let response;
 try{response=await fetcher(url,{headers:{Accept:'application/vnd.github+json',
   'User-Agent':'Habbo-NFT-Market-Radar-Desktop','Cache-Control':'no-cache','Pragma':'no-cache'},
   signal:AbortSignal.timeout(12000)});}catch(err){throw Error(`GitHub release lookup failed: ${err?.message||err}`);}
 if(!response.ok)throw Error(`GitHub release lookup returned HTTP ${response.status}`);
 return parseGitHubRelease(await response.json(),currentVersion);
}
module.exports={compareVersions,parseGitHubRelease,fetchLatestRelease};
