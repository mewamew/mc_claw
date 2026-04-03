# Bot Server 进化系统设计

> 日期：2026-04-02
> 状态：Draft
> 前提：对 `bot-server-task-layer.md` 方案的反思与替代提案

---

## 1. 问题：为什么硬编码规则行不通

`bot-server-task-layer.md` 提出在 Bot Server 内硬编码 stage 判定、urgent 判定、task 流程。本质上是把人类攻略从 prompt 文本搬到 JavaScript 代码：

```
之前: prompt 里写 "如果饥饿值低于 8 就先吃东西"
之后: JS 里写 if (food < 8) urgent.push("food_low")
```

形式变了，问题没变：

1. **覆盖不了 Minecraft 的复杂性** — 5 个 stage、5 种 urgent、5 个 task 远远不够，会陷入不断补规则的死循环
2. **与项目初衷矛盾** — 项目目标是"AI 从游戏中学习，把重复模式沉淀为技能和记忆"，而硬编码规则是人类预设轨道，AI 只是在轨道上跑
3. **无法处理"成功但低效"** — 规则只能判断对错，无法判断好坏。AI 采集 10 块木头跑了 200 格，规则会说"成功"，但其实很糟糕

---

## 2. 核心洞察：AI 缺的不是规则，是自我评估

人类玩家知道"就近采集更高效"，不是因为有人告诉他，而是因为：

1. 他跑远了采集，花了很多时间
2. 他就近采集，很快就完成了
3. 他**自己对比了两次经验**，总结出规律

当前系统的经验管理器（experienceManager）主要记录**死亡**等严重失败。但 AI 日常面临的更多是"成功但低效"的情况 — 它不会死，只是慢，所以永远意识不到问题。

**AI 需要的进化循环：**

```
执行动作 → 采集度量数据 → 与历史基准对比 → 发现差距 → 形成/更新策略 → 下次验证
```

缺失的关键环节是**度量**和**对比**。

---

## 3. 进化成果的载体：结构化策略

### 3.1 不是文本，不是代码，是中间形态

进化沉淀物有三种可能的形式：

| 载体 | 例子 | 优点 | 缺点 |
|------|------|------|------|
| 自由文本 | "采集时应该先找密集区域" | 灵活，能泛化 | 不稳定，AI 可能忘记或误读 |
| JavaScript 代码 | `function smartCollect(...)` | 确定性高 | AI 难以自己写出可靠代码并热加载 |
| **结构化策略** | JSON 格式的执行配方 | AI 能读写，服务端能解释执行 | 需要设计好 schema |

我们选择**结构化策略**作为进化载体。

### 3.2 策略的三个层级

类比人类学习过程：

| 层级 | 人类类比 | 载体 | 生命周期 | 例子 |
|------|---------|------|---------|------|
| 原则 | 认知 / 直觉 | 文本 | 长期稳定 | "夜间不要在野外停留" |
| 策略 | 习惯 / 套路 | 结构化 JSON | 中期，随数据更新 | "采集前先扫描 → 选密集区 → 批量采集" |
| 参数 | 肌肉记忆 | 数值 | 短期，频繁调整 | "扫描半径 32、食物储备 16" |

当前的 experienceManager 只覆盖了"原则"层（死亡教训等文本描述）。本设计重点补齐"策略"和"参数"两层。

### 3.3 策略的数据结构

```json
{
  "id": "collect_wood_v3",
  "action": "findAndCollect",
  "target": "oak_log",
  "strategy": {
    "name": "scan_then_collect",
    "steps": [
      { "action": "lookAround", "purpose": "scan for tree clusters" },
      { "action": "goto", "purpose": "move to densest area", "selectBy": "nearest_cluster" },
      { "action": "findAndCollect", "params": { "blockName": "oak_log", "count": 10 } }
    ]
  },
  "params": {
    "scanRadius": 32,
    "minClusterSize": 3,
    "maxTravelDistance": 50
  },
  "evidence": {
    "timesUsed": 5,
    "avgItemsPerMinute": 6.2,
    "avgDistancePerItem": 8.3,
    "lastUsed": "2026-04-02T10:30:00Z",
    "comparedTo": {
      "baseline": { "avgItemsPerMinute": 3.1, "avgDistancePerItem": 24.7 },
      "improvement": "2x efficiency"
    }
  },
  "supersedes": "collect_wood_v2",
  "createdBy": "agent_reflection",
  "createdAt": "2026-04-02T09:00:00Z"
}
```

关键设计点：

- **steps**：AI 可读写的执行步骤，Bot Server 可解释执行
- **params**：可独立调整的参数，不需要改步骤
- **evidence**：数据支撑，不是拍脑袋。包含使用次数、效率指标、与基准的对比
- **supersedes**：版本链，能追溯策略是怎么进化来的

---

## 4. Bot Server 的职责变化

### 4.1 不做什么

- 不做局面判断（那是 AI 的事）
- 不做任务推荐（那是 AI 的事）
- 不硬编码 stage / urgent / blocker 规则
- 不内置 LLM

