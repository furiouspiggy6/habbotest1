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
 // Pin the native update feed to the SAME version the GitHub Releases API
 // verified. The old GitHub provider occasionally resolved an older latest.yml
 // despite releases/latest showing a newer published version.
 if(tag!==`v${version}`)throw new Error('Unexpected Windows release tag format');
 const feedUrl=`https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}`;
 const installerUrl=`${feedUrl}/${encodeURIComponent(exe)}`;
 const manifestUrl=`${feedUrl}/latest.yml`;
 if(!asset||asset.browser_download_url!==installerUrl||!manifest||manifest.browser_download_url!==manifestUrl||
     asset.size<10_000_000||!Number.isFinite(manifest.size)||manifest.size<30){
  throw new Error(`Latest release v${version} is missing its official Windows installer or native update manifest`);
 }
 return {version,latestTag:tag,newer:compareVersions(version,currentVersion)>0,installerUrl,manifestUrl,feedUrl,
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
