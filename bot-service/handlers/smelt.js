const { gotoNear } = require('../primitives/navigation');
const { equipItemByName } = require('../primitives/tools');
const { findNearbyGroundPlacement } = require('../primitives/placement');

// Fuel priority order: best fuels first
const FUEL_PRIORITY = [
  'coal',
  'charcoal',
  'coal_block',
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'jungle_planks',
  'acacia_planks',
  'dark_oak_planks',
  'stick',
];

/**
 * Get a summary of bot inventory for error messages.
 */
function inventorySummary(bot) {
  const items = bot.inventory.items();
  if (items.length === 0) return '(empty)';
  return items.map((i) => `${i.name}x${i.count}`).join(', ');
}

/**
 * Pick the best available fuel from the bot's inventory.
 * Returns the item object, or null if no fuel is found.
 */
function pickFuel(bot) {
  for (const fuelName of FUEL_PRIORITY) {
    const item = bot.inventory.items().find((i) => i.name === fuelName);
    if (item) return item;
  }
  return null;
}

/**
 * Find a furnace block within `radius` blocks, or place one from inventory.
 * Returns the furnace block object.
 */
async function findOrPlaceFurnace(bot, radius) {
  const mcData = require('minecraft-data')(bot.version);

  // Search for an existing furnace nearby
  const furnaceBlock = bot.findBlock({
    matching: [mcData.blocksByName.furnace.id, mcData.blocksByName.lit_furnace?.id].filter(Boolean),
    maxDistance: radius,
  });

  if (furnaceBlock) return furnaceBlock;

  // No furnace found nearby -- check inventory for one
  const furnaceItem = bot.inventory.items().find((i) => i.name === 'furnace');
  if (!furnaceItem) {
    throw new Error(
      `No furnace found within ${radius} blocks and no furnace in inventory. ` +
      `Inventory: ${inventorySummary(bot)}`
    );
  }

  // Place the furnace: find a solid block nearby to place on
  const offsets = [
    { x: 1, z: 0 }, { x: -1, z: 0 },
    { x: 0, z: 1 }, { x: 0, z: -1 },
    { x: 1, z: 1 }, { x: -1, z: -1 },
    { x: 1, z: -1 }, { x: -1, z: 1 },
  ];

  const placement = findNearbyGroundPlacement(bot, bot.entity.position.floored(), offsets);
  if (placement) {
    await equipItemByName(bot, furnaceItem.name, 'hand', { errorPrefix: 'No furnace in inventory' });
    await bot.placeBlock(placement.blockBelow, { x: 0, y: 1, z: 0 });
    await bot.waitForTicks(20);

    const placed = bot.blockAt(placement.placePos);
    if (placed && placed.name === 'furnace') {
      return placed;
    }
  }

  throw new Error('Could not find a suitable position to place furnace');
}

/**
 * Handle smelting items in a furnace.
 *
 * @param {Object} payload
 * @param {string} payload.itemName - The item to smelt (e.g. "raw_iron", "sand", "beef")
 * @param {string} [payload.fuelName] - Fuel to use. Auto-picks from inventory if omitted.
 * @param {number} [payload.count=1] - How many items to smelt.
 * @returns {Object} Result with action, item name, and count smelted.
 */
