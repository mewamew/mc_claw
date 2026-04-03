const { gotoNear } = require('../primitives/navigation');
const { equipBestTool } = require('../primitives/tools');

/**
 * Block-to-drop name mapping for common blocks whose drop name differs
 * from the block name. Used to verify collection in inventory.
 */
const BLOCK_DROP_MAP = {
  stone: 'cobblestone',
  coal_ore: 'coal',
  deepslate_coal_ore: 'coal',
  iron_ore: 'raw_iron',
  deepslate_iron_ore: 'raw_iron',
  gold_ore: 'raw_gold',
  deepslate_gold_ore: 'raw_gold',
  copper_ore: 'raw_copper',
  deepslate_copper_ore: 'raw_copper',
  diamond_ore: 'diamond',
  deepslate_diamond_ore: 'diamond',
  emerald_ore: 'emerald',
  deepslate_emerald_ore: 'emerald',
  lapis_ore: 'lapis_lazuli',
  deepslate_lapis_ore: 'lapis_lazuli',
  redstone_ore: 'redstone',
  deepslate_redstone_ore: 'redstone',
  nether_gold_ore: 'gold_nugget',
  nether_quartz_ore: 'quartz',
  glowstone: 'glowstone_dust',
  sea_lantern: 'prismarine_crystals',
  melon: 'melon_slice',
  grass_block: 'dirt',
  tall_grass: 'wheat_seeds',
  short_grass: 'wheat_seeds',
};

/**
 * Navigate to a position with proper listener cleanup and timeout.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} reach      - How close to get (GoalNear range)
 * @param {number} timeoutMs  - Max milliseconds to wait
 * @returns {Promise<boolean>} true if goal was reached, false if timed out
 * @throws {Error} if no path exists
 */
async function navigateTo(bot, x, y, z, reach, timeoutMs) {
  const result = await gotoNear(bot, { x, y, z }, {
    reach,
    timeoutMs,
    noPathMessage: `No path to ${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`,
    softTimeout: true,
  });
  return result.reached;
}

/**
 * Equip the best harvest tool for the given block from the bot's inventory.
 * Falls back to bare hand if nothing suitable is found.
 *
 * @param {Object} block - The Mineflayer block object to be mined
 */
/**
 * Try to collect a nearby dropped item by walking to it.
 * Skips navigation if the item is already within auto-pickup range (~1 block).
 *
 * @param {number} timeoutMs - Max milliseconds to spend collecting
 */
async function collectNearbyDrop(bot, blockPos, timeoutMs) {
  // Wait for the item entity to spawn and gravity to settle
  await new Promise((r) => setTimeout(r, 600));

  // Strategy 1: Check if any dropped item is within auto-pickup range already
  const nearItem = bot.nearestEntity((e) =>
    (e.type === 'object' || e.type === 'other') &&
    e.name === 'item' &&
    e.position.distanceTo(bot.entity.position) < 2.5
  );
  if (nearItem) {
    // Already close enough for auto-pickup, just wait
    await new Promise((r) => setTimeout(r, 400));
    return;
  }

  // Strategy 2: Find the actual dropped item entity and walk to IT (not the block position)
  // The item may have fallen below the mined block
  const droppedItem = bot.nearestEntity((e) =>
    (e.type === 'object' || e.type === 'other') &&
    e.name === 'item' &&
    e.position.distanceTo(blockPos) < 6
  );

  if (droppedItem) {
    try {
      await navigateTo(bot, droppedItem.position.x, droppedItem.position.y, droppedItem.position.z, 0, timeoutMs);
    } catch (_) {
      // Can't reach the item — try the block position as fallback
    }
    await new Promise((r) => setTimeout(r, 400));
    return;
  }

  // Strategy 3: Fallback — walk to block position (works for surface mining)
  const dist = bot.entity.position.distanceTo(blockPos);
  if (dist > 1.5) {
    try {
      await navigateTo(bot, blockPos.x, blockPos.y, blockPos.z, 1, timeoutMs);
    } catch (_) {}
  }

  await new Promise((r) => setTimeout(r, 400));
}

/**
 * Get names that could appear in inventory after mining a given block.
 *
 * @param {string} blockName
 * @returns {string[]} Possible drop item names
 */
function getExpectedDropNames(blockName) {
  const names = [blockName];
  const mapped = BLOCK_DROP_MAP[blockName];
  if (mapped) names.push(mapped);
  return names;
}

/**
 * Snapshot relevant inventory counts for the given block/drop names.
 *
 * @param {string[]} names - Item names to check
 * @returns {Object.<string, number>} name -> count
 */
function countInventory(bot, names) {
  const counts = {};
  for (const item of bot.inventory.items()) {
    if (names.includes(item.name)) {
      counts[item.name] = (counts[item.name] || 0) + item.count;
    }
  }
  return counts;
}

