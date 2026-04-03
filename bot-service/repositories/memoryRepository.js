const path = require('path');
const { JsonFileStore } = require('./jsonFileStore');
const { createDefaultMemoryDocument } = require('../models/memoryDefaults');

const DATA_FILE = path.join(__dirname, '..', 'data', 'memory.json');

class MemoryRepository {
  constructor(store = new JsonFileStore(DATA_FILE, createDefaultMemoryDocument)) {
    this.store = store;
    this.data = this.store.load();
  }

  reload() {
    this.data = this.store.load();
    return this.data;
  }

  save() {
    this.store.save(this.data);
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  reset() {
    this.data = this.store.defaultValue();
    this.save();
    return this.data;
  }
}

module.exports = { MemoryRepository };
