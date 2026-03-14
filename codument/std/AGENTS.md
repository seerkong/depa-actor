# Codument 使用指南

这是 AI 编程助手使用 Codument 进行规范驱动开发的核心指令。

## 快速检查清单

- 搜索已有工作：`codument list`、`codument list --specs`
- 确定范围：新增能力 vs 修改现有能力
- 选择唯一的 `track-id`：kebab-case 命名，动词开头（`add-`、`update-`、`remove-`、`refactor-`）
- 创建文件：`spec.md`，`proposal.md`、`design.md`(可选)、`plan.xml`
- 编写规范增量：使用 `## ADDED|MODIFIED|REMOVED Requirements`，每个需求至少包含一个 `#### Scenario:`
- 验证：`codument validate [track-id] --strict`
- 等待批准：提案获批前不要开始实现

### 外部 CLI validate 回退规则

- 当提示词要求运行外部 `codument validate ...` 命令时，如果当前系统中找不到 `codument` 可执行命令，则可跳过这个外部 CLI validate 步骤，不要因此阻塞当前工作流。
- 跳过时需要在输出中明确说明：外部 `codument validate` 未执行，原因是系统中找不到 `codument` 命令。

## 工作阶段

### 阶段一：创建变更追踪

在以下情况下创建 track：
- 添加新功能或特性
- 进行破坏性变更（API、数据结构）
- 更改架构或模式
- 性能优化（改变行为）
- 安全模式更新

跳过 track 的情况：
- Bug 修复（恢复预期行为）
- 拼写错误、格式调整、注释
- 依赖更新（非破坏性）
- 配置变更
- 为现有行为编写测试

**工作流程**
1. 查看 `codument/project.md` 和 `codument/product.md` 了解项目上下文
2. 阅读 `codument/std/workflow.md` 了解工作流程
3. 运行 `codument list` 和 `codument list --specs` 查看当前状态
4. 选择唯一的动词开头 `track-id`，在 `codument/tracks/<id>/` 下创建文件
5. 编写 `spec.md` 规范增量，使用 `## ADDED|MODIFIED|REMOVED Requirements`
6. 编写 `proposal.md` 说明背景和动机、变更什么、“要做”和“不做”、 变更内容、影响范围
7. 按需编写 `design.md` 说明上下文、方案概览、影响范围与修改点、决策、风险/权衡、兼容性设计、迁移计划、待解决问题
8. 编写 `plan.xml` 结构化任务清单
9. 尝试运行 `codument validate <id> --strict` 验证后再提交审批；如果系统找不到 `codument` 命令，可跳过该外部 CLI validate 步骤，并明确说明已跳过

### 阶段二：实现变更

将这些步骤作为待办事项逐一完成：
1. **阅读 proposal.md** - 理解要构建什么
2. **阅读 design.md**（如存在）- 审查技术决策
3. **阅读 plan.xml** - 获取实现清单
4. **遵循 workflow.md** - 按工作流执行任务
5. **按顺序实现任务** - 依次完成
6. **确认完成** - 确保 plan.xml 中每个任务都已完成后再更新状态
7. **更新任务状态** - 将已完成任务标记为 DONE
8. **等待批准** - 提案被审查和批准之前不要开始实现

### 阶段三：归档变更

部署后，创建归档：
- 将 `tracks/[id]/` 移动到 `archive/YYYY-MM-DD-[id]/`
- 如果能力发生变化，更新 `specs/`
- 尝试运行 `codument validate --strict` 确认归档的变更通过检查；如果系统找不到 `codument` 命令，可跳过该外部 CLI validate 步骤，并明确说明已跳过

## 开始任何任务前

**上下文检查清单：**
- [ ] 阅读 `specs/[capability]/spec.md` 中的相关规范
- [ ] 检查 `tracks/` 中的待处理变更是否有冲突
- [ ] 阅读 `codument/project.md` 了解项目约定
- [ ] 阅读 `codument/product.md` 了解产品定义
- [ ] 运行 `codument list` 查看活跃变更
- [ ] 运行 `codument list --specs` 查看现有能力

