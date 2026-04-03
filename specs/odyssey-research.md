# Odyssey 项目深度技术调研报告

> 项目地址：https://github.com/zju-vipa/Odyssey
> 论文：[Odyssey: Empowering Minecraft Agents with Open-World Skills](https://arxiv.org/abs/2407.15325)（IJCAI 2025 录用）
> 许可证：MIT License（可自由使用、修改、分发）

---

## 1. 项目概览

Odyssey 是浙江大学 VIPA 实验室开发的 Minecraft AI Agent 框架，**基于 Voyager 框架改造**，核心改进有三点：

1. **开放世界技能库**：40 个原始技能 + 183 个组合技能（Voyager 仅 18 个原始技能）
2. **开源 LLM 支持**：使用微调的 LLaMA-3 替代 GPT-4，降低成本
3. **Agent 能力基准测试**：新增长期规划、动态即时规划、自主探索三类任务

---

## 2. 仓库结构

```
Odyssey/
├── LLM-Backend/                      # LLM 推理服务部署代码
├── MC-Crawler/                       # Minecraft Wiki 数据爬取工具
├── MC-Comprehensive-Skill-Library/   # 自动化物品采集系统（独立于 Agent）
│   ├── json/                         # 配方和依赖关系 JSON
│   │   ├── func.json                 # 物品→获取方式映射
│   │   ├── map_name.json             # 物品名称映射
│   │   ├── pre_collect.json          # 采集掉落物映射
│   │   ├── pre_item.json             # 合成配方
│   │   ├── pre_smelt.json            # 熔炼配方
│   │   └── pre_tool.json             # 所需工具映射
│   ├── skill/                        # 核心功能实现
│   │   ├── primitiveAPIs.js          # 基础功能：craft/mine/smelt/place/explore
│   │   ├── combatAPIs.js             # 战斗功能：killMob/shoot
│   │   ├── collectItem.js            # 物品收集（杀怪掉落/挖掘）
│   │   ├── obtainItem.js             # 统一物品获取入口
│   │   ├── equipAPIs.js              # 装备管理
│   │   ├── chestAPIs.js              # 箱子操作
│   │   ├── spatialAPIs.js            # 空间检测工具
│   │   └── jsonAPIs.js               # JSON 配方查询
│   └── README.md
├── MineMA-Model-Fine-Tuning/        # LLaMA 模型微调流水线
├── Multi-Agent/                      # 多 Agent 框架（2025.02 新增）
├── Odyssey/                          # 核心 Agent 实现
│   ├── main.py                       # 主入口
│   ├── requirements.txt
│   ├── odyssey/
│   │   ├── odyssey.py                # Agent 主循环
│   │   ├── agents/
│   │   │   ├── actor.py              # 动作 Agent
│   │   │   ├── planner.py            # 规划 Agent
│   │   │   ├── critic.py             # 评估 Agent
│   │   │   ├── comment.py            # 评论 Agent
│   │   │   ├── skill.py              # 技能管理器（向量检索）
│   │   │   └── llama.py              # LLaMA 调用封装
│   │   ├── control_primitives/       # 底层控制原语（JS）
│   │   │   ├── craftItem.js
│   │   │   ├── mineBlock.js
│   │   │   ├── killMob.js
│   │   │   ├── placeItem.js
│   │   │   ├── smeltItem.js
│   │   │   ├── exploreUntil.js
│   │   │   ├── shoot.js
│   │   │   ├── useChest.js
│   │   │   └── ...（共 11 个 JS 文件）
│   │   ├── env/                      # 环境接口（与 Mineflayer 桥接）
│   │   └── prompts/                  # 各 Agent 的 Prompt 模板
│   └── skill_library/
│       └── skill/
│           ├── primitive/            # 22 个原始技能（JS）
│           ├── compositional/        # 183 个组合技能（JS）
│           ├── description/          # 技能描述文本
│           └── skills.json           # 技能索引
├── LICENSE                           # MIT 许可证
└── README.md
```

---

## 3. 技能库深度分析

### 3.1 技能体系总览

Odyssey 的技能分为三层：

| 层级 | 位置 | 数量 | 说明 |
|------|------|------|------|
| **控制原语** | `odyssey/control_primitives/` | 11 个 | 最底层 Mineflayer 封装，不可再分 |
| **原始技能** | `skill_library/skill/primitive/` | 22 个 | 调用控制原语的单步技能 |
| **组合技能** | `skill_library/skill/compositional/` | 183 个 | 编排原始技能的多步任务 |

> **注意**：论文声称 40 个原始技能，但仓库实际只有 22 个原始技能文件。差异可能是因为论文将部分控制原语也计入了原始技能（11 + 22 ≈ 33，加上 `spatialAPIs.js` 中的空间检测函数凑满 40）。

### 3.2 控制原语（11 个 JS 文件）

这些是直接调用 Mineflayer API 的最底层函数：

| 文件 | 功能 |
|------|------|
| `craftItem.js` | 合成物品（查找工作台、放置、合成） |
| `mineBlock.js` | 挖掘方块（搜索、装备工具、采集） |
| `killMob.js` | 击杀生物（近战/远程、等待死亡、收集掉落） |
| `smeltItem.js` | 熔炼物品（放置熔炉、添加燃料、等待完成） |
| `placeItem.js` | 放置方块 |
| `exploreUntil.js` | 定向探索（回调检测、定时寻路） |
| `shoot.js` | 远程射击 |
| `useChest.js` | 箱子操作（存取物品） |
| `craftHelper.js` | 合成辅助 |
| `givePlacedItemBack.js` | 回收已放置方块 |
| `waitForMobRemoved.js` | 等待生物消失事件 |

### 3.3 原始技能（22 个 JS 文件）

完整列表：

| 类别 | 技能名 | 功能 |
|------|--------|------|
| **移动** | `goto.js` | 寻路到指定坐标 |
| **空间检测** | `findSuitablePosition.js` | 寻找可放置方块的位置 |
| | `checkAdjacentBlock.js` | 检测相邻方块 |
| | `checkBlockAbove.js` | 检测上方方块 |
| | `checkBlocksAround.js` | 检测四周方块 |
| | `checkNearbyBlock.js` | 检测附近方块（指定半径） |
| | `checkNoAdjacentBlock.js` | 检测相邻是否无指定方块 |
| **装备** | `equipSword.js` | 装备最好的剑 |
| | `equipPickaxe.js` | 装备最好的镐 |
| | `equipAxe.js` | 装备最好的斧 |
| | `equipHoe.js` | 装备最好的锄 |
| | `equipShovel.js` | 装备最好的铲 |
| | `equipArmor.js` | 装备最好的盔甲 |
| **战斗** | `killMonsters.js` | 击杀指定怪物 |
| | `killAnimal.js` | 击杀指定动物 |
| **食物** | `cookFood.js` | 烹饪食物（放熔炉） |
| | `eatFood.js` | 吃食物回血 |
| **农业** | `plantSeeds.js` | 种植种子 |
| | `feedAnimals.js` | 喂养动物 |
| **工具** | `getAnimal.js` | 获取附近动物实体 |
| | `getLogsCount.js` | 统计木头数量 |
| | `getPlanksCount.js` | 统计木板数量 |

### 3.4 组合技能（183 个 JS 文件）

按类别分类：

#### 繁殖类（4 个）
`breedChicken`, `breedCow`, `breedPig`, `breedSheep`

#### 收集类（22+ 个）
`collectBamboo`, `collectBeetroots`, `collectCactusBlocks`, `collectCarrots`, `collectCobblestone`, `collectCocoaBeans`, `collectDirt`, `collectFlowers`, `collectLavaWithBucket`, `collectMelon`, `collectMelonSeeds`, `collectMilkWithBucket`, `collectPotatoes`, `collectPumpkin`, `collectPumpkinSeeds`, `collectSand`, `collectSandstone`, `collectSugarCane`, `collectWaterWithBucket`, `collectWheat`, `collectWheatSeeds`

#### 烹饪类（4 个）
`cookBeef`, `cookChicken`, `cookMutton`, `cookPorkchop`

#### 合成 - 工具武器（60+ 个）
覆盖木/石/铁/金/钻五个材料等级的：斧、镐、铲、剑、锄
以及：弓、箭、打火石、钓鱼竿、剪刀、盾牌、望远镜

#### 合成 - 盔甲（12 个）
金/铁/钻三个等级的：头盔、胸甲、护腿、靴子

#### 合成 - 方块材料（29 个）
各种矿物块、台阶、楼梯、围墙、脚手架、火把、梯子、铁轨、铁栏杆等

#### 合成 - 容器工具（15 个）
箱子、炼药锅、桶、碗、船、矿车、漏斗、熔炉、工作台、活塞、时钟、指南针等

#### 挖矿类（14 个）
煤、铁、金、钻石、绿宝石、铜、红石、青金石、紫水晶、燧石、圆石等

#### 熔炼类（6 个）
铁/金/铜矿石熔炼、仙人掌→绿色染料、沙子→玻璃

#### 装备类（8 个）
`equipAxeOrCraftOne`（没有就先合成再装备）等

#### 农业类（4 个）
`hoeFarmland`, `plantMelonSeeds`, `plantPumpkinSeeds`, `plantWheatSeeds`

#### 战斗类（17 个）
杀蝙蝠、骆驼、鸡、牛、苦力怕、驴、末影人、马、骡、猪、兔子、羊、骷髅、史莱姆、蜘蛛、海龟、僵尸

#### 其他（7 个）
`catchFish`, `shearOneSheep`, `placeMinecartOnRail`, `placeRail`, `takeAndMoveMinecart`, `depositIntoChest`, `placeChest`, `placeWater`

### 3.5 技能代码格式详解

所有技能都是 **async JavaScript 函数**，统一格式如下：

```javascript
// 原始技能示例：装备剑
async function equipSword(bot) {
    const Sword = bot.inventory.findInventoryItem(mcData.itemsByName.diamond_sword.id) ||
                  bot.inventory.findInventoryItem(mcData.itemsByName.iron_sword.id) ||
                  bot.inventory.findInventoryItem(mcData.itemsByName.stone_sword.id) ||
                  bot.inventory.findInventoryItem(mcData.itemsByName.golden_sword.id) ||
                  bot.inventory.findInventoryItem(mcData.itemsByName.wooden_sword.id);
    if (Sword) {
        await bot.equip(Sword, "hand");
        bot.chat("Sword equipped.");
        return true;
    } else {
        bot.chat("No sword in inventory.");
        return false;
    }
}
```

```javascript
// 组合技能示例：合成钻石镐
async function craftDiamondPickaxe(bot) {
    let diamondsCount = bot.inventory.count(mcData.itemsByName.diamond.id);
    const sticksCount = bot.inventory.count(mcData.itemsByName.stick.id);
    if (sticksCount < 2) {
        await craftSticks(bot);       // 调用其他组合技能
    }
    while (diamondsCount < 3) {
        await mineDiamond(bot);       // 调用其他组合技能
        diamondsCount = bot.inventory.count(mcData.itemsByName.diamond.id);
    }
    const craftingTableCount = bot.inventory.count(mcData.itemsByName.crafting_table.id);
    if (craftingTableCount === 0) {
        await craftCraftingTable(bot); // 调用其他组合技能
    }
    const craftingTablePosition = await findSuitablePosition(bot); // 调用原始技能
    await placeItem(bot, "crafting_table", craftingTablePosition); // 调用控制原语
    await craftItem(bot, "diamond_pickaxe", 1);                    // 调用控制原语
    bot.chat("Crafted a diamond pickaxe.");
}
```

```javascript
// 组合技能示例：杀僵尸
async function killOneZombie(bot) {
    await equipSword(bot);           // 原始技能
    const zombie = await exploreUntil(bot, new Vec3(1, 0, 1), 60, () => {
        return bot.nearestEntity(entity => {
            return entity.name === "zombie" &&
                   entity.position.distanceTo(bot.entity.position) < 32;
        });
    });
    if (!zombie) {
        bot.chat("Could not find a zombie.");
        return;
    }
    await killMob(bot, "zombie", 300);  // 控制原语
    bot.chat("Killed a zombie.");
    await bot.pathfinder.goto(new GoalBlock(zombie.position.x, zombie.position.y, zombie.position.z));
    bot.chat("Collected dropped items.");
}
```

**关键特征：**
- 所有函数第一个参数都是 `bot`（Mineflayer Bot 实例）
- 使用 `mcData`（minecraft-data）查询物品/方块 ID
- 使用 `bot.pathfinder` + `GoalBlock`/`GoalNear` 寻路
- 使用 `Vec3` 表示方向和坐标
- 通过 `bot.chat()` 输出状态信息
- 组合技能通过直接调用其他技能函数名来编排

---

## 4. 技术架构详解

### 4.1 整体架构

```
┌─────────────────────────────────────────────────┐
│                  Python Agent 层                  │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Planner  │  │  Actor   │  │  Critic  │       │
│  │(任务分解) │  │(代码生成) │  │(结果验证) │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │             │
│  ┌────┴──────────────┴──────────────┴────┐       │
│  │         SkillManager                   │       │
│  │  (ChromaDB 向量检索 + 技能代码库)       │       │
│  └────────────────┬──────────────────────┘       │
│                   │                               │
│  ┌────────────────┴──────────────────────┐       │
│  │         LLaMA 推理服务                 │       │
│  │  (本地 HTTP / DashScope API)           │       │
│  └───────────────────────────────────────┘       │
└───────────────────┬───────────────────────────────┘
                    │ HTTP REST API
┌───────────────────┴───────────────────────────────┐
│              Node.js Mineflayer 层                  │
│                                                     │
│  ┌─────────────┐  ┌──────────────────────┐        │
│  │ Mineflayer  │  │ control_primitives   │        │
│  │   Bot       │  │ (JS 控制原语)         │        │
│  └──────┬──────┘  └──────────────────────┘        │
│         │                                          │
│  ┌──────┴──────────────────────────────────┐      │
│  │        Minecraft 服务器通信              │      │
│  └─────────────────────────────────────────┘      │
└────────────────────────────────────────────────────┘
```

### 4.2 Agent 循环

1. **感知**：从 Mineflayer 获取游戏状态（背包、坐标、周围方块、装备、生命值等）
2. **规划**：Planner Agent 使用 LLaMA-70B 分解目标为子任务列表
3. **检索**：SkillManager 用 ChromaDB 向量数据库语义检索 top-k 相关技能
4. **执行**：Actor Agent 使用 LLaMA-8B 选择/生成 JS 代码，通过 HTTP 发送给 Mineflayer 执行
5. **验证**：Critic Agent 使用 LLaMA-70B 判断任务是否成功
6. **迭代**：失败则回到第 3 步重试，成功则进入下一个子任务

### 4.3 技能检索机制

```python
# 使用 sentence-transformers 生成嵌入向量
embedding = HuggingFaceEmbeddings(model_name="paraphrase-multilingual-MiniLM-L12-v2")

# ChromaDB 向量数据库存储技能描述的嵌入
vectordb = Chroma(embedding_function=embedding, persist_directory=...)

# 语义相似度搜索
results = vectordb.similarity_search_with_score(query=task_description, k=5)
```

### 4.4 Python-JavaScript 桥接

Python Agent 和 Mineflayer Bot 通过 **HTTP REST API** 通信：

| 端点 | 功能 |
|------|------|
| `POST /start` | 初始化 Minecraft 连接 |
| `POST /step` | 发送 JS 代码执行，返回游戏状态 |
| `POST /pause` | 暂停/恢复 |
| `POST /stop` | 断开连接 |

Node.js 服务作为子进程运行，默认端口 3000。

### 4.5 LLM 配置

| Agent | 模型 | 用途 |
|-------|------|------|
| Actor | LLaMA-3 8B（微调版） | 代码生成/选择 |
| Planner | LLaMA-3 70B | 任务分解 |
| Critic | LLaMA-2 70B | 结果验证 |
| QA（知识问答） | LLaMA-3（390K 条 Wiki 数据微调） | Minecraft 知识 |

---

## 5. 与 Voyager 的关系和区别

| 维度 | Voyager | Odyssey |
|------|---------|---------|
| **代码基础** | 原创 | 基于 Voyager 改造 |
| **LLM** | GPT-4（闭源、贵） | LLaMA-3（开源、可本地部署） |
| **原始技能** | 18 个 | 40 个（含控制原语） |
| **组合技能** | 动态生成（无预定义库） | 183 个预定义 + 动态生成 |
| **技能检索** | 嵌入相似度 | 嵌入相似度（相同方案） |
| **任务类型** | 自主探索为主 | 探索 + 战斗 + 农业 + 子目标 |
| **知识源** | GPT-4 内置知识 | 微调 LLaMA + Wiki QA |
| **开发团队** | MineDojo / NVIDIA | 浙江大学 VIPA Lab |

Odyssey 的核心贡献是证明了 **开源 LLM + 预定义技能库** 可以在部分任务上接近甚至超越 GPT-4 驱动的 Voyager。

---

## 6. MC-Comprehensive-Skill-Library（独立采集系统）

除了 Agent 使用的技能库外，Odyssey 还包含一个**独立的自动化采集系统**：

- 支持获取 Minecraft 三个维度中的 **789 种主要物品**
- 统一入口：`obtainItem(bot, count, type)`
- 通过 JSON 配方表递归解决物品依赖
- 自动判断获取方式（挖矿/合成/熔炼/击杀/采集）

这个系统更像一个**物品获取引擎**，与 Agent 技能库是两套独立的代码。

---

## 7. 兼容性评估：能否移植到 MC Claw？

### 7.1 技能代码依赖分析

每个技能函数依赖以下全局对象/函数：

| 依赖项 | 来源 | MC Claw 是否有 |
|--------|------|----------------|
| `bot` | Mineflayer Bot 实例 | 有（核心） |
| `mcData` | `minecraft-data` 包 | 需引入 |
| `bot.pathfinder` | `mineflayer-pathfinder` 插件 | 需引入 |
| `GoalBlock`, `GoalNear`, `GoalNearXZ` | `mineflayer-pathfinder` | 需引入 |
| `Vec3` | `vec3` 包 | 需引入 |
| `bot.collectBlock` | `mineflayer-collectblock` 插件 | 需引入 |
| `bot.autoAttack` / `bot.pvp` | PVP 插件 | 需引入或自实现 |
| 其他技能函数互相调用 | 技能库自身 | 需一起导入 |
| `bot.chat()` 作为日志 | Mineflayer 内置 | 有 |

### 7.2 移植适配工作量评估

#### 可直接复用的部分
- **组合技能逻辑**：183 个组合技能的编排逻辑（先做什么再做什么）可直接复用
- **空间检测函数**：`findSuitablePosition`、`checkAdjacentBlock` 等纯计算函数
- **装备管理函数**：`equipSword`、`equipPickaxe` 等优先级装备逻辑
- **JSON 配方表**：6 个 JSON 文件的物品依赖关系数据

#### 需要适配的部分
- **控制原语需改造**：`craftItem`、`mineBlock`、`killMob` 等需要适配 MC Claw 的 HTTP API 模式
- **全局变量注入**：`mcData`、`Vec3`、`GoalBlock` 等需要在执行环境中预先注入
- **错误处理**：原始代码缺乏健壮的错误处理，需加强
- **代码质量**：部分代码有 bug（如 `goto.js` 中 `positon` 拼写错误）

#### 不适用的部分
- **Python Agent 层**：Odyssey 的 Planner/Actor/Critic 架构与 MC Claw 的 AI Agent 架构不同
- **LLaMA 推理服务**：MC Claw 使用不同的 LLM 方案
- **ChromaDB 向量检索**：MC Claw 有自己的 Skill 管理机制

### 7.3 推荐移植策略

1. **优先移植控制原语**（11 个 JS 文件）：这些是最有价值的底层 Mineflayer 封装
2. **选择性移植组合技能**：按 MC Claw 的实际需求挑选，不必全部移植
3. **复用 JSON 配方表**：物品依赖关系数据是宝贵的结构化知识
4. **参考但不复制 Agent 架构**：两个项目的 Agent 设计理念不同

### 7.4 适配工作量预估

| 工作项 | 预估工时 |
|--------|----------|
| 搭建控制原语适配层 | 2-3 天 |
| 移植核心控制原语（11个） | 3-5 天 |
| 移植原始技能（22个） | 1-2 天 |
| 选择性移植组合技能（50个常用） | 2-3 天 |
| 集成 JSON 配方表 | 1 天 |
| 测试和调试 | 3-5 天 |
| **总计** | **约 12-19 天** |

---

## 8. 许可证和使用权

- **许可证**：MIT License
- **版权**：2023 MineDojo Team
- **可以做**：使用、复制、修改、合并、发布、分发、再许可、商业使用
- **要求**：在分发时包含版权声明和许可证文本
- **限制**：无担保，作者不承担任何责任

**结论：MIT 许可证是最宽松的开源许可证之一，我们可以自由使用和改编 Odyssey 的代码。**

---

## 9. 关键发现和建议

### 价值最高的资源
1. **控制原语代码**（`control_primitives/`）：成熟的 Mineflayer 底层封装，值得移植
2. **JSON 配方表**（`MC-Comprehensive-Skill-Library/json/`）：789 种物品的获取方式和配方数据
3. **组合技能的编排模式**：提供了大量"先做A再做B"的任务编排参考

### 需要注意的问题
1. **代码质量参差**：部分技能有 bug（拼写错误、逻辑缺陷）
2. **Minecraft 版本**：代码基于 1.20 版本，与 MC Claw 一致
3. **状态管理缺失**：技能没有统一的状态管理/错误恢复机制
4. **硬编码较多**：很多物品名、距离阈值等是硬编码的

---

## 参考来源

- [GitHub - zju-vipa/Odyssey](https://github.com/zju-vipa/Odyssey)
- [论文 - arXiv:2407.15325](https://arxiv.org/abs/2407.15325)
- [IJCAI 2025 Proceedings](https://www.ijcai.org/proceedings/2025/0022.pdf)
- [OpenReview Discussion](https://openreview.net/forum?id=vtGLtSxtqv)
- [Voyager 项目](https://github.com/MineDojo/Voyager)
- [Voyager 架构分析](https://medium.com/trueagi/voyager-for-minecraft-under-the-hood-3e6cc7e3cb25)
