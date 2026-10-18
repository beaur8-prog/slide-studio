'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Same fonts as the audience, without file, clipboard, capture or editor IPC.
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  platform: process.platform,
  loadOfficeCalibriFonts: () => ipcRenderer.invoke('slide-studio:load-office-calibri-fonts'),
  loadOfficeLightFont: () => ipcRenderer.invoke('slide-studio:load-office-light-font'),
}));
