const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const express = require('express');
const experienceManager = require('./experienceManager');
const memoryManager = require('./memoryManager');
const logger = require('./logger');
const { createBotContext } = require('./runtime/context');
const { createActionHandlers } = require('./handlers/createActionHandlers');
const { listBlueprints } = require('./handlers/build');
const recipeService = require('./services/recipeService');
const { createActionRegistry } = require('./services/actionRegistry');
const { createActionExecutor } = require('./services/actionExecutor');

const config = require('./config.json');

const MC_HOST = process.env.MC_HOST || 'localhost';
const MC_PORT = parseInt(process.env.MC_PORT || '18888');
const MC_VERSION = process.env.MC_VERSION || '1.20';
const BOT_USERNAME_BASE = process.env.BOT_USERNAME || 'QClaw';
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3001');

let bot = null;
let botGeneration = 0;
let currentUsername = BOT_USERNAME_BASE;
let isResetting = false;

function generateNewUsername() {
  if (!config.randomUsername) {
    currentUsername = BOT_USERNAME_BASE;
    return currentUsername;
  }
  botGeneration++;
  const ts = Date.now().toString(36).slice(-4);
  currentUsername = `${BOT_USERNAME_BASE}_${botGeneration}_${ts}`;
  return currentUsername;
}

function getBotUsername() {
  return currentUsername;
}
const botContext = createBotContext();
const actionHandlers = createActionHandlers(botContext);

// --- Death tracking for Meta Loop ---
const deathsSinceLastCheck = [];
let deathAckIndex = 0; // tracks how many deaths have been acknowledged


function recordDeath(deathInfo) {
  deathsSinceLastCheck.push(deathInfo);
  console.log(`[DEATH-TRACK] #${deathsSinceLastCheck.length}: ${deathInfo.cause} at ${JSON.stringify(deathInfo.position)}`);
}

function getUnacknowledgedDeaths() {
  const unacked = deathsSinceLastCheck.slice(deathAckIndex);
  return { count: unacked.length, totalDeaths: deathsSinceLastCheck.length, deaths: unacked };
}

function acknowledgeDeaths() {
  const unacked = deathsSinceLastCheck.slice(deathAckIndex);
  deathAckIndex = deathsSinceLastCheck.length;
  return { acknowledged: unacked.length };
}

// --- Kick loop detection ---
const kickTimestamps = [];

// --- Event Log (Layer 2) ---
const MAX_EVENTS = 200;
const eventLog = [];

function pushEvent(type, data) {
  const event = { time: Date.now(), type, ...data };
  eventLog.push(event);
  if (eventLog.length > MAX_EVENTS) eventLog.shift();
  console.log(`[EVENT] ${type} ${JSON.stringify(data || {})}`);
}

// =============================================
// === REFLEX LAYER (System 1: 自动反射) ===
// =============================================

// --- Global mutex flags ---
let isEating = false;
let reflexActive = false;
let isExecuting = false;
let spawnStabilizing = true; // Block reflex actions until spawn is stable
let isSheltering = false;
let lastAteAt = 0;
const EAT_COOLDOWN = 10000; // 10s cooldown

// --- Hostile mob set ---
const HOSTILE_MOBS_REFLEX = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'witch', 'pillager', 'vindicator', 'phantom', 'drowned', 'husk', 'stray',
  'slime', 'magma_cube', 'blaze', 'ghast', 'ravager', 'evoker', 'vex',
  'warden', 'elder_guardian', 'guardian', 'silverfish', 'zombie_villager',
]);

// --- Weapon priority ---
const WEAPON_PRIORITY_REFLEX = [
  'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe',
];

// --- Food priority (by saturation) ---
const FOOD_PRIORITY_REFLEX = [
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato',
  'golden_carrot', 'golden_apple', 'carrot', 'apple', 'melon_slice',
  'sweet_berries', 'potato', 'beetroot', 'cookie', 'pumpkin_pie',
];

function getBestWeapon() {
  if (!bot) return null;
  const items = bot.inventory.items();
  for (const name of WEAPON_PRIORITY_REFLEX) {
    const item = items.find((i) => i.name === name);
    if (item) return item;
  }
  return null;
}

