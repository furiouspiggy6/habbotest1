'use strict';
// Native Windows shell for the local-only Market Radar backend.
// BrowserWindow is sandboxed and loads only our own loopback dashboard.
const {app, BrowserWindow, ipcMain, shell} = require('electron');
const {autoUpdater} = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {pathToFileURL} = require('node:url');

const REPO = 'furiouspiggy6/habbotest1';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let window = null;
let serverControl = null;
let baseUrl = '';
let downloadedUpdate = null;
let installingUpdate = false;
let checkingUpdate = false;
let updateTimer = null;
let lastStatus = {phase:'starting', message:'Starting the desktop app...', version:app.getVersion()};
let preferencePath = '';

function sendStatus(phase, message, extra={}) {
  lastStatus = {phase, message, version:app.getVersion(), ...extra};
  if (window && !window.isDestroyed()) window.webContents.send('radar-update-status', lastStatus);
}
function readAutoUpdatePreference() {
  try {return JSON.parse(fs.readFileSync(preferencePath, 'utf8')).autoUpdate !== false;}
  catch {return true;}
}
function setAutoUpdatePreference(enabled) {
  fs.writeFileSync(preferencePath, JSON.stringify({autoUpdate:enabled}, null, 2), {mode:0o600});
  if(enabled) {scheduleUpdateChecks(); void checkForUpdates();}
  else {if(updateTimer)clearInterval(updateTimer);updateTimer=null;sendStatus('disabled','Automatic updates turned off.');}
  return {enabled};
}
function reserveLocalPort() {
  return new Promise((resolve,reject)=>{
    const listener=net.createServer();
    listener.once('error',reject);
    listener.listen(0,'127.0.0.1',()=>{
      const port=listener.address().port;
      listener.close(err=>err?reject(err):resolve(port));
    });
  });
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function startBackend(){
  const port = await reserveLocalPort();
  process.env.HABBO_DESKTOP_APP='1';
  process.env.HABBO_DATA_DIR=path.join(app.getPath('userData'),'radar-data');
  process.env.PORT=String(port);
  baseUrl=`http://127.0.0.1:${port}`;
  serverControl=await import(pathToFileURL(path.join(__dirname,'..','server.mjs')).href);
  for(let attempt=0;attempt<80;attempt++){
    try {
      const response=await fetch(`${baseUrl}/api/state`,{signal:AbortSignal.timeout(800)});
      if(response.ok){const info=await response.json();if(info.appVersion===app.getVersion())return;}
    }catch{}
    await sleep(250);
  }
  throw new Error('Local NFT scanner could not start. Review the desktop app log.');
}
function createWindow(){
  window=new BrowserWindow({
    title:'Habbo NFT Market Radar', width:1400,height:900,minWidth:1060,minHeight:700,
    autoHideMenuBar:true, backgroundColor:'#101820',
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      nodeIntegration:false, contextIsolation:true, sandbox:true,
      webSecurity:true
    }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({url})=>{
    try {const u=new URL(url);if(u.protocol==='https:' && ['tokentrove.com','www.tokentrove.com','github.com'].includes(u.hostname))void shell.openExternal(u.toString());}catch{}
    return {action:'deny'};
  });
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(`${baseUrl}/`))event.preventDefault();});
  window.webContents.on('did-finish-load',()=>window.webContents.send('radar-update-status',lastStatus));
  window.loadURL(baseUrl);
  window.on('closed',()=>{window=null;});
}
async function checkForUpdates(){
  if(!app.isPackaged){sendStatus('development','Desktop update checks work in the installed Windows application.');return;}
  if(!readAutoUpdatePreference()){sendStatus('disabled','Automatic updates turned off.');return;}
  if(checkingUpdate||installingUpdate)return;
  checkingUpdate=true;
  try {
    sendStatus('checking','Checking GitHub for desktop updates...');
    await autoUpdater.checkForUpdates();
  } catch(error) {
    sendStatus('error',`Desktop update check failed: ${String(error?.message||error).slice(0,250)}`);
  } finally {checkingUpdate=false;}
}
async function installWhenSafe(){
  if(!downloadedUpdate||installingUpdate||!readAutoUpdatePreference())return;
  installingUpdate=true;
  try{
    sendStatus('waiting',`Update v${downloadedUpdate.version} downloaded. Waiting for the scanner to finish safely...`);
    // The backend pauses new scans before this returns, and will not interrupt a real-money purchase.
    const paused=await serverControl.pauseForDesktopUpdate();
    if(!paused){
      sendStatus('waiting',`Update v${downloadedUpdate.version} is ready. Install will wait until live buying is disarmed.`);
      installingUpdate=false;
      return;
    }
    sendStatus('installing',`Installing verified Windows update v${downloadedUpdate.version} and reopening...`);
    autoUpdater.quitAndInstall(true,true);
  }catch(error){
    serverControl?.resumeAfterDesktopUpdate?.();
    sendStatus('error',`Could not restart for update: ${String(error?.message||error).slice(0,230)}`);
    installingUpdate=false;
  }
}
function setupUpdater(){
  autoUpdater.autoDownload=true;
  autoUpdater.autoInstallOnAppQuit=true;
  autoUpdater.allowPrerelease=false;
  autoUpdater.on('checking-for-update',()=>sendStatus('checking','Checking GitHub for desktop updates...'));
  autoUpdater.on('update-available',info=>sendStatus('downloading',`Update v${info.version} found. Downloading in the background...`,{newVersion:info.version}));
  autoUpdater.on('update-not-available',()=>sendStatus('current',`You're up to date (v${app.getVersion()}).`));
  autoUpdater.on('download-progress',progress=>sendStatus('downloading',`Downloading desktop update: ${Math.round(progress.percent)}%`,{percent:progress.percent}));
  autoUpdater.on('update-downloaded',info=>{downloadedUpdate=info;void installWhenSafe();});
  autoUpdater.on('error',error=>sendStatus('error',`Desktop update failed: ${String(error?.message||error).slice(0,250)}`));
}
function scheduleUpdateChecks(){
  if(updateTimer)clearInterval(updateTimer);
  if(!readAutoUpdatePreference())return;
  updateTimer=setInterval(()=>{
    if(downloadedUpdate)void installWhenSafe(); else void checkForUpdates();
  },UPDATE_INTERVAL_MS);
}
async function run(){
  if(!app.requestSingleInstanceLock()){app.quit();return;}
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  await app.whenReady();
  app.setAppUserModelId('com.furiouspiggy6.habbomarketradar');
  preferencePath=path.join(app.getPath('userData'),'desktop-updates.json');
  ipcMain.handle('radar-check-updates',()=>checkForUpdates());
  ipcMain.handle('radar-get-auto-updates',()=>({enabled:readAutoUpdatePreference(),status:lastStatus}));
  ipcMain.handle('radar-set-auto-updates',(_event,enabled)=>{
    if(typeof enabled!=='boolean')throw new Error('Expected a boolean update preference');
    return setAutoUpdatePreference(enabled);
  });
  ipcMain.handle('radar-install-downloaded-update',()=>installWhenSafe());
  try{
    await startBackend();
    createWindow();
    setupUpdater();
    if(readAutoUpdatePreference()){
      scheduleUpdateChecks();
      setTimeout(()=>{void checkForUpdates();},12000);
      sendStatus('scheduled','Automatic desktop updates enabled. Checking GitHub shortly.');
    }else sendStatus('disabled','Automatic desktop updates are off.');
  }catch(error){
    const message=String(error?.stack??error);
    fs.writeFileSync(path.join(app.getPath('userData'),'startup-error.log'),message);
    const failureWindow=new BrowserWindow({width:720,height:340,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    const html=`<html><body style="background:#101820;color:#f1f6ff;font:16px sans-serif;padding:30px"><h2>Market Radar failed to start</h2><p>Check the startup-error.log in your AppData/Roaming/Habbo NFT Market Radar folder.</p><pre style="white-space:pre-wrap">${message.replace(/[<>&]/g,' ').slice(0,1200)}</pre></body></html>`;
    failureWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  }
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0&&baseUrl)createWindow();});
}
app.on('window-all-closed',()=>app.quit());
void run();
