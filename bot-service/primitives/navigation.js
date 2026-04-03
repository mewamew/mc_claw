const { goals } = require('mineflayer-pathfinder');

async function gotoGoal(bot, goal, {
  timeoutMs = 30000,
  noPathMessage = 'No path found',
  timeoutMessage = 'Navigation timed out',
  softNoPath = false,
  softTimeout = false,
  continueFollowing = false,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const onGoalReached = () => {
      cleanup();
      resolve({ reached: true, timedOut: false });
    };

    const onPathUpdate = (result) => {
      if (result.status !== 'noPath') return;
      cleanup();
      if (softNoPath) {
        resolve({ reached: false, timedOut: false, noPath: true });
      } else {
        reject(new Error(noPathMessage));
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      if (softTimeout) {
        resolve({ reached: false, timedOut: true });
      } else {
        reject(new Error(timeoutMessage));
      }
    }, timeoutMs);

    function cleanup() {
      if (settled) return;
      settled = true;
      bot.removeListener('goal_reached', onGoalReached);
      bot.removeListener('path_update', onPathUpdate);
      clearTimeout(timer);
    }

    bot.on('goal_reached', onGoalReached);
    bot.on('path_update', onPathUpdate);
    bot.pathfinder.setGoal(goal, continueFollowing);
  });
}

async function gotoNear(bot, position, {
  reach = 2,
  timeoutMs = 30000,
  noPathMessage = 'No path found',
  timeoutMessage = 'Navigation timed out',
  softNoPath = false,
  softTimeout = false,
  continueFollowing = false,
} = {}) {
  return gotoGoal(
    bot,
    new goals.GoalNear(position.x, position.y, position.z, reach),
    { timeoutMs, noPathMessage, timeoutMessage, softNoPath, softTimeout, continueFollowing }
  );
}

module.exports = {
  gotoGoal,
  gotoNear,
};
