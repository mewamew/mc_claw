const { goals } = require('mineflayer-pathfinder');
const { gotoNear } = require('../primitives/navigation');
const { equipBestTool, equipItemByName } = require('../primitives/tools');
const { findPlacementSurface } = require('../primitives/placement');

function createBasicHandlers({ getBot, getFollowInterval, setFollowInterval, clearFollowInterval }) {
  async function handleChat(payload) {
    const bot = getBot();
    bot.chat(payload.message);
    return { action: 'chat', message: payload.message };
  }

  async function handleGoto(payload) {
    const bot = getBot();
    const { x, y, z } = payload;
    await gotoNear(bot, { x, y, z }, {
      reach: 1,
      timeoutMs: 30000,
      noPathMessage: 'No path found to destination',
      timeoutMessage: 'goto timed out',
    });
    return { action: 'goto', position: bot.entity.position };
  }

  async function handleLookAround() {
    const bot = getBot();
    const entities = Object.values(bot.entities)
      .filter((entity) => entity !== bot.entity && entity.position.distanceTo(bot.entity.position) < 16)
      .map((entity) => ({
        name: entity.name || entity.username || 'unknown',
        type: entity.type,
        position: entity.position,
        distance: entity.position.distanceTo(bot.entity.position).toFixed(1),
      }));

    const blocks = [];
    const pos = bot.entity.position.floored();
    const radius = 5;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block && block.type !== 0) {
            const name = block.name;
            if (!blocks.find((entry) => entry.name === name)) {
              blocks.push({ name, position: block.position });
            }
          }
        }
      }
    }

    return { action: 'lookAround', entities, nearbyBlockTypes: blocks.map((block) => block.name) };
  }

  async function handleDig(payload) {
    const bot = getBot();
    const { Vec3 } = require('vec3');
    const { x, y, z } = payload;
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block || block.type === 0) {
      throw new Error(`No block at ${x}, ${y}, ${z}`);
    }
    await equipBestTool(bot, block);
    await bot.dig(block);
    return { action: 'dig', block: block.name, position: { x, y, z } };
  }

  async function handlePlace(payload) {
    const bot = getBot();
    const { Vec3 } = require('vec3');
    const { x, y, z, blockName } = payload;
    await equipItemByName(bot, blockName, 'hand', { errorPrefix: `No ${blockName} in inventory` });

    const targetVec = new Vec3(x, y, z);
    const dist = bot.entity.position.distanceTo(targetVec);
    if (dist > 4) {
      await gotoNear(bot, { x, y, z }, {
        reach: 3,
        timeoutMs: 15000,
        noPathMessage: `Cannot reach placement position ${x}, ${y}, ${z}`,
        timeoutMessage: `Placement navigation timed out for ${x}, ${y}, ${z}`,
        softTimeout: true,
      });
    }

    const placement = findPlacementSurface(bot, targetVec);
    if (placement.blockedBy) {
      throw new Error(`Position ${x}, ${y}, ${z} is occupied by ${placement.blockedBy}`);
    }
    if (!placement.refBlock || !placement.faceVec) {
      throw new Error(`No solid block near ${x}, ${y}, ${z} to place against`);
    }

    await bot.placeBlock(placement.refBlock, placement.faceVec);
    return { action: 'place', block: blockName, position: { x, y, z } };
  }

  async function handleAttack(payload) {
    const bot = getBot();
    let target;
    if (payload && payload.entityName) {
      target = Object.values(bot.entities).find(
        (entity) =>
          entity !== bot.entity &&
          (entity.name === payload.entityName || entity.username === payload.entityName)
      );
    } else {
      target = bot.nearestEntity(
        (entity) => entity.type === 'mob' && entity.position.distanceTo(bot.entity.position) < 6
      );
    }
    if (!target) {
      throw new Error('No target found');
    }
    await bot.attack(target);
    return { action: 'attack', target: target.name || target.username || 'unknown' };
  }

  async function handleInventory() {
    const bot = getBot();
    const items = bot.inventory.items().map((item) => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
    }));
    return { action: 'inventory', items };
  }

  async function handleFollow() {
    const bot = getBot();
    const playerNames = Object.keys(bot.players).filter((name) => name !== bot.username);
    let targetName = null;
    let targetEntity = null;

    for (const name of playerNames) {
      const player = bot.players[name];
      if (player && player.entity) {
        targetEntity = player.entity;
        targetName = name;
        break;
      }
    }

    if (!targetName || !targetEntity) {
      throw new Error('No player found nearby');
    }

    if (getFollowInterval()) {
      clearFollowInterval();
    }

    bot.pathfinder.setGoal(new goals.GoalNear(
      targetEntity.position.x,
      targetEntity.position.y,
      targetEntity.position.z,
      1
    ), true);

    const intervalId = setInterval(() => {
      const player = bot.players[targetName];
      if (player && player.entity) {
        bot.pathfinder.setGoal(new goals.GoalNear(
          player.entity.position.x,
          player.entity.position.y,
          player.entity.position.z,
          1
        ), true);
      }
    }, 5000);

    setFollowInterval(intervalId);

    return { action: 'follow', target: targetName };
  }

  async function handleStopFollow() {
    const bot = getBot();
    clearFollowInterval();
    bot.pathfinder.setGoal(null);
    return { action: 'stopFollow' };
  }

  async function handleEquip(payload) {
    const bot = getBot();
    const { itemName, destination } = payload;
    await equipItemByName(bot, itemName, destination || 'hand', { errorPrefix: `No ${itemName} in inventory` });
    return { action: 'equip', item: itemName, destination: destination || 'hand' };
  }

  async function handleDrop(payload) {
    const bot = getBot();
    if (payload && payload.itemName) {
      const item = bot.inventory.items().find((entry) => entry.name === payload.itemName);
      if (!item) {
        throw new Error(`No ${payload.itemName} in inventory`);
      }
      const count = payload.count || item.count;
      await bot.tossStack(item);
      return { action: 'drop', item: payload.itemName, count };
    }

    const held = bot.heldItem;
    if (!held) {
      throw new Error('No item in hand');
    }
    await bot.tossStack(held);
    return { action: 'drop', item: held.name, count: held.count };
  }

  async function handleGivePlayer(payload) {
    const bot = getBot();

    // Find nearest player
    const playerNames = Object.keys(bot.players).filter((name) => name !== bot.username);
    let targetPlayer = null;
    for (const name of playerNames) {
      const player = bot.players[name];
      if (player && player.entity) {
        targetPlayer = player;
        break;
      }
    }
    if (!targetPlayer || !targetPlayer.entity) {
      throw new Error('附近没有玩家');
    }

    // Find item in inventory
    const itemName = payload && payload.itemName;
    if (!itemName) {
      throw new Error('需要指定 itemName');
    }
    const item = bot.inventory.items().find((i) => i.name === itemName);
    if (!item) {
      throw new Error(`背包里没有 ${itemName}`);
    }
    const count = payload.count || item.count;

    // Walk to the player
    const playerPos = targetPlayer.entity.position;
    await gotoNear(bot, playerPos, {
      reach: 2,
      timeoutMs: 15000,
      noPathMessage: '无法走到玩家身边',
      timeoutMessage: '走向玩家超时',
      softTimeout: true,
    });

    // Look at player and toss the item
    await bot.lookAt(targetPlayer.entity.position.offset(0, 1, 0));
    if (count >= item.count) {
      await bot.tossStack(item);
    } else {
      await bot.toss(item.type, null, count);
    }

    return {
      action: 'givePlayer',
      item: itemName,
      count: Math.min(count, item.count),
      player: targetPlayer.username || targetPlayer.entity.username,
    };
  }

  async function handlePlayers() {
    const bot = getBot();
    const playerList = [];
    for (const name of Object.keys(bot.players)) {
      if (name === bot.username) continue;
      const player = bot.players[name];
      const info = { name, ping: player.ping };
      if (player.entity) {
        info.position = {
          x: Math.round(player.entity.position.x),
          y: Math.round(player.entity.position.y),
          z: Math.round(player.entity.position.z),
        };
        info.distance = player.entity.position.distanceTo(bot.entity.position).toFixed(1);
      } else {
        info.position = null;
        info.distance = 'out of range';
      }
      playerList.push(info);
    }
    return { action: 'players', players: playerList, botPosition: bot.entity.position };
  }

  async function handleScan(payload) {
    const bot = getBot();
    const mcData = require('minecraft-data')(bot.version);
    const radius = (payload && payload.radius) || 32;
    const targetName = payload && payload.blockName;

    const valuableBlocks = new Set([
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
      'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore',
      'emerald_ore', 'copper_ore', 'deepslate_coal_ore', 'deepslate_iron_ore',
      'deepslate_gold_ore', 'deepslate_diamond_ore',
      'stone', 'cobblestone', 'sand', 'gravel', 'clay',
      'crafting_table', 'furnace', 'chest',
      'sugar_cane', 'wheat', 'pumpkin', 'melon',
    ]);

    if (targetName) {
      const blockType = mcData.blocksByName[targetName];
      if (!blockType) {
        throw new Error(`Unknown block: ${targetName}`);
      }

      const blocks = bot.findBlocks({
        matching: blockType.id,
        maxDistance: radius,
        count: 10,
      });

      return {
        action: 'scan',
        blockName: targetName,
        total: blocks.length,
        nearest: blocks.slice(0, 5).map((pos) => ({
          x: pos.x,
          y: pos.y,
          z: pos.z,
          distance: pos.distanceTo(bot.entity.position).toFixed(1),
        })),
      };
    }

    const pos = bot.entity.position.floored();
    const counts = {};

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block && block.type !== 0 && valuableBlocks.has(block.name)) {
            if (!counts[block.name]) {
              counts[block.name] = { count: 0, nearest: null, nearestDist: Infinity };
            }
            counts[block.name].count++;
            const dist = pos.offset(dx, dy, dz).distanceTo(bot.entity.position);
            if (dist < counts[block.name].nearestDist) {
              counts[block.name].nearestDist = dist;
              counts[block.name].nearest = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
            }
          }
        }
      }
    }

    const resources = Object.entries(counts)
      .map(([name, data]) => ({
        name,
        count: data.count,
        nearest: data.nearest,
        distance: data.nearestDist.toFixed(1),
      }))
      .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

    return { action: 'scan', radius, resources };
  }

  async function handlePlaceNear() {
    const bot = getBot();
    const { Vec3 } = require('vec3');

    const playerNames = Object.keys(bot.players).filter((name) => name !== bot.username);
    let targetPlayer = null;

    for (const name of playerNames) {
      const player = bot.players[name];
      if (player && player.entity) {
        targetPlayer = player;
        break;
      }
    }

    if (!targetPlayer || !targetPlayer.entity) {
      throw new Error('No player found nearby');
    }

    const heldItem = bot.heldItem;
    if (!heldItem) {
      throw new Error('No item in hand. Use equip first.');
    }

    const playerPos = targetPlayer.entity.position;
    await gotoNear(bot, playerPos, {
      reach: 2,
      timeoutMs: 30000,
      noPathMessage: 'Cannot reach player',
      timeoutMessage: 'Navigation to player timed out',
      softTimeout: true,
    });

    const pPos = targetPlayer.entity.position.floored();
    const offsets = [
      { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
      { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: -1, z: -1 },
      { x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }, { x: 0, z: -2 },
    ];

    const checkedPositions = [];

    for (const offset of offsets) {
      const placePos = pPos.offset(offset.x, 0, offset.z);
      const blockAtPos = bot.blockAt(placePos);
      const blockBelow = bot.blockAt(placePos.offset(0, -1, 0));

      if (!blockAtPos || !blockBelow) {
        checkedPositions.push({ offset, reason: 'out of range' });
        continue;
      }
      if (blockAtPos.type !== 0) {
        checkedPositions.push({ offset, reason: `occupied by ${blockAtPos.name}` });
        continue;
      }
      if (blockBelow.type === 0) {
        checkedPositions.push({ offset, reason: 'no solid ground below' });
        continue;
      }

      try {
        const distToRef = bot.entity.position.distanceTo(blockBelow.position);
        if (distToRef > 4) {
          await gotoNear(bot, placePos, {
            reach: 2,
            timeoutMs: 10000,
            softNoPath: true,
            softTimeout: true,
          });
        }
        await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
        return {
          action: 'placeNear',
          block: heldItem.name,
          position: { x: placePos.x, y: placePos.y, z: placePos.z },
          nearPlayer: targetPlayer.username,
        };
      } catch (error) {
        checkedPositions.push({ offset, reason: `place failed: ${error.message}` });
      }
    }

    throw new Error(`No suitable position found near player. Checked: ${JSON.stringify(checkedPositions)}`);
  }

  async function handleActivateItem(payload) {
    const bot = getBot();
    const opts = payload || {};

    if (opts.itemName) {
      await equipItemByName(bot, opts.itemName, 'hand', { errorPrefix: `No ${opts.itemName} in inventory` });
    }

    const count = opts.count === undefined ? 5 : Number(opts.count);
    const interval = opts.interval === undefined ? 400 : Number(opts.interval);
    const hand = opts.offHand ? 'left' : 'right';

    for (let i = 0; i < count; i++) {
      bot.swingArm(hand);
      if (i < count - 1) {
        await new Promise((r) => setTimeout(r, interval));
      }
    }

    const held = opts.offHand ? bot.inventory.slots[45] : bot.heldItem;
    return {
      action: 'activateItem',
      item: held ? held.name : null,
      hand: opts.offHand ? 'off-hand' : 'hand',
      swings: count,
    };
  }

  async function handleUseItemOn(payload) {
    const bot = getBot();
    const { Vec3 } = require('vec3');
    const { x, y, z, itemName } = payload;

    if (!itemName) {
      throw new Error('需要指定 itemName（要使用的物品名）');
    }

    await equipItemByName(bot, itemName, 'hand', { errorPrefix: `No ${itemName} in inventory` });

    const targetVec = new Vec3(x, y, z);
    const dist = bot.entity.position.distanceTo(targetVec);
    if (dist > 4) {
      await gotoNear(bot, { x, y, z }, {
        reach: 3,
        timeoutMs: 15000,
        noPathMessage: `Cannot reach ${x}, ${y}, ${z}`,
        timeoutMessage: `Navigation timed out for ${x}, ${y}, ${z}`,
        softTimeout: true,
      });
    }

    const block = bot.blockAt(targetVec);
    if (!block || block.type === 0) {
      throw new Error(`No block at ${x}, ${y}, ${z}`);
    }

    await bot.lookAt(targetVec.offset(0.5, 0.5, 0.5));
    await bot.activateBlock(block);
    await new Promise(r => setTimeout(r, 250));

    const newBlock = bot.blockAt(targetVec);
    return {
      action: 'useItemOn',
      item: itemName,
      targetBlock: block.name,
      resultBlock: newBlock ? newBlock.name : 'unknown',
      position: { x, y, z },
    };
  }

  return {
    chat: handleChat,
    goto: handleGoto,
    lookAround: handleLookAround,
    dig: handleDig,
    place: handlePlace,
    attack: handleAttack,
    inventory: handleInventory,
    follow: handleFollow,
    stopFollow: handleStopFollow,
    equip: handleEquip,
    drop: handleDrop,
    givePlayer: handleGivePlayer,
    players: handlePlayers,
    scan: handleScan,
    placeNear: handlePlaceNear,
    useItemOn: handleUseItemOn,
    activateItem: handleActivateItem,
  };
}

module.exports = createBasicHandlers;
