# MC Claw - 用 AI 玩 Minecraft 生存模式

## 背景

我们希望用 AI Agent 控制 Minecraft 中的机器人，实现自主生存游戏。

系统采用"大脑 + 手脚"分离架构：AI Agent 作为大脑负责决策，Mineflayer Bot 服务作为手脚负责执行。Agent 具备以下能力：

- **定时触发**：按 cron 表达式定时唤醒 Agent
- **持久化 Session**：JSONL 格式，跨 turn 保持状态
- **Memory 系统**：文件级别的长期记忆
- **Skill 系统**：可动态加载的技能，支持运行时创建新技能

Mineflayer 是一个成熟的 Minecraft bot 框架（Node.js），可以程序化控制游戏内的角色。

## 目标

让 AI Agent 通过 Mineflayer 自主玩 Minecraft 生存模式，具备以下能力：

1. **自主生存** - 采集资源、合成工具、建造庇护所、应对怪物
2. **持续决策** - 定时唤醒，每轮进行感知→复盘→规划→执行→记忆的完整循环
3. **经验积累** - 从游戏中学习，把重复模式沉淀为技能和记忆
4. **技能进化** - 在游戏过程中自动创建和优化技能

## 架构设计

### 整体思路

将系统分为"手脚"和"大脑"两层：

- **Mineflayer Bot 服务（手脚）**：独立的 Node.js 进程，持续连接 Minecraft 服务器，暴露 HTTP API
- **AI Agent（大脑）**：定时唤醒，通过 API 感知游戏状态、做出决策、发送指令

两者通过 HTTP API 通信，互不依赖对方的生命周期。

```
┌─────────────────────────────────────────────┐
│              Mineflayer Bot 服务              │
│  持久运行，维护游戏连接，缓存事件日志          │
│  暴露 HTTP API：查状态 / 发指令 / 读日志       │
└──────────────┬──────────────────┬────────────┘
               │ 查询状态          │ 发送指令
               │                  │
┌──────────────▼──────────────────▼────────────┐
│            AI Agent（定时唤醒）                 │
│                                              │
│  每轮循环：                                   │
│  1. 感知 - 调 API 获取 bot 状态 + 事件日志     │
│  2. 复盘 - 对比上一轮的计划和实际结果          │
│  3. 规划 - 根据当前状态制定下一步计划          │
│  4. 执行 - 发指令给 bot                       │
│  5. 记忆 - 更新经验（什么有效，什么失败）       │
│                                              │
└──────────────────────────────────────────────┘
```

### Mineflayer Bot 服务

独立的 Node.js 进程，提供以下 API：

| API | 方法 | 用途 |
|-----|------|------|
| `/state` | GET | 位置、血量、饥饿值、背包、周围环境 |
| `/logs` | GET | 上次查询以来发生的事件（被攻击、死亡、天黑等） |
| `/action` | POST | 执行单个动作（挖矿、移动、合成、建造等） |
| `/action/batch` | POST | 批量执行一系列动作 |

关键设计：Bot 需要缓存两次 Agent 唤醒之间发生的所有事件，确保 Agent 醒来后能了解"不在期间发生了什么"。

### AI Agent 决策循环

通过 cron trigger 定时唤醒（如每 5 分钟一次），每次执行一轮完整的决策循环：

1. **感知** - 调用 `/state` 和 `/logs` 获取当前游戏状态和最近事件
2. **复盘** - 回顾上一轮的计划，对比实际执行结果，总结经验
3. **规划** - 根据当前状态、长期目标和历史经验，制定下一步行动计划
4. **执行** - 通过 `/action` 或 `/action/batch` 发送具体指令
5. **记忆** - 将本轮经验写入记忆系统，更新长期计划

### 记忆层

| 内容 | 存储方式 | 示例 |
|------|---------|------|
| 长期计划 | memory 文件 | "今天的目标：建一个带围墙的木屋" |
| 短期计划 | session 内 plan | "先砍 20 棵树，再合成木板" |
| 经验教训 | memory 文件 | "晚上不要出门，会被怪物打死" |
| 合成配方 / 建筑模板 | Bot 服务配方数据库 + skill references | 788 种物品配方（/recipe 端点查询）、建筑蓝图 |

### 技能进化

Agent 在游戏过程中发现重复模式时，可以将其沉淀为新的 skill：

- 反复手动砍树 → 总结出"自动砍树"技能
- 多次被怪物打死 → 总结出"夜间生存"技能
- 反复建同一种结构 → 总结出"建造模板"技能

---

## 实现（v0.4）

### 当前状态

- 统一技能 `mc-claw` 支持完整的生存指令集 + 配方查询
- 集成 Odyssey 项目的配方数据库（788 种物品），Bot 服务提供 `/recipe` 端点
- 参考 Odyssey 控制原语，新增熔炼、进食、探索、箱子操作能力，优化合成诊断和采集效率

### 项目结构

