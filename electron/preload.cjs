'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  platform: process.platform,
  windowSessionId: (process.argv || []).find(arg => arg.startsWith('--slide-studio-window-session='))?.split('=')[1],
  getUpdateState: () => ipcRenderer.invoke('slide-studio:get-update-state'),
  checkUpdates: () => ipcRenderer.invoke('slide-studio:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('slide-studio:download-update'),
  installUpdate: () => ipcRenderer.invoke('slide-studio:install-update'),
  cancelUpdate: () => ipcRenderer.invoke('slide-studio:cancel-update'),
  revealUpdate: () => ipcRenderer.invoke('slide-studio:reveal-update'),
  openUpdatePage: () => ipcRenderer.invoke('slide-studio:open-update-page'),
  setAutomaticUpdates: enabled => ipcRenderer.invoke('slide-studio:set-automatic-updates', enabled),
  onUpdateState: callback => {
    if (typeof callback !== 'function') throw new TypeError('An update callback is required.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('slide-studio:update-state', listener);
    return () => ipcRenderer.removeListener('slide-studio:update-state', listener);
  },
  pasteTableClipboard: () => ipcRenderer.invoke('slide-studio:paste-table-clipboard'),
  editTextClipboard: action => ipcRenderer.invoke('slide-studio:edit-text-clipboard', action),
  loadOfficeCalibriFonts: () => ipcRenderer.invoke('slide-studio:load-office-calibri-fonts'),
  loadOfficeLightFont: () => ipcRenderer.invoke('slide-studio:load-office-light-font'),
  setChromeTheme: theme => ipcRenderer.invoke('slide-studio:set-chrome-theme', theme),
  setPresentationMode: enabled => ipcRenderer.invoke('slide-studio:set-presentation-mode', enabled),
  listCaptureSources: () => ipcRenderer.invoke('slide-studio:list-capture-sources'),
  captureSource: id => ipcRenderer.invoke('slide-studio:capture-source', id),
  onPresentationEnded: callback => {
    if (typeof callback !== 'function') throw new TypeError('A presentation callback is required.');
    const listener = () => callback();
    ipcRenderer.on('slide-studio:presentation-ended', listener);
    return () => ipcRenderer.removeListener('slide-studio:presentation-ended', listener);
  },
  saveFile: payload => ipcRenderer.invoke('slide-studio:save-file', payload),
  saveRecoveryData: payload => ipcRenderer.invoke('slide-studio:save-recovery-data', payload),
  openFile: () => ipcRenderer.invoke('slide-studio:open-file'),
  takeRequestedFile: () => ipcRenderer.invoke('slide-studio:take-requested-file'),
  onOpenRequested: callback => {
    if (typeof callback !== 'function') throw new TypeError('A file-open callback is required.');
    const listener = () => callback();
    ipcRenderer.on('slide-studio:open-requested', listener);
    return () => ipcRenderer.removeListener('slide-studio:open-requested', listener);
  },
  recentFiles: () => ipcRenderer.invoke('slide-studio:recent-files'),
  openRecentFile: id => ipcRenderer.invoke('slide-studio:open-recent-file', id),
  exportPDF: name => ipcRenderer.invoke('slide-studio:export-pdf', name),
  print: () => ipcRenderer.invoke('slide-studio:print'),
  onMenu: callback => {
    if (typeof callback !== 'function') throw new TypeError('A menu callback is required.');
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('slide-studio:menu', listener);
    return () => ipcRenderer.removeListener('slide-studio:menu', listener);
  },
}));

// User-initiated web links open in the system browser. No generic IPC or shell
// capability is exposed to the editor, and generated click events are ignored.
window.addEventListener('click', event => {
  const link = event.composedPath().find(node => node instanceof HTMLAnchorElement);
  if (!link) return;
  let url;
  try { url = new URL(link.href); } catch { return; }
  if (!['https:', 'http:'].includes(url.protocol)) return;
  if (url.origin === window.location.origin) return;
  event.preventDefault();
  if (event.isTrusted) ipcRenderer.send('slide-studio:open-external', url.href);
}, true);
