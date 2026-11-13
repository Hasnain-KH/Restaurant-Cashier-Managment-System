'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const bootstrap = ipcRenderer.sendSync('app:bootstrap') || {};

contextBridge.exposeInMainWorld('joona', {
  bootstrap,
  info: () => ipcRenderer.invoke('app:info'),
  backup: () => ipcRenderer.invoke('backup:create'),
  restore: () => ipcRenderer.invoke('backup:restore'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
  openBackupsFolder: () => ipcRenderer.invoke('app:open-backups-folder'),
});
