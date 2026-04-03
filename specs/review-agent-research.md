# AI Agent 自我监督与复盘机制 - 调研报告

> 调研日期：2026-04-01
> 目的：为 MC Claw 项目设计"复盘 Agent"提供理论和实践参考

---

## 目录

1. [Voyager 的 Critic/Verifier 机制](#1-voyager-的-criticverifier-机制)
2. [Odyssey 的 Planner-Actor-Critic 架构](#2-odyssey-的-planner-actor-critic-架构)
3. [Reflexion 的自我反思机制](#3-reflexion-的自我反思机制)
4. [DEPS 的交互式规划与自我解释](#4-deps-的交互式规划与自我解释)
5. [GITM 的层次化分解架构](#5-gitm-的层次化分解架构)
6. [Multi-Agent 协作模式](#6-multi-agent-协作模式)
7. [自动化性能分析：Trajectory-Informed Memory](#7-自动化性能分析trajectory-informed-memory)
8. [OpenAI 自进化 Agent Cookbook](#8-openai-自进化-agent-cookbook)
9. [AI Agent 可观测性与监控](#9-ai-agent-可观测性与监控)
10. [综合对比与 MC Claw 复盘 Agent 设计建议](#10-综合对比与-mc-claw-复盘-agent-设计建议)

---

## 1. Voyager 的 Critic/Verifier 机制

**论文**: [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291)
**代码**: [GitHub - MineDojo/Voyager](https://github.com/MineDojo/Voyager)

### 1.1 核心架构

Voyager 由三个组件组成：
- **Curriculum Agent（自动课程）**：提出下一个探索任务
- **Action Agent（行动代理）**：生成 JavaScript 代码执行任务
- **Critic Agent（评审代理）**：验证任务是否完成，提供改进建议

### 1.2 Critic 的工作机制

Critic Agent 是一个独立的 GPT-4 实例，专门负责"审查"行动结果。

**输入数据**（从 `critic.txt` prompt 和 `critic.py` 实现中提取）：
- 当前生物群系（biome）
- 玩家血量和饥饿度
- 背包物品清单
- 周围方块信息
- 装备状态
- 箱子内容
- 当前任务描述

**输出格式** — 严格的 JSON：
```json
{
  "reasoning": "分析当前状态与任务目标的差距...",
  "success": true/false,
  "critique": "具体的改进建议，如：你还需要采集 3 个铁矿石..."
}
```

**评估逻辑**（从 prompt 分析）：
- **资源采集类任务**：统计背包中匹配物品的总数
- **合成类任务**：验证材料是否充足，物品是否在背包或装备槽中
- **环境类任务**（如种植）：检查"周围方块"而非背包
- **进食类任务**：饥饿度是否达到 20.0/20.0
- **战斗类任务**：通过战利品（如腐肉）验证

### 1.3 反馈循环

```
Action Agent 生成代码
       ↓
执行代码，获取环境反馈 + 执行错误
       ↓
Critic Agent 评估（check_task_success）
       ↓
   成功？──→ 存入技能库，进入下一个任务
       │
   失败 → critique 文本回传给 Action Agent
       ↓
Action Agent 下一轮代码生成（最多 5 轮重试）
```

关键代码（`voyager.py`）：
```python
success, critique = self.critic_agent.check_task_success(
    events=events,
    task=self.task,
    context=self.context,
    chest_observation=self.action_agent.render_chest_observation(),
    max_retries=5,
)
```

### 1.4 关键发现

- **移除 Critic 会导致发现物品数下降 73%** — 这是所有反馈类型中最重要的
- Critic 的核心价值：决定"何时推进到下一个任务"vs"何时重试当前任务"
- 失败时的 critique 是**具体且可操作的**，不是泛泛而谈

### 1.5 对 MC Claw 的启示

Voyager 的 Critic 是**即时验证模式**（每次执行后立即检查），而 MC Claw 是 cron 触发的异步模式。我们需要的不是即时 Critic，而是**跨轮次的复盘机制**。

---

## 2. Odyssey 的 Planner-Actor-Critic 架构

**论文**: [Odyssey: Empowering Minecraft Agents with Open-World Skills](https://arxiv.org/abs/2407.15325)
**代码**: [GitHub - zju-vipa/Odyssey](https://github.com/zju-vipa/Odyssey)

### 2.1 三层架构

- **Planner（规划器）**：将高层目标分解为具体可执行的子目标
- **Actor（执行器）**：从技能库中检索并应用最相关的技能执行子目标
- **Critic（评审器）**：评估执行结果，提供反馈和策略优化建议

### 2.2 技能库

- 40 个原始技能（primitive skills）
- 183 个组合技能（compositional skills）
- 基于微调的 LLaMA-3 模型（390k+ 指令数据，源自 Minecraft Wiki）

### 2.3 评估体系

三类任务评估基准：
- **长期规划任务**：如准备与怪物战斗的全套装备
- **动态即时规划任务**：需要适应突发变化
- **自主探索任务**：测试 Agent 独立发现和交互的能力

### 2.4 与 Voyager 的对比

| 维度 | Voyager | Odyssey |
|------|---------|---------|
| Critic 输入 | 游戏状态 JSON | 游戏状态 + 技能执行结果 |
| 技能库 | 动态生成（代码） | 预定义 + 组合 |
| 模型 | GPT-4 | 微调 LLaMA-3 |
| 反馈目标 | 代码改进 | 策略优化 |

### 2.5 对 MC Claw 的启示

MC Claw 的配方数据库（788 种物品）就是借鉴自 Odyssey。它的 Planner-Actor-Critic 三层架构值得参考，但 MC Claw 已经有了"感知→复盘→规划→执行→记忆"的循环，可以在现有"复盘"步骤上做深度增强。

---

## 3. Reflexion 的自我反思机制

**论文**: [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)（NeurIPS 2023）
**代码**: [GitHub - noahshinn/reflexion](https://github.com/noahshinn/reflexion)

### 3.1 核心创新

**用"语言反馈"代替"梯度更新"**。Agent 不更新权重，而是通过文本形式的反思来改进行为。

### 3.2 三组件架构

```
┌──────────┐     生成轨迹     ┌──────────┐     评分     ┌──────────┐
│  Actor   │ ──────────────→ │ Evaluator│ ──────────→ │  Self-   │
│          │                 │          │             │Reflection│
│ (行动者)  │ ←───────────── │ (评估者)  │             │ (反思者)  │
│          │   反思 + 记忆    │          │             │          │
└──────────┘                 └──────────┘             └──────────┘
                                                          │
                                                     存入长期记忆
                                                     (episodic buffer)
```

**各组件职责**：

1. **Actor（行动者）**：
   - 基于 CoT 或 ReAct 模式生成动作
   - 接收长期记忆中的反思文本作为上下文

2. **Evaluator（评估者）**：
   - 对 Actor 产生的轨迹打分
   - 输出奖励信号（reward score）
   - 可以是 LLM 或规则引擎

3. **Self-Reflection（自我反思）**：
   - **输入**：奖励信号 + 当前轨迹 + 持久化记忆
   - **输出**：具体的语言化反馈（verbal reinforcement cues）
   - 类似于"语义梯度"——给 Agent 一个明确的改进方向

### 3.3 记忆系统

- **短期记忆**：当前尝试的轨迹（trajectory）
- **长期记忆**：提炼后的反思文本，持久存储
- 使用滑动窗口管理容量，复杂任务可用向量嵌入

### 3.4 工作流程

```
定义任务 → 生成轨迹 → 评估 → 反思 → 生成下一次轨迹
                ↑                        │
                └────────────────────────┘
```

### 3.5 关键洞察

- 反思产生的不是泛泛的"做得更好"，而是**具体的、有针对性的改进建议**
- 这些反思存在**episodic memory buffer**中，后续尝试可以参考
- 类比人类：不是只知道"失败了"，而是"我失败了，因为X，下次应该Y"

### 3.6 对 MC Claw 的启示

**这是最直接可借鉴的模式**。MC Claw 已经有经验系统（`experience.json`），Reflexion 的机制可以直接映射：
- Actor = 执行 Agent（当前的决策循环）
- Evaluator = 检查游戏状态变化（血量、背包、任务完成度）
- Self-Reflection = 复盘 Agent（生成语言化经验并存入记忆）

---

## 4. DEPS 的交互式规划与自我解释

**论文**: [Describe, Explain, Plan and Select](https://arxiv.org/abs/2302.01560)（ICML 2023）
**代码**: [GitHub - CraftJarvis/MC-Planner](https://github.com/CraftJarvis/MC-Planner)

### 4.1 核心组件

- **Descriptor（描述器）**：事件触发，描述当前执行状态
- **Explainer（解释器）**：当执行失败时，LLM 解释为什么失败
- **Planner（规划器）**：LLM 生成和修正计划
- **Selector（选择器）**：可训练模块，根据预估完成步数排序并行子目标

### 4.2 关键机制

- 失败时不仅重新规划，还要**自我解释为什么失败**
- 这个"解释"步骤使错误修正更精准
- Goal Selector 解决了"并行子目标优先级"问题

### 4.3 成果

首个在 Minecraft 中零样本完成 70+ 任务的 Agent，性能接近翻倍。

### 4.4 对 MC Claw 的启示

DEPS 的"Explain"步骤（失败后自我解释）可以整合到复盘 Agent 中。当 MC Claw 某个行动失败时，不只是记录"失败了"，而是要求 Agent 解释"为什么失败"，并将这个解释存入经验系统。

---

## 5. GITM 的层次化分解架构

**论文**: [Ghost in the Minecraft](https://arxiv.org/abs/2305.17144)
**代码**: [GitHub - OpenGVLab/GITM](https://github.com/OpenGVLab/GITM)

### 5.1 三层分解

- **LLM Decomposer**：将目标分解为子目标
- **LLM Planner**：为每个子目标生成结构化动作（有预定义语义、参数、期望结果）
- **LLM Interface**：将结构化动作转为键鼠操作

### 5.2 关键设计

结构化动作有**预定义的期望结果**，可以用于验证执行是否成功。

### 5.3 对 MC Claw 的启示

MC Claw 的指令系统（goto、craft、findAndCollect 等）本身就是"结构化动作"。可以为每个指令定义**预期结果检查器**，比如 `craft` 后检查背包中是否有目标物品。

---

## 6. Multi-Agent 协作模式

### 6.1 执行者 + 审查者 双 Agent 模式

#### AutoGPT 的自我反思

- **思考→行动→观察 循环**（基于 ReAct 模式）
- 每步执行后自我评估，进展停滞时运行内部反思
- 短期记忆（session buffer）+ 长期记忆（向量数据库/本地文件）
- 语义搜索从长期记忆中检索相关上下文
- 参考: [AutoGPT GitHub](https://github.com/Significant-Gravitas/AutoGPT)

#### CAMEL 的角色扮演框架

- **双 Agent 对话**：一个 Agent 扮演"用户/规划者"，另一个扮演"助手/执行者"
- 通过 inception prompting 引导对话
- 轮流对话机制推进任务
- 解决了角色翻转、无限循环等问题
- 参考: [CAMEL Paper](https://arxiv.org/abs/2303.17760), [GitHub - camel-ai/camel](https://github.com/camel-ai/camel)

#### CrewAI 的层级管理模式

- **Manager Agent + Worker Agents** 的层级结构
- Manager 负责任务分配、工作流协调、结果验证
- 支持 `Process.hierarchical` 模式
- 通过 `allowed_agents` 参数控制委派范围
- **注意**：实际实现中存在局限性，Manager 的编排逻辑较弱，任务可能按顺序执行而非智能分配
- 参考: [CrewAI Hierarchical Process](https://docs.crewai.com/en/learn/hierarchical-process), [GitHub - crewAIInc/crewAI](https://github.com/crewaiinc/crewai)

### 6.2 Multi-Agent Evolve (MAE)

- **三 Agent 架构**：Proposer（出题者）、Solver（解题者）、Judge（裁判）
- 三个角色从同一个 LLM 实例化
- 共同进化：Judge 同时评估 Proposer 的问题质量和 Solver 的解答质量
- 参考: [Multi-Agent Evolve](https://openreview.net/forum?id=sknMpr8NWU)

### 6.3 Writer-Reviewer 模式

一个典型的生产环境实现模式：
```
Writer Agent 创建初稿
       ↓
Reviewer Agent 评估（对照规则打分）
       ↓
   达标？──→ 完成
       │
   未达标 → 反馈回 Writer
       ↓
Writer 基于反馈重写
       ↓
  重复直到达标或达到最大迭代次数
```

**成本优化技巧**：Writer 用高质量模型（如 GPT-4），Reviewer 用更便宜的模型（如 GPT-3.5），因为**评审比创作对 LLM 来说更容易**。

### 6.4 对 MC Claw 的启示

最适合 MC Claw 的是 **Writer-Reviewer 模式的变体**：
- 执行 Agent（Writer）= 当前的 AI Agent，做决策循环
- 复盘 Agent（Reviewer）= 独立的 cron Agent，定期审查执行 Agent 的轨迹
- 复盘 Agent 可以用更便宜/更快的模型，因为"审查"比"决策"简单

---

## 7. 自动化性能分析：Trajectory-Informed Memory

**论文**: [Trajectory-Informed Memory Generation for Self-Improving Agent Systems](https://arxiv.org/abs/2603.10600)（IBM Research, 2026）

### 7.1 核心问题

LLM Agent 经常：
- 重复低效模式
- 无法从相似错误中恢复
- 错过应用成功策略的机会

### 7.2 三阶段管道

#### Phase 1: 轨迹分析与提示提取

**组件 1 — Trajectory Intelligence Extractor（轨迹智能提取器）**：

四个处理阶段：
1. **思维分类**：解析 Agent 响应，识别四种推理类型
   - 分析性思维（情境评估）
   - 规划性思维（动作排序）
   - 验证性思维（假设验证）
   - 反思性思维（方法重新考虑）

2. **模式识别**：使用 LLM 识别认知模式
   - 验证行为、反思序列、自我修正机制、错误识别、API 发现方法、效率意识

3. **结果确定**：有标签用标签，无标签则从自反信号中综合判断

4. **成功分类**：
   - 干净成功（无错误执行）
   - 低效成功（完成但不优）
   - 恢复序列（失败后修正）

**组件 2 — Decision Attribution Analyzer（决策归因分析器）**：

自动因果分析：
- **失败分析**：回溯推理链，识别直接原因、近因、根因和贡献因素
- **恢复分析**：识别问题如何被发现、采取了什么修正措施、为什么修正成功
- **低效分析**：确定执行为什么不够优化，给出更高效的替代方案
- **成功模式分析**：识别促成成功的策略及其有效性

**组件 3 — Contextual Learning Generator（上下文学习生成器）**：

生成三类指导：

| 类型 | 来源 | 内容 |
|------|------|------|
| **Strategy Tips（策略提示）** | 干净成功的轨迹 | 有效模式、实施步骤、触发条件 |
| **Recovery Tips（恢复提示）** | 失败+恢复的轨迹 | 错误识别信号、修正步骤、**反面例子** |
| **Optimization Tips（优化提示）** | 低效成功的轨迹 | 为什么替代方案更优 |

每条提示包含：唯一 ID、类别、可操作内容、目的说明、具体步骤、触发条件、负面示例（可选）、应用上下文、任务类别、优先级、源轨迹 ID、结果描述。

**组件 4 — 任务级 vs 子任务级提取**：

- **任务级**：整条轨迹作为一个单元，产出端到端模式，简单但复用性差
- **子任务级**：两阶段管道
  - Phase A：LLM 将轨迹分段为逻辑子任务
  - Phase B：每个子任务独立提取 2-4 条可操作提示

#### Phase 2: 提示存储与管理

1. **子任务描述泛化**：实体抽象、动作规范化、上下文移除
2. **语义聚类**：cosine 相似度 + 层次聚合聚类（阈值 ~0.85）
3. **提示合并**：去重 → 冲突解决（成功轨迹优先）→ 综合
4. **双重存储**：向量嵌入（语义搜索）+ 结构化元数据（过滤查询）

#### Phase 3: 运行时检索

两种策略：
- **Cosine 相似度检索**：快速，无需额外 LLM 调用，典型参数 τ ∈ [0.5, 0.7], k ∈ [5, 10]
- **LLM 引导选择**：更精准，使用 LLM 分析任务上下文构建检索查询

### 7.3 效果

在 AppWorld 基准上：
- 最佳配置（子任务级提示 + LLM 引导选择）
- Test-Normal: +3.6 pp 任务目标完成率
- 难度 3 任务: +28.5 pp 场景目标完成率（**+149% 相对提升**）

### 7.4 对 MC Claw 的启示

**这是最直接可参考的自动化性能分析框架**。MC Claw 可以：
1. 将每轮决策循环的日志作为"轨迹"
2. 分析失败/低效/成功模式
3. 生成 Strategy/Recovery/Optimization Tips
4. 存入 `experience.json` 并在后续轮次中检索

---

## 8. OpenAI 自进化 Agent Cookbook

**资源**: [Self-Evolving Agents Cookbook](https://developers.openai.com/cookbook/examples/partners/self_evolving_agents/autonomous_agent_retraining)
**代码**: [GitHub Notebook](https://github.com/openai/openai-cookbook/blob/main/examples/partners/self_evolving_agents/autonomous_agent_retraining.ipynb)

### 8.1 核心理念

Agent 在 POC 阶段后容易"遇到瓶颈"，因为依赖人类来诊断边缘情况和修正失败。这个 Cookbook 构建了一个**自动化的诊断-优化-部署循环**。

### 8.2 四个互补评估器（Grader）

| 评估器 | 类型 | 用途 |
|--------|------|------|
| 化学名验证 | Python 规则 | 领域保真度 |
| 长度偏差评分 | Python 规则 | 输出纪律性 |
| 余弦相似度 | 文本比对 | 源文本锚定 |
| LLM-as-Judge | 语义评判 | 内容质量 |

设计原则：**先用确定性检查稳定优化，再进行语义调优**。

### 8.3 三级优化策略

| 策略 | 自动化程度 | 适用场景 |
|------|----------|---------|
| A: 手动 UI | 最低 | 初始探索 |
| B: 半自动 API | 中等 | MetapromptAgent + 人工反馈 |
| C: 全自动循环 | 最高 | 持续监控 + 自动触发优化 |

全自动循环的阈值：
- 宽松通过率：75% 的评估器必须通过
- 宽松平均分：85% 的平均得分

### 8.4 版本化 Prompt 管理

```python
PromptVersionEntry:
  - version: 版本号
  - model: 模型选择
  - prompt: 提示文本
  - timestamp: UTC 时间戳
  - eval_id, run_id: 追踪标识
  - metadata: 自由格式元数据
```

### 8.5 自愈工作流

```
评估当前输出 → 计算综合分数 → 通过？→ 持久化为最佳候选
                                  │
                                失败 → 收集评估器反馈
                                  ↓
                            调用 MetapromptAgent 生成新 Prompt
                                  ↓
                            更新 Prompt 版本，重试（最多 3 次）
                                  ↓
                            选择所有评估中得分最高的版本
                                  ↓
                            提升为生产版本
```

### 8.6 对 MC Claw 的启示

可以为 MC Claw 的复盘 Agent 设计类似的评估器体系：
- **规则评估器**：血量是否下降？物品数是否增加？任务是否完成？
- **LLM 评估器**：行为是否高效？是否有更好的策略？
- **自动优化**：如果多轮表现不佳，自动调整决策策略

---

## 9. AI Agent 可观测性与监控

### 9.1 关键差异

传统监控追踪 CPU、内存、请求率。AI Agent 可观测性追踪：
- Agent 是否理解了查询？
- 检索的上下文是否相关？
- 工具调用是否成功？
- 输出是否准确且符合策略？

### 9.2 自动化评估方法

- **Heuristics**（启发式规则）
- **LLM-as-Judge**（LLM 作为裁判）
- **Custom Logic**（自定义逻辑）

### 9.3 Trace（追踪）

每个 LLM 调用、工具调用、检索步骤和中间决策都被捕获。Trace 类似于 AI 系统的"调用栈"。

主流平台：Datadog、Splunk、Braintrust、LangSmith 等。

### 9.4 Cron 式 Agent 监控模式

- 定期检查 Agent 状态，只在变化时通知
- **事件驱动监控优于轮询**
- 可以结合自愈逻辑：检测异常 → 诊断 → 自动修复

---

## 10. 综合对比与 MC Claw 复盘 Agent 设计建议

### 10.1 各方案核心对比

| 方案 | Critic 时机 | 评估方式 | 改进方式 | 记忆机制 |
|------|-----------|---------|---------|---------|
| Voyager | 即时（每次执行后） | GPT-4 检查游戏状态 | critique 文本回传 | 技能库 |
| Reflexion | 试次间（每次失败后） | Evaluator 打分 | 语言化反思存入记忆 | episodic buffer |
| DEPS | 失败时 | LLM 自我解释 | 解释驱动的计划修正 | 无持久化 |
| Trajectory-Informed | 离线（批量分析） | 4 阶段轨迹分析 | 3 类提示存储+检索 | 向量+元数据 |
| OpenAI Cookbook | 周期性 | 4 类评估器 | 自动 Prompt 优化 | 版本化 Prompt |

### 10.2 MC Claw 复盘 Agent 设计建议

#### 整体架构

```
┌───────────────────────────────────────────────────────┐
│              执行 Agent（现有决策循环）                   │
│   每 5 分钟：感知 → 复盘 → 规划 → 执行 → 记忆           │
│                                                       │
│   产出：action logs, state changes, success/failure    │
└───────────────────────┬───────────────────────────────┘
                        │ 日志 + 状态变化
                        ↓
┌───────────────────────────────────────────────────────┐
│              复盘 Agent（新增，独立 cron 触发）           │
│                                                       │
│   每 30 分钟 / 每 6 轮执行后触发一次                     │
│                                                       │
│   Phase 1: 轨迹收集                                    │
│     - 读取最近 N 轮的 action logs                       │
│     - 读取 state 变化序列                               │
│     - 读取 experience.json 中的最近经验                  │
│                                                       │
│   Phase 2: 模式分析（借鉴 Trajectory-Informed Memory）  │
│     - 成功模式识别：什么策略有效？                        │
│     - 失败模式识别：什么行为重复失败？                    │
│     - 低效模式识别：完成了但耗时过长？                    │
│                                                       │
│   Phase 3: 生成改进建议（借鉴 Reflexion + Voyager）     │
│     - Strategy Tips: "挖铁矿前先确认有石镐"             │
│     - Recovery Tips: "goto 超时时改用 exploreUntil"     │
│     - Optimization Tips: "批量采集木头比单个效率高3x"    │
│                                                       │
│   Phase 4: 更新记忆（借鉴 OpenAI Cookbook）              │
│     - 写入 experience.json                             │
│     - 更新 memory.json 的 facts                        │
│     - 可选：调整执行 Agent 的系统提示                    │
│                                                       │
└───────────────────────────────────────────────────────┘
```

#### 复盘 Agent 的输入数据

| 数据源 | 内容 | 用途 |
|--------|------|------|
| `/logs` API | 两轮之间发生的所有事件 | 事件流分析 |
| `/state` API 快照 | 每轮开始/结束时的状态 | 进展追踪 |
| `experience.json` | 历史经验和使用计数 | 避免重复发现 |
| `memory.json` | 地标、资源、任务状态 | 上下文理解 |
| Session 日志 | 执行 Agent 的思考过程 | 决策质量评估 |

#### 复盘 Agent 的输出

| 输出 | 目标 | 格式 |
|------|------|------|
| 新经验条目 | 写入 `experience.json` | `{problem, context, solution, tags}` |
| 事实更新 | 写入 `memory.json` 的 `facts` | 自然语言事实 |
| 策略建议 | 影响执行 Agent 的下一轮规划 | 文本注入到 session |
| 效率报告 | 人类可读的总结 | Dashboard 或日志 |

#### 评估体系（4 类评估器）

| 评估器 | 类型 | 检查内容 |
|--------|------|---------|
| 生存评估 | 规则 | 血量变化、死亡次数、饥饿管理 |
| 进展评估 | 规则 | 新物品获取、科技树推进、资源积累 |
| 效率评估 | LLM | 每轮实际产出 vs 预期产出 |
| 策略评估 | LLM | 决策质量、行为多样性、探索 vs 利用平衡 |

#### 影响执行 Agent 的方式

1. **被动影响**：更新经验库和记忆，执行 Agent 在"复盘"阶段自然读取
2. **主动影响**：在 Session 中注入"复盘摘要"，作为下一轮的额外上下文
3. **策略调整**：修改任务优先级、目标序列（写入 `memory.json` 的 `tasks`）

#### 实现路径

**Phase 1（最小可行版）**：
- 在现有"复盘"步骤中增强，不新建独立 Agent
- 增加结构化的经验分析 prompt
- 自动将分析结果写入 `experience.json`

**Phase 2（独立复盘 Agent）**：
- 新建一个 cron 触发的复盘 Agent
- 读取执行 Agent 的 Session 日志和游戏日志
- 独立分析，输出写入共享的 memory/experience 文件

**Phase 3（闭环自进化）**：
- 复盘 Agent 不仅分析行为，还优化执行 Agent 的 Skill Prompt
- 版本化管理 Skill 提示，A/B 测试不同策略
- 类似 OpenAI Cookbook 的自愈循环

---

## 参考资源汇总

### 核心论文

| 论文 | 年份 | 关键贡献 |
|------|------|---------|
| [Voyager](https://arxiv.org/abs/2305.16291) | 2023 | Critic Agent + 技能库 + 自动课程 |
| [Reflexion](https://arxiv.org/abs/2303.11366) | 2023 | 语言化自我反思 + episodic memory |
| [DEPS](https://arxiv.org/abs/2302.01560) | 2023 | 失败自我解释 + 目标选择 |
| [GITM](https://arxiv.org/abs/2305.17144) | 2023 | 层次化分解 + 结构化动作验证 |
| [Odyssey](https://arxiv.org/abs/2407.15325) | 2024 | Planner-Actor-Critic + 大规模技能库 |
| [Trajectory-Informed Memory](https://arxiv.org/abs/2603.10600) | 2026 | 轨迹分析 → 三类提示 → 语义检索 |
| [Self-Evolving Agents Survey](https://arxiv.org/abs/2508.07407) | 2025 | 自进化 Agent 全面综述 |

### 重要代码仓库

| 仓库 | 关键文件 |
|------|---------|
| [MineDojo/Voyager](https://github.com/MineDojo/Voyager) | `voyager/agents/critic.py`, `voyager/prompts/critic.txt` |
| [noahshinn/reflexion](https://github.com/noahshinn/reflexion) | 完整 Reflexion 实现 |
| [zju-vipa/Odyssey](https://github.com/zju-vipa/Odyssey) | Planner-Actor-Critic 实现 |
| [OpenGVLab/GITM](https://github.com/OpenGVLab/GITM) | 层次化 Agent 实现 |
| [CraftJarvis/MC-Planner](https://github.com/CraftJarvis/MC-Planner) | DEPS 实现 |
| [openai/openai-cookbook](https://github.com/openai/openai-cookbook/blob/main/examples/partners/self_evolving_agents/autonomous_agent_retraining.ipynb) | 自进化 Agent Notebook |
| [EvoAgentX/Awesome-Self-Evolving-Agents](https://github.com/EvoAgentX/Awesome-Self-Evolving-Agents) | 自进化 Agent 论文列表 |
| [camel-ai/camel](https://github.com/camel-ai/camel) | CAMEL 多 Agent 框架 |
| [crewAIInc/crewAI](https://github.com/crewaiinc/crewai) | CrewAI 层级 Agent 框架 |

### 综合参考

- [Lilian Weng - LLM Powered Autonomous Agents](https://lilianweng.github.io/posts/2023-06-23-agent/)（经典综述博文）
- [Prompt Engineering Guide - Reflexion](https://www.promptingguide.ai/techniques/reflexion)
- [Anthropic - Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Hugging Face - Reflection in AI](https://huggingface.co/blog/Kseniase/reflection)