/**
 * Improved findAndCollect action handler.
 *
 * Improvements over the original:
 *   1. Batch block finding -- finds up to 100 blocks at once, sorted by distance
 *   2. Auto-equips the best tool before mining each block
 *   3. Smarter drop collection with auto-pickup detection
 *   4. Proper event listener cleanup (no leaked listeners on timeout)
 *   5. Detailed result with failed count and post-action inventory snapshot
 *   6. Graceful skip on unreachable blocks instead of aborting the whole task
 *
 * @param {Object} payload
 * @param {string}  payload.blockName  - Block to find and mine (e.g. "oak_log", "iron_ore")
 * @param {number}  [payload.count=1]  - How many blocks to collect
 * @param {number}  [payload.maxDistance=64] - Search radius in blocks
 * @returns {Object} Result summary
 */
function createHandleFindAndCollect({ getBot }) {
  return async function handleFindAndCollect(payload) {
    const bot = getBot();
    const mcData = require('minecraft-data')(bot.version);
    const { blockName, count, maxDistance } = payload;
    const targetCount = count || 1;
    const searchRadius = maxDistance || 64;

    // --- Validate block name ---
    const blockType = mcData.blocksByName[blockName];
    if (!blockType) {
      throw new Error(`Unknown block: ${blockName}`);
    }

    // Remember starting position to return after mining underground
    const startPos = bot.entity.position.clone();

    const dropNames = getExpectedDropNames(blockName);
    const inventoryBefore = countInventory(bot, dropNames);

    let collected = 0;
    let failed = 0;
    const NAV_TIMEOUT = 30000;
    const PICKUP_TIMEOUT = 5000;

    while (collected < targetCount) {
      // --- 1. Batch find blocks, sorted by distance ---
      const remaining = targetCount - collected;
      const blockPositions = bot.findBlocks({
        matching: blockType.id,
        maxDistance: searchRadius,
        count: Math.min(remaining * 2, 100),
      });

      if (blockPositions.length === 0) {
        if (collected === 0) {
          throw new Error(`No ${blockName} found within ${searchRadius} blocks`);
        }
        break;
      }

      const botPos = bot.entity.position;

      // Sort by 3D distance, prefer blocks near bot's Y level but don't exclude distant ones
      blockPositions.sort((a, b) => {
        const aDy = Math.abs(a.y - botPos.y);
        const bDy = Math.abs(b.y - botPos.y);
        // Prefer blocks within 4 Y of the bot, then sort by 3D distance
        const aReachable = aDy <= 4 ? 0 : 1;
        const bReachable = bDy <= 4 ? 0 : 1;
        if (aReachable !== bReachable) return aReachable - bReachable;
        return a.distanceTo(botPos) - b.distanceTo(botPos);
      });

      let madeProgress = false;

      for (const pos of blockPositions) {
        if (collected >= targetCount) break;

        const currentBlock = bot.blockAt(pos);
        if (!currentBlock || currentBlock.type !== blockType.id) {
          continue;
        }

        // Navigate: let pathfinder decide if it can reach the block
        // Use reach=2 to get close enough for mining AND drop collection
        let reached;
        try {
          reached = await navigateTo(bot, pos.x, pos.y, pos.z, 2, NAV_TIMEOUT);
        } catch (err) {
          failed++;
          continue;
        }

        if (!reached) {
          failed++;
          continue;
        }

        // Verify block is within dig range after navigation
        const verifyBlock = bot.blockAt(pos);
        if (!verifyBlock || verifyBlock.type === 0) continue;
        if (!bot.canDigBlock(verifyBlock)) {
          // Try getting one block closer
          try {
            await navigateTo(bot, pos.x, pos.y, pos.z, 1, 10000);
          } catch (_) {}
          const retryBlock = bot.blockAt(pos);
          if (!retryBlock || !bot.canDigBlock(retryBlock)) {
            failed++;
            continue;
          }
        }

        try {
          await equipBestTool(bot, verifyBlock);
        } catch (_) {
          // Non-critical -- mine with whatever is in hand
        }

        try {
          await bot.dig(verifyBlock);
        } catch (err) {
          failed++;
          continue;
        }

        await collectNearbyDrop(bot, pos, PICKUP_TIMEOUT);

        collected++;
        madeProgress = true;
      }

      if (!madeProgress) {
        break;
      }
    }

    const distFromStart = bot.entity.position.distanceTo(startPos);
    if (distFromStart > 5) {
      try {
        await navigateTo(bot, startPos.x, startPos.y, startPos.z, 3, 15000);
      } catch (_) {
        // Best effort — don't fail the whole action if we can't return
      }
    }

    const inventoryAfter = bot.inventory.items()
      .filter((i) => dropNames.includes(i.name))
      .map((i) => ({ name: i.name, count: i.count }));

    const totalBefore = Object.values(inventoryBefore).reduce((s, c) => s + c, 0);
    const totalAfter = inventoryAfter.reduce((s, i) => s + i.count, 0);

    return {
      action: 'findAndCollect',
      block: blockName,
      collected,
      failed,
      requested: targetCount,
      netGain: totalAfter - totalBefore,
      inventoryAfter,
    };
  };
}

module.exports = createHandleFindAndCollect;