**创建规范前：**
- 始终检查能力是否已存在
- 优先修改现有规范而不是创建重复
- 使用 `codument show [spec]` 审查当前状态
- 如果需求模糊，先问 1-2 个澄清问题再动手（使用 **ask-single-question-free** 或 **ask-multi-question-free**）

## CLI 命令

```bash
# 基本命令
codument list                  # 列出活跃变更
codument list --specs          # 列出规范
codument show [item]           # 显示变更或规范详情
codument validate [item]       # 验证变更或规范
codument archive <track-id>    # 归档已完成的变更

# 项目管理
codument init [path]           # 初始化 Codument
codument upgrade-workspace      # 升级工作区内置标准文件与命令
codument upgrade-track <id>     # 升级单个 track 到支持波次的新版本
codument status                # 查看项目状态

# 波次执行命令
/codument:discuss <track-id>    # 阶段级讨论，生成 context.md
/codument:plan-wave <track-id>  # 规划波次 DAG，更新 plan.xml
/codument:execute-wave <track-id> [phase]  # 按波次 DAG 执行任务
/codument:gap-loop <track-id> [--background <path>]... [--phase <phase-id>]  # fresh agent gap 分析与修正闭环
/codument:verify <track-id>     # 独立验证子代理模式

# 调试
codument show [track] --json
codument validate [track] --strict
```

### 命令参数

- `--json` - 机器可读输出
- `--type track|spec` - 消除歧义
- `--strict` - 全面验证
- `--yes`/`-y` - 跳过确认提示

## 目录结构

```
codument/
├── project.md              # 项目约定（技术栈、架构、代码风格）
├── product.md              # 产品定义（愿景、目标用户、核心功能）
├── tech-stack.md           # 技术栈配置
├── workflow.md             # 工作流规范（开发流程、质量门控）
├── state.json              # 状态持久化
├── specs/                  # 当前真相 - 已构建的内容
│   └── [capability]/       # 单一聚焦的能力
│       ├── spec.md         # 需求和场景
│       └── design.md       # 技术设计（可选）
├── tracks/                 # 变更追踪 - 待实现的变更
│   └── [track-id]/
│       ├── analysis/       # 创建/规划阶段 analysis 产物（planning-with-files 外部记忆）
│       │   ├── findings.md    # 分析中直接找到的事实、约束、问题与结论
│       │   └── knowledge.md   # 阅读后沉淀出的知识上下文、术语与机制理解
│       ├── proposal.md     # 为什么、是什么、影响
│       ├── spec.md         # 规范增量（ADDED/MODIFIED/REMOVED）
│       ├── plan.xml        # 结构化任务清单
│       ├── decisions.md    # 决策问题、选项、结论与理由（需要决策时创建）
│       ├── design.md       # 技术决策（可选）
│       ├── context.md      # 波次执行上下文（波次模式）
│       ├── state.md        # 波次执行状态追踪（波次模式）
│       ├── phases/         # 阶段级产出（波次模式）
│       │   └── P{n}/
│       │       └── index.md
│       └── waves/          # 波次级产出（波次模式）
│           └── WAVE-P{n}-{序号}/
│               └── index.md
└── archive/                # 已完成的变更
    └── YYYY-MM-DD-[id]/
```

## 创建变更追踪

### 决策树

```
新请求？
├─ 恢复规范行为的 Bug 修复？→ 直接修复
├─ 拼写错误/格式/注释？→ 直接修复
├─ 新功能/能力？→ 创建 track
├─ 破坏性变更？→ 创建 track
├─ 架构变更？→ 创建 track
└─ 不确定？→ 创建 track（更安全）
```

### Track 结构

1. **创建目录：** `tracks/[track-id]/`（kebab-case，动词开头，唯一）

2. **编写 proposal.md：**
```markdown
# 变更：[变更的简要描述]

## 背景
[1-2 句话说明问题或机会]

## 变更内容
- [变更列表]
- [用 **BREAKING** 标记破坏性变更]

## 影响范围
- 受影响的规范：[列出能力]
- 受影响的代码：[关键文件/系统]
```

