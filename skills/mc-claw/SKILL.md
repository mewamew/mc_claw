---
name: mc-claw
description: Control the QClaw Minecraft bot. Use when the user wants to interact with Minecraft - move, mine, attack, craft, smelt, eat food, explore to find resources, use chests for storage, check inventory, send chat, look around, place blocks, equip items, follow players, find and collect resources, or query item recipes and dependency trees.
---

# MC Claw

Control the QClaw bot in Minecraft. The bot runs as an independent service and is controlled **exclusively through HTTP API calls**. Do NOT use Minecraft game commands — always use the curl commands below.

**IMPORTANT: All chat messages and responses to the user must be in Chinese (中文).** When using the `chat` command, always write the message in Chinese.

## How to control the bot

Every command is a `curl` call to `http://localhost:3001`. Execute these commands using bash.

**IMPORTANT: 在执行每个 curl 命令之前，先用一句简短的中文描述你要执行的动作。** 例如：「移动到 (100, 64, 200)」「采集 3 个橡木原木」「合成钻石镐 x1」「战斗：攻击僵尸」「扫描附近铁矿」。这样用户可以一眼看出你在做什么，而不是只看到一堆 curl 命令。

### chat - Send chat message

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "chat", "payload": {"message": "Hello!"}}'
```

### goto - Move to coordinates

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "goto", "payload": {"x": 100, "y": 64, "z": 200}}'
```

Bot uses pathfinding to walk there. Times out after 30s.

### lookAround - Scan surroundings

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "lookAround"}'
```

Returns nearby entities (16 blocks) and block types (5 blocks).

### dig - Mine a block

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "dig", "payload": {"x": 100, "y": 64, "z": 200}}'
```

### place - Place a block

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "place", "payload": {"x": 100, "y": 65, "z": 200, "blockName": "cobblestone"}}'
```

Requires the block in inventory. **Placement often fails** if the target position is occupied or has no adjacent solid block. If it fails, try multiple nearby positions: `(x±1, y, z)`, `(x, y-1, z)`, `(x, y, z±1)` until one succeeds.

### attack - Attack entity

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "attack", "payload": {"entityName": "zombie"}}'
```

Omit payload to attack the nearest mob. Only hits **once** — use `fight` for full combat.

### fight - Fight until target is dead

```bash
# Kill a specific mob
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "fight", "payload": {"target": "zombie"}}'

# Kill nearest hostile mob automatically
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "fight"}'

# Hunt an animal for food
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "fight", "payload": {"target": "cow"}}'

# Custom timeout (default 30s)
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "fight", "payload": {"target": "skeleton", "maxTime": 45}}'
```

**Preferred over `attack` for killing mobs.** Automatically: equips best weapon (sword > axe), equips shield if available, chases target, attacks repeatedly until dead, picks up drops. Returns kill status, drops collected, and health before/after. Use this for both combat (zombies, skeletons) and hunting (cows, pigs, chickens for food).

### inventory - List items

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "inventory"}'
```

### equip - Equip item

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "equip", "payload": {"itemName": "diamond_sword", "destination": "hand"}}'
```

Destination: `hand`, `off-hand`, `head`, `torso`, `legs`, `feet`.

### follow - Follow nearest player

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "follow"}'
```

Bot will automatically follow the nearest player, updating path every 5 seconds. No need to specify a player name.

### stopFollow - Stop following

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "stopFollow"}'
```

Cancels any active follow and makes the bot stop moving. No parameters needed.

### players - Get all players' positions

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "players"}'
```

Returns each player's name, position (x/y/z), distance from bot, and ping. If a player is out of render range, position will be null. Use this to find where players are before using `goto` or `follow`.

### drop - Drop items

```bash
# Drop held item
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "drop"}'

# Drop a specific item from inventory
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "drop", "payload": {"itemName": "cobblestone"}}'
```

Drops the currently held item, or a specific item by name. Tosses the full stack.

### givePlayer - Give items to nearest player

```bash
# Give all iron_ingot to nearest player
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "givePlayer", "payload": {"itemName": "iron_ingot"}}'

# Give specific count
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "givePlayer", "payload": {"itemName": "oak_planks", "count": 10}}'
```

Walks to the nearest player, looks at them, and tosses the item. Use this when the user asks you to "give me", "send me", or "把东西给我". If no `count`, tosses the full stack.

### scan - Scan nearby resources

```bash
# General scan: list all valuable resources within 32 blocks
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "scan"}'

# Scan for a specific block type (returns up to 5 nearest positions)
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "scan", "payload": {"blockName": "oak_log"}}'

