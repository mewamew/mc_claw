const Vec3 = require('vec3');
const { gotoNear } = require('../primitives/navigation');

const CHEST_BLOCK_NAMES = new Set(['chest', 'trapped_chest', 'barrel']);

/**
 * Walk to the chest block using pathfinder (GoalNear distance 2).
 * Waits for goal_reached or throws on noPath / timeout.
 */
async function walkToChest(bot, chestBlock) {
  const pos = chestBlock.position;
  await gotoNear(bot, pos, {
    reach: 2,
    timeoutMs: 30000,
    noPathMessage: 'No path found to chest',
    timeoutMessage: 'Navigation to chest timed out',
  });
}

/**
 * Locate a chest block. If x/y/z are provided, verify the block at that
 * position is a chest-type block. Otherwise scan for the nearest one
 * within 32 blocks.
 */
function findChestBlock(bot, payload) {
  const mcData = require('minecraft-data')(bot.version);

  if (payload.x !== undefined && payload.y !== undefined && payload.z !== undefined) {
    const pos = new Vec3(payload.x, payload.y, payload.z);
    const block = bot.blockAt(pos);
    if (!block || !CHEST_BLOCK_NAMES.has(block.name)) {
      const actualName = block ? block.name : 'air';
      throw new Error(
        `Block at (${payload.x}, ${payload.y}, ${payload.z}) is ${actualName}, not a chest`
      );
    }
    return block;
  }

  // No coordinates given — find nearest chest-type block
  const chestIds = [];
  for (const name of CHEST_BLOCK_NAMES) {
    const blockType = mcData.blocksByName[name];
    if (blockType) chestIds.push(blockType.id);
  }

  const found = bot.findBlock({
    matching: chestIds,
    maxDistance: 32,
  });

  if (!found) {
    throw new Error('No chest found within 32 blocks');
  }
  return found;
}

/**
 * Small helper — wait a few ticks for container state to settle.
 */
function waitTicks(ticks = 3) {
  return new Promise((resolve) => setTimeout(resolve, ticks * 50));
}

// ---------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------

async function handleList(container, chestBlock) {
  const items = container.containerItems().map((item) => ({
    name: item.name,
    count: item.count,
  }));

  return {
    action: 'useChest',
    chestAction: 'list',
    position: {
      x: chestBlock.position.x,
      y: chestBlock.position.y,
      z: chestBlock.position.z,
    },
    items,
  };
}

async function handleDeposit(bot, container, payload) {
  const mcData = require('minecraft-data')(bot.version);
  const deposited = [];

  if (payload.items && Object.keys(payload.items).length > 0) {
    // Deposit specified items
    for (const [itemName, count] of Object.entries(payload.items)) {
      const itemType = mcData.itemsByName[itemName];
      if (!itemType) {
        throw new Error(`Unknown item name: ${itemName}`);
      }

      const invItem = bot.inventory.items().find((i) => i.name === itemName);
      if (!invItem) {
        const inv = bot.inventory.items().map((i) => `${i.name}x${i.count}`).join(', ') || '(empty)';
        throw new Error(`No ${itemName} in inventory. Current inventory: ${inv}`);
      }

      const transferCount = Math.min(count, invItem.count);
      await container.deposit(itemType.id, null, transferCount);
      deposited.push({ name: itemName, count: transferCount });
      await waitTicks();
    }
  } else {
    // Deposit ALL inventory items
    const invItems = bot.inventory.items();
    for (const invItem of invItems) {
      const itemType = mcData.itemsByName[invItem.name];
      if (!itemType) continue;
      await container.deposit(itemType.id, null, invItem.count);
      deposited.push({ name: invItem.name, count: invItem.count });
      await waitTicks();
    }
  }

  return {
    action: 'useChest',
    chestAction: 'deposit',
    deposited,
  };
}

async function handleWithdraw(bot, container, payload) {
  const mcData = require('minecraft-data')(bot.version);

  if (!payload.items || Object.keys(payload.items).length === 0) {
    throw new Error('withdraw requires an items object, e.g. {"cobblestone": 32}');
  }

  const withdrawn = [];

  for (const [itemName, count] of Object.entries(payload.items)) {
    const itemType = mcData.itemsByName[itemName];
    if (!itemType) {
      throw new Error(`Unknown item name: ${itemName}`);
    }

    const chestItem = container.containerItems().find((i) => i.name === itemName);
    if (!chestItem) {
      const contents = container.containerItems()
        .map((i) => `${i.name}x${i.count}`)
        .join(', ') || '(empty)';
      throw new Error(`No ${itemName} in chest. Chest contents: ${contents}`);
    }

    const transferCount = Math.min(count, chestItem.count);
    await container.withdraw(itemType.id, null, transferCount);
    withdrawn.push({ name: itemName, count: transferCount });
    await waitTicks();
  }

  return {
    action: 'useChest',
    chestAction: 'withdraw',
    withdrawn,
  };
}

// ---------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------

function createHandleUseChest({ getBot }) {
  return async function handleUseChest(payload) {
    const bot = getBot();
    const chestAction = payload && payload.action;
    if (!chestAction || !['list', 'deposit', 'withdraw'].includes(chestAction)) {
      throw new Error('useChest requires payload.action to be one of: list, deposit, withdraw');
    }

    // 1. Locate the chest block
    const chestBlock = findChestBlock(bot, payload);

    // 2. Walk to the chest
    await walkToChest(bot, chestBlock);

  // Re-fetch block reference after walking (position vec may have changed)
    const block = bot.blockAt(chestBlock.position);
    if (!block || !CHEST_BLOCK_NAMES.has(block.name)) {
      throw new Error('Chest block disappeared after walking to it');
    }

  // 3. Open the chest
    const container = await bot.openContainer(block);
    await waitTicks(5);

    try {
      let result;
      switch (chestAction) {
        case 'list':
          result = await handleList(container, block);
          break;
        case 'deposit':
          result = await handleDeposit(bot, container, payload);
          break;
        case 'withdraw':
          result = await handleWithdraw(bot, container, payload);
          break;
      }
      return result;
    } finally {
      container.close();
    }
  };
}

module.exports = createHandleUseChest;
