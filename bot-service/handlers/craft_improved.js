/**
 * Improved craft action handler with smart failure diagnostics.
 *
 * Key improvements over the basic version:
 * 1. Analyzes ALL recipes and reports exactly which materials are missing
 * 2. Tries both 2x2 (hand) and 3x3 (crafting table) recipes
 * 3. Reports materials consumed on success
 */

const { gotoNear } = require('../primitives/navigation');

/**
 * Get a summary of bot inventory for error messages.
 */
function inventorySummary(bot) {
  const items = bot.inventory.items();
  if (items.length === 0) return '(empty)';
  return items.map((i) => `${i.name}x${i.count}`).join(', ');
}

/**
 * Build a map of item counts in the bot's inventory.
 * @returns {Map<number, number>} itemId -> total count
 */
function getInventoryCounts(bot) {
  const counts = new Map();
  for (const item of bot.inventory.items()) {
    counts.set(item.type, (counts.get(item.type) || 0) + item.count);
  }
  return counts;
}

/**
 * Analyze a single recipe's delta to determine what materials are missing.
 *
 * @param {Object} recipe - Mineflayer recipe object
 * @param {Map<number, number>} invCounts - inventory item counts
 * @param {Object} mcData - minecraft-data instance
 * @param {number} craftCount - how many times to craft
 * @returns {{ missing: Array<{name: string, need: number, have: number}>, totalMissing: number }}
 */
function analyzeRecipe(recipe, invCounts, mcData, craftCount) {
  const missing = [];
  let totalMissing = 0;

  for (const delta of recipe.delta) {
    // Negative count means consumed by the recipe
    if (delta.count < 0) {
      const needed = -delta.count * craftCount;
      const have = invCounts.get(delta.id) || 0;
      const shortage = Math.max(needed - have, 0);

      if (shortage > 0) {
        const itemInfo = mcData.items[delta.id];
        const name = itemInfo ? itemInfo.name : `unknown(id:${delta.id})`;
        missing.push({ name, need: needed, have, shortage });
        totalMissing += shortage;
      }
    }
  }

  return { missing, totalMissing };
}

/**
 * Format a missing-materials report into a human-readable string.
 *
 * @param {Array} missing - array of { name, need, have, shortage }
 * @returns {string}
 */
function formatMissingReport(missing) {
  return missing
    .map((m) => `${m.name} x${m.need} (have ${m.have}, need ${m.shortage} more)`)
    .join(', ');
}


/**
 * Attempt to find a usable recipe and craft the item.
 * Provides detailed diagnostics when crafting is not possible.
 *
 * @param {Object} payload
 * @param {string} payload.itemName - The item to craft (e.g. "diamond_pickaxe")
 * @param {number} [payload.count=1] - How many to craft
 * @returns {Object} Result with action details
 */