// --- Auto-Defense ---
// Safe flee direction: guards against NaN from zero-length vector normalize()
function safeFleeDir(botPos, attackerPos) {
  const dir = botPos.minus(attackerPos);
  if (dir.norm() < 0.01) {
    // Attacker at same position — pick a random horizontal direction
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
  }
  return dir.normalize();
}

async function autoDefense(attacker) {
  if (spawnStabilizing || reflexActive || isExecuting) return;
  if (!attacker || !attacker.position || !bot || !bot.entity) return;
  reflexActive = true;
  try {
    // Clear all movement states first to prevent sprint+knockback amplification
    try { bot.clearControlStates(); } catch (_) {}

    // Wait for knockback to settle before taking action
    await new Promise((r) => setTimeout(r, 300));
    if (!bot || !bot.entity) return;

    // Creeper: ALWAYS flee
    if (attacker.name === 'creeper') {
      const dir = safeFleeDir(bot.entity.position, attacker.position);
      const fleeTarget = bot.entity.position.plus(dir.scaled(20));
      try {
        const { goals: g } = require('mineflayer-pathfinder');
        bot.pathfinder.setGoal(new g.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3));
      } catch (_) {}
      bot.setControlState('sprint', true);
      setTimeout(() => { if (bot) bot.setControlState('sprint', false); }, 5000);
      console.log(`[REFLEX] Fleeing from creeper!`);
      pushEvent('reflex_flee', { from: 'creeper', health: bot.health });
      logger.logEvent('reflex_flee', { from: 'creeper', health: bot.health });
      return;
    }

    const weapon = getBestWeapon();
    if (bot.health > 6 && weapon) {
      // FIGHT
      await bot.equip(weapon, 'hand');
      // Attack loop: hit until target dies or out of range
      for (let i = 0; i < 10; i++) {
        if (!attacker.isValid) break;
        try {
          const dist = bot.entity.position.distanceTo(attacker.position);
          if (dist > 6) break;
          await bot.attack(attacker);
        } catch (_) { break; }
        await new Promise((r) => setTimeout(r, 600));
      }
      console.log(`[REFLEX] Fought ${attacker.name} with ${weapon.name}`);
      pushEvent('reflex_fight', { target: attacker.name, weapon: weapon.name, healthAfter: bot.health });
      logger.logEvent('reflex_fight', { target: attacker.name, weapon: weapon.name, healthAfter: bot.health });
    } else {
      // FLEE
      const dir = safeFleeDir(bot.entity.position, attacker.position);
      const fleeTarget = bot.entity.position.plus(dir.scaled(20));
      try {
        const { goals: g } = require('mineflayer-pathfinder');
        bot.pathfinder.setGoal(new g.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3));
      } catch (_) {}
      bot.setControlState('sprint', true);
      setTimeout(() => { if (bot) bot.setControlState('sprint', false); }, 5000);
      console.log(`[REFLEX] Fleeing from ${attacker.name} (HP: ${bot.health})`);
      pushEvent('reflex_flee', { from: attacker.name, health: bot.health });
      logger.logEvent('reflex_flee', { from: attacker.name, health: bot.health });
    }
  } catch (e) {
    console.log(`[REFLEX] Defense error: ${e.message}`);
  }
  // Cooldown
  setTimeout(() => { reflexActive = false; }, 2000);
}

// --- Auto-Eat ---
async function tryAutoEat() {
  if (spawnStabilizing || isEating || isExecuting || reflexActive || !bot || !bot.entity) return;
  if (bot.food >= 14) return;
  if (Date.now() - lastAteAt < EAT_COOLDOWN) return;

  const foodItem = FOOD_PRIORITY_REFLEX
    .map((name) => bot.inventory.items().find((i) => i.name === name))
    .find(Boolean);
  if (!foodItem) return;

  isEating = true;
  try {
    await bot.equip(foodItem, 'hand');
    await bot.consume();
    lastAteAt = Date.now();
    console.log(`[REFLEX] Auto-ate ${foodItem.name}, food: ${bot.food}/20`);
    pushEvent('auto_eat', { food: foodItem.name, health: bot.health, foodLevel: bot.food });
    logger.logEvent('auto_eat', { food: foodItem.name, health: bot.health, foodLevel: bot.food });
  } catch (e) {
    console.log(`[REFLEX] Auto-eat failed: ${e.message}`);
  } finally {
    isEating = false;
  }
}

