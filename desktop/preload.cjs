'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('marketRadarDesktop',Object.freeze({
  checkForUpdates:()=>ipcRenderer.invoke('radar-check-updates'),
  getAutoUpdates:()=>ipcRenderer.invoke('radar-get-auto-updates'),
  setAutoUpdates:value=>ipcRenderer.invoke('radar-set-auto-updates',value),
  installDownloadedUpdate:()=>ipcRenderer.invoke('radar-install-downloaded-update'),
  openLatestInstaller:()=>ipcRenderer.invoke('radar-open-latest-installer'),
  onUpdateStatus:callback=>{
    if(typeof callback!=='function')return ()=>{};
    const listener=(_event,status)=>callback(status);
    ipcRenderer.on('radar-update-status',listener);
    return ()=>ipcRenderer.removeListener('radar-update-status',listener);
  }
}));
