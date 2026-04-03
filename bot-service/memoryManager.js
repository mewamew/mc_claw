const { MemoryRepository } = require('./repositories/memoryRepository');

const MAX_LANDMARKS = 100;
const MAX_RESOURCES = 50;
const MAX_FACTS = 50;

// Block types worth remembering as landmarks
const LANDMARK_BLOCKS = new Set([
  'crafting_table', 'furnace', 'blast_furnace', 'smoker',
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box',
  'bed', 'white_bed', 'red_bed', 'blue_bed', 'green_bed', 'yellow_bed',
  'black_bed', 'brown_bed', 'cyan_bed', 'gray_bed', 'light_blue_bed',
  'light_gray_bed', 'lime_bed', 'magenta_bed', 'orange_bed', 'pink_bed', 'purple_bed',
  'enchanting_table', 'anvil', 'brewing_stand', 'smithing_table',
  'stonecutter', 'grindstone', 'loom', 'cartography_table',
  'composter', 'lectern', 'cauldron', 'beacon',
]);

class MemoryManager {
  constructor(repository = new MemoryRepository()) {
    this.repository = repository;
    this.data = this.repository.data;
  }

  _load() {
    this.data = this.repository.reload();
    return this.data;
  }

  _save() {
    this.repository.save();
  }

  _syncData() {
    this.data = this.repository.data;
  }

  _dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }

  // --- Landmarks ---

  isLandmarkBlock(blockName) {
    return LANDMARK_BLOCKS.has(blockName);
  }

  addLandmark(type, position, meta = {}) {
    const existing = this.data.landmarks.find(
      (lm) => lm.type === type && this._dist(lm.position, position) < 1.5
    );

    if (existing) {
      existing.timestamp = Date.now();
      Object.assign(existing, meta);
      this._save();
      return { updated: true, id: existing.id };
    }

    const id = `lm_${Date.now()}`;
    this.data.landmarks.push({
      id,
      type,
      position: { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) },
      timestamp: Date.now(),
      ...meta,
    });

    if (this.data.landmarks.length > MAX_LANDMARKS) {
      this.data.landmarks.sort((a, b) => b.timestamp - a.timestamp);
      this.data.landmarks = this.data.landmarks.slice(0, MAX_LANDMARKS);
    }

    this._save();
    return { updated: false, id };
  }

  removeLandmark(type, position) {
    const idx = this.data.landmarks.findIndex(
      (lm) => lm.type === type && this._dist(lm.position, position) < 1.5
    );
    if (idx === -1) return false;
    this.data.landmarks.splice(idx, 1);
    this._save();
    return true;
  }

  // --- Resources ---

  addResource(type, area, count) {
    const existing = this.data.resources.find(
      (r) => r.type === type && this._dist(r.area, area) < 16
    );

    if (existing) {
      existing.count = count;
      existing.timestamp = Date.now();
      this._save();
      return { updated: true, id: existing.id };
    }

    const id = `res_${Date.now()}`;
    this.data.resources.push({
      id,
      type,
      area: { x: Math.round(area.x), y: Math.round(area.y), z: Math.round(area.z) },
      count,
      timestamp: Date.now(),
    });

    if (this.data.resources.length > MAX_RESOURCES) {
      this.data.resources.sort((a, b) => b.timestamp - a.timestamp);
      this.data.resources = this.data.resources.slice(0, MAX_RESOURCES);
    }

    this._save();
    return { updated: false, id };
  }

  // --- Tasks ---

  updateTask(current, progress) {
    this.data.tasks = { current, progress, updatedAt: Date.now() };
    this._save();
  }

  // --- Facts ---

  addFact(key, value, note = '') {
    const existing = this.data.facts.find((f) => f.key === key);
    if (existing) {
      existing.value = value;
      existing.note = note;
      existing.timestamp = Date.now();
      this._save();
      return { updated: true, id: existing.id };
    }

    const id = `fact_${Date.now()}`;
    this.data.facts.push({ id, key, value, note, timestamp: Date.now() });

    if (this.data.facts.length > MAX_FACTS) {
      this.data.facts.sort((a, b) => b.timestamp - a.timestamp);
      this.data.facts = this.data.facts.slice(0, MAX_FACTS);
    }

    this._save();
    return { updated: false, id };
  }

  // --- Queries ---

  getNearby(position, radius = 64) {
    const landmarks = this.data.landmarks
      .map((lm) => ({ ...lm, distance: this._dist(lm.position, position) }))
      .filter((lm) => lm.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    const resources = this.data.resources
      .map((r) => ({ ...r, distance: this._dist(r.area, position) }))
      .filter((r) => r.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    return { landmarks, resources };
  }

  getSummaryForState(botPosition) {
    if (!botPosition) return null;
    const pos = { x: botPosition.x, y: botPosition.y, z: botPosition.z };

    const nearbyLandmarks = this.data.landmarks
      .map((lm) => ({
        type: lm.type,
        position: lm.position,
        distance: parseFloat(this._dist(lm.position, pos).toFixed(1)),
      }))
      .filter((lm) => lm.distance <= 64)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);

    const currentTask = this.data.tasks.current
      ? { task: this.data.tasks.current, progress: this.data.tasks.progress }
      : null;

    const recentFacts = [...this.data.facts]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3)
      .map((f) => ({ key: f.key, value: f.value, note: f.note }));

    return {
      nearbyLandmarks: nearbyLandmarks.length > 0 ? nearbyLandmarks : null,
      currentTask,
      recentFacts: recentFacts.length > 0 ? recentFacts : null,
    };
  }

  getAll() {
    return {
      landmarks: this.data.landmarks,
      resources: this.data.resources,
      tasks: this.data.tasks,
      facts: this.data.facts,
    };
  }

  getByType(type) {
    if (type === 'tasks') return this.data.tasks;
    return this.data[type] || [];
  }

  remove(id) {
    for (const collection of ['landmarks', 'resources', 'facts']) {
      const idx = this.data[collection].findIndex((item) => item.id === id);
      if (idx !== -1) {
        this.data[collection].splice(idx, 1);
        this._save();
        return true;
      }
    }
    return false;
  }

  clearAll() {
    this.data = this.repository.reset();
    this._syncData();
  }
}

module.exports = new MemoryManager();
