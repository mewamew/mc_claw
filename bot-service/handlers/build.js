const fs = require('fs');
const path = require('path');
const { gotoNear } = require('../primitives/navigation');
const { equipItemByName } = require('../primitives/tools');
const { findPlacementSurface } = require('../primitives/placement');

const BLUEPRINTS_DIR = path.join(__dirname, '..', 'data', 'blueprints');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadBlueprint(name) {
  const file = path.join(BLUEPRINTS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    const available = fs.readdirSync(BLUEPRINTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
    throw new Error(`蓝图 "${name}" 不存在。可用蓝图: ${available.join(', ')}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function listBlueprints() {
  return fs.readdirSync(BLUEPRINTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const bp = JSON.parse(fs.readFileSync(path.join(BLUEPRINTS_DIR, f), 'utf-8'));
      return { name: bp.name, description: bp.description, materials: bp.materials };
    });
}

async function placeBlockAt(bot, x, y, z, blockName) {
  const { Vec3 } = require('vec3');
  const targetPos = new Vec3(x, y, z);

  // Check if position is already occupied
  const existing = bot.blockAt(targetPos);
  if (existing && existing.name !== 'air' && existing.name !== 'water' && existing.name !== 'short_grass' && existing.name !== 'tall_grass' && existing.name !== 'fern') {
    return 'skipped'; // Already has a block
  }

  // Find the item in inventory
  if (!bot.inventory.items().find((i) => i.name === blockName)) {
    return 'no_material';
  }

  await gotoNear(bot, targetPos, {
    reach: 4,
    timeoutMs: 10000,
    softNoPath: true,
    softTimeout: true,
  });

  const placement = findPlacementSurface(bot, targetPos);
  if (placement.blockedBy) {
    return 'skipped';
  }
  if (!placement.refBlock || !placement.faceVec) {
    return 'no_surface'; // No adjacent block to place against
  }

  await equipItemByName(bot, blockName, 'hand', { errorPrefix: `No ${blockName} in inventory` });
  try {
    await bot.placeBlock(placement.refBlock, placement.faceVec);
    return 'placed';
  } catch (e) {
    return 'failed';
  }
}

function createBuildHandler({ getBot }) {
  return async function handleBuild(payload) {
    const bot = getBot();
    const { blueprint: bpName, x, y, z } = payload;

  if (!bpName) {
    throw new Error('缺少 blueprint 参数。用 GET /blueprints 查看可用蓝图');
  }
  if (x === undefined || y === undefined || z === undefined) {
    throw new Error('缺少基点坐标 (x, y, z)');
  }

  const bp = loadBlueprint(bpName);

  // Check materials
  const missing = {};
  for (const [mat, needed] of Object.entries(bp.materials || {})) {
    const have = bot.inventory.items()
      .filter((i) => i.name === mat)
      .reduce((sum, i) => sum + i.count, 0);
    if (have < needed) {
      missing[mat] = { need: needed, have };
    }
  }

  if (Object.keys(missing).length > 0) {
    throw new Error(`材料不足: ${JSON.stringify(missing)}`);
  }

  let placed = 0;
  let skipped = 0;
  let failed = 0;

  // Build layers (bottom to top)
  if (bp.layers) {
    for (const layer of bp.layers) {
      for (const block of layer.blocks) {
        const [dx, dz, blockName] = block;
        const result = await placeBlockAt(bot, x + dx, y + layer.y, z + dz, blockName);
        if (result === 'placed') placed++;
        else if (result === 'skipped') skipped++;
        else failed++;
        await sleep(200); // Pace placement for visual effect
      }
    }
  }

  // Place furniture / decorations
  if (bp.furniture) {
    for (const item of bp.furniture) {
      const result = await placeBlockAt(bot, x + item.dx, y + item.dy, z + item.dz, item.block);
      if (result === 'placed') placed++;
      else if (result === 'skipped') skipped++;
      else failed++;
      await sleep(200);
    }
  }

  // Build fence (animal pen / farm)
  if (bp.fence) {
    for (const [dx, dz] of bp.fence) {
      const fenceName = bp.materials.oak_fence ? 'oak_fence' : 'oak_planks';
      const result = await placeBlockAt(bot, x + dx, y + 1, z + dz, fenceName);
      if (result === 'placed') placed++;
      else if (result === 'skipped') skipped++;
      else failed++;
      await sleep(150);
    }
  }

  // Place gate
  if (bp.gate) {
    const result = await placeBlockAt(bot, x + bp.gate.dx, y + 1, z + bp.gate.dz, bp.gate.block);
    if (result === 'placed') placed++;
    else failed++;
  }

    return {
      action: 'build',
      blueprint: bpName,
      basePosition: { x, y, z },
      placed,
      skipped,
      failed,
      total: placed + skipped + failed,
    };
  };
}

module.exports = { createBuildHandler, listBlueprints };