function createHandleSmelt({ getBot }) {
  return async function handleSmelt(payload) {
    const bot = getBot();
    const mcData = require('minecraft-data')(bot.version);
    const { itemName, fuelName, count: rawCount } = payload;
    const count = rawCount || 1;

  // --- Validate input item exists in inventory ---
  const inputItem = bot.inventory.items().find((i) => i.name === itemName);
  if (!inputItem) {
    throw new Error(
      `No ${itemName} in inventory. Inventory: ${inventorySummary(bot)}`
    );
  }
  if (inputItem.count < count) {
    throw new Error(
      `Not enough ${itemName}: have ${inputItem.count}, need ${count}. ` +
      `Inventory: ${inventorySummary(bot)}`
    );
  }

  // --- Validate fuel availability ---
  if (fuelName) {
    const fuelItem = bot.inventory.items().find((i) => i.name === fuelName);
    if (!fuelItem) {
      throw new Error(
        `No fuel ${fuelName} in inventory. Inventory: ${inventorySummary(bot)}`
      );
    }
  } else {
    // Check that at least some fuel exists
    const anyFuel = pickFuel(bot);
    if (!anyFuel) {
      throw new Error(
        `No fuel available in inventory. Need one of: ${FUEL_PRIORITY.join(', ')}. ` +
        `Inventory: ${inventorySummary(bot)}`
      );
    }
  }

  // --- Find or place a furnace ---
  const furnaceBlock = await findOrPlaceFurnace(bot, 32);

  // --- Navigate to the furnace and face it ---
  const fbPos = furnaceBlock.position;
  await gotoNear(bot, fbPos, {
    reach: 1,
    timeoutMs: 30000,
    noPathMessage: 'Cannot reach furnace',
    timeoutMessage: 'Navigation to furnace timed out',
    softTimeout: true,
  });

  // Look at furnace center to ensure interaction works
  await bot.lookAt(fbPos.offset(0.5, 0.5, 0.5));
  await bot.waitForTicks(10);

  // --- Smelt items one at a time ---
  let smelted = 0;

  for (let i = 0; i < count; i++) {
    // Re-lookup the furnace block in case it changed state (lit_furnace vs furnace)
    const currentFurnaceBlock = bot.blockAt(fbPos);
    if (!currentFurnaceBlock || (currentFurnaceBlock.name !== 'furnace' && currentFurnaceBlock.name !== 'lit_furnace')) {
      throw new Error(`Furnace at ${fbPos.x}, ${fbPos.y}, ${fbPos.z} is gone. Smelted ${smelted}/${count}.`);
    }

    // Open the furnace
    const furnace = await bot.openFurnace(currentFurnaceBlock);

    try {
      // --- Add fuel if needed ---
      if (furnace.fuelSeconds < 15) {
        let fuel;
        if (fuelName) {
          fuel = bot.inventory.items().find((item) => item.name === fuelName);
        } else {
          fuel = pickFuel(bot);
        }

        if (!fuel) {
          throw new Error(
            `Ran out of fuel after smelting ${smelted}/${count} items. ` +
            `Inventory: ${inventorySummary(bot)}`
          );
        }

        await furnace.putFuel(fuel.type, null, 1);
        await bot.waitForTicks(20);
      }

      // --- Put input item ---
      const currentInput = bot.inventory.items().find((item) => item.name === itemName);
      if (!currentInput) {
        throw new Error(
          `Ran out of ${itemName} after smelting ${smelted}/${count} items. ` +
          `Inventory: ${inventorySummary(bot)}`
        );
      }

      await furnace.putInput(currentInput.type, null, 1);

      // --- Wait for smelting (one item takes ~10 seconds = 200 ticks) ---
      // Poll for output to appear, with a timeout
      const smeltTimeout = 15000; // 15 seconds max per item
      const startTime = Date.now();

      await new Promise((resolve, reject) => {
        const checkOutput = () => {
          if (furnace.outputItem() && furnace.outputItem().count > 0) {
            resolve();
          } else if (Date.now() - startTime > smeltTimeout) {
            reject(new Error(`Smelting timed out for item ${smelted + 1}/${count}`));
          } else {
            setTimeout(checkOutput, 1000);
          }
        };
        // Wait a bit before first check to let smelting start
        setTimeout(checkOutput, 2000);
      });

      // --- Take output ---
      const output = furnace.outputItem();
      if (output) {
        await furnace.takeOutput();
      }

      smelted++;
      await bot.waitForTicks(10);
    } finally {
      // Always close the furnace window
      furnace.close();
      await bot.waitForTicks(10);
    }
  }

    return {
      action: 'smelt',
      item: itemName,
      count: smelted,
      furnacePosition: furnaceBlock ? { x: furnaceBlock.position.x, y: furnaceBlock.position.y, z: furnaceBlock.position.z } : null,
    };
  };
}

module.exports = createHandleSmelt;
