function createBotContext() {
  let bot = null;
  let followInterval = null;

  return {
    getBot() {
      return bot;
    },

    setBot(nextBot) {
      bot = nextBot;
    },

    getFollowInterval() {
      return followInterval;
    },

    setFollowInterval(nextInterval) {
      followInterval = nextInterval;
    },

    clearFollowInterval() {
      if (followInterval) {
        clearInterval(followInterval);
        followInterval = null;
      }
    },
  };
}

module.exports = { createBotContext };