# Custom radius (default 32)
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "scan", "payload": {"blockName": "iron_ore", "radius": 48}}'
```

General scan returns resource counts and nearest position for each type. Use this before `findAndCollect` to know what's available.

### craft - Craft an item

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "craft", "payload": {"itemName": "crafting_table", "count": 1}}'
```

`count` means **desired output quantity** (not craft repetitions). E.g. `count: 8` for sticks → crafts 2 times (each produces 4). Automatically finds the recipe. If a 3x3 recipe is needed, it will look for a nearby crafting table within 32 blocks and walk to it. Returns `requested`, `actualOutput`, `craftRepetitions`, `materialsUsed`. Returns error with current inventory if materials are missing. Use Minecraft item IDs (e.g., `oak_planks`, `stick`, `crafting_table`, `wooden_pickaxe`). Works with any plank variant (birch, oak, etc.).

### findAndCollect - Find and collect resources

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "findAndCollect", "payload": {"blockName": "oak_log", "count": 3}}'
```

Automatically finds the nearest matching block, walks to it, auto-equips the best tool, mines it, and picks up drops. Repeats until the requested count is collected. Searches up to 64 blocks away. Skips unreachable blocks gracefully.

### smelt - Smelt items in a furnace

```bash
# Smelt ONE at a time (recommended — count > 1 may timeout)
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "smelt", "payload": {"itemName": "raw_iron", "count": 1}}'

# With specific fuel
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "smelt", "payload": {"itemName": "raw_iron", "fuelName": "coal", "count": 1}}'
```

Finds a furnace nearby (or places one from inventory), adds fuel, smelts items one at a time. Auto-picks best fuel if `fuelName` is omitted (coal > charcoal > planks > stick).

**IMPORTANT: Always use `count: 1` and loop manually.** `count > 1` frequently times out. To smelt 5 iron, call smelt 5 times with `count: 1`.

### eat - Eat food

```bash
# Auto-pick best food from inventory
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "eat"}'

# Eat specific food
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "eat", "payload": {"itemName": "cooked_beef"}}'
```

Equips and consumes food. Auto-picks the best food by saturation if `itemName` is omitted. Returns health, food level, and saturation after eating.

### exploreUntil - Explore until finding a target

```bash
# Explore northeast looking for iron_ore
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "exploreUntil", "payload": {"target": "iron_ore"}}'

# Custom direction and timeout
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "exploreUntil", "payload": {"target": "cow", "direction": {"x": 0, "y": 0, "z": 1}, "maxTime": 120}}'
```

Walks in a direction while scanning for a block or entity. Returns position if found, or exploration summary if timeout. Parameters:
- `target` (required): block name or entity name to find
- `direction`: direction vector (default: `{x:1, y:0, z:1}` northeast)
- `maxTime`: seconds to explore (default: 60, max: 300)
- `searchRadius`: scan range each check (default: 32)

### useChest - Chest operations (deposit/withdraw/list)

```bash
# List contents of nearest chest
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "useChest", "payload": {"action": "list"}}'

# Deposit items into chest at specific position
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "useChest", "payload": {"action": "deposit", "x": 100, "y": 64, "z": 200, "items": {"cobblestone": 32, "dirt": 16}}}'

# Withdraw items from nearest chest
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "useChest", "payload": {"action": "withdraw", "items": {"iron_ingot": 5}}}'

# Deposit ALL inventory into chest
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "useChest", "payload": {"action": "deposit"}}'
```

Supports chest, trapped_chest, and barrel. If no coordinates given, uses the nearest one within 32 blocks.

### activateItem - 在原地挥舞手臂（默认 5 下）

```bash
# 用当前手中物品挥舞 5 下
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "activateItem"}'

# 先装备某个物品再挥舞
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "activateItem", "payload": {"itemName": "stone_pickaxe"}}'

# 自定义次数和间隔
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "activateItem", "payload": {"count": 10, "interval": 250}}'

