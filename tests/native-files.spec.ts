import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

test('native file transport accepts typed byte slices without expanding or leaking surrounding bytes', () => {
  const filename = path.resolve('electron/main.cjs');
  const realRequire = createRequire(filename);
  const sandbox: any = {
    __dirname: path.dirname(filename), process, Buffer, Uint8Array, URL,
    require: (id: string) => id === 'electron' ? { app: {
      isPackaged: true, setName() {}, setPath() {}, getPath() { return '/tmp'; },
      requestSingleInstanceLock() { return false; }, quit() {},
    } } : realRequire(id),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nthis.decode = decodeFilePayload;', sandbox);
  const bytes = new Uint8Array([99, 80, 75, 3, 4, 88]);
  const output = sandbox.decode({ name: '한글 문서.pptx', extensions: ['pptx'], data: bytes.subarray(1, 5) });
  expect([...output.data]).toEqual([80, 75, 3, 4]);
  expect(output.data.buffer).toBe(bytes.buffer);
  expect(output.name).toBe('한글 문서.pptx');
  expect(() => sandbox.decode({ name: 'bad', extensions: ['pptx'], data: [1, 2, 3] })).toThrow();
  expect(() => sandbox.decode({ name: 'bad', extensions: ['exe'], data: bytes })).toThrow();
});

test('Windows save names avoid reserved devices without changing Korean names', () => {
  const filename = path.resolve('electron/main.cjs');
  const realRequire = createRequire(filename);
  let appId = '';
  const sandbox: any = {
    __dirname: path.dirname(filename), process: { ...process, platform: 'win32' }, Buffer, Uint8Array, URL,
    require: (id: string) => id === 'electron' ? { app: {
      isPackaged: true, setName() {}, setPath() {}, getPath() { return 'C:\\Users\\test'; },
      setAppUserModelId(value: string) { appId = value; },
      requestSingleInstanceLock() { return false; }, quit() {},
    } } : realRequire(id),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nthis.filename = safeFilename;', sandbox);
  expect(appId).toBe('local.slidestudio.app');
  expect(sandbox.filename('CON', 'pptx')).toBe('_CON.pptx');
  expect(sandbox.filename('lpt1.slide', 'slide')).toBe('_lpt1.slide');
  expect(sandbox.filename('COM¹.pptx', 'pptx')).toBe('_COM¹.pptx');
  expect(sandbox.filename('기획안... ', 'slide')).toBe('기획안.slide');
  expect(sandbox.filename('한글 문서.pptx', 'pptx')).toBe('한글 문서.pptx');
});
