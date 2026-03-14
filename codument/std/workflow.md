# 系统级工作流

## 指导原则

1. **规范是真实来源：** 所有工作必须在 plan.xml 中追踪
2. **技术栈是慎重选择的：** 对技术栈的更改必须在实现前记录在 tech-stack.md 中
3. **测试驱动开发：** 在实现功能前编写单元测试
4. **高代码覆盖率：** 所有模块的代码覆盖率目标为 >80%
5. **用户体验优先：** 每个决策都应优先考虑用户体验
6. **非交互式和 CI 感知：** 优先使用非交互式命令。对监视模式工具使用 `CI=true`

## 任务工作流

所有任务遵循严格的生命周期：

### 标准任务工作流

1. **选择任务：** 从 plan.xml 按顺序选择下一个可用任务

2. **标记进行中：** 开始工作前，将任务状态从 `TODO` 改为 `IN_PROGRESS`

3. **编写失败测试（红色阶段）：**
   - 为功能或 Bug 修复创建测试文件
   - 编写一个或多个单元测试，清楚定义预期行为和验收标准
   - **关键：** 运行测试并确认按预期失败。这是 TDD 的"红色"阶段。在有失败测试前不要继续

4. **实现通过测试（绿色阶段）：**
   - 编写使失败测试通过所需的最少代码
   - 再次运行测试套件确认所有测试通过。这是"绿色"阶段

5. **重构（可选但推荐）：**
   - 在通过测试的保护下，重构实现代码和测试代码
   - 提高清晰度、消除重复、增强性能，同时不改变外部行为
   - 重新运行测试确保仍然通过

6. **验证覆盖率：** 使用项目工具运行覆盖率报告
   ```bash
   bun test --coverage
   ```
   目标：新代码覆盖率 >80%

7. **记录偏差：** 如果实现与技术栈不同：
   - **停止**实现
   - 用新设计更新 `tech-stack.md`
   - 添加带日期的注释解释更改
   - 恢复实现

8. **提交代码更改（根据提交模式）：**

   **如果是 auto 模式：**
   - 暂存所有与任务相关的代码更改
   - 使用规范的提交消息格式：`feat(<track_id>): <任务描述>`
   - 附加 Git Notes 记录变更详情：
     ```bash
     git add .
     git commit -m "feat(<track_id>): complete task T1.2 - <任务名称>"
     git notes add -m "Task: T1.2
     Changes: <变更摘要>
     Files: <文件列表>
     AC: <验收标准>"
     ```

   **如果是 manual 模式：**
   - 通知用户任务代码已完成
   - 提示用户自行提交

9. **更新任务状态：**
   - 将任务状态从 `IN_PROGRESS` 更新为 `DONE`
   - 在任务元素中记录 commit SHA（如果有）
   - 更新 `<acceptance_criteria>` 中各标准的 `checked` 属性

10. **提交任务更新（auto 模式）：**
    - 暂存修改的 plan.xml
    - 提交更改，消息如 `codument(task): Mark task 'Create user model' as complete`


### 更正进行中工作流
当有如下情况：
- 当前有进行中的tracks
- 用户提出的补充需求，属于当前进行中的某个track范围

需要执行下述工作流：
1. **找到track：** 找到补充需求所属的进行中的track
2. **更正plan.xml：** 在所属的plan.xml，合适的位置，按照`plan-xml-spec.md`的规范，新增内容，初始化状态

### 决策采集工作流
当某个 track 存在需要用户确认的决策问题时：
1. **创建或更新 decisions.md：** 在 `codument/tracks/<track_id>/decisions.md` 记录问题、选项、用户答复、最终决策和理由
   - 如果在后续实现、测试、验证过程中出现新的决策补充，也继续追加到同一个 `decisions.md`
2. **统一标题格式：** 问题标题使用 `### 1. 【P0】文件内容来源` 这类格式；字母只用于选项，不用于问题标题
3. **按数量选择交互方式：**
   - 待确认问题 `<= 5`，且环境支持一次性多问题 ToolCall：优先使用一次性多问题 ToolCall 收集答复
   - 待确认问题 `> 5`，或环境不支持一次性多问题 ToolCall：引导用户直接编辑 `decisions.md`
4. **结果回写：** 无论通过 ToolCall 还是文档编辑获得答复，都必须回写 `decisions.md`


### 阶段完成验证协议

**触发器（严格）：** 仅当某个阶段的最后一个任务完成，且该 `<phase>` 下存在 `<confirm protocol="yield-human-confirm" .../>` 或 `<confirm protocol="yield-gap-loop" .../>` 且 `when` 包含 `after`（或 `both`）时，才执行本协议。
**否则：** 不要执行本协议，不要等待用户反馈，直接进入下一阶段。

1. **宣布协议开始：** 通知用户阶段已完成，验证和检查点协议开始

2. **确保阶段变更的测试覆盖率：**
   - 确定阶段范围：找到上一个阶段检查点的 Git commit SHA
   - 列出变更文件：`git diff --name-only <previous_checkpoint_sha> HEAD`
   - 验证并创建测试：对每个代码文件验证对应测试文件存在

3. **执行自动化测试：**
   - 宣布将执行的确切 shell 命令
   - 执行命令
   - 如果失败，通知用户并开始调试。最多尝试修复两次
   - 如果仍失败，停止并请求用户指导

