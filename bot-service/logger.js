const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'data', 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10); // 2026-03-31
  return path.join(LOG_DIR, `${date}.jsonl`);
}

function log(category, data) {
  const entry = {
    time: new Date().toISOString(),
    cat: category,
    ...data,
  };

  const line = JSON.stringify(entry) + '\n';

  try {
    fs.appendFileSync(getLogFile(), line);
  } catch (e) {
    console.error(`[LOGGER] Failed to write log: ${e.message}`);
  }
}

// --- Convenience methods ---

function logAction(type, payload, result, success, error, duration) {
  const entry = { type, payload };
  if (success) {
    entry.success = true;
    entry.result = result;
  } else {
    entry.success = false;
    entry.error = error;
  }
  if (duration) entry.duration = duration;
  log('action', entry);
}

function logActionBlocked(type, reason, details) {
  log('action_blocked', { type, reason, ...details });
}

function logReport(report) {
  log('report', report);
}

function logEvent(type, data) {
  log('event', { type, ...data });
}

function logChat(username, message) {
  log('chat', { username, message });
}

function logState(state) {
  log('state', state);
}

function logTick(action, reason) {
  log('tick', { action, reason });
}

function logMemory(operation, data) {
  log('memory', { operation, ...data });
}

function logExperience(operation, data) {
  log('experience', { operation, ...data });
}

function logDeath(data) {
  log('death', data);
}

function logSpawn(data) {
  log('spawn', data);
}

function logConnection(status, detail) {
  log('connection', { status, detail });
}

module.exports = {
  log,
  logAction,
  logActionBlocked,
  logReport,
  logEvent,
  logChat,
  logState,
  logTick,
  logMemory,
  logExperience,
  logDeath,
  logSpawn,
  logConnection,
};
