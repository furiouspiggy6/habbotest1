const test=require('node:test');
const assert=require('node:assert/strict');
const {compareVersions,parseGitHubRelease,fetchLatestRelease}=require('../desktop/release-check.cjs');
const tag='v2.0.3';
const name='Habbo-NFT-Market-Radar-Setup-2.0.3.exe';
const release={tag_name:tag,draft:false,prerelease:false,assets:[
 {name,size:120_000_000,browser_download_url:`https://github.com/furiouspiggy6/habbotest1/releases/download/${tag}/${name}`},
 {name:'latest.yml',size:373,browser_download_url:`https://github.com/furiouspiggy6/habbotest1/releases/download/${tag}/latest.yml`}
]};
test('compare semantic versions numerically',()=>{
 assert.equal(compareVersions('2.0.3','2.0.2'),1);
 assert.equal(compareVersions('v2.0.2','2.0.3'),-1);
 assert.equal(compareVersions('2.0.3','2.0.3'),0);
 assert.equal(compareVersions('2.0.10','2.0.9'),1);
});
test('GitHub latest release identifies missing desktop update with official installer',()=>{
 const result=parseGitHubRelease(release,'2.0.2');
 assert.equal(result.newer,true);
 assert.equal(result.version,'2.0.3');
 assert.equal(result.installerUrl,release.assets[0].browser_download_url);
 assert.equal(result.feedUrl,'https://github.com/furiouspiggy6/habbotest1/releases/download/v2.0.3');
 assert.equal(result.manifestUrl,release.assets[1].browser_download_url);
 assert.equal(parseGitHubRelease(release,'2.0.3').newer,false);
});
test('reject release without verified Windows installer and manifest',()=>{
 assert.throws(()=>parseGitHubRelease({...release,assets:[release.assets[0]]},'2.0.2'),/missing/);
 assert.throws(()=>parseGitHubRelease({...release,draft:true},'2.0.2'),/not public/);
 assert.throws(()=>parseGitHubRelease({...release,assets:[release.assets[0],{...release.assets[1],browser_download_url:'https://bad.example/latest.yml'}]},'2.0.2'),/missing/);
 assert.throws(()=>parseGitHubRelease({...release,assets:[{...release.assets[0],browser_download_url:'https://evil.example/test'},release.assets[1]]},'2.0.2'),/missing/);
});
test('fetchLatestRelease requests GitHub without caching, checks available version',async()=>{
 let seenUrl,seenOptions;const result=await fetchLatestRelease('2.0.2',async(url,options)=>{seenUrl=url;seenOptions=options;return new Response(JSON.stringify(release),{status:200});});
 assert.ok(seenUrl.includes('api.github.com/repos/furiouspiggy6/habbotest1/releases/latest?'));
 assert.equal(seenOptions.headers['Cache-Control'],'no-cache');
 assert.equal(result.newer,true);
});
