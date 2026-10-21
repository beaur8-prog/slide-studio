'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Store references to user-selected files, never document contents. The renderer
// can reopen registered IDs but cannot request reads of arbitrary paths.
class RecentFiles {
  constructor(filename, write, platform = process.platform) {
    this.filename = filename;
    this.write = write;
    this.platform = platform;
    this.files = [];
    this.loaded = null;
    this.pending = Promise.resolve();
    this.needsPersist = false;
  }

  key(filename) {
    return this.platform === 'win32' ? filename.toLowerCase() : filename;
  }

  async load() {
    this.loaded ??= (async () => {
      try {
        if ((await fs.stat(this.filename())).size > 1024 * 1024)
          throw new Error('최근 파일 정보가 너무 큽니다.');
        const saved = JSON.parse(await fs.readFile(this.filename(), 'utf8'));
        if (saved.version !== 1 || !Array.isArray(saved.files))
          throw new Error('최근 파일 정보를 읽을 수 없습니다.');
        const unique = new Map();
        for (const file of saved.files.slice(0, 1000)) {
          if (!file || typeof file.id !== 'string' || file.id.length > 100 ||
              typeof file.path !== 'string' || !path.isAbsolute(file.path) ||
              !/\.(?:pptx|slide)$/i.test(file.path) || !Number.isFinite(file.lastUsedAt)) continue;
          const filename = await fs.realpath(file.path).catch(() => file.path);
          const key = this.key(filename), previous = unique.get(key);
          if (!previous || previous.lastUsedAt < file.lastUsedAt)
            unique.set(key, { id: file.id, path: filename, lastUsedAt: file.lastUsedAt });
        }
        this.files = [...unique.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 100);
        this.needsPersist = JSON.stringify(saved.files) !== JSON.stringify(this.files);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    })();
    return this.loaded;
  }

  queue(task) {
    const operation = this.pending.then(async () => { await this.load(); return task(); });
    this.pending = operation.catch(() => {});
    return operation;
  }

  async persist(files) {
    await this.write(this.filename(), Buffer.from(JSON.stringify({ version: 1, files })));
    this.files = files;
    this.needsPersist = false;
  }

  remember(filename) {
    return this.queue(async () => {
      const canonical = await fs.realpath(filename);
      if (!/\.(?:pptx|slide)$/i.test(canonical)) throw new Error('프레젠테이션 파일을 선택하세요.');
      const key = this.key(canonical);
      const previous = this.files.find(file => this.key(file.path) === key);
      const next = { id: previous?.id || randomUUID(), path: canonical, lastUsedAt: Date.now() };
      await this.persist([next, ...this.files.filter(file => this.key(file.path) !== key)].slice(0, 100));
    });
  }

  list() {
    return this.queue(async () => {
      const kept = [], result = [];
      for (const file of this.files) {
        try {
          const stat = await fs.stat(file.path);
          if (!stat.isFile()) continue;
          kept.push(file);
          result.push({ ...file, name: path.basename(file.path), available: true });
        } catch (error) {
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
          kept.push(file);
          result.push({ ...file, name: path.basename(file.path), available: false });
        }
      }
      if (this.needsPersist || kept.length !== this.files.length) await this.persist(kept);
      return result;
    });
  }

  async resolve(id) {
    if (typeof id !== 'string' || id.length > 100) throw new Error('최근 파일을 선택하세요.');
    await this.pending;
    await this.load();
    const file = this.files.find(file => file.id === id);
    if (!file) throw new Error('최근 파일 목록에 없는 파일입니다. 파일 열기를 사용하세요.');
    return file.path;
  }
}

module.exports = { RecentFiles };
