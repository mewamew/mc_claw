# Agent Loop：双层迭代协议

> 本文件定义了 Claude 作为 Agent 进行实战迭代的完整协议。
> 每次新对话开始迭代时，读取本文件 + 迭代日志即可无缝接续。

---

## 1. 双层循环模型

```
┌─── 外层循环（Meta Loop）─── 系统优化 ─────────────────────┐
│                                                            │
│   while (系统还在迭代) {                                    │
│       启动内层循环                                          │
│       观察内层循环的运行情况                                 │
│       ┌── 发现问题？                                       │
│       │   → 中断内层循环                                   │
│       │   → 分析根因                                       │
│       │   → 修复代码 / 更新 Skill                          │
│       │   → git commit                                    │
│       │   → 记录到迭代日志                                 │
│       │   → POST /reset 重置 bot                          │
│       │   → 重新启动内层循环（从零开始）                    │
│       └── 没有问题？                                       │
│           → 继续观察                                       │
│   }                                                        │
│                                                            │
│   ┌─── 内层循环（Game Loop）─── 游戏执行 ─────────────┐   │
│   │                                                    │   │
│   │   while (终极目标未完成) {                           │   │
│   │       GET /state → 感知                            │   │
│   │       规划下一步 → POST /report                     │   │
│   │       POST /action → 执行                          │   │
│   │       观察结果                                      │   │
│   │   }                                                │   │
│   │                                                    │   │
│   └────────────────────────────────────────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 两层的职责区分

| | 内层循环（Game Loop） | 外层循环（Meta Loop） |
|---|---|---|
| **视角** | 我是 Minecraft 玩家 | 我是系统工程师 |
| **目标** | 生存、攀科技树、建基地 | 让内层循环跑得更好 |
| **关注** | 下一步挖什么、做什么、去哪 | handler 有没有 bug、效率怎么样 |
| **产出** | 游戏内进度 | 代码修复、Skill 优化、git commit |
| **改代码** | 不改 | 改 |
| **操作范围** | 只调 Bot Server API | 读写代码 + 调 API + git |

---

## 2. 核心原则

### 2.1 发现即中断

内层循环跑的过程中，一旦外层观察到问题（bug、死亡、异常效率），立刻中断内层，切换到外层处理。不要"先推进游戏以后再修"。

### 2.2 重启即重生

外层修完 bug 后，通过 `POST /reset` 让 bot 回到初始状态。内层循环从零开始 — 空背包、出生点、重新攀科技树。积累的不是游戏物品，而是更好的系统。

### 2.3 每次修复必须提交

每个修复对应一次 git commit。方便追溯"第几轮发现的、什么场景触发的、怎么修的"。

### 2.4 日志跨会话持久化

上下文会丢失，但日志不会。每轮的观察、数据、问题、修复都写入日志文件。

### 2.5 只改 bot-service 和 skills/mc-claw

其他技能不动。

---

## 3. 新对话启动流程

```
1. 读取本文件（specs/agent-loop.md）
2. 读取问题清单（bot-service/data/logs/issues.md）
   — 有未解决的 open 问题？优先在外层循环处理
3. 读取迭代日志（bot-service/data/logs/iteration-log.jsonl）最后几条
   — 了解上次跑到什么程度、发现了什么
4. 启动 Bot Server（如未运行）
5. 决定从哪层开始：
   - 有 open issues → 外层循环：先修 bug，再启动内层
   - 没有 open issues → 内层循环：直接开始游戏
6. 开始循环
```

---

## 4. 内层循环（Game Loop）

### 4.1 单步流程

```
1. GET /state
   — 检查 deathsSinceLastCheck（如果有死亡，立即中断，交给外层）
   — 记录：位置、血量、背包、威胁

2. 规划
   — 根据当前状态和科技树目标，决定下一步
   — POST /report 汇报计划

3. POST /action 执行动作
   — 设足够的 curl 超时（findAndCollect ≥ 120s，goto ≥ 60s）

4. 观察结果
   — 检查 success/error
   — 检查返回的 meta 里有没有 deaths 信息
   — 记录：动作类型、参数、耗时、结果

