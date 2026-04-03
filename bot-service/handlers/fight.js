const WEAPON_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe',
];

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
  'drowned', 'husk', 'stray', 'phantom', 'pillager', 'vindicator',
  'ravager', 'blaze', 'ghast', 'wither_skeleton', 'piglin_brute',
  'cave_spider', 'slime', 'magma_cube', 'hoglin', 'zoglin',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHandleFight({ getBot }) {
  return async function handleFight(payload) {
    const bot = getBot();
    const maxTime = (payload && payload.maxTime) || 30;
    const deadline = Date.now() + maxTime * 1000;

  // 1. Find target
  let target;
  if (payload && payload.target) {
    target = Object.values(bot.entities).find(
      (e) => e !== bot.entity && e.name === payload.target && e.position
        && e.position.distanceTo(bot.entity.position) < 32
    );
    if (!target) {
      throw new Error(`找不到目标 ${payload.target}（32 格内）。用 lookAround 确认附近有该生物`);
    }
  } else {
    // Auto-target nearest hostile
    target = bot.nearestEntity(
      (e) => e.type === 'mob' && HOSTILE_MOBS.has(e.name)
        && e.position.distanceTo(bot.entity.position) < 16
    );
    if (!target) {
      throw new Error('附近 16 格内没有敌对生物');
    }
  }

  const targetName = target.name || 'unknown';

  // 2. Auto-equip best weapon
  let equippedWeapon = '空手';
  const items = bot.inventory.items();
  for (const weaponName of WEAPON_PRIORITY) {
    const weapon = items.find((i) => i.name === weaponName);
    if (weapon) {
      await bot.equip(weapon, 'hand');
      equippedWeapon = weaponName;
      break;
    }
  }

  // 3. Equip shield if available
  const shield = items.find((i) => i.name === 'shield');
  if (shield) {
    try { await bot.equip(shield, 'off-hand'); } catch (_) { /* ignore */ }
  }

  // 4. Snapshot inventory BEFORE fight to detect drops later
  const dropsBefore = new Map();
  for (const item of bot.inventory.items()) {
    dropsBefore.set(item.name, (dropsBefore.get(item.name) || 0) + item.count);
  }

  // 5. Fight loop: approach + attack until dead or timeout
  let hits = 0;
  const startHealth = bot.health;

  while (Date.now() < deadline) {
    // Check if target is still alive
    if (!target.isValid || target.metadata === undefined) break;

    const dist = bot.entity.position.distanceTo(target.position);

    // Approach if too far (survival melee reach is ~3 blocks)
    if (dist > 3.0) {
      try {
        const { goals } = require('mineflayer-pathfinder');
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
        // Wait a bit for movement
        await sleep(500);
      } catch (_) {
        // Fallback: look at target and sprint
        await bot.lookAt(target.position.offset(0, target.height || 1, 0));
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        await sleep(400);
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
      }
      continue;
    }

    // Attack
    try {
      await bot.attack(target);
      hits++;
    } catch (_) {
      // Target might have died or moved
      break;
    }

    // Wait for attack cooldown (~0.625s for stone sword in MC 1.20)
    await sleep(650);
  }

  // Stop pathfinding
  try { bot.pathfinder.stop(); } catch (_) { /* ignore */ }

  // 6. Wait for drops and pick up
  await sleep(800); // wait for items to drop

  // Walk to where target died to pick up drops
  if (target.position) {
    try {
      const { goals } = require('mineflayer-pathfinder');
      bot.pathfinder.setGoal(new goals.GoalBlock(
        Math.floor(target.position.x),
        Math.floor(target.position.y),
        Math.floor(target.position.z)
      ));
      await sleep(1500);
      bot.pathfinder.stop();
    } catch (_) { /* ignore */ }
  }

  await sleep(500); // extra time for pickup

  // 7. Calculate drops gained by comparing inventory before vs after fight
  const newItems = [];
  for (const item of bot.inventory.items()) {
    const before = dropsBefore.get(item.name) || 0;
    if (item.count > before) {
      newItems.push(`${item.name} x${item.count - before}`);
    }
  }

  const killed = !target.isValid || target.metadata === undefined;

    return {
      action: 'fight',
      target: targetName,
      killed,
      hits,
      weapon: equippedWeapon,
      drops: newItems,
      healthBefore: startHealth,
      healthAfter: bot.health,
      foodAfter: bot.food,
    };
  };
}

module.exports = createHandleFight;
