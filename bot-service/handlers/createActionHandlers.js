const createBasicHandlers = require('./basic');
const createCraftHandler = require('./craft_improved');
const createSmeltHandler = require('./smelt');
const createEatHandler = require('./eat');
const createExploreUntilHandler = require('./exploreUntil');
const createUseChestHandler = require('./useChest');
const createFindAndCollectHandler = require('./findAndCollect_improved');
const createFightHandler = require('./fight');
const { createBuildHandler } = require('./build');

function createActionHandlers(runtime) {
  return {
    ...createBasicHandlers(runtime),
    craft: createCraftHandler(runtime),
    smelt: createSmeltHandler(runtime),
    eat: createEatHandler(runtime),
    exploreUntil: createExploreUntilHandler(runtime),
    useChest: createUseChestHandler(runtime),
    findAndCollect: createFindAndCollectHandler(runtime),
    fight: createFightHandler(runtime),
    build: createBuildHandler(runtime),
  };
}

module.exports = { createActionHandlers };
