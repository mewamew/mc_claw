function defaultFailureTarget(type, payload) {
  if (!payload) return '';

  switch (type) {
    case 'build':
      return payload.blueprint || '';
    case 'useChest':
      return payload.action || '';
    default:
      return payload.itemName || payload.blockName || payload.target || '';
  }
}

function defaultDescribeFailure(type, error, payload) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const target = defaultFailureTarget(type, payload);
  return `[失败] ${type}${target ? ` ${target}` : ''}: ${errorMessage}`;
}

function createActionRegistry({ actionHandlers, memoryManager, getBot }) {
  return {
    chat: {
      run: actionHandlers.chat,
      silent: true,
    },
    goto: {
      run: actionHandlers.goto,
      describeSuccess: () => '[完成] 已到达目的地',
    },
    lookAround: {
      run: actionHandlers.lookAround,
      silent: true,
    },
    dig: {
      run: actionHandlers.dig,
      describeSuccess: (result) => `[完成] 挖掘了 ${result.block}`,
      remember: ({ result }) => {
        if (!result.position) return;
        memoryManager.removeLandmark(result.block, result.position);
      },
    },
    place: {
      run: actionHandlers.place,
      silent: true,
      describeSuccess: (result) => `[完成] 放置了 ${result.block}`,
      remember: ({ result }) => {
        if (result.position && memoryManager.isLandmarkBlock(result.block)) {
          memoryManager.addLandmark(result.block, result.position, { placedBy: getBot()?.username });
        }
      },
    },
    attack: {
      run: actionHandlers.attack,
      describeSuccess: (result) => `[战斗] 攻击了 ${result.target}`,
    },
    inventory: {
      run: actionHandlers.inventory,
      silent: true,
    },
    equip: {
      run: actionHandlers.equip,
      describeSuccess: (result) => `[装备] ${result.item}`,
    },
    follow: {
      run: actionHandlers.follow,
      describeSuccess: (result) => `[跟随] 正在跟随 ${result.target}`,
    },
    stopFollow: {
      run: actionHandlers.stopFollow,
      describeSuccess: () => '[停止] 已停止跟随',
    },
    drop: {
      run: actionHandlers.drop,
      describeSuccess: (result) => `[丢弃] ${result.item} x${result.count}`,
    },
    givePlayer: {
      run: actionHandlers.givePlayer,
      describeSuccess: (result) => `给你咯，拿着~`,
    },
    players: {
      run: actionHandlers.players,
      silent: true,
    },
    scan: {
      run: actionHandlers.scan,
      silent: true,
    },
    craft: {
      run: actionHandlers.craft,
      describeSuccess: (result) => `[完成] 合成了 ${result.item} x${result.actualOutput || result.count}`,
      remember: ({ result }) => {
        // Record the crafting table used as a landmark
        if (result.usedCraftingTable && result.craftingTablePosition) {
          memoryManager.addLandmark('crafting_table', result.craftingTablePosition, { discoveredBy: 'craft' });
        }
      },
    },
    smelt: {
      run: actionHandlers.smelt,
      describeSuccess: (result) => `[完成] 熔炼了 ${result.item} x${result.count}`,
      remember: ({ result }) => {
        if (result.furnacePosition) {
          memoryManager.addLandmark('furnace', result.furnacePosition, { discoveredBy: 'smelt' });
        }
      },
    },
    eat: {
      run: actionHandlers.eat,
      describeSuccess: (result) => `[进食] 吃了 ${result.item}`,
    },
    exploreUntil: {
      run: actionHandlers.exploreUntil,
      describeSuccess: (result) => {
        if (result.found) return `[发现] 找到了 ${result.target}`;
        return `[探索] 没找到 ${result.target}，走了 ${result.distanceTraveled} 格`;
      },
      remember: ({ result }) => {
        if (result.found && result.position && result.targetType === 'block') {
          memoryManager.addResource(result.target, result.position, 1);
        }
      },
    },
    useChest: {
      run: actionHandlers.useChest,
      describeSuccess: (result) => {
        if (result.chestAction === 'deposit') return '[箱子] 存入了物品';
        if (result.chestAction === 'withdraw') return '[箱子] 取出了物品';
        return '[箱子] 查看了物品';
      },
      remember: ({ payload }) => {
        if (payload && payload.x !== undefined) {
          memoryManager.addLandmark('chest', { x: payload.x, y: payload.y, z: payload.z });
        }
      },
    },
    useItemOn: {
      run: actionHandlers.useItemOn,
      describeSuccess: (result) => `[完成] 用 ${result.item} 对 ${result.targetBlock} 使用 → ${result.resultBlock}`,
    },
    activateItem: {
      run: actionHandlers.activateItem,
      describeSuccess: (result) => `[挥舞] ${result.item || '空手'} x${result.swings}`,
    },
    placeNear: {
      run: actionHandlers.placeNear,
      describeSuccess: (result) => `[完成] 已放在 ${result.nearPlayer} 旁边`,
      remember: ({ result }) => {
        if (result.position && memoryManager.isLandmarkBlock(result.block)) {
          memoryManager.addLandmark(result.block, result.position, { placedBy: getBot()?.username, nearPlayer: result.nearPlayer });
        }
      },
    },
    findAndCollect: {
      run: actionHandlers.findAndCollect,
      describeSuccess: (result) => `[完成] 采集了 ${result.block} x${result.collected}`,
      remember: ({ result }) => {
        const bot = getBot();
        if (result.collected > 0 && bot && bot.entity) {
          memoryManager.addResource(result.block, bot.entity.position, result.collected);
        }
      },
    },
    fight: {
      run: actionHandlers.fight,
      describeSuccess: (result) => `[战斗] ${result.killed ? '击败了' : '交战'} ${result.target}`,
    },
    build: {
      run: actionHandlers.build,
      describeSuccess: (result) => `[完成] 建造了 ${result.blueprint}`,
    },
    defaultDescribeFailure,
  };
}

module.exports = { createActionRegistry };