```
mc-claw/
├── README.md
├── specs/
│   ├── architecture.md              # 本文档
│   └── odyssey-recipes/             # Odyssey 配方数据（原始备份）
├── bot-service/
│   ├── package.json                 # mineflayer + express
│   ├── index.js                     # Bot 服务主入口 + HTTP API
│   ├── handlers/                    # Action handler 模块
│   │   ├── smelt.js                 # 熔炼（自动放燃料、逐个熔炼）
│   │   ├── eat.js                   # 进食（自动选最佳食物）
│   │   ├── exploreUntil.js          # 定向探索（直到找到目标）
│   │   ├── useChest.js              # 箱子操作（存取、列表）
│   │   ├── craft_improved.js        # 合成（智能缺料诊断）
│   │   └── findAndCollect_improved.js # 采集（批量寻找、自动装备工具）
│   └── data/recipes/                # 配方数据库（JSON）
│       ├── func.json                # 788 物品→获取方式
│       ├── pre_item.json            # 630 合成配方
│       ├── pre_smelt.json           # 51 熔炼配方
│       ├── pre_tool.json            # 92 采矿所需工具
│       ├── pre_collect.json         # 26 击杀掉落物映射
│       └── map_name.json            # 22 泛称→具体物品名映射
└── skills/
    └── mc-claw/
        └── SKILL.md                 # 统一控制技能（AI Agent Skill）
```

### 配置

| 项目 | 值 |
|------|-----|
| Minecraft 服务器 | `localhost:18888` |
| Minecraft 版本 | `1.20` |
| Bot 用户名 | `QClaw` |
| Bot 服务 HTTP 端口 | `3001` |

### Bot 服务 API

| API | 方法 | 用途 |
|-----|------|------|
| `/health` | GET | 服务健康检查 |
| `/state` | GET | Bot 位置、血量、饥饿值、游戏模式 |
| `/action` | POST | 执行动作 |
| `/recipe` | GET | 查询物品配方和完整依赖链（`?item=diamond_pickaxe&depth=10`） |

### 指令集

#### 第一批：生存基础（已实现）

| 指令 | type | payload | 说明 | 状态 |
|------|------|---------|------|------|
| 聊天 | `chat` | `{message}` | 发送聊天消息 | ✅ |
| 移动 | `goto` | `{x, y, z}` | 走到指定坐标（A*寻路） | ✅ |
| 查看周围 | `lookAround` | 无 | 获取附近的方块、生物、玩家 | ✅ |
| 挖掘 | `dig` | `{x, y, z}` | 挖指定位置的方块 | ✅ |
| 放置 | `place` | `{x, y, z, blockName}` | 在指定位置放方块 | ✅ |
| 攻击 | `attack` | `{entityName?}` | 攻击最近的/指定的生物 | ✅ |
| 查看背包 | `inventory` | 无 | 列出背包物品 | ✅ |
| 装备 | `equip` | `{itemName, destination}` | 切换手持/穿戴物品 | ✅ |
| 跟随 | `follow` | 无 | 自动跟随最近的玩家 | ✅ |
| 停止跟随 | `stopFollow` | 无 | 取消跟随，原地停下 | ✅ |

#### 中层指令：复合能力（已实现）

| 指令 | type | payload | 说明 | 状态 |
|------|------|---------|------|------|
| 合成 | `craft` | `{itemName, count?}` | 自动查找配方合成，失败时精确报告缺料 | ✅ |
| 熔炼 | `smelt` | `{itemName, fuelName?, count?}` | 自动找/放熔炉、加燃料、熔炼 | ✅ |
| 进食 | `eat` | `{itemName?}` | 自动选最佳食物进食 | ✅ |
| 寻找采集 | `findAndCollect` | `{blockName, count?}` | 批量寻找→自动装备工具→挖掘→捡起 | ✅ |
| 定向探索 | `exploreUntil` | `{target, direction?, maxTime?}` | 沿方向探索直到找到目标方块/生物 | ✅ |
| 箱子操作 | `useChest` | `{action, x?, y?, z?, items?}` | 存取物品、查看箱子内容 | ✅ |
| 放在玩家旁 | `placeNear` | 无 | 走到最近玩家旁，放置手持物品 | ✅ |

中层指令封装了多步逻辑，Agent 只需编排 3-4 步调用即可完成复杂任务（如"做个工作台放我面前"）。

#### 资源查询（已实现）

| 指令 | type | payload | 说明 | 状态 |
|------|------|---------|------|------|
| 扫描资源 | `scan` | `{blockName?, radius?}` | 扫描周围资源分布 | ✅ |
| 丢弃 | `drop` | `{itemName?, count?}` | 丢弃手持或指定物品 | ✅ |

#### 配方查询（已实现）

`GET /recipe?item=<物品名>&depth=<展开深度>` — 独立端点，不依赖 Bot 连接状态。

返回完整依赖树，包含：获取方式（craft/mine/smelt/kill）、材料清单、所需工具、可挖掘的矿石变种、需击杀的生物等。数据来源于 Odyssey 项目的配方数据库（MIT 许可证）。

#### 待开发

| 指令 | type | payload | 说明 |
|------|------|---------|------|
| 远程射击 | `shoot` | `{entityName?}` | 用弓箭/弩远程射击 |
| 睡觉 | `sleep` | 无 | 找到床并睡觉跳过夜晚 |

### 技能编写经验

- Skill 文档必须明确说明所有操作通过 HTTP API（curl）执行，否则 AI 会尝试用 Minecraft 游戏内指令
- 每个指令都要给完整的 curl 示例，不能只给 JSON body
- 不需要参数的指令要明确写"无需参数"，避免 AI 猜测参数

### 已实现的技能

| 技能 | 触发方式 | 功能 |
|------|---------|------|
| `mc-claw` | `/mc-claw` 或自然语言 | 统一控制 QClaw 机器人 |

### 启动方式

```bash
# 1. 安装依赖
cd bot-service && npm install

# 2. 启动 Bot 服务
npm start

# 3. 安装技能到 AI Agent（仅首次或更新时，路径根据你使用的 Agent 框架调整）
# cp -r skills/mc-claw <your-agent-skills-dir>/
```
