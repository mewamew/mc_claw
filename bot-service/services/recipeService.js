const recipeData = {
  func: require('../data/recipes/func.json'),
  mapName: require('../data/recipes/map_name.json'),
  preCollect: require('../data/recipes/pre_collect.json'),
  preItem: require('../data/recipes/pre_item.json'),
  preSmelt: require('../data/recipes/pre_smelt.json'),
  preTool: require('../data/recipes/pre_tool.json'),
};

function resolveGenericName(itemName) {
  if (recipeData.func[itemName]) return itemName;
  const variants = recipeData.mapName[itemName];
  if (variants) return variants[0];
  return itemName;
}

function buildDependencyTree(itemName, depth, maxDepth, visited) {
  if (depth >= maxDepth) return null;
  if (visited.has(itemName)) return { item: itemName, circular: true };
  visited.add(itemName);

  const method = recipeData.func[itemName];
  if (!method) return null;

  const node = { item: itemName, method };

  if (method === 'craft') {
    const recipe = recipeData.preItem[itemName];
    if (recipe) {
      const [ingredients, count, needsTable] = recipe;
      node.ingredients = ingredients;
      node.output = count;
      node.requiresCraftingTable = needsTable;
      node.deps = {};
      for (const entry of ingredients) {
        const parts = entry.split(' ');
        const qty = parseInt(parts[0], 10);
        const materialName = parts.slice(1).join(' ');
        const concreteName = resolveGenericName(materialName);
        const sub = buildDependencyTree(concreteName, depth + 1, maxDepth, new Set(visited));
        node.deps[materialName] = { quantity: qty, concrete: concreteName, ...(sub || {}) };
      }
    }
  } else if (method === 'smelt') {
    const source = recipeData.preSmelt[itemName];
    if (source) {
      node.source = source;
      const sub = buildDependencyTree(source, depth + 1, maxDepth, new Set(visited));
      node.deps = { [source]: { quantity: 1, ...(sub || {}) } };
    }
  } else if (method === 'mine') {
    const tool = recipeData.preTool[itemName];
    if (tool && tool !== 'none') {
      node.requiredTool = tool;
    }
    const sources = recipeData.mapName[itemName];
    if (sources) node.mineFrom = sources;
  } else if (method === 'kill') {
    const sources = recipeData.preCollect[itemName];
    if (sources) node.killMobs = sources;
  }

  return node;
}

function hasRecipeItem(itemName) {
  return Boolean(recipeData.func[itemName]);
}

function getRecipeTree(itemName, maxDepth = 10) {
  return buildDependencyTree(itemName, 0, maxDepth, new Set());
}

function getSuggestions(itemName, limit = 5) {
  return Object.keys(recipeData.func)
    .filter((key) => key.includes(itemName))
    .slice(0, limit);
}

module.exports = {
  getRecipeTree,
  getSuggestions,
  hasRecipeItem,
};