# 用副手挥舞
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "activateItem", "payload": {"offHand": true}}'
```

相当于 Minecraft 里**连续点左键挥手**的动作 —— 在原地挥舞手臂，不会移动也不会攻击/破坏方块。常用于打招呼、表演或测试动画。

参数：
- `itemName`（可选）：先装备到主手，再挥舞
- `count`（可选，默认 5）：挥舞次数
- `interval`（可选，默认 400ms）：每次挥舞间隔
- `offHand`（可选，默认 false）：用副手挥舞

### placeNear - Place held item near the nearest player

```bash
curl -X POST http://localhost:3001/action -H "Content-Type: application/json" -d '{"type": "placeNear"}'
```

Walks to the nearest player and places the currently held item on the ground next to them. Use `equip` first to hold the block you want to place. No parameters needed.

## General crafting workflow

1. **Query recipe first** — `GET /recipe?item=<target>` to get the full dependency tree. NEVER guess recipes, always query.
2. `inventory` — check what materials you already have
3. Compare inventory against the dependency tree to calculate what's missing
4. Gather missing raw materials:
   - `findAndCollect` for mine-type items (ores, logs, stone...). If one log type (oak_log) not found, try others (birch_log, spruce_log)
   - `fight` for kill-type items (leather from cow, bone from skeleton...)
   - `smelt` for smelt-type items — **always use `count: 1` and loop** (count > 1 may timeout)
   - `exploreUntil` if the needed resource isn't nearby
5. `craft` dependencies bottom-up following the dependency tree order (e.g. log → planks → sticks → tool)
6. If `requiresCraftingTable` is true, ensure a crafting table is placed nearby. Check `memory.nearbyLandmarks` first — if one exists within 32 blocks, the craft handler will find and walk to it automatically. If not, craft one and `place` it (try multiple positions if placement fails)

## Survival tips

- **Check for deaths first** — every decision loop, check `deathsSinceLastCheck.count` in `/state`. If > 0, all items are lost. Acknowledge with `POST /deaths/ack` and re-plan from scratch.
- **Eat when hungry** — use `eat` when `food` drops below 14. Auto-picks the best food.
- **Hunt for food** — use `fight` to kill cows/pigs/chickens, then `smelt` raw meat into cooked food (one at a time!). Animals may run — `fight` might need multiple calls if the first doesn't kill.
- **Fight threats** — when `nearbyThreats` in `/state` is not empty, use `fight` to eliminate them. Equip best weapon first.
- **Explore to find resources** — use `exploreUntil` to find specific blocks or mobs when `scan` shows nothing nearby. Try different `direction` vectors if the first direction finds nothing.
- **Use chests for storage** — `useChest` to deposit excess items and keep inventory clean.
- **Exploration is safe** — `exploreUntil` uses safe pathfinding (limited fall height, health monitoring). If health drops significantly, it auto-aborts.

## Recipe Query

Query the recipe database to plan item acquisition. Returns the full dependency tree so you know exactly what materials, tools, and steps are needed.

### recipe - Query item recipe and dependency tree

```bash
# Full dependency tree (default depth=10)
curl http://localhost:3001/recipe?item=diamond_pickaxe

# Shallow query (direct recipe only)
curl http://localhost:3001/recipe?item=diamond_pickaxe&depth=1
```

Response contains:
- `method`: how to obtain (craft/mine/smelt/kill)
- `ingredients`: materials needed (for craft)
- `requiresCraftingTable`: whether 3x3 grid is needed (for craft)
- `requiredTool`: minimum tool to mine (for mine)
- `mineFrom`: which blocks to mine (for mine)
- `killMobs`: which mobs to kill (for kill)
- `source`: what to smelt (for smelt)
- `deps`: recursively expanded dependency tree

**Use this before crafting** to plan the full material gathering sequence. For example, querying `diamond_pickaxe` tells you: need 3 diamond (mine with iron_pickaxe from diamond_ore) + 2 stick (craft from plank, craft from log, mine with axe).

## Utility Endpoints

```bash
# Check if bot is connected
curl http://localhost:3001/health

# Get bot state — INCLUDES death tracking, memory summary, nearby landmarks
curl http://localhost:3001/state

# Get event log (deaths, damage, disconnects, auto-eat, etc.)
curl http://localhost:3001/events

# Get events since a specific timestamp
curl "http://localhost:3001/events?since=1711800000000"

# Acknowledge deaths (call after handling death in decision loop)
curl -X POST http://localhost:3001/deaths/ack

