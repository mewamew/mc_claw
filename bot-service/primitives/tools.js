const TOOL_RANKS = { wooden: 1, stone: 2, iron: 3, golden: 4, diamond: 5, netherite: 6 };

function getPreferredToolType(blockName, includeShears) {
  if (/ore|stone|cobblestone|andesite|diorite|granite|deepslate|obsidian|netherrack|basalt|blackstone|brick/.test(blockName)) {
    return 'pickaxe';
  }
  if (/log|wood|planks|fence|door|sign|chest|barrel|crafting_table|bookshelf/.test(blockName)) {
    return 'axe';
  }
  if (/dirt|sand|gravel|clay|soul_sand|soul_soil|farmland|grass_block|mycelium|podzol|snow/.test(blockName)) {
    return 'shovel';
  }
  if (includeShears && /leaves|vine|wool|cobweb/.test(blockName)) {
    return 'shears';
  }
  return null;
}

function chooseBestTool(bot, block, { allowFallback = true, includeShears = true } = {}) {
  const items = bot.inventory.items();
  if (items.length === 0) return null;

  if (bot.pathfinder && typeof bot.pathfinder.bestHarvestTool === 'function') {
    const best = bot.pathfinder.bestHarvestTool(block);
    if (best) return best;
  }

  const preferredType = getPreferredToolType(block.name || '', includeShears);
  if (!preferredType) return null;

  let bestItem = null;
  let bestRank = -1;

  for (const item of items) {
    if (!item.name.endsWith(`_${preferredType}`) && item.name !== preferredType) continue;
    const material = item.name.replace(`_${preferredType}`, '');
    const rank = TOOL_RANKS[material] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      bestItem = item;
    }
  }

  if (!bestItem && allowFallback && preferredType !== 'shears') {
    for (const item of items) {
      if (!/pickaxe|axe|shovel/.test(item.name)) continue;
      const material = item.name.split('_')[0];
      const rank = TOOL_RANKS[material] || 0;
      if (rank > bestRank) {
        bestRank = rank;
        bestItem = item;
      }
    }
  }

  return bestItem;
}

async function equipBestTool(bot, block, options = {}) {
  const item = chooseBestTool(bot, block, options);
  if (!item) return null;
  await bot.equip(item, 'hand');
  return item;
}

async function equipItemByName(bot, itemName, destination = 'hand', { errorPrefix } = {}) {
  const item = bot.inventory.items().find((entry) => entry.name === itemName);
  if (!item) {
    throw new Error(errorPrefix || `No ${itemName} in inventory`);
  }
  await bot.equip(item, destination);
  return item;
}

module.exports = {
  chooseBestTool,
  equipBestTool,
  equipItemByName,
};
