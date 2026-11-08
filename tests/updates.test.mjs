import test from 'node:test';
import assert from 'node:assert/strict';
import {isNewer,versionParts,expectedAssetNames,parseChecksum,checkForUpdates,GITHUB_REPO,canAutoUpdate} from '../updates.mjs';

test('version comparison handles major, minor and patch',()=>{
 assert.equal(isNewer('v1.0.3','1.0.2'),true);
 assert.equal(isNewer('1.0.2','1.0.2'),false);
 assert.equal(isNewer('1.0.1','1.0.2'),false);
 assert.equal(isNewer('2.0.0','1.99.99'),true);
 assert.equal(versionParts('wat'),null);
 assert.throws(()=>isNewer('evil','1.0.0'));
});
test('checksum must match filename and digest',()=>{
 const names=expectedAssetNames('1.0.3');
 const hash='a'.repeat(64);
 assert.equal(parseChecksum(`${hash}  ${names.zip}\n`,names.zip),hash);
 assert.throws(()=>parseChecksum(`${hash}  wrong.zip\n`,names.zip));
});
test('release must belong to intended GitHub repository and have both assets',async()=>{
 const version='1.0.8';const names=expectedAssetNames(version);
 const item=name=>({name,size:123,browser_download_url:`https://github.com/${GITHUB_REPO}/releases/download/v${version}/${name}`});
 const rel={tag_name:'v'+version,assets:[item(names.zip),item(names.checksum)]};
 const result=await checkForUpdates(async()=>({ok:true,status:200,json:async()=>rel}));
 assert.equal(result.available,true);assert.equal(result.latest,version);
 rel.assets[0].browser_download_url='https://example.org/evil.zip';
 await assert.rejects(()=>checkForUpdates(async()=>({ok:true,status:200,json:async()=>rel})),/expected GitHub/);
});

test('automatic updates only run on Windows when enabled and no scan or real buy is active',()=>{
 const base={enabled:true,platform:'win32',armed:false,scanning:false,updating:false,now:1000,nextAttemptAt:0};
 assert.equal(canAutoUpdate(base),true);
 for(const key of ['armed','scanning','updating'])assert.equal(canAutoUpdate({...base,[key]:true}),false,key);
 assert.equal(canAutoUpdate({...base,enabled:false}),false);
 assert.equal(canAutoUpdate({...base,platform:'linux'}),false);
 assert.equal(canAutoUpdate({...base,nextAttemptAt:1001}),false);
});
