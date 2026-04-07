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

function findNearestHostile(bot, range) {
  return bot.nearestEntity(
    (e) => e.type === 'mob' && HOSTILE_MOBS.has(e.name)
      && e.position.distanceTo(bot.entity.position) < range
  );
}

// Kill a single target, returns { killed, hits }
async function killTarget(bot, target, deadline) {
  let hits = 0;
  const { goals } = require('mineflayer-pathfinder');

  while (Date.now() < deadline) {
    if (!target.isValid || target.metadata === undefined) break;

    const dist = bot.entity.position.distanceTo(target.position);

    // Approach if too far
    if (dist > 3.0) {
      try {
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
        await sleep(300);
      } catch (_) {
        await bot.lookAt(target.position.offset(0, target.height || 1, 0));
        bot.setControlState('forward', true);
        bot.setControlState('sprint', true);
        await sleep(300);
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
      }
      continue;
    }

    // Attack
    try {
      await bot.lookAt(target.position.offset(0, target.height || 1, 0));
      await bot.attack(target);
      hits++;
    } catch (_) {
      break;
    }

    // Attack cooldown (~0.625s for sword)
    await sleep(550);
  }

  try { bot.pathfinder.stop(); } catch (_) {}
  const killed = !target.isValid || target.metadata === undefined;
  return { killed, hits };
}

function createHandleFight({ getBot }) {
  return async function handleFight(payload) {
    const bot = getBot();
    const maxTime = (payload && payload.maxTime) || 30;
    const continuous = (payload && payload.continuous) || false;
    const searchRange = (payload && payload.range) || (continuous ? 32 : 16);
    const deadline = Date.now() + maxTime * 1000;

    // 1. Find initial target
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
      target = findNearestHostile(bot, searchRange);
      if (!target) {
        throw new Error(`附近 ${searchRange} 格内没有敌对生物`);
      }
    }

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
      try { await bot.equip(shield, 'off-hand'); } catch (_) {}
    }

    // 4. Snapshot inventory BEFORE fight
    const dropsBefore = new Map();
    for (const item of bot.inventory.items()) {
      dropsBefore.set(item.name, (dropsBefore.get(item.name) || 0) + item.count);
    }

    const startHealth = bot.health;
    let totalHits = 0;
    let totalKills = 0;
    const killedMobs = [];

    // 5. Fight loop
    if (continuous) {
      // --- Continuous mode: keep fighting all hostiles until none left or timeout ---
      while (Date.now() < deadline) {
        if (!target) {
          target = findNearestHostile(bot, searchRange);
          if (!target) break; // No more hostiles
        }

        const mobName = target.name || 'unknown';
        const result = await killTarget(bot, target, deadline);
        totalHits += result.hits;

        if (result.killed) {
          totalKills++;
          killedMobs.push(mobName);
        }

        // Immediately find next target, no drop pickup delay
        target = findNearestHostile(bot, searchRange);
      }

      // Pick up drops at the end
      await sleep(500);

    } else {
      // --- Single target mode (original behavior) ---
      const result = await killTarget(bot, target, deadline);
      totalHits = result.hits;
      if (result.killed) {
        totalKills = 1;
        killedMobs.push(target.name || 'unknown');
      }

      // Wait for drops and pick up
      await sleep(800);
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
        } catch (_) {}
      }
      await sleep(500);
    }

    // 6. Calculate drops gained
    const newItems = [];
    for (const item of bot.inventory.items()) {
      const before = dropsBefore.get(item.name) || 0;
      if (item.count > before) {
        newItems.push(`${item.name} x${item.count - before}`);
      }
    }

    return {
      action: 'fight',
      continuous,
      target: continuous ? killedMobs.join(', ') : (killedMobs[0] || 'unknown'),
      killed: totalKills > 0,
      kills: totalKills,
      killedMobs,
      hits: totalHits,
      weapon: equippedWeapon,
      drops: newItems,
      healthBefore: startHealth,
      healthAfter: bot.health,
      foodAfter: bot.food,
    };
  };
}

module.exports = createHandleFight;