### 4.2 要做什么

Bot Server 聚焦于两件事：**度量**和**策略执行**。

#### 度量：为每个 action 提供丰富的执行指标

现在的 action 返回：

```json
{ "success": true, "message": "Collected 10 oak_log" }
```

改进后返回：

```json
{
  "success": true,
  "message": "Collected 10 oak_log",
  "metrics": {
    "durationMs": 45000,
    "distanceTraveled": 83,
    "itemsCollected": 10,
    "itemsPerMinute": 13.3,
    "avgDistancePerItem": 8.3,
    "blocksScanned": 156,
    "failedAttempts": 1,
    "inventoryAfter": { "freeSlots": 12 }
  }
}
```

不同类型的 action 返回不同的度量：

| Action | 核心度量 |
|--------|---------|
| findAndCollect | 耗时、移动距离、每分钟采集量、每物品平均距离 |
| craft | 耗时、是否一次成功、缺料情况 |
| smelt | 耗时、燃料消耗量、产出量 |
| fight | 耗时、受伤量、击杀数、武器耐久消耗 |
| goto | 耗时、实际路径长度 vs 直线距离、是否被阻挡 |
| exploreUntil | 耗时、探索距离、是否找到目标 |
| eat | 恢复的饥饿值、恢复的生命值 |
| build | 耗时、放置方块数、缺料情况 |

#### 策略执行：解释并执行结构化策略

新增 API `POST /strategy`，接受结构化策略并执行：

```json
POST /strategy
{
  "strategyId": "collect_wood_v3",
  "steps": [
    { "action": "lookAround" },
    { "action": "goto", "params": { "selectBy": "nearest_cluster", "target": "oak_log" } },
    { "action": "findAndCollect", "params": { "blockName": "oak_log", "count": 10 } }
  ],
  "budget": {
    "maxSteps": 5,
    "maxRuntimeMs": 60000,
    "abortOnDanger": true
  }
}
```

返回每一步的度量：

```json
{
  "strategyId": "collect_wood_v3",
  "completed": true,
  "totalDurationMs": 42000,
  "steps": [
    {
      "action": "lookAround",
      "success": true,
      "metrics": { "durationMs": 200, "blocksFound": { "oak_log": 23, "birch_log": 8 } }
    },
    {
      "action": "goto",
      "success": true,
      "metrics": { "durationMs": 8000, "distance": 34 }
    },
    {
      "action": "findAndCollect",
      "success": true,
      "metrics": { "durationMs": 33800, "itemsCollected": 10, "itemsPerMinute": 17.7, "avgDistancePerItem": 4.2 }
    }
  ],
  "aggregateMetrics": {
    "totalDistance": 76,
    "totalItems": 10,
    "itemsPerMinute": 14.3,
    "avgDistancePerItem": 7.6
  }
}
```

---

## 5. AI 侧的进化循环

Bot Server 提供度量和策略执行能力，AI Agent 负责进化循环：

```
┌──────────────────────────────────────────────────┐
│                   AI Agent 决策循环                │
│                                                    │
│  1. 感知：GET /state + GET /events                 │
│  2. 回顾：读取历史策略和度量数据                     │
│  3. 对比：这次效率 vs 历史基准                       │
│  4. 反思：为什么更好/更差？形成假设                   │
│  5. 决策：选择/修改策略，或创建新策略                  │
│  6. 执行：POST /strategy 或 POST /action            │
│  7. 沉淀：把执行结果和度量写回策略库                  │
│                                                    │
└──────────────────────────────────────────────────┘
```

### 5.1 反思触发条件

不是每次执行都需要深度反思。建议触发条件：

- **失败时**：分析原因，更新策略避开同类错误
- **效率显著低于历史基准时**：对比差异，寻找原因
- **每 N 次执行后**：定期总结，更新参数
- **达成里程碑时**：回顾整个阶段的策略演变

### 5.2 策略进化示例

**第 1 次采集木头**（无历史经验）：

```
AI: 没有相关策略，直接用基础 action
→ POST /action { "type": "findAndCollect", "payload": { "blockName": "oak_log", "count": 10 } }
→ 结果：10 块木头，花了 3 分钟，跑了 247 格
→ AI 记录为基准
```

**第 2 次采集木头**：

```
AI: 上次效率 3.3/分钟，距离 24.7/块，感觉太分散了
→ 假设：先找到树多的地方再采集会更好
→ 创建策略 collect_wood_v1: lookAround → goto 密集区 → findAndCollect
→ POST /strategy { steps: [...] }
→ 结果：10 块木头，花了 1.5 分钟，跑了 83 格
→ 效率 6.7/分钟，提升 2 倍！记录为新基准
```

**第 5 次采集木头**：

```
AI: 策略 v1 稳定有效，但发现有时密集区恰好在悬崖边
→ 更新策略 v2: 加入安全检查，避开高度差大的区域
→ params.maxHeightDiff = 5
```

