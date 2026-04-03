# 单 Agent 前提下的 Bot Server Policy/Workflow Runtime 设计

> 日期：2026-04-02
> 状态：Draft v2
> 说明：本版用于替代“以硬编码 task layer 为中心”的初稿，改为“薄内核 + 可演化 workflow/policy runtime”路线。

---

## 1. 背景与问题重述

当前项目的真实运行链路是：

`AI Agent -> Skill Prompt -> Bot Server -> Minecraft`

当前已知前提：

- 只考虑 **单 Agent** 主控
- Skill Prompt 可以改，但本质仍是 **静态协议**
- Bot Server 当前是 **纯脚本**，内部没有 LLM
- 不做多 Agent 协作
- 不做独立的旁路演化进程

同时，项目的原始目标不是把 Bot Server 写成一个巨大的硬编码 Minecraft 专家系统，而是：

- 让 AI 在运行中不断试错
- 把有效模式沉淀下来
- 让能力最终沉淀在 Bot Server，而不是沉淀成一堆 prompt 文本

因此，本设计的关键问题不是：

- “如何手写更多 task”

而是：

- “如何让 Bot Server 成为 AI 产出策略的运行时与沉淀载体”

---

## 2. 核心判断

### 2.1 Bot Server 不应该主导高层智能

因为它没有 LLM，所以它不能：

- 开放式发明新策略
- 自主反思复杂失败
- 自主生成新工作流

### 2.2 Bot Server 应该提供薄而稳的内核

Bot Server 真正应该负责的是：

- 可靠动作执行
- 安全约束
- 状态抽取
- 结构化评估
- Workflow/Policy 的校验、运行、统计、激活

### 2.3 真正会增长的部分，不该硬编码在服务端源码里

真正需要持续增长的应该是：

- workflow
- fallback chain
- success criteria 组合
- parameter preference
- policy routing

这些应该作为 **数据化 artifact** 存在，而不是写死在 handler 里。

---

## 3. 目标架构

### 3.1 四层模型

本设计把 Bot Server 分成四层：

#### Layer 1: Action Kernel

现有动作和复合动作：

- `goto`
- `dig`
- `place`
- `craft`
- `smelt`
- `eat`
- `fight`
- `findAndCollect`
- `exploreUntil`
- `useChest`
- `build`

这一层负责“可执行动作”。

#### Layer 2: Derived State

由规则派生出的局面摘要：

- threat summary
- inventory summary
- capability summary
- stage summary
- recent failure summary

这一层负责“当前局面长什么样”。

#### Layer 3: Evaluation Kernel

提供可复用的结构化评估原语：

- 是否满足某种背包条件
- 是否达到某个食物储备
- 是否附近存在某类 landmark
- 是否最近有死亡/威胁/失败

这一层负责“怎么判断成功、失败、阻塞、风险”。

#### Layer 4: Workflow/Policy Runtime

运行由 Agent 提案、服务端存储的 artifact：

- workflow
- policy

这一层负责“如何复用过去试出来的策略”。

---

## 4. 设计原则

### 4.1 薄内核原则

服务端源码中只保留那些必须稳定、必须可测试、必须对世界安全负责的东西。

应硬编码的：

- action executor
- safety guards
- evaluator primitives
- workflow interpreter
- schema validator
- stats / activation logic

不应硬编码的：

- 大量游戏阶段脚本
- 长链路任务模板
- 复杂 fallback 树
- “下一步该做什么”的全部策略

### 4.2 数据优先原则

“能力增长”优先表现为 artifact 的增加与迭代，而不是源码分支越来越多。

### 4.3 单链路带内演化原则

不引入独立演化进程。

同一个 Agent 的同一条主链路中，允许发生：

1. 执行动作或 workflow
2. 验收结果
3. 提交候选 workflow/policy
4. 后续轮次继续使用或修正

也就是：

- 运行
- 反思
- 提案
- 再使用

都发生在同一条链路里。

