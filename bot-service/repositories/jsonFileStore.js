const fs = require('fs');
const path = require('path');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class JsonFileStore {
  constructor(filePath, createDefaultDocument) {
    this.filePath = filePath;
    this.createDefaultDocument = createDefaultDocument;
    this.defaultDocument = createDefaultDocument();
    this.dir = path.dirname(filePath);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return clone(this.defaultDocument);
    }
  }

  save(document) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(document, null, 2));
  }

  defaultValue() {
    return clone(this.defaultDocument);
  }
}

module.exports = { JsonFileStore };