3. **编写规范增量 spec.md：**
```markdown
## ADDED Requirements
### Requirement: 新功能名称
系统应当（SHALL）提供...

#### Scenario: 成功场景
- **GIVEN** 前置条件
- **WHEN** 用户执行某操作
- **THEN** 预期结果

#### Scenario: 失败场景
- **GIVEN** 前置条件
- **WHEN** 用户执行某操作
- **AND** 某条件不满足
- **THEN** 系统返回错误信息

## MODIFIED Requirements
### Requirement: 现有功能名称
[完整的修改后需求]

#### Scenario: 更新后的场景
- **GIVEN** 新的前置条件
- **WHEN** 新的操作
- **THEN** 新的预期结果

## REMOVED Requirements
### Requirement: 旧功能名称
**原因**：[为什么移除]
**迁移**：[如何处理]
```

4. **编写 plan.xml：**

顺序执行模式（默认）：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <metadata>
    <track_id>add-user-auth</track_id>
    <track_name>添加用户认证功能</track_name>
    <goal>实现用户登录和注册功能</goal>
    <created_at>2026-01-01</created_at>
    <status>new</status>
    <commit_mode>auto</commit_mode>
  </metadata>

  <phases>
    <phase id="P1" name="基础设施">
      <goal>搭建认证基础架构</goal>
      <tasks>
        <task id="T1.1" name="创建用户数据模型" status="TODO" priority="P0">
          <description>定义 User 模型结构并实现基本 CRUD 操作</description>
          <subtasks>
            <subtask id="T1.1.1" name="编写测试用例" status="TODO"/>
            <subtask id="T1.1.2" name="实现 User 模型" status="TODO"/>
          </subtasks>
        </task>
      </tasks>
    </phase>
  </phases>
</plan>
```

波次执行模式（DAG 并行）：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <metadata>
    <track_id>add-wave-feature</track_id>
    <track_name>添加波次功能</track_name>
    <goal>实现波次并行执行</goal>
    <created_at>2026-01-01</created_at>
    <status>new</status>
    <commit_mode>auto</commit_mode>
    <execution_mode>wave</execution_mode>
  </metadata>

  <phases>
    <phase id="P1" name="基础设施">
      <goal>搭建基础架构</goal>
      <context_files>
        <file>src/core/index.ts</file>
      </context_files>
      <waves>
        <wave id="WAVE-P1-01" depends_on=""/>
        <wave id="WAVE-P1-02" depends_on="WAVE-P1-01"/>
      </waves>
      <tasks>
        <task id="T1.1" name="创建数据模型" status="TODO" priority="P0" wave="WAVE-P1-01">
          <description>定义模型结构</description>
        </task>
        <task id="T1.2" name="创建 API 路由" status="TODO" priority="P0" wave="WAVE-P1-02">
          <description>实现 REST API</description>
        </task>
      </tasks>
    </phase>
  </phases>
</plan>
```

5. **需要时创建 design.md：**

以下情况需要创建 `design.md`：
- 跨模块变更或新的架构模式
- 新的外部依赖或重大数据模型变更
- 安全、性能或迁移复杂性
- 需要在编码前消除技术歧义

最小 design.md 结构：
```markdown
## 上下文
[背景、约束、利益相关者]

## 目标 / 非目标
- 目标：[...]
- 非目标：[...]

## 决策摘要
- 详见 `decisions.md`
- 已确认的关键决策：[...]

## 风险 / 权衡
- [风险] → 缓解措施

## 迁移计划
[步骤、回滚方案]

## 待解决问题
- [...]
```

## 规范文件格式

### Scenario 格式

使用 GIVEN/WHEN/THEN/AND 结构描述场景：

**正确**（使用 #### 标题 + GIVEN/WHEN/THEN）：
```markdown
#### Scenario: 用户登录成功
- **GIVEN** 用户已注册且账户正常
- **AND** 用户在登录页面
- **WHEN** 用户输入正确的用户名和密码
- **AND** 用户点击登录按钮
- **THEN** 系统返回 JWT 令牌
- **AND** 用户被重定向到首页
```

**关键字说明**：
- **GIVEN**：前置条件（初始状态）
- **AND**：补充前一个关键字的条件
- **WHEN**：触发动作
- **THEN**：预期结果