function createHandleCraft({ getBot }) {
  return async function handleCraft(payload) {
    const bot = getBot();
    const mcData = require('minecraft-data')(bot.version);
    const { itemName, count } = payload;
    const desiredOutput = count || 1;

    // --- Validate item name ---
    const item = mcData.itemsByName[itemName];
    if (!item) {
      throw new Error(`Unknown item: ${itemName}. Check spelling or use the internal Minecraft item name.`);
    }

    const invCounts = getInventoryCounts(bot);

    /**
     * Try to craft using the given recipe list and optional crafting table.
     * count parameter means "desired output items", not "craft repetitions".
     */
    async function tryCraft(recipes, table) {
      if (recipes.length === 0) return null;

      const recipe = recipes[0];
      const outputPerCraft = recipe.result.count;
      const craftRepetitions = Math.ceil(desiredOutput / outputPerCraft);

      // Snapshot inventory before crafting
      const invBefore = getInventoryCounts(bot);

      if (table) {
        // Walk to crafting table and face it
        const ctPos = table.position;
        const dist = bot.entity.position.distanceTo(ctPos);
        if (dist > 2) {
          await gotoNear(bot, ctPos, {
            reach: 1,
            timeoutMs: 15000,
            noPathMessage: 'Cannot reach crafting table',
            timeoutMessage: 'Crafting table navigation timed out',
            softTimeout: true,
          });
        }
        // Look at the crafting table to ensure interaction works
        await bot.lookAt(ctPos.offset(0.5, 0.5, 0.5));
        await new Promise((r) => setTimeout(r, 200));
      }

      await bot.craft(recipe, craftRepetitions, table || null);

      // Snapshot inventory after to calculate actual results
      const invAfter = getInventoryCounts(bot);
      const actualOutput = (invAfter.get(item.id) || 0) - (invBefore.get(item.id) || 0);

      // Calculate actual materials consumed by comparing inventory diffs
      const materialsUsed = [];
      for (const delta of recipe.delta) {
        if (delta.count < 0) {
          const itemInfo = mcData.items[delta.id];
          const name = itemInfo ? itemInfo.name : `unknown(id:${delta.id})`;
          const before = invBefore.get(delta.id) || 0;
          const after = invAfter.get(delta.id) || 0;
          const consumed = before - after;
          if (consumed > 0) {
            materialsUsed.push({ name, count: consumed });
          }
        }
      }

      return {
        action: 'craft',
        item: itemName,
        requested: desiredOutput,
        craftRepetitions,
        outputPerCraft,
        actualOutput,
        usedCraftingTable: !!table,
        craftingTablePosition: table ? { x: table.position.x, y: table.position.y, z: table.position.z } : null,
        materialsUsed,
      };
    }

    // --- Step 1: Try 2x2 recipes (no crafting table needed) ---
    // Use minResultCount=1 to find any available recipe, not filtered by desired count
    let handRecipes = bot.recipesFor(item.id, null, 1, null);
    const handResult = await tryCraft(handRecipes, null);
    if (handResult) return handResult;

    // --- Step 2: Try 3x3 recipes (crafting table needed) ---
    let craftingTable = bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id,
      maxDistance: 32,
    });

    if (craftingTable) {
      let tableRecipes = bot.recipesFor(item.id, null, 1, craftingTable);
      const tableResult = await tryCraft(tableRecipes, craftingTable);
      if (tableResult) return tableResult;
    }

  // --- Step 3: No fulfillable recipe found. Diagnose why. ---

  // Gather ALL recipes (regardless of whether materials are available)
  // Try without crafting table first, then with
  const allHandRecipes = bot.recipesAll(item.id, null, null);
  const allTableRecipes = craftingTable
    ? bot.recipesAll(item.id, null, craftingTable)
    : [];

  const allRecipes = [...allHandRecipes, ...allTableRecipes];

  if (allRecipes.length === 0) {
    // No recipes found at all (not even unfulfillable ones)
    // This could mean: (a) item has no crafting recipe, or
    //                   (b) recipes exist but require a crafting table we don't have

    if (!craftingTable) {
      throw new Error(
        `No recipe found for ${itemName}. ` +
        `No crafting table within 32 blocks -- some recipes require a crafting table. ` +
        `Try placing a crafting_table nearby first. ` +
        `Inventory: ${inventorySummary(bot)}`
      );
    }

    throw new Error(
      `No recipe exists for ${itemName}. This item cannot be crafted. ` +
      `Inventory: ${inventorySummary(bot)}`
    );
  }

  // --- Find the recipe with the fewest missing materials ---
  let bestRecipe = null;
  let bestAnalysis = null;
  let bestMissing = Infinity;
  let bestNeedsTable = false;

  for (const recipe of allHandRecipes) {
    const analysis = analyzeRecipe(recipe, invCounts, mcData, desiredOutput);
    if (analysis.totalMissing < bestMissing) {
      bestMissing = analysis.totalMissing;
      bestRecipe = recipe;
      bestAnalysis = analysis;
      bestNeedsTable = false;
    }
  }

  for (const recipe of allTableRecipes) {
    const analysis = analyzeRecipe(recipe, invCounts, mcData, desiredOutput);
    if (analysis.totalMissing < bestMissing) {
      bestMissing = analysis.totalMissing;
      bestRecipe = recipe;
      bestAnalysis = analysis;
      bestNeedsTable = true;
    }
  }

  // Build the diagnostic error message
  const parts = [`Cannot craft ${itemName} x${desiredOutput}.`];

  if (bestAnalysis && bestAnalysis.missing.length > 0) {
    parts.push(`Best recipe needs: ${formatMissingReport(bestAnalysis.missing)}.`);
  }

  if (bestNeedsTable) {
    parts.push('Crafting table required: yes (found nearby).');
  } else if (!craftingTable && allHandRecipes.length === 0) {
    // We only have hand recipes but none work, or we have no recipes at all without a table
    parts.push(
      'No crafting table found within 32 blocks. ' +
      'Some recipes may require a crafting table -- try placing one nearby.'
    );
  }

    parts.push(`Inventory: ${inventorySummary(bot)}`);

    throw new Error(parts.join(' '));
  };
}

module.exports = createHandleCraft;