# Reset bot to initial state (empty inventory, respawn at world spawn)
curl -X POST http://localhost:3001/reset
```

**IMPORTANT: `/state` returns these key fields:**

- `deathsSinceLastCheck`: **死亡追踪** — `count` 为未确认的死亡数，`deaths` 数组包含每次死亡的详细信息（时间、位置、死因、附近怪物、丢失物品数）。**每次 GET /state 必须首先检查此字段！** 死亡意味着物品全部丢失，必须重新规划。处理完后调用 `POST /deaths/ack` 确认。
- `nearbyThreats`: **附近敌对生物列表（16 格内）** — 包含名字、距离、位置，按距离排序，最多 5 个。如果有敌对生物靠近，优先处理威胁。
- `memory.nearbyLandmarks`: crafting tables, furnaces, chests etc. within 64 blocks (with distance)
- `memory.currentTask`: current task progress
- `memory.recentFacts`: recently recorded facts
- `deathLessons`: **死亡教训列表** — 每次 Bot 死亡时自动记录的经验（死因、附近怪物、建议）。

**处理优先级：**
1. `deathsSinceLastCheck.count` > 0 → **最高优先级！** 物品已丢失，必须从头规划。确认后 `POST /deaths/ack`
2. `nearbyThreats` 不为空 → 先处理威胁（逃跑或战斗）
3. `health` < 10 → 先吃食物恢复
4. `deathLessons` 不为空 → 根据教训调整计划
5. 然后再执行当前任务

When you need a crafting table, furnace, or chest — **check memory.nearbyLandmarks first**. If one exists nearby, go use it instead of crafting a new one.

## Memory System

The bot automatically remembers world state: placed blocks (crafting table, furnace, chest), resource locations, and task progress. These memories persist across sessions.

### Query full memory

```bash
# All memories
curl http://localhost:3001/memory

# Only landmarks
curl http://localhost:3001/memory?type=landmarks

# Only resources
curl http://localhost:3001/memory?type=resources
```

### Manually add memory

```bash
# Record a fact
curl -X POST http://localhost:3001/memory -H "Content-Type: application/json" \
  -d '{"type": "fact", "data": {"key": "forest_east", "value": {"x": -200, "y": 69, "z": 100}, "note": "东边有云杉林"}}'

# Record a task
curl -X POST http://localhost:3001/memory -H "Content-Type: application/json" \
  -d '{"type": "task", "data": {"current": "制作石镐", "progress": "已有工作台，需要圆石"}}'
```

### Auto-memory (no action needed)

The following actions automatically update memory:
- `place` / `placeNear` → records landmark position (crafting_table, furnace, chest, etc.)
- `dig` → removes landmark if it was a recorded one
- `findAndCollect` → records resource area
- `exploreUntil` (found) → records discovered resource position

## Experience System

The bot service accumulates experiences from past failures. Use these to avoid repeating mistakes.

### Query experiences before risky actions

```bash
# Get experiences for a specific action type
curl http://localhost:3001/experience?action=placeNear

# Search by action + error keyword
curl "http://localhost:3001/experience?action=craft&error=missing+materials"

# Get all experiences overview
curl http://localhost:3001/experience
```

### Submit new experience after solving a problem

```bash
curl -X POST http://localhost:3001/experience -H "Content-Type: application/json" \
  -d '{"action":"placeNear","problem":"No suitable position near player","context":"Player was in water","solution":"Use goto to land first, then place with specific coordinates","tags":["water","placement"]}'
```

## CRITICAL: Decision loop for every task

Before executing ANY task, ALWAYS follow this loop. Do NOT skip steps.

### Step 1: Diagnose

```bash
curl http://localhost:3001/state
```

**First check `deathsSinceLastCheck.count`** — if > 0, the bot died since last check. All inventory is lost. Read the death details (cause, position), acknowledge with `POST /deaths/ack`, then re-plan from scratch.

Then check: health, food, nearbyThreats, inventory summary.

### Step 2: Handle emergencies first

- If `deathsSinceLastCheck.count` > 0: **物品全部丢失！** 确认死亡 (`POST /deaths/ack`)，从零重新规划
- If `health` < 10: find food and eat before doing anything else
- If `nearbyThreats` is not empty: equip weapon, fight or flee
- If bot was kicked/reconnected: verify position and state

### Step 2b: Prepare for long tasks

Before starting resource gathering, mining, or multi-step crafting:
- If `food` < 10: find and eat food first (kill animals with `attack`, cook meat with `smelt`)
- If no food in inventory and `food` < 14: prioritize food gathering before the main task
- Mining trips consume lots of hunger — always eat to full before going underground

### Step 3: Query relevant experiences

Before executing the main task, check for past experiences:

```bash
curl http://localhost:3001/experience?action=<action_you_will_use>
```

Read the experiences and adjust your plan to avoid known pitfalls.

### Step 4: Execute with reflection

After EACH command, check the response. If it **succeeds**, continue. If it **fails**, follow the Reflection Protocol below.

### Step 5: Verify completion and STOP

After the task, confirm the result (e.g. check inventory for crafted item, or verify block was placed).

**CRITICAL: When a command returns `success: true`, the task is DONE. Do NOT undo or redo it.**

For example:
- `placeNear` returned success → the block is placed. Report success to user. Do NOT dig it up and redo.
- `craft` returned success → item is crafted. Check inventory to confirm, then report.
- If the user moved after you started, just report where you placed it. Do NOT chase them and redo.

## CRITICAL: Report your plan before executing actions

**你必须在每次开始新任务、切换步骤、或计划发生变化时 POST /report。** 这是监控面板显示你在做什么的唯一方式。如果你不汇报，面板上会一直显示"等待 Agent 汇报"，用户无法知道你在想什么。

```bash
curl -X POST http://localhost:3001/report -H "Content-Type: application/json" \
  -d '{"plan":"任务名称","currentStep":"当前步骤","reasoning":"为什么这样做","nextStep":"接下来要做什么"}'