**错误**（不要使用列表项或粗体作为场景标题）：
```markdown
- **Scenario: 用户登录**  ❌
**Scenario**: 用户登录     ❌
### Scenario: 用户登录      ❌
```

每个需求必须有至少一个 Scenario。

### 需求措辞
- 对规范性需求使用 SHALL/MUST（除非故意设为非规范性，否则避免使用 should/may）

### 增量操作

- `## ADDED Requirements` - 新能力
- `## MODIFIED Requirements` - 变更的行为
- `## REMOVED Requirements` - 废弃的功能
- `## RENAMED Requirements` - 名称变更

### ADDED vs MODIFIED 的选择

- **ADDED**：引入可独立存在的新能力或子能力。当变更是正交的（如添加"API 配置"）而不是改变现有需求的语义时，优先使用 ADDED。
- **MODIFIED**：更改现有需求的行为、范围或验收标准。必须粘贴完整的更新需求内容（标题 + 所有场景）。归档时会用你提供的内容完全替换原需求。
- **RENAMED**：仅当名称变更时使用。如果同时更改了行为，使用 RENAMED（名称）加上 MODIFIED（内容）引用新名称。

常见陷阱：使用 MODIFIED 添加新关注点但不包含之前的文本。这会在归档时导致细节丢失。如果你没有明确更改现有需求，请在 ADDED 下添加新需求。

## 故障排除

### 常见错误

**"Track must have at least one delta"**
- 检查 `tracks/[id]/spec.md` 是否存在
- 验证文件是否有操作前缀（## ADDED Requirements）

**"Requirement must have at least one scenario"**
- 检查场景是否使用 `#### Scenario:` 格式（4 个井号）
- 不要对场景标题使用列表项或粗体

**"Invalid plan.xml format"**
- 检查 XML 语法是否正确
- 验证必需元素是否存在

### 验证技巧

```bash
# 使用严格模式进行全面检查
codument validate [track] --strict

# 查看详细信息
codument show [track] --json
```

## 最佳实践

### 简单优先
- 默认新增代码少于 100 行
- 在证明不足之前使用单文件实现
- 没有明确理由不要使用框架
- 选择经过验证的稳定模式

### 复杂性触发器
仅在以下情况添加复杂性：
- 性能数据显示当前解决方案太慢
- 具体的规模需求（>1000 用户，>100MB 数据）
- 多个经过验证的用例需要抽象

### 清晰引用
- 使用 `file.ts:42` 格式表示代码位置
- 将规范引用为 `specs/auth/spec.md`
- 链接相关变更和 PR

### 能力命名
- 使用动词-名词：`user-auth`、`payment-capture`
- 每个能力单一目的
- 10 分钟可理解规则
- 如果描述需要"和"，则拆分

### Track ID 命名
- 使用 kebab-case，简短且描述性：`add-two-factor-auth`
- 优先使用动词开头的前缀：`add-`、`update-`、`remove-`、`refactor-`
- 确保唯一性；如果已被使用，追加 `-2`、`-3` 等

## 错误恢复

### 变更冲突
1. 运行 `codument list` 查看活跃变更
2. 检查重叠的规范
3. 与变更负责人协调
4. 考虑合并提案

### 验证失败
1. 使用 `--strict` 参数运行
2. 检查 JSON 输出了解详情
3. 验证规范文件格式
4. 确保场景格式正确

### 缺少上下文
1. 首先阅读 project.md 和 product.md
2. 检查相关规范
3. 查看最近的归档
4. 请求澄清（使用 **ask-single-question-free** 或 **ask-multi-question-free**）

## 快速参考

### 阶段指示器
- `tracks/` - 已提案，尚未构建
- `specs/` - 已构建和部署
- `archive/` - 已完成的变更

### 文件用途
- `analysis/` - track 分析阶段的持久化上下文（findings/knowledge）；用于记录“找到的内容 / 关键发现 / 知识上下文”，避免长对话或多轮工具调用导致关键信息丢失；不引用 `.` 开头隐藏目录的文件
- `proposal.md` - 为什么和是什么
- `plan.xml` - 结构化实现步骤
- `decisions.md` - 决策问题、选项、用户答复、最终结论与理由
- `design.md` - 方案设计与决策摘要
- `spec.md` - 需求和行为
- `context.md` - 波次执行上下文（波次模式）
- `state.md` - 波次执行状态追踪（波次模式）

