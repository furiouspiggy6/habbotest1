import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>readFileSync(resolve(root,name),'utf8');

test('desktop app has an isolated renderer and uses a local-only backend',()=>{
 const main=read('desktop/main.cjs');
 assert.match(main,/nodeIntegration:false/);
 assert.match(main,/contextIsolation:true/);
 assert.match(main,/sandbox:true/);
 assert.match(main,/HABBO_DESKTOP_APP='1'/);
 assert.match(main,/await import\(pathToFileURL/);
 assert.match(main,/127\.0\.0\.1/);
 assert.match(main,/app\.requestSingleInstanceLock/);
});
test('desktop updates wait for safe scanner checkpoint and never invoke legacy ZIP installer',()=>{
 const main=read('desktop/main.cjs');
 const server=read('server.mjs');
 assert.match(main,/autoUpdater\.checkForUpdates\(/);
 assert.match(main,/autoUpdater\.quitAndInstall\(/);
 assert.match(main,/serverControl\.pauseForDesktopUpdate\(/);
 assert.match(server,/export async function pauseForDesktopUpdate/);
 assert.match(server,/if\(liveArmed\|\|updating\)return false/);
 assert.match(server,/HABBO_DESKTOP_APP==='1'/);
});
test('Windows CI builds installer and native latest.yml manifest',()=>{
 const pkg=JSON.parse(read('package.json'));
 const wf=read('.github/workflows/desktop-windows.yml');
 const legacy=read('.github/workflows/publish-release.yml');
 assert.equal(pkg.main,'desktop/main.cjs');
 assert.equal(pkg.build.win.target[0],'nsis');
 assert.equal(pkg.build.publish[0].repo,'habbotest1');
 assert.match(wf,/npm run dist:win/);
 assert.match(wf,/dist\/latest\.yml/);
 assert.doesNotMatch(legacy,/push:\s*\n\s*branches: \[main\]/);
});