4. **提议手动验证计划：**
   - 分析 product.md 和 plan.xml 确定用户目标
   - 生成分步验证计划，包括命令和预期结果

5. **等待用户反馈：**
   - 若协议为 `yield-human-confirm`：请求确认："这是否符合预期？请回复 'yes' 确认，或直接给出需要修改的反馈点。"（必须使用 **ask-single-question-free**；如支持则用 ToolCall 发起该问题）
   - 若协议为 `yield-gap-loop`：不要在当前 agent 内继续修正；当前 agent 结束并把控制权交回父层，由父层 fresh-spawn 新的 gap-loop 子代理或等价的 fresh child context

6. **创建检查点提交：**
   - 暂存所有更改
   - 提交，消息如 `codument(checkpoint): Checkpoint end of Phase X`

7. **更新任务并记录检查点 SHA：**
   - 在 plan.xml 中阶段元素添加 checkpoint 属性

8. **提交任务更新：**
   - 提交更改，消息如 `codument(phase): Mark phase 'P1' as complete`

9. **宣布完成：** 通知用户阶段已完成

### 质量门控

在将任何任务标记为完成前，验证：

- [ ] 所有测试通过
- [ ] 代码覆盖率满足要求（>80%）
- [ ] 代码遵循项目代码风格指南
- [ ] 所有公共函数/方法有文档
- [ ] 强制类型安全
- [ ] 无代码检查或静态分析错误
- [ ] 文档已更新（如需要）
- [ ] 未引入安全漏洞

## 测试要求

### 单元测试
- 每个模块必须有对应测试
- 使用适当的测试设置/拆卸机制
- 模拟外部依赖
- 测试成功和失败情况

### 集成测试
- 测试完整命令流程
- 验证文件系统操作
- 测试错误处理

## 提交指南

### 消息格式
```
<类型>(<范围>): <描述>

[可选正文]

[可选页脚]
```

### 类型
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 仅文档
- `style`: 格式化，缺少分号等
- `refactor`: 既不修复 Bug 也不添加功能的代码更改
- `test`: 添加缺失测试
- `chore`: 维护任务

### 示例
```bash
git commit -m "feat(cli): Add list command with specs option"
git commit -m "fix(validate): Correct scenario parsing for GIVEN/WHEN/THEN"
git commit -m "test(utils): Add tests for parseTaskDetails function"
```

## 完成定义

任务在以下情况下完成：

1. 所有代码按规范实现
2. 单元测试编写并通过
3. 代码覆盖率满足项目要求
4. 文档完成（如适用）
5. 代码通过所有配置的代码检查
6. 实现说明添加到 plan.xml
7. 更改用正确消息提交
8. 任务状态更新为 DONE

## 持续改进

- 每周审查工作流
- 根据痛点更新
- 记录经验教训
- 优化用户满意度
- 保持简单和可维护

## 波次执行工作流

当 plan.xml 中 `<execution_mode>` 为 `wave` 时，使用波次执行工作流替代标准顺序执行。

### 核心模型

- **阶段（Phase）严格串行**：P1 完成后才能开始 P2
- **波次（Wave）DAG 并行**：同一阶段内的波次按依赖关系组成有向无环图（DAG），无依赖的波次可并行执行
- **波次标签格式**：`WAVE-P{n}-{序号}`（如 `WAVE-P1-01`、`WAVE-P2-03`）
- **wave 属性在 task 级别**：每个 task 通过 `wave="WAVE-P1-01"` 声明所属波次
- **波次依赖声明**：在 `<phase>` 内通过 `<waves><wave id="..." depends_on="..."/></waves>` 声明 DAG

### 波次执行流程

1. **讨论阶段**（`/codument:discuss`）
   - 针对当前阶段进行深度讨论
   - 生成 `context.md` 记录讨论结论和上下文

2. **波次规划**（`/codument:plan-wave`）
   - 分析任务间的依赖关系
   - 将任务分配到波次，构建 DAG
   - 更新 plan.xml 中的 `<waves>` 和 task 的 `wave` 属性

3. **波次执行**（`/codument:execute-wave`）
   - 按拓扑排序确定波次执行顺序
   - 同一波次内的任务通过 `Task()` 分派给子代理并行执行
   - 每个子代理获得独立的 200k 上下文窗口
   - 编排器保持轻量（~10-15% 上下文），通过 `state.md` 传递跨波次知识
   - 支持指定单个阶段执行：`/codument:execute-wave <track-id> P2`

4. **独立验证**（`/codument:verify`）
   - 启动独立验证子代理
   - 目标倒推验证：从目标出发，逐层验证实现
   - 三级验证：存在性 → 实质性 → 连通性

### 波次执行状态追踪

波次执行过程中维护以下文件：
- `state.md`：当前执行状态、已完成波次、跨波次知识摘要
- `phases/P{n}/index.md`：阶段级产出汇总
- `waves/WAVE-P{n}-{序号}/index.md`：波次级产出详情

### 上下文工程

- `<context_files>` 替代旧的 `<references>` 标签，声明阶段级上下文文件
- 编排器在分派任务时，将 `context_files` + `state.md` 摘要注入子代理上下文
- 子任务可通过 `<detail_ref>` 链接到外部详情文件

## 其他项目级workflow
请阅读 `codument/workflows/` 目录下的更多文件，了解更多的本项目专属工作流