// --- Auto-Shelter ---
async function tryAutoShelter() {
  if (isSheltering || isExecuting || reflexActive || isEating || !bot || !bot.entity) return;

  const time = bot.time?.timeOfDay;
  const isNight = time > 13000 && time < 23000;
  if (!isNight) return;
  if (bot.health >= 10) return;

  // Check nearby hostile
  const hasHostile = Object.values(bot.entities).some((e) => {
    if (!HOSTILE_MOBS_REFLEX.has(e.name)) return false;
    try { return e.position.distanceTo(bot.entity.position) < 10; } catch { return false; }
  });
  if (!hasHostile) return;

  // Only shelter if no weapon (otherwise auto-defense handles it)
  if (getBestWeapon()) return;

  isSheltering = true;
  try {
    console.log(`[REFLEX] Auto-shelter: night + hostile + low HP + no weapon`);
    pushEvent('auto_shelter', { health: bot.health, time });
    logger.logEvent('auto_shelter', { health: bot.health, time });

    const { Vec3 } = require('vec3');
    const start = bot.entity.position.floored();

    // Dig down 3-4 blocks
    for (let i = 1; i <= 4; i++) {
      const b = bot.blockAt(start.offset(0, -i, 0));
      if (b && b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && bot.canDigBlock(b)) {
        await bot.dig(b).catch(() => {});
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Seal the top with any block
    const sealItem = bot.inventory.items().find((i) =>
      ['dirt', 'cobblestone', 'stone', 'gravel', 'sand', 'oak_planks', 'spruce_planks', 'birch_planks'].includes(i.name)
    );
    if (sealItem) {
      await bot.equip(sealItem, 'hand');
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const wallRef = bot.blockAt(new Vec3(start.x + dx, start.y, start.z + dz));
        if (wallRef && wallRef.name !== 'air' && wallRef.name !== 'water') {
          try {
            await bot.placeBlock(wallRef, new Vec3(-dx, 0, -dz));
            console.log(`[REFLEX] Sealed shelter`);
            break;
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    console.log(`[REFLEX] Auto-shelter error: ${e.message}`);
  } finally {
    isSheltering = false;
  }
}

function createBot() {
  const username = getBotUsername();
  console.log(`Connecting to Minecraft server ${MC_HOST}:${MC_PORT} as ${username} (gen #${botGeneration})...`);
  botContext.clearFollowInterval();

  bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: username,
    version: MC_VERSION,
  });
  botContext.setBot(bot);

  bot.loadPlugin(pathfinder);

  bot.on('spawn', () => {
    console.log('[SPAWN] spawn event fired');
    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);

    // Wait for server to sync before doing anything
    // invalid_player_movement kicks happen when bot acts too soon after spawn
    tickFrozen = false; // assume tick is running normally on spawn
    spawnStabilizing = true; // Block reflex actions during stabilization
    setTimeout(() => {
      if (bot && bot.entity) {
        // Stop any pathfinding to prevent invalid movement
        try { bot.pathfinder.stop(); } catch (_) {}
        try { bot.clearControlStates(); } catch (_) {}
        spawnStabilizing = false;
        console.log('[SPAWN] Stabilized after 4s delay, reflex enabled');
      }
    }, 4000);

    pushEvent('spawn', { position: bot.entity.position });
    logger.logSpawn({ position: bot.entity.position, health: bot.health, food: bot.food });
  });

  // --- NaN/Infinity safety net on every physics tick ---
  let lastGoodPos = null;
  bot.on('physicsTick', () => {
    if (!bot || !bot.entity) return;
    const pos = bot.entity.position;
    const vel = bot.entity.velocity;
    const posNaN = isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z) ||
        !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z);
    const velNaN = isNaN(vel.x) || isNaN(vel.y) || isNaN(vel.z) ||
        !isFinite(vel.x) || !isFinite(vel.y) || !isFinite(vel.z);
    if (posNaN) {
      if (lastGoodPos) {
        console.log(`[NaN-GUARD] Position NaN! Restoring to (${lastGoodPos.x.toFixed(1)}, ${lastGoodPos.y.toFixed(1)}, ${lastGoodPos.z.toFixed(1)})`);
        pos.set(lastGoodPos.x, lastGoodPos.y, lastGoodPos.z);
      } else {
        console.log(`[NaN-GUARD] Position NaN but no backup! Cannot restore.`);
      }
      vel.set(0, 0, 0);
    } else if (velNaN) {
      console.log(`[NaN-GUARD] Velocity NaN! Resetting to zero.`);
      vel.set(0, 0, 0);
    } else {
      // Save last good position
      lastGoodPos = { x: pos.x, y: pos.y, z: pos.z };
    }
  });

  // --- Clamp extreme entity_velocity packets ---
  bot._client.on('entity_velocity', (packet) => {
    if (!bot || !bot.entity || packet.entityId !== bot.entity.id) return;
    const vel = packet.velocity;
    if (!vel) return;
    const raw = [vel.x, vel.y, vel.z];
    // vec3i16 units: 1/8000 block/tick. >80000 = >10 blocks/tick — unreasonable
    if (raw.some(v => v === undefined || isNaN(v) || !isFinite(v) || Math.abs(v) > 80000)) {
      console.log(`[VELOCITY-GUARD] Extreme velocity clamped:`, raw);
      vel.x = 0;
      vel.y = 0;
      vel.z = 0;
    }
  });

  bot.on('chat', (username, message) => {
    logger.logChat(username, message);
    if (username !== bot.username) {
      console.log(`[CHAT] <${username}> ${message}`);
    }
  });

  // --- Death detection via protocol packet (precise death cause) ---
  // Mineflayer's bot.on('death') doesn't fire reliably and carries no cause info.
  // The Minecraft protocol sends 'death_combat_event' with the exact death message.
  bot._client.on('death_combat_event', (packet) => {
    try {
      const death = parseDeathMessage(packet.message);
      console.log(`[DEATH] ${death.readable} (${death.raw})`);

      const deathPos = bot.entity ? bot.entity.position : null;
      const posStr = deathPos
        ? `(${Math.round(deathPos.x)}, ${Math.round(deathPos.y)}, ${Math.round(deathPos.z)})`
        : '未知';
      const inventoryLost = bot.inventory ? bot.inventory.items().length : 0;
      const recentActions = actionLogs.slice(-3).map((l) =>
        `${l.type}${l.success ? '' : '(FAIL: ' + l.error + ')'}`
      );

      pushEvent('death', { position: deathPos, cause: death.readable, raw: death.raw });

      recordDeath({
        time: Date.now(),
        position: deathPos ? { x: Math.round(deathPos.x), y: Math.round(deathPos.y), z: Math.round(deathPos.z) } : null,
        cause: death.readable,
        rawCause: death.raw,
        entities: death.entities,
        recentActions,
        inventoryLost,
      });

      experienceManager.add('_death', death.readable,
        `位置: ${posStr}。最近动作: ${recentActions.join(' → ') || '无'}`,
        `死因: ${death.readable}。需要根据死因调整生存策略`,
        ['death', ...death.entities]);

      logger.logDeath({ position: posStr, cause: death.readable, raw: death.raw });
    } catch (e) {
      console.log(`[DEATH] Error processing death_combat_event: ${e.message}`);
      try {
        recordDeath({ time: Date.now(), position: null, cause: 'unknown (parse error)', recentActions: [], inventoryLost: 0 });
      } catch (_) {}
    }
  });

  // Helper: parse Minecraft death message from chat component JSON
  function parseDeathMessage(component) {
    if (typeof component === 'string') {
      try { component = JSON.parse(component); } catch (_) { return { raw: component, translate: '', entities: [] }; }
    }

    const translate = component.translate || '';
    const entities = [];

    // Extract entity names from 'with' array
    if (component.with) {
      for (const part of component.with) {
        if (typeof part === 'string') {
          entities.push(part);
        } else if (part && part.text) {
          entities.push(part.text);
        } else if (part && part.translate) {
          // Entity type like "entity.minecraft.zombie"
          entities.push(part.translate.replace('entity.minecraft.', ''));
        }
      }
    }

    // Build readable death message
    const DEATH_MESSAGES = {
      'death.attack.mob': (e) => `被 ${e[1] || '怪物'} 杀死`,
      'death.attack.player': (e) => `被玩家 ${e[1] || '?'} 杀死`,
      'death.attack.arrow': (e) => `被 ${e[1] || '?'} 射杀`,
      'death.attack.genericKill': () => '被 /kill 命令杀死',
      'death.attack.explosion': () => '被爆炸炸死',
      'death.attack.explosion.player': (e) => `被 ${e[1] || '?'} 炸死`,
      'death.fell.accident.generic': () => '从高处摔死',
      'death.attack.fall': () => '摔死',
      'death.attack.drown': () => '淹死',
      'death.attack.starve': () => '饿死',
      'death.attack.lava': () => '被岩浆烧死',
      'death.attack.inFire': () => '被火烧死',
      'death.attack.onFire': () => '被烧死',
      'death.attack.cactus': () => '被仙人掌扎死',
      'death.attack.sweetBerryBush': () => '被甜浆果灌木扎死',
      'death.attack.sting': () => '被蜜蜂蛰死',
      'death.attack.magic': () => '被魔法杀死',
      'death.attack.wither': () => '被凋零效果杀死',
      'death.attack.cramming': () => '被挤死',
      'death.attack.outOfWorld': () => '掉出了世界',
    };

    const formatter = DEATH_MESSAGES[translate];
    const readable = formatter ? formatter(entities) : `${translate || '未知死因'} (${entities.join(', ')})`;

    return { raw: translate, readable, entities };
  }

  // Auto-respawn on death (keep bot.on('death') just for respawn)
  bot.on('death', () => {
    setTimeout(() => {
      if (bot) {
        try {
          bot.respawn();
          console.log('[BOT] Auto-respawned');
        } catch (e) {
          console.log(`[BOT] Respawn failed: ${e.message}`);
        }
      }
    }, 1000);
  });

  // Layer 1: Monitor health for auto-eat and danger alerts
  bot.on('health', () => {
    const h = bot.health;
    const f = bot.food;

    if (h <= 5 && h > 0) {
      pushEvent('health_critical', { health: h, food: f });
      logger.logEvent('health_critical', { health: h, food: f });
    }
    if (f <= 6) {
      pushEvent('food_low', { health: h, food: f });
      logger.logEvent('food_low', { health: h, food: f });
      tryAutoEat();
    }
  });

  // === REFLEX LAYER REGISTRATION ===

  // Passive defense: when bot gets hurt, find attacker and respond
  bot.on('entityHurt', (entity) => {
    if (entity !== bot.entity) return;
    const attacker = Object.values(bot.entities).find((e) =>
      e !== bot.entity && e.type === 'mob' && e.position
      && e.position.distanceTo(bot.entity.position) < 6
    );
    if (attacker && HOSTILE_MOBS_REFLEX.has(attacker.name)) {
      autoDefense(attacker);
    }
  });

  // Proactive defense: check for nearby hostiles every 500ms
  setInterval(() => {
    if (reflexActive || isExecuting || !bot || !bot.entity) return;
    let nearest = null;
    let nearestDist = 5;
    for (const e of Object.values(bot.entities)) {
      if (!HOSTILE_MOBS_REFLEX.has(e.name) || !e.position) continue;
      try {
        const dist = e.position.distanceTo(bot.entity.position);
        if (dist < nearestDist) {
          nearest = e;
          nearestDist = dist;
        }
      } catch (_) {}
    }
    if (nearest) autoDefense(nearest);
  }, 500);

  // Auto-eat: check every 5 seconds
  setInterval(() => { tryAutoEat(); }, 5000);

  // Auto-shelter: check every 10 seconds
  setInterval(() => { tryAutoShelter(); }, 10000);

  bot.on('error', (err) => {
    console.log(`[BOT] Error: ${err.message}`);
    logger.logConnection('error', err.message);
  });

  bot.on('end', (reason) => {
    botContext.clearFollowInterval();
    botContext.setBot(null);
    bot = null;
    logger.logConnection('disconnected', reason);

    // Don't auto-reconnect during reset (reset will call createBot itself)
    if (isResetting) {
      console.log(`[BOT] Disconnected during reset — not auto-reconnecting`);
      return;
    }

    // Kick loop detection: if kicked too many times in 60s, stop reconnecting
    const now = Date.now();
    kickTimestamps.push(now);
    while (kickTimestamps.length > 0 && kickTimestamps[0] < now - 60000) kickTimestamps.shift();

    if (kickTimestamps.length >= 4) {
      kickTimestamps.length = 0;

      // Auto-reset with new identity to break out of kick loop
      const newName = generateNewUsername();
      console.log(`[BOT] KICK LOOP DETECTED — auto-resetting as ${newName} (gen #${botGeneration})`);
      logger.logConnection('kick_loop_reset', `Auto-reset to ${newName}`);

      // Clear state for fresh start
      eventLog.length = 0;
      actionLogs.length = 0;
      deathsSinceLastCheck.length = 0;
      deathAckIndex = 0;
      currentReport = null;
      actionsSinceReport = 0;
      memoryManager.clearAll();

      setTimeout(createBot, 5000);
      return;
    }

    console.log(`[BOT] Disconnected: ${reason}. Reconnecting in 5 seconds...`);
    setTimeout(createBot, 5000);
  });

  bot.on('kicked', (reason) => {
    console.log(`[BOT] Kicked: ${reason}`);
    logger.logConnection('kicked', reason);
  });
}

