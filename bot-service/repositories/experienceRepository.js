const path = require('path');
const { JsonFileStore } = require('./jsonFileStore');
const { createDefaultExperienceDocument } = require('../models/experienceDefaults');

const DATA_FILE = path.join(__dirname, '..', 'data', 'experience.json');

class ExperienceRepository {
  constructor(store = new JsonFileStore(DATA_FILE, createDefaultExperienceDocument)) {
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

module.exports = { ExperienceRepository };
