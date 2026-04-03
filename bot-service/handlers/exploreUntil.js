const { goals } = require('mineflayer-pathfinder');

/**
 * Directional exploration handler.
 *
 * Moves the bot in a given direction while scanning for a target block or
 * entity.  Returns immediately if the target is already within range,
 * otherwise keeps walking until found or the time budget runs out.
 *
 * @param {Object} payload
 * @param {string}  payload.target        - Block name or entity name to look for (e.g. "iron_ore", "cow")
 * @param {{x:number, y:number, z:number}} [payload.direction={x:1,y:0,z:1}] - Direction vector
 * @param {number}  [payload.maxTime=60]      - Max exploration time in seconds (capped at 300)
 * @param {number}  [payload.searchRadius=32] - Scan radius each tick
 */
function createHandleExploreUntil({ getBot }) {
  return async function handleExploreUntil(payload) {
    const bot = getBot();
    const mcData = require('minecraft-data')(bot.version);

  // --- Validate & defaults ---------------------------------------------------
  const target = payload && payload.target;
  if (!target) {
    throw new Error('Missing required field: target');
  }

  const direction = Object.assign({ x: 1, y: 0, z: 1 }, payload.direction || {});
  const maxTime = Math.min(Math.max((payload.maxTime || 60), 1), 300);
  const searchRadius = payload.searchRadius || 32;

  // Normalise direction vector so magnitude ≈ 1 (avoid zero-vector)
  const mag = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2) || 1;
  const dir = {
    x: direction.x / mag,
    y: direction.y / mag,
    z: direction.z / mag,
  };

  const startPos = bot.entity.position.clone();

  // --- Helpers ---------------------------------------------------------------

  /**
   * Scan for the target as a block.  Returns { type: 'block', position } or null.
   */
  function findTargetBlock() {
    if (!bot.entity) return null;
    const blockType = mcData.blocksByName[target];
    if (!blockType) return null;

    const found = bot.findBlock({
      matching: blockType.id,
      maxDistance: searchRadius,
    });
    if (!found) return null;
    return {
      type: 'block',
      name: target,
      position: { x: found.position.x, y: found.position.y, z: found.position.z },
    };
  }

  /**
   * Scan for the target as an entity.  Returns { type: 'entity', position } or null.
   */
  function findTargetEntity() {
    if (!bot.entity) return null;
    const entity = bot.nearestEntity(
      (e) =>
        e !== bot.entity &&
        (e.name === target || e.username === target) &&
        e.position.distanceTo(bot.entity.position) < searchRadius
    );
    if (!entity) return null;
    return {
      type: 'entity',
      name: entity.name || entity.username || target,
      position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
    };
  }

  /**
   * Combined scan — try block first, then entity.
   */
  function scanForTarget() {
    return findTargetBlock() || findTargetEntity();
  }

  /**
   * Compute distance the bot has traveled from startPos.
   */
  function distanceTraveled() {
    if (!bot.entity) return 0;
    return parseFloat(bot.entity.position.distanceTo(startPos).toFixed(1));
  }

  // --- Check if target is already nearby ------------------------------------
  const immediateHit = scanForTarget();
  if (immediateHit) {
    return {
      action: 'exploreUntil',
      found: true,
      target: immediateHit.name,
      targetType: immediateHit.type,
      position: immediateHit.position,
      distanceTraveled: 0,
    };
  }

  // --- Configure safer pathfinding for exploration --------------------------
  const { Movements } = require('mineflayer-pathfinder');
  const mcDataForMov = require('minecraft-data')(bot.version);
  const safeMovements = new Movements(bot, mcDataForMov);
  safeMovements.maxDropDown = 3;    // max 3 blocks fall (~0.5 hearts damage, acceptable)
  safeMovements.canDig = true;      // allow breaking small obstacles while exploring
  safeMovements.allow1by1towers = false; // don't pillar up
  safeMovements.allowSprinting = true;  // sprint for speed
  const prevMovements = bot.pathfinder.movements;
  bot.pathfinder.setMovements(safeMovements);

  // --- Exploration loop (Promise-based) -------------------------------------
    return new Promise((resolve) => {
    const deadline = Date.now() + maxTime * 1000;
    const startHealth = bot.health;
    let intervalId = null;
    let settled = false;
    let lastPos = bot.entity.position.clone();
    let stuckCount = 0;

    function cleanup() {
      if (settled) return;
      settled = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      try {
        bot.pathfinder.setGoal(null);
      } catch (_) {
        // pathfinder may already be idle — ignore
      }
      // Restore original movements
      try { bot.pathfinder.setMovements(prevMovements); } catch (_) {}
    }

    function safeResolve(result) {
      cleanup();
      // Safely get current position (bot might be dead)
      if (!result.currentPosition && bot.entity) {
        result.currentPosition = {
          x: Math.floor(bot.entity.position.x),
          y: Math.floor(bot.entity.position.y),
          z: Math.floor(bot.entity.position.z),
        };
      }
      resolve(result);
    }

    /**
     * Pick a new waypoint roughly in the desired direction.
     */
    function setNextWaypoint() {
      if (!bot.entity) { cleanup(); return; }
      const stepSize = 8 + Math.random() * 8;
      // Larger jitter when stuck to break free from obstacles
      const jitterScale = stuckCount >= 2 ? 12 : 3;
      const jitterX = (Math.random() - 0.5) * jitterScale;
      const jitterZ = (Math.random() - 0.5) * jitterScale;

      const current = bot.entity.position;
      const goalX = current.x + dir.x * stepSize + jitterX;
      const goalY = current.y;
      const goalZ = current.z + dir.z * stepSize + jitterZ;

      bot.pathfinder.setGoal(new goals.GoalNear(goalX, goalY, goalZ, 2), true);
    }

    // Kick off the first waypoint immediately
    setNextWaypoint();

    // Every 5 seconds: check health, scan, update waypoint, check timeout
    intervalId = setInterval(() => {
      if (settled) return;
      if (!bot.entity) {
        safeResolve({
          action: 'exploreUntil',
          found: false,
          target,
          distanceTraveled: 0,
          currentPosition: null,
          message: `Bot died during exploration for ${target}`,
          abortReason: 'death',
        });
        return;
      }

      // Safety: abort if health dropped significantly
      if (bot.health < 10 && bot.health < startHealth - 4) {
        safeResolve({
          action: 'exploreUntil',
          found: false,
          target,
          distanceTraveled: distanceTraveled(),
          message: `Aborted exploration: health dropped to ${bot.health}`,
          abortReason: 'low_health',
        });
        return;
      }

      // Timeout check
      if (Date.now() >= deadline) {
        safeResolve({
          action: 'exploreUntil',
          found: false,
          target,
          distanceTraveled: distanceTraveled(),
          message: `Explored for ${maxTime}s without finding ${target}`,
        });
        return;
      }

      // Scan for the target
      const hit = scanForTarget();
      if (hit) {
        cleanup();
        resolve({
          action: 'exploreUntil',
          found: true,
          target: hit.name,
          targetType: hit.type,
          position: hit.position,
          distanceTraveled: distanceTraveled(),
        });
        return;
      }

      // Check if stuck (moved less than 2 blocks since last check)
      const currentPos = bot.entity.position;
      const movedSinceLastCheck = currentPos.distanceTo(lastPos);
      lastPos = currentPos.clone();

      if (movedSinceLastCheck < 2) {
        stuckCount++;
        if (stuckCount >= 2) {
          // Stuck for 2+ intervals — add random perpendicular jitter to break free
          console.log(`[EXPLORE] Stuck detected (${stuckCount}x), adding perpendicular jitter`);
          stuckCount = 0;
        }
      } else {
        stuckCount = 0;
      }

      // Pick a new waypoint, with extra jitter if stuck
      setNextWaypoint();
    }, 5000);
    });
  };
}

module.exports = createHandleExploreUntil;