// --- HTTP API ---

const app = express();
app.use(express.json());

app.get('/blueprints', (req, res) => {
  res.json(listBlueprints());
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    botConnected: bot !== null && bot.entity !== undefined,
    username: getBotUsername(),
    generation: botGeneration,
  });
});

// Event log endpoint (Layer 2)
app.get('/events', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const filtered = since ? eventLog.filter((e) => e.time > since) : eventLog;
  res.json({ events: filtered, serverTime: Date.now() });
});

app.get('/state', (req, res) => {
  if (!bot || !bot.entity) {
    return res.status(503).json({ error: 'Bot not connected' });
  }
  // Freeze game while AI thinks
  tickFreeze();

  const heldItem = bot.heldItem;
  // Inventory summary for dashboard
  const items = bot.inventory.items();
  const inventory = items.map(i => ({ name: i.name, count: i.count }));
  const inventoryUsed = items.length;
  const inventoryTotal = bot.inventory.slots.length - 9; // exclude armor + crafting slots

  // Nearby threats (hostile mobs within 16 blocks)
  const nearbyThreats = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.type === 'mob' && e.position
      && e.position.distanceTo(bot.entity.position) < 16
      && ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
          'drowned', 'husk', 'stray', 'phantom', 'pillager', 'vindicator',
          'ravager', 'blaze', 'ghast', 'wither_skeleton', 'piglin_brute',
          'cave_spider', 'slime', 'magma_cube', 'hoglin', 'zoglin',
         ].includes(e.name))
    .map((e) => ({
      name: e.name,
      distance: parseFloat(e.position.distanceTo(bot.entity.position).toFixed(1)),
      position: { x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z) },
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);

  const stateData = {
    position: bot.entity.position,
    health: bot.health,
    food: bot.food,
    gameMode: bot.game.gameMode,
    heldItem: heldItem ? { name: heldItem.name, count: heldItem.count } : null,
    inventory,
    inventoryUsed,
    inventoryTotal,
    nearbyThreats,
    tickFrozen,
    memory: memoryManager.getSummaryForState(bot.entity.position),
    deathLessons: experienceManager.getByAction('_death'),
    deathsSinceLastCheck: getUnacknowledgedDeaths(),
  };

  logger.logState({
    position: stateData.position,
    health: stateData.health,
    food: stateData.food,
    heldItem: stateData.heldItem,
    inventoryUsed: stateData.inventoryUsed,
    nearbyThreats: stateData.nearbyThreats,
  });

  res.json(stateData);
});