### 4.4 服务端只接受“可解释、可校验”的策略

Bot Server 不接受任意代码执行。

它只接受引用现有 action / evaluator primitive 的结构化 artifact。

---

## 5. 为什么这不是“硬编码更多规则”

这套方案和“写很多 `/task` if/else”有本质区别。

### 5.1 硬编码式 task layer 的问题

如果长期靠服务端源码手写任务：

- 复杂度会快速膨胀
- 覆盖不了开放世界变化
- 每次策略改进都要改代码
- 最终变成巨大的、脆弱的规则树

### 5.2 Runtime 方案的不同点

本方案里：

- 服务端只提供运行时和评估原语
- 高层工作流由 Agent 提炼为 artifact
- 服务端负责验证、运行、统计、激活

也就是说，服务端是 **策略运行平台**，不是 **策略内容全集**。

---

## 6. 新增能力的核心对象

本设计引入两个核心对象：

- `workflow`
- `policy`

### 6.1 Workflow

定义：一段可复用的、多步、有限预算的动作序列。

典型例子：

- 收集基础木头并做出工作台
- 打猎并把生肉熔成熟肉
- 回收低价值物品到箱子

Workflow 解决的是：

- “这件事通常怎么做”

### 6.2 Policy

定义：在什么局面下，优先使用哪个 workflow，用什么参数，失败后按什么顺序回退。

典型例子：

- 饥饿低且熟食不足时，优先运行 `stock_food_v3`
- 背包快满时，优先尝试 `deposit_inventory_v2`
- 夜晚且附近有敌对生物时，禁止运行外出采矿型 workflow

Policy 解决的是：

- “什么时候该用哪套 workflow”

---

## 7. 新增 API 设计

本版不再以 `/task` 为中心，而是引入 workflow/policy 相关接口。

### 7.1 保留的现有接口

- `GET /state`
- `GET /events`
- `POST /action`
- `GET /memory`
- `POST /memory`
- `GET /experience`
- `POST /experience`
- `POST /report`

这些保持兼容。

### 7.2 建议新增接口

- `GET /situation`
- `POST /evaluate`
- `GET /workflows`
- `GET /workflows/:id`
- `POST /workflow/run`
- `POST /workflow/propose`
- `GET /policies`
- `POST /policy/propose`

说明：

- `workflow` 是主扩展面
- `policy` 可放在第二阶段落地
- 旧的 `/action` 继续作为最低层能力接口

---

## 8. `GET /situation`

用途：提供结构化的局面摘要，供 Agent 判断当前该做什么。

### 返回结构

```json
{
  "threats": {
    "nearbyHostiles": 2,
    "nearestHostileDistance": 4.5,
    "hasCreeperClose": false
  },
  "survival": {
    "health": 11,
    "food": 5,
    "hasFoodInInventory": true,
    "cookedFoodCount": 2
  },
  "inventory": {
    "usedSlots": 32,
    "freeSlots": 4,
    "woodLogs": 8,
    "cobblestone": 21,
    "coal": 0,
    "rawIron": 3,
    "ironIngot": 0
  },
  "capabilities": {
    "hasCraftingTable": true,
    "hasFurnace": true,
    "hasChest": false,
    "hasShield": false,
    "hasBaseFact": false
  },
  "milestoneHints": {
    "hasStonePickaxe": true,
    "hasStableFoodSupply": false,
    "hasBase": false
  },
  "signals": [
    {
      "code": "food_low",
      "severity": "high",
      "reason": "food < 8"
    },
    {
      "code": "inventory_nearly_full",
      "severity": "medium",
      "reason": "freeSlots <= 4"
    }
  ]
}
```

### 设计要点

- `situation` 只输出派生信息
- 不直接替代 `/state`
- 不试图给出完整高层计划
- 只提供弱约束的结构化信号

换句话说：

- 它是“局面理解原语”
- 不是“服务端总代替 Agent 做决策”

---

## 9. `POST /evaluate`

