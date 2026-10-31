'use strict';

const path = require('node:path');

function createFileDialogs({ dialog, systemPreferences, getHome, platform = process.platform }) {
  function prepare() {
    if (platform !== 'darwin') return;
    const directory = getHome();
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\r\n\0]/.test(directory))
      throw new Error('파일 선택창의 시작 폴더를 확인할 수 없습니다.');
    // Set the application's own NSUserDefaults before Cocoa creates a panel.
    // A plain local path overrides shared recent-folder/iCloud bookmark restore;
    // the caller's defaultPath still selects the document's actual folder.
    // Never delete shared/global preferences or any user document/recovery data.
    systemPreferences.setUserDefault('NSOSPLastRootDirectory', 'string', directory);
  }
  function optionsForPanel(options) {
    // On affected macOS/Electron combinations the native Office-type filter
    // disables Open/Save even for a valid PPTX. Keep validation in the app:
    // readPresentationFile checks extensions/size before reading, and the
    // presentation saver appends .pptx and checks overwrite conflicts.
    if (platform === 'darwin' && options?.filters?.some(filter =>
      filter.extensions?.some(extension => extension === 'pptx' || extension === 'slide')))
      return { ...options, filters: [] };
    return options;
  }
  function argumentsForPanel(args) {
    return [...args.slice(0, -1), optionsForPanel(args.at(-1))];
  }
  return {
    async showOpenDialog(...args) { prepare(); return dialog.showOpenDialog(...argumentsForPanel(args)); },
    async showSaveDialog(...args) { prepare(); return dialog.showSaveDialog(...argumentsForPanel(args)); },
    showMessageBox: (...args) => dialog.showMessageBox(...args),
  };
}

module.exports = { createFileDialogs };