app.get('/recipe', (req, res) => {
  const itemName = req.query.item;
  if (!itemName) {
    return res.status(400).json({ error: 'Missing ?item= parameter' });
  }

  const maxDepth = parseInt(req.query.depth) || 10;

  if (!recipeService.hasRecipeItem(itemName)) {
    const suggestions = recipeService.getSuggestions(itemName);
    return res.status(404).json({
      error: `Unknown item: ${itemName}`,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    });
  }

  res.json(recipeService.getRecipeTree(itemName, maxDepth));
});

// --- Experience API ---

app.get('/experience', (req, res) => {
  const action = req.query.action;
  const error = req.query.error;

  if (action) {
    if (error) {
      const results = experienceManager.findRelevant(action, error);
      res.json({ action, experiences: results, total: results.length });
    } else {
      const results = experienceManager.getByAction(action);
      res.json({ action, experiences: results, total: results.length });
    }
  } else {
    res.json(experienceManager.getAll());
  }
});

app.post('/experience', (req, res) => {
  const { action, problem, context, solution, tags } = req.body;

  if (!action || !problem || !solution) {
    return res.status(400).json({ error: 'Missing required fields: action, problem, solution' });
  }

  const result = experienceManager.add(action, problem, context || '', solution, tags || []);

  console.log(`[EXPERIENCE] ${result.updated ? 'Updated' : 'Added'} ${result.id} for action=${action}`);
  res.json({ success: true, id: result.id, updated: result.updated });
});