用途：对某个目标或某个 workflow 的结果做结构化验收。

### 请求结构

```json
{
  "mode": "goal",
  "name": "stock_food",
  "params": {
    "targetCookedFood": 16
  }
}
```

或：

```json
{
  "mode": "workflow",
  "name": "stock_food_v3",
  "params": {
    "targetCookedFood": 16
  }
}
```

### 返回结构

```json
{
  "success": false,
  "progress": {
    "currentCookedFood": 6,
    "targetCookedFood": 16
  },
  "missing": [
    "need 10 more cooked food"
  ],
  "riskFlags": [
    "food_low"
  ],
  "notes": [
    "no animals seen in recent events"
  ]
}
```

### 设计要点

- `evaluate` 是规则内核，不依赖 LLM
- 可被 workflow step 复用
- 既能被 Agent 调，也能被 runtime 内部调用

---

## 10. `GET /workflows`

用途：列出当前可用 workflow。

### 返回结构

```json
{
  "workflows": [
    {
      "id": "stock_food_v3",
      "goal": "stock_food",
      "status": "active",
      "version": 3,
      "successRate": 0.71,
      "runs": 14,
      "tags": ["food", "survival", "hunt", "smelt"]
    },
    {
      "id": "gather_basic_wood_v2",
      "goal": "gather_basic_wood",
      "status": "draft",
      "version": 2,
      "successRate": 0.5,
      "runs": 2,
      "tags": ["wood", "bootstrap"]
    }
  ]
}
```

### `status` 定义

- `draft`
  - 通过 schema 校验，但尚未证明稳定
- `active`
  - 已满足最小运行成功阈值
- `disabled`
  - 成功率过低或被显式停用

---

## 11. `POST /workflow/run`

用途：运行某个 workflow。

### 请求结构

```json
{
  "id": "stock_food_v3",
  "inputs": {
    "targetCookedFood": 16
  },
  "budget": {
    "maxSteps": 6,
    "maxRuntimeMs": 45000,
    "stopOnRisk": true
  }
}
```

### 返回结构

```json
{
  "success": true,
  "completed": false,
  "workflow": "stock_food_v3",
  "goal": "stock_food",
  "steps": [
    {
      "type": "action",
      "name": "fight",
      "success": true
    },
    {
      "type": "action",
      "name": "smelt",
      "success": true
    }
  ],
  "evaluation": {
    "success": false,
    "missing": ["need 4 more cooked food"]
  },
  "statsUpdated": true,
  "budgetUsed": {
    "steps": 2,
    "runtimeMs": 15320
  }
}
```

### 语义说明

- `success`
  - workflow 运行过程中没有出现不可恢复异常
- `completed`
  - workflow 对应目标已经满足

也就是说：

- `success = true, completed = false`
  - 表示“这次执行没炸，但目标还没完全达成”

这点对于开放世界非常关键。

---

## 12. `POST /workflow/propose`

用途：由 Agent 在主链路内提交一个候选 workflow。

### 请求结构

```json
{
  "workflow": {
    "id": "stock_food_v3",
    "goal": "stock_food",
    "description": "hunt nearby animals, smelt meat, stop when cooked food target reached",
    "version": 3,
    "inputsSchema": {
      "targetCookedFood": {
        "type": "number",
        "required": true
      }
    },
    "budget": {
      "maxSteps": 6,
      "maxRuntimeMs": 45000
    },
    "preconditions": [
      { "type": "food_below", "value": 14 },
      { "type": "inventory_free_slots_at_least", "value": 2 }
    ],
    "successCriteria": [
      {
        "type": "cooked_food_at_least",
        "valueFromInput": "targetCookedFood"
      }
    ],
    "steps": [
      {
        "type": "action",
        "name": "fight",
        "payload": { "target": "cow" },
        "optional": true
      },
      {
        "type": "action",
        "name": "fight",
        "payload": { "target": "pig" },
        "optional": true
      },
      {
        "type": "action",
        "name": "smelt",
        "payload": { "itemName": "raw_beef", "count": 8 },
        "optional": true
      },
      {
        "type": "action",
        "name": "smelt",
        "payload": { "itemName": "raw_porkchop", "count": 8 },
        "optional": true
      }
    ],
    "fallbacks": [
      { "type": "action", "name": "exploreUntil", "payload": { "target": "cow", "maxTime": 60 } }
    ],
    "tags": ["food", "survival", "hunt"]
  }
}
```