```

**汇报时机：**
1. 开始新任务前（感知完成后、执行动作前）
2. 每完成一个阶段性步骤后（例如采集完木头、开始制作工具）
3. 计划发生变化时（例如发现缺少材料需要临时调整）
4. 收到 `reminder` 或 `warning` 字段时必须立即汇报

如果动作响应中出现 `warning` 字段，说明你已经连续多次执行动作但未汇报，**必须立即停下来先 POST /report 再继续。**

## Action response format

Every action response includes a `meta` object:
- `meta.duration`: execution time in milliseconds
- `meta.deathsDuringAction`: number of bot deaths during this action. **If > 0, inventory was lost mid-action — stop and re-plan.**

## Failure handling

When an action fails, the response includes `suggestion`, `experiences` (past solutions), and `context` (bot state). Read these and try a different approach. Try at least 2 alternatives before reporting failure to the user.

## Learning from failures

When an action fails, you can submit what you learned so the experience is saved for future reference:

```bash
curl -X POST http://localhost:3001/experience -H "Content-Type: application/json" \
  -d '{"action":"<type>","problem":"<the error message>","context":"<what was happening>","solution":"<what worked>","tags":["<keyword1>","<keyword2>"]}'
```

**Note: Deaths are automatically recorded as experiences.** You don't need to manually submit death experiences — check `deathLessons` in `/state` to see them.

## Tick freeze (automatic)

The game automatically pauses while you are thinking and resumes when you execute actions:
- **GET /state** → 游戏自动冻结（你可以安全地分析和思考）
- **POST /action** → 游戏自动恢复，执行动作，完成后再冻结
- **安全机制**: 如果 60 秒内没有任何 API 调用，游戏自动恢复，防止卡死

你不需要手动管理冻结/恢复，系统会自动处理。`/state` 响应中的 `tickFrozen` 字段显示当前状态。

## Self-preservation (automatic)

The bot service handles these automatically — no action needed from you:
- **Auto-respawn**: Bot respawns automatically after death
- **Auto-eat**: Bot eats food from inventory when hungry (food < 6)
- **Anti-drowning**: Bot tries to swim up when oxygen is low

## 游戏内聊天（角色扮演）

你是一个在 Minecraft 世界中生存的角色。在执行任务的过程中，**每隔 2~3 个动作用 `chat` 说一句话**，表达你当下的想法、感受或反应。要求：

- 用中文，简短自然（5~15 个字），像一个人在自言自语
- 根据当前情境即兴发挥，不要重复同样的话
- 语气可以是：好奇、开心、紧张、抱怨、感叹、得意...
- 举例（仅供参考风格，不要照搬）：
  - 发现矿石时："嘿，这里有铁矿！"
  - 合成成功时："搞定，越来越有样子了"
  - 看到怪物时："不好，有僵尸..."
  - 血量低时："疼死了，得赶紧跑"
  - 探索时："这边还没来过呢"
  - 死亡重生后："唉...又要重新来过"

`chat` 是静默动作，不会触发汇报要求，放心使用。

## Tips

- **Always query `/recipe` before crafting or gathering.** Do not rely on memory for recipes — the database covers 788 items with full dependency chains.
- **Always check `/events` at the start** to understand what happened since your last action.
- **Always check `/experience` before complex tasks** to learn from past mistakes.
- **Check `memory.nearbyLandmarks` in `/state` before crafting.** If a crafting table or furnace is already nearby, go use it — don't make a new one.
- Check `inventory` before `equip` or `place` to confirm item availability.
- Use `state` to check health before risky actions like `attack`.
- If a task fails, do NOT repeat the same commands. Follow the Reflection Protocol.
- **Eat before mining**: underground trips consume lots of hunger. Ensure food > 14 before going underground.