// --- Memory API ---

app.get('/memory', (req, res) => {
  const type = req.query.type;
  if (type) {
    return res.json(memoryManager.getByType(type));
  }
  res.json(memoryManager.getAll());
});

app.post('/memory', (req, res) => {
  const { type, data } = req.body;

  if (!type || !data) {
    return res.status(400).json({ error: 'Missing required fields: type, data' });
  }

  let result;
  switch (type) {
    case 'landmark':
      result = memoryManager.addLandmark(data.type, data.position, data.meta || {});
      break;
    case 'resource':
      result = memoryManager.addResource(data.type, data.area, data.count || 0);
      break;
    case 'task':
      memoryManager.updateTask(data.current, data.progress);
      result = { success: true };
      break;
    case 'fact':
      result = memoryManager.addFact(data.key, data.value, data.note || '');
      break;
    default:
      return res.status(400).json({ error: `Unknown memory type: ${type}` });
  }

  console.log(`[MEMORY] Added ${type}: ${JSON.stringify(data)}`);
  res.json({ success: true, ...result });
});

app.delete('/memory/:id', (req, res) => {
  const removed = memoryManager.remove(req.params.id);
  if (removed) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Memory not found' });
  }
});

app.delete('/memory', (req, res) => {
  memoryManager.clearAll();
  console.log('[MEMORY] All memories cleared');
  res.json({ success: true, message: 'All memories cleared' });
});