### 服务端必须做的校验

- schema 合法
- `id` / `goal` / `version` 完整
- 只引用存在的 action
- 只引用存在的 evaluator primitive
- 输入变量引用合法
- step 数量不超上限
- budget 不超系统上限

### 返回结构

```json
{
  "accepted": true,
  "status": "draft",
  "validation": {
    "errors": [],
    "warnings": [
      "workflow has two optional fight steps and may depend on local mob availability"
    ]
  }
}
```

---

## 13. `POST /policy/propose`

用途：提交“在什么局面下优先使用哪个 workflow”的策略。

说明：

- `workflow` 是第一优先级
- `policy` 建议放到第二阶段

### 请求结构

```json
{
  "policy": {
    "id": "food_low_policy_v1",
    "description": "when hunger is low and cooked food is insufficient, prefer stock_food workflows",
    "match": [
      { "type": "signal_present", "value": "food_low" },
      { "type": "cooked_food_below", "value": 8 }
    ],
    "prefer": [
      "stock_food_v3",
      "stock_food_v2"
    ],
    "avoidWhen": [
      { "type": "signal_present", "value": "hostile_nearby" }
    ],
    "fallback": [
      "gather_basic_wood_v2"
    ]
  }
}
```

### 作用

Policy 不直接改世界，只影响：

- workflow 推荐顺序
- 默认参数
- fallback 顺序

---

## 14. Workflow DSL 设计

为了防止服务端被变成“任意代码执行器”，workflow DSL 必须很小。

### 14.1 首批 step 类型

- `action`
  - 调用现有 `/action` handler
- `check`
  - 调用 evaluator primitive
- `branch`
  - 基于某个 check 选择下一步
- `stop`
  - 提前结束

初期不要支持：

- 任意 JavaScript
- 无限循环
- 深层嵌套
- 动态生成新的 action 名称

### 14.2 首批 evaluator primitive

建议内置以下评估原语：

- `has_item`
- `inventory_item_at_least`
- `inventory_free_slots_at_least`
- `health_at_least`
- `food_at_least`
- `cooked_food_at_least`
- `nearby_hostile_count_below`
- `signal_present`
- `memory_fact_exists`
- `landmark_nearby`
- `recent_event_present`

这些 primitive 应该是服务端源码中稳定、可测试的部分。

### 14.3 变量能力

Workflow 可以有有限输入变量：

- `targetCookedFood`
- `targetCount`
- `blockName`
- `radius`

但不允许复杂表达式。

---

## 15. 运行时统计与激活机制

这是“能力沉淀在 Bot Server”最关键的一层。

### 15.1 服务端应记录

对每个 workflow 记录：

- `runs`
- `successRuns`
- `completedRuns`
- `failureRuns`
- `avgRuntimeMs`
- `recentErrors`
- `lastUsedAt`

### 15.2 激活规则

建议：

- 新提案默认 `draft`
- `draft` 在满足最小样本后可晋升为 `active`
- 典型阈值：
  - `runs >= 3`
  - `completedRuns / runs >= 0.6`

### 15.3 降级规则

如果某个 `active` workflow：

- 最近 10 次完成率过低
- 或频繁触发相同错误

则自动降为：

- `draft`
- 或 `disabled`

这样，服务端不会只是“存策略”，而会真的管理它们的可用性。

---

## 16. 单 Agent 下的带内演化闭环

这部分是整份设计的核心。

### 16.1 主链路