5. 交给外层评估
```

### 4.2 内层循环的终极目标

生存并攀登科技树：

```
Phase 1: 木器 — 采集木头 → 木板 → 工作台 → 木镐 → 木剑
Phase 2: 石器 — 挖石头 → 石镐 → 石剑 → 石斧 → 熔炉
Phase 3: 食物 — 猎杀动物 → 烤肉 → 食物储备
Phase 4: 基地 — 箱子 → 庇护所 → 床
Phase 5: 铁器 — 找铁矿 → 熔炼 → 铁镐 → 铁剑 → 铁甲
Phase 6: 深层 — 找钻石 → 附魔台
```

### 4.3 每 3-4 个 action 后要 POST /report

否则 dashboard 会发 warning，超过 5 个会被拦截。

---

## 5. 外层循环（Meta Loop）

### 5.1 观察：每个 action 结束后评估

每次内层循环执行完一个 action，外层循环检查：

#### 中断条件（立即停止内层，进入修复）

| 条件 | 判断方式 | 优先级 |
|------|---------|--------|
| **Bot 死亡** | `/state` 的 `deathsSinceLastCheck.count > 0` 或 action 返回里有 deaths | 最高 |
| **代码 Bug** | action 返回 error 且原因是代码缺陷（如 "xxx is not defined"） | 高 |
| **服务崩溃** | curl 超时或连接拒绝 | 高 |

#### 改进条件（完成当前 action 链后处理）

| 条件 | 判断方式 | 优先级 |
|------|---------|--------|
| **效率异常** | findAndCollect 失败率 > 30%；不合理的高耗时 | 中 |
| **数据丢失** | netGain 远低于 collected（掉落物没捡到） | 中 |
| **信息不足** | 返回值缺少关键数据，无法判断好坏 | 低 |
| **Skill 描述问题** | Skill 里的说明与实际行为不符 | 低 |

### 5.2 分析：找根因

1. 读相关 handler 代码
2. 如果是死亡：分析 `/events` 和 `/experience` 里的死亡记录，找死因
3. 如果是效率问题：对比数据，定位瓶颈
4. 如果是 Skill 问题：对比 Skill 描述和实际 API 行为

### 5.3 修复

1. 修改代码（bot-service）或 Skill 定义（skills/mc-claw/SKILL.md）
2. 重启 Bot Server
3. 用一个小测试验证修复有效
4. **Skill 同步审查** — 每次修改 Bot Server 代码后，检查 SKILL.md 是否需要同步更新：
   - 新增/修改了 API？→ 更新 Skill 里的端点文档
   - 改了参数语义？→ 更新 Skill 里的参数说明
   - 发现了实战 workaround？→ 写进 Skill 的 tips 或对应指令说明
   - Skill 里的决策流程需要调整？→ 更新 decision loop
5. git commit（格式见第 8 节）
6. 更新 issues.md

### 5.4 重启内层循环

修复完成后：

```bash
# 重置 bot 到初始状态
curl -X POST http://localhost:3001/reset

# 确认重置成功
curl http://localhost:3001/state
# 应该看到：空背包、满血、出生点位置
```

然后重新进入内层循环，从 Phase 1（砍树）开始。

---

## 6. 死亡追踪

### 6.1 Bot Server 提供的死亡信息

`GET /state` 返回：

```json
{
  "deathsSinceLastCheck": {
    "count": 2,
    "deaths": [
      {
        "time": 1775114700000,
        "position": [43, 65, -1],
        "cause": "zombie",
        "nearbyThreats": ["zombie", "skeleton"],
        "inventoryLost": 12
      }
    ]
  }
}
```

每次 GET /state 后，计数器重置为 0。这样外层循环不会漏掉任何死亡。

### 6.2 Action 返回的死亡信息

每个 action 返回的 `meta` 里也包含执行期间的死亡信息：

```json
{
  "meta": {
    "duration": 45000,
    "deathsDuringAction": 1
  }
}
```

---

## 7. 日志系统

### 7.1 迭代日志：`bot-service/data/logs/iteration-log.jsonl`

每轮外层循环追加一条 JSON：

```json
{
  "round": 3,
  "time": "2026-04-02T14:00:00Z",
  "loop": "meta",
  "trigger": "bot 探索时摔死，exploreUntil 不安全",
  "gameState": {"position": [5, 72, 9], "health": 20, "food": 20, "inventoryCount": 0},
  "issue": "ISS-006",
  "fix": "exploreUntil 加安全寻路 + 血量检查",
  "commit": "e35ff09",
  "verification": "30 秒走 69 格，满血"
}
```

内层循环也记录，但格式不同：

```json
{
  "round": 3,
  "time": "2026-04-02T13:50:00Z",
  "loop": "game",
  "actions": [
    {"type": "findAndCollect", "params": {"blockName": "stone", "count": 20}, "success": true, "duration": 78883, "detail": "collected 20, netGain 6 (drop loss)"}
  ],
  "deaths": 0,
  "techTreePhase": "stone"
}
```

### 7.2 问题清单：`bot-service/data/logs/issues.md`

格式：

```markdown
## ISS-XXX [STATUS] 简述
- 发现于: Round N
- 现象: ...
- 根因: ...
- 修复: ...
- Commit: hash
- 状态: open / fixed
```

---

## 8. Git 提交规范

```
fix: <简述>

场景: <什么游戏操作触发>
数据: <具体数据>
根因: <代码层面原因>
修复: <改了什么>
验证: <修复后数据>

Iteration: Round N, ISS-XXX
```

---

## 9. Bot Server 操作

### 9.1 重启

```bash
lsof -i :3001 -t 2>/dev/null | xargs kill 2>/dev/null
sleep 2
cd bot-service && node index.js &
sleep 5
curl -s --max-time 5 http://localhost:3001/health
```

### 9.2 重置 Bot（新一局）

```bash
curl -X POST http://localhost:3001/reset
```

重置后 bot 回到出生点、空背包、满血、清空记忆。等价于"新一局游戏"。

---

## 10. 注意事项

- 外层和内层不要混在一起 — 发现问题就切到外层，不要在内层里"顺便修"
- 重启内层后从零开始，不要试图恢复之前的游戏进度
- curl 超时要充足：findAndCollect ≥ 120s，goto ≥ 60s，exploreUntil ≥ maxTime + 10s
- 修改代码后必须重启 Bot Server 才生效