// --- Tick Freeze/Unfreeze (Carpet Mod) ---
let tickFrozen = false;
let tickWatchdog = null;
const TICK_WATCHDOG_TIMEOUT = 60000; // 60s auto-unfreeze if no API calls

function tickFreeze() {
  // Disabled: tick freeze causes invalid_player_movement kicks
  // The position desync from freeze/unfreeze is worse than the benefit
}

function tickUnfreeze() {
  // Disabled: see tickFreeze
}

function resetTickWatchdog() {
  clearTickWatchdog();
  tickWatchdog = setTimeout(() => {
    if (tickFrozen) {
      console.log('[TICK] Watchdog triggered — auto-unfreezing after 60s inactivity');
      tickUnfreeze();
    }
  }, TICK_WATCHDOG_TIMEOUT);
}

function clearTickWatchdog() {
  if (tickWatchdog) {
    clearTimeout(tickWatchdog);
    tickWatchdog = null;
  }
}

// Tick control API
app.get('/tick', (req, res) => {
  res.json({ frozen: tickFrozen });
});

app.post('/tick/freeze', (req, res) => {
  tickFreeze();
  res.json({ success: true, frozen: true });
});

app.post('/tick/unfreeze', (req, res) => {
  tickUnfreeze();
  res.json({ success: true, frozen: false });
});

