const { ExperienceRepository } = require('./repositories/experienceRepository');

const MAX_PER_ACTION = 20;

class ExperienceManager {
  constructor(repository = new ExperienceRepository()) {
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

  findRelevant(action, errorMsg = null, limit = 5) {
    const exps = this.data.experiences[action] || [];
    if (exps.length === 0) return [];

    let results = exps;

    if (errorMsg) {
      const errorLower = errorMsg.toLowerCase();
      results = exps
        .map((exp) => {
          let score = 0;
          if (exp.problem && exp.problem.toLowerCase().includes(errorLower)) score += 10;
          const errorWords = errorLower.split(/\s+/).filter((w) => w.length > 3);
          for (const word of errorWords) {
            if (exp.problem && exp.problem.toLowerCase().includes(word)) score += 2;
            if (exp.tags && exp.tags.some((t) => t.includes(word))) score += 1;
          }
          score += (exp.useCount || 0) * 0.5;
          return { ...exp, _score: score };
        })
        .filter((exp) => exp._score > 0)
        .sort((a, b) => b._score - a._score);
    } else {
      results = [...exps].sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
    }

    const ids = new Set(results.slice(0, limit).map((e) => e.id));
    for (const exp of exps) {
      if (ids.has(exp.id)) {
        exp.useCount = (exp.useCount || 0) + 1;
      }
    }
    this._save();

    return results.slice(0, limit).map((e) => ({
      id: e.id,
      problem: e.problem,
      context: e.context,
      solution: e.solution,
      tags: e.tags,
      useCount: e.useCount,
    }));
  }

  add(action, problem, context, solution, tags = []) {
    if (!this.data.experiences[action]) {
      this.data.experiences[action] = [];
    }

    const exps = this.data.experiences[action];

    const duplicate = this._findSimilar(exps, problem);
    if (duplicate) {
      duplicate.solution = solution;
      duplicate.context = context;
      if (tags.length > 0) {
        duplicate.tags = [...new Set([...(duplicate.tags || []), ...tags])];
      }
      duplicate.timestamp = Date.now();
      this._save();
      return { updated: true, id: duplicate.id };
    }

    const id = `exp_${Date.now()}`;
    exps.push({
      id,
      problem,
      context,
      solution,
      tags,
      useCount: 0,
      timestamp: Date.now(),
    });

    if (exps.length > MAX_PER_ACTION) {
      exps.sort((a, b) => {
        if (a.useCount !== b.useCount) return b.useCount - a.useCount;
        return b.timestamp - a.timestamp;
      });
      this.data.experiences[action] = exps.slice(0, MAX_PER_ACTION);
    }

    this._save();
    return { updated: false, id };
  }

  getAll() {
    const overview = {};
    for (const [action, exps] of Object.entries(this.data.experiences)) {
      overview[action] = {
        count: exps.length,
        experiences: exps.map((e) => ({
          id: e.id,
          problem: e.problem,
          solution: e.solution,
        })),
      };
    }
    return overview;
  }

  getByAction(action) {
    return (this.data.experiences[action] || []).map((e) => ({
      id: e.id,
      problem: e.problem,
      context: e.context,
      solution: e.solution,
      tags: e.tags,
      useCount: e.useCount,
    }));
  }

  _findSimilar(exps, problem) {
    const words = problem.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) return null;

    for (const exp of exps) {
      const expWords = exp.problem.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (expWords.length === 0) continue;
      const overlap = words.filter((w) => expWords.includes(w)).length;
      const ratio = overlap / Math.max(words.length, expWords.length);
      if (ratio > 0.5) return exp;
    }
    return null;
  }
}

module.exports = new ExperienceManager();
