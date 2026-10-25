'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

// Keep paths, rather than document bytes, until the editor can open a file.
// The only producers are OS open-file events and application launch arguments.
class FileOpenRequests {
  constructor() { this.paths = new Set(); }
  get size() { return this.paths.size; }
  add(filename, directory = process.cwd()) {
    if (typeof filename !== 'string' || !filename || filename.startsWith('-')) return false;
    try {
      if (filename.startsWith('file:')) filename = fileURLToPath(filename);
      else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filename)) return false;
      filename = path.resolve(directory, filename);
      if (!/\.(pptx|slide)$/i.test(filename) || this.paths.has(filename)) return false;
      if (this.paths.size >= 64) return false;
      this.paths.add(filename);
      return true;
    } catch { return false; }
  }
  addArguments(argv, directory) {
    for (const argument of argv.slice(1)) this.add(argument, directory);
  }
  take() {
    const filename = this.paths.values().next().value;
    if (filename) this.paths.delete(filename);
    return filename;
  }
}

module.exports = { FileOpenRequests };