单个 Agent 每轮可以按以下协议工作：

1. `GET /state`
2. `GET /events`
3. `GET /situation`
4. `GET /workflows`
5. 优先选择 `active workflow`
6. 没有合适 workflow 时，退回原始 `/action`
7. 执行后 `POST /evaluate`
8. 如果这轮出现了稳定模式，`POST /workflow/propose`

### 16.2 这意味着什么

即使：

- prompt 是静态的
- Bot Server 没有 LLM

系统仍然可以增长，因为增长体现在：

- workflow artifact 的积累
- policy artifact 的积累
- runtime stats 的积累

而不是体现在：

- prompt 越来越长
- Bot Server 源码越写越多

---

## 17. Bootstrap：最小内置内容应该是什么

为了让系统一开始能跑起来，仍然需要极少量内置内容。

但这里的原则是：

- **只内置启动内核**
- **不内置长期主路线**

### 17.1 建议保留的内置能力

- 当前 action handlers
- 当前 reflex layer
- `situation` 派生规则
- evaluator primitives
- workflow/policy store
- workflow interpreter

### 17.2 可以接受的少量内置 workflow

只建议保留极少数系统级 bootstrap workflow，例如：

- `emergency_eat`
- `emergency_flee`
- `deposit_low_value_items`

这些应理解为：

- 系统自救原语

而不是：

- 完整的生存攻略

---

## 18. 对 Skill Prompt 的影响

这套方案下，Skill Prompt 应该是协议，不是知识库。

### 18.1 Prompt 该做什么

- 读取状态与局面
- 查询现有 workflow
- 选择使用已有 workflow 还是原始 action
- 在成功或失败后尝试提炼新的 workflow/policy 提案

### 18.2 Prompt 不该做什么

- 携带过长的发展阶段脚本
- 携带大量世界知识 if/else
- 长篇描述固定建造攻略
- 在自然语言里存储全部 fallback 逻辑

换句话说：

- prompt 固定协议
- knowledge 长在 workflow/policy store

---

## 19. 内部模块划分建议

建议新增如下模块：

```text
bot-service/
  derived/
    situationService.js
    capabilitySummary.js
    signalDetector.js
  evaluators/
    primitives.js
    goalEvaluators.js
  workflows/
    schema.js
    repository.js
    validator.js
    interpreter.js
    stats.js
  policies/
    schema.js
    repository.js
    validator.js
    matcher.js
```

职责：

- `derived/`
  - 生成结构化局面信息
- `evaluators/`
  - 提供稳定评估原语
- `workflows/`
  - workflow 校验、存储、运行、统计
- `policies/`
  - policy 校验、存储、匹配

---

## 20. 实施顺序

### Phase 1: 先做内核，不做大量 workflow

先落地：

- `GET /situation`
- `POST /evaluate`
- evaluator primitives
- workflow schema
- workflow repository

### Phase 2: 再做 workflow runtime

新增：

- `GET /workflows`
- `POST /workflow/propose`
- `POST /workflow/run`

### Phase 3: 再做 stats / activation

新增：

- workflow success stats
- `draft -> active -> disabled` 状态流转

### Phase 4: 最后再做 policy

新增：

- `GET /policies`
- `POST /policy/propose`
- policy matcher

原因：

- workflow 是主体
- policy 只是调度层

---

## 21. 最小结论

如果按项目初衷来收敛，Bot Server 不该演进成一个越来越大的硬编码任务树。

更合适的方向是：

1. 把 Bot Server 做成 **薄内核**
2. 让 AI 在主链路里持续试错
3. 把成功模式提炼成 **workflow/policy artifact**
4. 由 Bot Server 负责 **校验、运行、统计、激活**

这样：

- Bot Server 仍然是能力沉淀主体
- 但能力不是沉淀成越来越多的源码分支
- 而是沉淀成可演化、可管理、可复用的策略资产

这更符合“让 AI 持续试错和进化”的原始目标。