### CLI 精要
```bash
codument list              # 正在进行什么？
codument show [item]       # 查看详情
codument validate --strict # 正确吗？
codument archive <id>      # 标记完成

# 波次执行
/codument:discuss <id>      # 阶段讨论
/codument:plan-wave <id>    # 规划波次 DAG
/codument:execute-wave <id> # 执行波次
/codument:gap-loop <id>     # fresh agent gap 分析与修正
/codument:verify <id>       # 独立验证
```

记住：规范是真相，变更追踪是提案。保持同步。

## 中断恢复协议

### 检测中断

在开始任何 track 实现时，首先检查是否存在中断状态：

1. **检查 plan.xml**：查找状态为 `IN_PROGRESS` 的任务
2. **检查 track metadata**：扫描 `codument/tracks/` 并查找 plan.xml metadata.status 为 `in_progress` 的 track
3. **检查 state.json**：查找保存的恢复点

### 恢复流程

如果检测到中断，向用户呈现恢复选项：

> "检测到上次中断的工作：
> - Track: <track_id>
> - 当前任务: <任务名称> (IN_PROGRESS)
> - 上次完成: <上一个 DONE 任务>
> 
> 请选择：
> A. 继续当前任务
> B. 重新开始当前任务
> C. 跳过当前任务，继续下一个
> D. 从头开始整个 Track"
（使用 **ask-single-question-closed**）


### 保存恢复点

在关键节点保存恢复点到 `codument/state.json`：

```json
{
  "active_track": "<track_id>",
  "current_phase": "P1",
  "current_task": "T1.2",
  "last_action": "task_started",
  "timestamp": "2026-01-01T12:00:00Z",
  "commit_mode": "auto"
}
```

### 恢复点触发时机

- 任务开始时
- 任务完成时
- 阶段门控通过时
- Track 完成时

## 多层确认协议

### 确认层级

Codument 使用三层确认机制确保重要决策得到用户认可：

#### 第一层：规范确认

在创建 track 时：
1. **spec.md 确认**：展示起草的规范，等待用户确认或修改（使用 **ask-single-question-free**）
2. **plan.xml + 模式确认**：在同一轮交互中确认任务计划，并选择提交模式（auto/manual）与校验模式（`yield-human-confirm` 或 `yield-gap-loop`）；仅在 `yield-gap-loop` 下继续选择粒度（使用 **ask-single-question-free**）

#### 第二层：阶段/任务确认（可配置）

在实现过程中：
1. **阶段完成确认**：仅当 `<phase>` 下存在 `<confirm protocol="yield-human-confirm" .../>` 或 `<confirm protocol="yield-gap-loop" .../>` 且 when 包含 `after`
2. **任务执行前确认**：仅当 `<task>` 下存在 `<confirm ... when="before"/>` 或 `when="both"`
3. **任务执行后确认**：仅当 `<task>` 下存在 `<confirm ... when="after"/>` 或 `when="both"`
4. **确认行为**：见 `codument/std/protocols.md`（必须更新 `<confirm>` 的 `status`；`yield-gap-loop` 必须由父层 fresh-spawn 新子代理完成每一轮复检）

#### 第三层：项目文档确认

在 track 完成后：
1. **product.md 更新确认**：如需更新，展示 diff 等待确认（使用 **ask-single-question-closed**）
2. **project.md 更新确认**：如需更新，展示 diff 等待确认（使用 **ask-single-question-closed**）
3. **归档/删除确认**：询问用户选择处理方式（使用 **ask-single-question-closed**）

### 确认原则

1. **明确等待**：仅在存在 `<confirm .../>` 时要求确认
2. **提供选项**：尽可能提供 A/B/C 选项而非开放式问题
3. **展示影响**：在确认前展示操作的影响范围
4. **允许修改**：用户可以要求修改而非简单确认
5. **记录决策**：重要决策记录在相关文件中
