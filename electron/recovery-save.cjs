'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { FileContexts } = require('./file-contexts.cjs');
const EXTENSIONS = new Set(['json', 'zip', 'bin']);
const MAX_BYTES = 256 * 1024 * 1024;
function decodeRecoveryPayload(payload, safeFilename) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['name', 'data', 'extension'].includes(key)) ||
      typeof payload.name !== 'string' || !EXTENSIONS.has(payload.extension) ||
      !(payload.data instanceof Uint8Array) || payload.data.byteLength > MAX_BYTES) {
    throw new TypeError('Choose JSON, ZIP or binary recovery data no larger than 256 MiB.');
  }
  return { name: safeFilename(payload.name, payload.extension), extension: payload.extension,
    data: Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength) };
}
function createRecoverySaver({ dialog, getWindow, defaultPath, atomicWrite, safeFilename }) {
  // This inspector never issues a presentation capability or changes its recent
  // files. The renderer cannot supply a path or a previous-file token.
  const inspector = new FileContexts({ maxBytes: MAX_BYTES });
  return async payload => {
    const file = decodeRecoveryPayload(payload, safeFilename);
    const result = await dialog.showSaveDialog(getWindow(), {
      title: '복구 원문 저장 (PPTX 파일 아님)',
      defaultPath: await defaultPath(file.name),
      filters: [{ name: 'Recovery data', extensions: [file.extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return false;
    const filename = result.filePath.toLowerCase().endsWith('.' + file.extension)
      ? result.filePath : result.filePath + '.' + file.extension;
    if (filename !== result.filePath && await fs.stat(filename).then(() => true, () => false)) {
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question', message: '같은 이름의 복구 파일이 있습니다. 바꾸시겠습니까?',
        detail: filename, buttons: ['바꾸기', '취소'], defaultId: 1, cancelId: 1, noLink: true,
      });
      if (answer.response !== 0) return false;
    }
    const expected = await inspector.inspect({ path: filename });
    if (expected.status !== 'missing') {
      if (!expected.digest) throw new Error('이 위치에는 저장할 수 없습니다. 다른 파일 이름을 선택하세요.');
      await fs.access(filename, constants.W_OK);
    }
    await atomicWrite(filename, file.data, {
      mode: expected.mode,
      beforeReplace: async () => {
        const now = await inspector.inspect({ path: filename, digest: expected.digest });
        if (expected.status === 'missing' ? now.status !== 'missing' : now.status !== 'unchanged')
          throw new Error('저장하는 동안 파일이 변경되어 덮어쓰지 않았습니다. 다른 이름으로 저장해 주세요.');
        if (now.status !== 'missing') await fs.access(filename, constants.W_OK);
      },
    });
    return true;
  };
}
module.exports = { createRecoverySaver, decodeRecoveryPayload };