// --- In-game progress reporting ---

const actionLogs = [];
const MAX_LOGS = 100;
let currentReport = null;
let actionsSinceReport = 0;
function appendActionLog(entry) {
  actionLogs.push(entry);
  if (actionLogs.length > MAX_LOGS) actionLogs.shift();
}

function incrementActionsSinceReport() {
  actionsSinceReport += 1;
}

const actionRegistry = createActionRegistry({
  actionHandlers,
  memoryManager,
  getBot: () => botContext.getBot(),
});

const actionExecutor = createActionExecutor({
  getBot: () => botContext.getBot(),
  actionRegistry,
  logger,
  experienceManager,
  tickFreeze,
  tickUnfreeze,
  appendActionLog,
  getActionsSinceReport: () => actionsSinceReport,
  incrementActionsSinceReport,
  setIsExecuting: (value) => {
    isExecuting = value;
  },
  getDeathCount: () => deathsSinceLastCheck.length,
});

app.post('/action', async (req, res) => {
  const { type, payload } = req.body;
  console.log(`[ACTION] >>> type=${type} payload=${JSON.stringify(payload || {})}`);
  const response = await actionExecutor.execute({ type, payload });
  res.status(response.statusCode).json(response.body);
});

// --- Report & Logs API ---

app.post('/report', (req, res) => {
  currentReport = { ...req.body, timestamp: Date.now() };
  actionsSinceReport = 0;
  console.log(`[REPORT] ${currentReport.plan || ''} | ${currentReport.currentStep || ''}`);
  logger.logReport({ plan: currentReport.plan, currentStep: currentReport.currentStep, reasoning: currentReport.reasoning, nextStep: currentReport.nextStep });
  res.json({ success: true });
});

app.get('/report', (req, res) => {
  res.json(currentReport || { plan: null, currentStep: null, reasoning: null, nextStep: null });
});

app.get('/logs', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const filtered = since ? actionLogs.filter((l) => l.time > since) : actionLogs;
  res.json({ logs: filtered, total: filtered.length });
});

// --- Death acknowledgment API ---

app.post('/deaths/ack', (req, res) => {
  const result = acknowledgeDeaths();
  console.log(`[DEATH-TRACK] Acknowledged ${result.acknowledged} deaths`);
  res.json({ success: true, ...result });
});

// --- Reset API (Meta Loop: new game with fresh identity) ---

app.post('/reset', (req, res) => {
  // Generate new unique username
  const newUsername = generateNewUsername();

  console.log(`[RESET] Meta Loop reset — new game as ${newUsername} (gen #${botGeneration})`);
  isResetting = true;

  // Clear all in-memory state
  eventLog.length = 0;
  actionLogs.length = 0;
  deathsSinceLastCheck.length = 0;
  deathAckIndex = 0;
  currentReport = null;
  actionsSinceReport = 0;
  memoryManager.clearAll();

  // Unfreeze tick if frozen
  if (tickFrozen) {
    tickUnfreeze();
  }

  // Disconnect old bot and reconnect with new username (truly fresh player)
  if (bot) {
    try { bot.quit(); } catch (_) {}
  }
  botContext.clearFollowInterval();
  botContext.setBot(null);
  bot = null;

  // Reconnect with new identity after a short delay
  setTimeout(() => {
    isResetting = false;
    kickTimestamps.length = 0; // clear kick history for fresh start
    createBot();
  }, 3000);

  logger.logConnection('reset', `New game as ${newUsername} (gen #${botGeneration})`);

  res.json({
    success: true,
    message: `Bot reset. New identity: ${newUsername} (generation #${botGeneration})`,
    username: newUsername,
    generation: botGeneration,
  });
});

// --- Dashboard ---

const path = require('path');
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// Start
app.listen(HTTP_PORT, () => {
  console.log(`HTTP API listening on port ${HTTP_PORT}`);
  console.log(`Dashboard: http://localhost:${HTTP_PORT}/dashboard`);
  createBot();
});