**这就是 AI 自主进化。不是人类写规则，是 AI 通过度量数据自己发现模式。**

---

## 6. 策略存储

### 6.1 存储位置

策略存储在 Bot Server 的 `data/strategies/` 目录，按 action 类型分文件：

```
bot-service/data/strategies/
  findAndCollect.json    # 采集相关策略
  fight.json             # 战斗相关策略
  craft.json             # 合成相关策略
  navigation.json        # 导航相关策略
  survival.json          # 生存综合策略
```

### 6.2 策略 API

| API | 方法 | 用途 |
|-----|------|------|
| `/strategies` | GET | 列出所有策略，支持 `?action=findAndCollect` 过滤 |
| `/strategies/:id` | GET | 获取单个策略详情 |
| `/strategies` | POST | 创建新策略 |
| `/strategies/:id` | PUT | 更新策略（参数调整、步骤修改） |
| `/strategies/:id/metrics` | POST | 追加一次执行的度量数据 |

### 6.3 度量历史

每个策略保留最近 N 次执行的度量，用于计算滑动平均和趋势：

```json
{
  "id": "collect_wood_v3",
  "metricsHistory": [
    { "time": "...", "itemsPerMinute": 14.3, "avgDistancePerItem": 7.6 },
    { "time": "...", "itemsPerMinute": 12.8, "avgDistancePerItem": 9.1 },
    { "time": "...", "itemsPerMinute": 15.1, "avgDistancePerItem": 6.8 }
  ],
  "movingAverage": {
    "itemsPerMinute": 14.1,
    "avgDistancePerItem": 7.8
  }
}
```

---

## 7. 与现有系统的关系

### 7.1 与 experienceManager 的关系

experienceManager 继续负责记录**原则层**的经验（死亡教训、严重失败等文本描述）。策略系统是它的补充，不是替代：

- experienceManager → **定性经验**："晚上出门会被怪物打死"
- 策略系统 → **定量策略**："采集前先扫描，效率提升 2x"

### 7.2 与 memoryManager 的关系

memoryManager 继续负责地标、资源区域等空间记忆。策略系统可以引用这些记忆：

```json
{
  "steps": [
    { "action": "goto", "params": { "selectBy": "memory_landmark", "landmarkType": "forest" } }
  ]
}
```

### 7.3 与现有 /action 的关系

`/action` 保持不变，但返回值增加 metrics 字段。`/strategy` 是 `/action` 之上的编排层，内部调用同样的 action handler。

---

## 8. 与 bot-server-task-layer.md 的对比

| 维度 | Task Layer 方案 | 本方案（进化系统） |
|------|----------------|------------------|
| 智能在哪 | 服务端硬编码规则 | AI 基于数据自己判断 |
| 进化方式 | 人类补规则 | AI 通过度量对比自主学习 |
| 扩展性 | 每新增场景要写代码 | AI 自己创建新策略 |
| 稳定性 | 高（固定逻辑） | 需要 AI 反思能力足够好 |
| 首次体验 | 开箱即用 | 需要冷启动积累数据 |
| Minecraft 复杂度适应 | 差（规则有限） | 好（数据驱动，持续学习） |

### 8.1 可以吸收的部分

Task Layer 方案中有一些值得保留的思想：

- **预算机制**（maxSubActions、maxRuntimeMs、abortOnDanger）→ 本方案的 strategy budget 直接采用
- **结构化输出优先于文本** → 本方案的度量系统完全遵循这一原则
- **milestone 概念** → 可以作为 AI 反思的触发条件，但由 AI 判定而非服务端硬编码

---

## 9. 实施顺序

### Phase 1: 度量基础设施

为现有 action handler 添加 metrics 返回：

- findAndCollect: 耗时、距离、效率
- fight: 耗时、伤害交换比
- goto: 路径效率
- craft / smelt: 耗时、成功率

这一步改动最小、风险最低、价值最高。有了度量数据，AI 就有了"对比"的基础。

### Phase 2: 策略存储与 API

- 实现 `data/strategies/` 存储
- 实现策略 CRUD API
- 实现 `POST /strategy` 策略执行端点

### Phase 3: AI 侧反思循环

- 更新 Skill Prompt，引导 AI 在执行后对比度量
- 引导 AI 在效率低下时创建/优化策略
- 引导 AI 定期回顾策略效果

### Phase 4: 冷启动优化

- 提供少量种子策略（基于人类常识的初始版本）
- AI 从种子策略开始，通过实际度量数据逐步优化

---

## 10. 总结

**核心理念：Bot Server 负责度量，AI 负责进化。**

不是给服务端塞更多硬编码规则让 AI 跑轨道，而是给 AI 提供足够丰富的度量数据，让它自己发现"什么是好的"，自己沉淀结构化策略，自己持续优化。

进化的载体不是自由文本（太模糊），不是 JavaScript 代码（太难写），而是**结构化策略** — 一种 AI 能读写、服务端能执行、数据能验证的中间形态。
