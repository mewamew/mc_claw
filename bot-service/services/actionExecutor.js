function createActionExecutor({
  getBot,
  actionRegistry,
  logger,
  experienceManager,
  tickFreeze,
  tickUnfreeze,
  appendActionLog,
  getActionsSinceReport,
  incrementActionsSinceReport,
  setIsExecuting,
  getDeathCount,
}) {
  const REPORT_REQUIRED_AFTER = 15;

  function buildErrorContext(type, err, payload) {
    const ctx = {
      actionType: type,
      payload: payload || {},
      botState: null,
      suggestion: null,
    };

    const bot = getBot();
    if (bot && bot.entity) {
      ctx.botState = {
        position: {
          x: Math.round(bot.entity.position.x),
          y: Math.round(bot.entity.position.y),
          z: Math.round(bot.entity.position.z),
        },
        health: bot.health,
        food: bot.food,
        isInWater: bot.entity.isInWater || false,
        onGround: bot.entity.onGround || false,
      };
    }

    const msg = err.message.toLowerCase();

    if (msg.includes('no path') || msg.includes('cannot reach')) {
      ctx.suggestion = '目标可能被阻挡或在水中。尝试 scan 查看周围环境，或 goto 到附近可达位置';
    } else if (msg.includes('not in inventory') || (msg.includes('no ') && msg.includes('inventory'))) {
      ctx.suggestion = '背包中缺少该物品。先用 inventory 检查，再用 findAndCollect 或 craft 获取';
    } else if (msg.includes('timed out')) {
      ctx.suggestion = '目标太远或路径太复杂。尝试分段移动，先 goto 到中间位置';
    } else if (msg.includes('no suitable position')) {
      ctx.suggestion = '周围地形不适合放置。检查是否在水中/空中，尝试用 place 指定具体坐标';
    } else if (msg.includes('no target') || msg.includes('not found')) {
      ctx.suggestion = '附近找不到目标。用 lookAround 或 exploreUntil 扩大搜索范围';
    } else if (msg.includes('no recipe')) {
      ctx.suggestion = '找不到配方。确认物品名称是否正确(用 /recipe 查询)，或确认附近有工作台';
    } else if (msg.includes('no block')) {
      ctx.suggestion = '目标位置没有方块。确认坐标是否正确，用 lookAround 检查周围';
    }

    return ctx;
  }

  return {
    async execute({ type, payload }) {
      const bot = getBot();
      if (!bot || !bot.entity) {
        return {
          statusCode: 503,
          body: { success: false, error: 'Bot not connected' },
        };
      }

      const action = actionRegistry[type];
      if (!action) {
        return {
          statusCode: 400,
          body: { success: false, error: `Unknown action type: ${type}` },
        };
      }

      if (!action.silent && getActionsSinceReport() >= REPORT_REQUIRED_AFTER) {
        logger.logActionBlocked(type, 'no_report', { actionsSinceReport: getActionsSinceReport() });
        return {
          statusCode: 403,
          body: {
            success: false,
            blocked: true,
            type,
            error: `已连续执行 ${getActionsSinceReport()} 个动作但未汇报决策，动作被拦截。请先 POST /report 汇报你的计划后再继续。`,
            howToFix: 'POST /report with { "plan": "...", "currentStep": "...", "reasoning": "...", "nextStep": "..." }',
            actionsSinceReport: getActionsSinceReport(),
          },
        };
      }

      const actionStart = Date.now();
      const deathsBefore = getDeathCount ? getDeathCount() : 0;
      setIsExecuting(true);

      try {
        tickUnfreeze();
        const result = await action.run(payload);
        const duration = Date.now() - actionStart;
        const deathsDuringAction = (getDeathCount ? getDeathCount() : 0) - deathsBefore;

        tickFreeze();

        logger.logAction(type, payload, result, true, null, duration);
        appendActionLog({ time: Date.now(), type, payload: payload || {}, success: true, result });
        incrementActionsSinceReport();

        if (action.remember) {
          try {
            action.remember({ result, payload });
          } catch (memoryError) {
            console.error(`[MEMORY] Auto-memory error: ${memoryError.message}`);
          }
        }

        const report = action.describeSuccess ? action.describeSuccess(result, payload) : null;
        if (report && bot && bot.entity) {
          bot.chat(report);
        }

        const meta = { duration, deathsDuringAction };
        if (!action.silent && getActionsSinceReport() > 1) {
          meta.reminder = '请先 POST /report 汇报你的当前计划再继续执行动作';
          if (getActionsSinceReport() >= 4) {
            meta.warning = `⚠️ 你已经连续执行了 ${getActionsSinceReport()} 个动作但没有汇报决策！请立即 POST /report 汇报你的计划、当前步骤和推理，然后再继续执行。监控面板上看不到你在想什么。`;
          }
        }

        const body = {
          success: true,
          type,
          result,
          meta,
          ...result,
        };

        if (meta.reminder) body.reminder = meta.reminder;
        if (meta.warning) body.warning = meta.warning;

        return { statusCode: 200, body };
      } catch (err) {
        const duration = Date.now() - actionStart;

        tickFreeze();

        logger.logAction(type, payload, null, false, err.message, duration);
        appendActionLog({ time: Date.now(), type, payload: payload || {}, success: false, error: err.message });

        const failReport = action.describeFailure
          ? action.describeFailure(err, payload)
          : actionRegistry.defaultDescribeFailure(type, err, payload);
        if (failReport && bot && bot.entity) {
          bot.chat(failReport);
        }

        const errorContext = buildErrorContext(type, err, payload);
        const relevantExp = experienceManager.findRelevant(type, err.message);

        // Auto-record experience from failure (only if no existing experience matched)
        if (relevantExp.length === 0) {
          const target = payload
            ? (payload.itemName || payload.blockName || payload.target || '')
            : '';
          const contextStr = errorContext.botState
            ? `pos=(${errorContext.botState.position.x},${errorContext.botState.position.y},${errorContext.botState.position.z}), hp=${errorContext.botState.health}`
            : '';
          experienceManager.add(
            type,
            err.message,
            `${target ? target + ': ' : ''}${contextStr}`,
            errorContext.suggestion || '',
            [type, target].filter(Boolean)
          );
        }

        const body = {
          success: false,
          type,
          error: err.message,
          context: errorContext,
          suggestion: errorContext.suggestion,
          meta: { duration },
        };

        if (relevantExp.length > 0) {
          body.experiences = relevantExp;
        }

        return { statusCode: 500, body };
      } finally {
        setIsExecuting(false);
      }
    },
  };
}

module.exports = { createActionExecutor };
