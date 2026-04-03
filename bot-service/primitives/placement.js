const { Vec3 } = require('vec3');

const DEFAULT_REPLACEABLE = new Set(['air', 'water', 'short_grass', 'tall_grass', 'fern']);
const DEFAULT_DIRECTIONS = [
  [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];

function toVec3(position) {
  if (position instanceof Vec3) return position;
  return new Vec3(position.x, position.y, position.z);
}

function findPlacementSurface(bot, targetPos, {
  allowReplace = DEFAULT_REPLACEABLE,
  directions = DEFAULT_DIRECTIONS,
} = {}) {
  const vec = toVec3(targetPos);
  const existing = bot.blockAt(vec);
  if (!existing) {
    return { refBlock: null, faceVec: null, blockedBy: 'out_of_range' };
  }
  if (!allowReplace.has(existing.name)) {
    return { refBlock: null, faceVec: null, blockedBy: existing.name };
  }

  for (const [dx, dy, dz] of directions) {
    const adjacentPos = vec.offset(dx, dy, dz);
    const block = bot.blockAt(adjacentPos);
    if (block && block.name !== 'air' && block.name !== 'water') {
      return { refBlock: block, faceVec: new Vec3(-dx, -dy, -dz), blockedBy: null };
    }
  }

  return { refBlock: null, faceVec: null, blockedBy: null };
}

function findNearbyGroundPlacement(bot, centerPos, offsets) {
  const center = toVec3(centerPos);
  for (const offset of offsets) {
    const placePos = center.offset(offset.x, offset.y || 0, offset.z);
    const blockAtPos = bot.blockAt(placePos);
    const blockBelow = bot.blockAt(placePos.offset(0, -1, 0));

    if (!blockAtPos || !blockBelow) continue;
    if (blockAtPos.type !== 0) continue;
    if (blockBelow.type === 0) continue;

    return { placePos, blockBelow };
  }

  return null;
}

module.exports = {
  DEFAULT_REPLACEABLE,
  findPlacementSurface,
  findNearbyGroundPlacement,
  toVec3,
};
