function createDefaultMemoryDocument() {
  return {
    version: 1,
    landmarks: [],
    resources: [],
    tasks: { current: null, progress: null, updatedAt: null },
    facts: [],
  };
}

module.exports = { createDefaultMemoryDocument };
