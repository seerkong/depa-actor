# depa-actor

`depa-actor` 是一个面向 TypeScript / JavaScript 的轻量 actor 运行时，重点支持以下几类能力：

- 基础 actor system：注册 actor、发送消息、广播消息、按邮箱优先级处理
- typed mailbox：用 `MailboxSchema` 对消息 tag 和 payload 建模
- selective receive：按 tag 检查和抽取待处理消息
- runtime 包装：把 actor 系统嵌入更高层运行时
- pipeline / dispatch 适配：方便与数据流、路由层组合
- fiber orchestration：把“状态归属”和“调度执行”拆开，支持前后台协作

这个库适合用来构建：

- AI Agent 运行时
- 多执行单元协作系统
- 需要消息驱动 + 可测试调度语义的应用

## 设计目标

`depa-actor` 不是为了做一个巨大的通用框架，而是聚焦几个明确目标：

- **小而清晰**：核心概念尽量少，API 保持直接
- **类型友好**：tag 和 payload 通过 schema 建模
- **消息优先**：控制语义和业务语义都优先消息化
- **可编排**：在 actor 之上支持 fiber 调度
- **可测试**：复杂行为优先通过仿真测试验证

## 核心概念

### 1. Actor

Actor 是状态与通信边界：

- 有唯一 id
- 有内部 state
- 通过 mailbox 收消息
- 用 handler 或 handlers 处理消息

### 2. MailboxSchema

`MailboxSchema` 是一个 `Record<tag, payload>`：

- key：邮箱 tag
- value：该 tag 对应的 payload 类型

示例：

```ts
type ChatSchema = {
  human_input: { text: string }
  cancel: { reason: string }
  tool_result: { callId: string; content: string }
}
```

### 3. Selective Receive

handler 内可以：

- `hasPending(tag)`：检查某类消息是否已在队列中
- `drainMailbox(tag)`：把某类消息一次性取出

这对 AI agent 这类需要“先看控制消息，再决定是否继续”的场景非常重要。

### 4. Fiber Orchestration

Actor 负责：

- 状态
- 身份
- mailbox

Fiber 负责：

- 调度
- 挂起
- 恢复
- 完成
- 取消

这让复杂系统可以拆成：

- 上层业务语义
- 中层 actor 通信
- 底层 fiber 调度

更完整的说明见：

- `ACTOR-FOR-AI-AGENTS.md`
- `doc/runtime-foundations.md`

## 导出的模块

`src/index.ts` 当前导出以下能力：

### Core

- 类型：
  - `MailboxSchema`
  - `ActorEnvelope`
  - `TaggedEnvelope`
  - `MailboxPriority`
  - `ActorRef`
  - `ActorSelf`
  - `ActorHandler`
  - `TagHandler`
  - `ActorDef`
  - `ActorLogKind`
  - `ActorLogEntry`
- 实现：
  - `ActorSystem`

### Runtime

- 类型：
  - `ActorPlugin`
  - `CompletionWaiter`
  - `SnapshotRecoveryState`
  - `RuntimeSnapshotManifestBase`
  - `RuntimeRootSnapshotBase`
  - `ActorSnapshotBase`
  - `FiberSnapshotBase`
  - `SnapshotCodec`
  - `RecoveryHooks`
  - `PersistenceEffectPort`
- 实现：
  - `ActorRuntime`
  - `CompletionSignalRegistry`
  - `CompletionBindingRegistry`
  - `createCompletionSignalRegistry`
  - `createCompletionBindingRegistry`
  - `createSnapshotCodec`
  - `createRecoveryHooks`
  - `createPersistenceEffectPort`
  - `RuntimeIndexHook`
  - `createRuntimeIndexHook`

### Pipeline

- 类型：
  - `ActorPipelineDef`
  - `PipelineDerivedAdapter`
  - `PipelineInnerRuntimeAdapter`
  - `PipelineInnerInputAdapter`
  - `PipelineInnerConfigAdapter`
  - `PipelineCoreLogic`
  - `PipelineOutputAdapter`
- 实现：
  - `createPipelineHandler`

### Dispatch

- 类型：
  - `DispatchRoute`
- 实现：
  - `createDispatchHandler`

### Orchestration

- 类型：
  - `FiberId`
  - `FiberStatus`
  - `FiberWaitingReason`
  - `SuspendPolicy`
  - `SchedulerHooks`
  - `FiberStep`
  - `FiberRecord`
  - `SpawnFiberInput`
  - `DeadLetterRecord`
  - `OrchestratorOptions`
  - `OrchestratorState`
  - `FiberAction`
  - `FiberEffect`
  - `ReduceResult`
  - `ScheduleResult`
- 实现：
  - `DEFAULT_ORCHESTRATOR_OPTIONS`
  - `createOrchestratorState`
  - `reduceOrchestrator`
  - `applyFailure`
  - `computeEffectivePriority`
  - `selectNextFiberId`
  - `scheduleOne`
  - `createAiAgentSchedulerHooks`
  - `dispatchEffects`

## 最小示例

下面是一个最小的 actor system 示例：

```ts
import { ActorSystem, type ActorDef } from "@depa/actor"

type DemoSchema = {
  ping: { from: string }
  pong: { from: string }
}

const system = new ActorSystem<void, DemoSchema>(() => undefined)

const pingActor: ActorDef<void, DemoSchema, { count: number }> = {
  initialState: { count: 0 },
  handlers: {
    ping(self, env) {
      self.state.count += 1
      self.send(env.from, "pong", { from: self.id })
    },
  },
}

const pongActor: ActorDef<void, DemoSchema, void> = {
  initialState: undefined,
  handlers: {
    pong(_self, env) {
      console.log("received pong from", env.payload.from)
    },
  },
}

system.register("alice", pingActor)
system.register("bob", pongActor)

system.sendFrom("bob", "alice", "ping", { from: "bob" })
```

## Selective Receive 示例

如果某些消息优先级更高，可以配合 `priority` 和 `drainMailbox()`：

```ts
import { ActorSystem, type ActorDef } from "@depa/actor"

type Schema = {
  step: { round: number }
  cancel: { reason: string }
}

const system = new ActorSystem<void, Schema>(() => undefined)

const actor: ActorDef<void, Schema, { cancelled: boolean }> = {
  initialState: { cancelled: false },
  priority: {
    cancel: 1,
    step: 100,
  },
  handlers: {
    step(self, env) {
      const pendingCancel = self.hasPending("cancel")
      if (pendingCancel) {
        const [cancel] = self.drainMailbox("cancel")
        if (cancel) {
          self.state.cancelled = true
          console.log("cancelled:", cancel.payload.reason)
          return
        }
      }

      if (!self.state.cancelled) {
        console.log("step", env.payload.round)
      }
    },
  },
}

system.register("worker", actor)
```

## 适合什么，不适合什么

### 适合

- 用消息驱动状态机
- 需要明确 mailbox 边界
- 需要把状态与调度分开
- 需要通过仿真测试验证复杂运行时语义
- 需要为 AI agent、多 worker、多阶段执行建模

### 不适合

- 只想写一个简单的同步流程
- 不需要消息边界与调度语义
- 需要现成的分布式 actor 集群能力
- 需要持久化 mailbox / durable queue / exactly-once 保证

## 测试

运行全部测试：

```bash
bun test
```

或：

```bash
bun run test
```

其中有几类值得优先阅读的测试：

### 基础 actor / scheduler

- `test/fiber-orchestrator.core.test.ts`
- `test/fiber-orchestrator.runtime.test.ts`
- `test/scheduler.generic-hooks.test.ts`

### AI agent 相关抽象测试

- `test/ai-agent-orchestration-simulation.test.ts`
- `test/ai-agent-human-wait-policy.test.ts`
- `test/ai-agent-organization-model.test.ts`

### 业务语义仿真测试

- `test/simulations/background-tasks/daemon_notify_queue.test.ts`
- `test/simulations/agent-teams/members_jsonl_mailboxes.test.ts`
- `test/simulations/team-protocols/protocol_fsm_shutdown_plan_approval.test.ts`
- `test/simulations/autonomous-agents/idle_cycle_auto_claim.test.ts`
- `test/simulations/cancel/interrupt_cancel_keeps_main_alive.test.ts`
- `test/simulations/shutdown/shutdown_stops_actor.test.ts`

这些仿真测试应以当前的 primary / delegate / detached 与 member / holon + governance 模型理解。

## 目录结构

```text
src/
├── core/            Actor 基础类型与 ActorSystem
├── runtime/         ActorRuntime
├── dispatch/        dispatch 适配层
├── pipeline/        pipeline 适配层
└── orchestration/   fiber 调度与编排

test/
├── simulations/     面向业务语义的仿真测试
└── *.test.ts        核心能力测试
```

## 构建与开发

安装依赖：

```bash
bun install
```

构建：

```bash
bun run build
```

监听编译：

```bash
bun run dev
```

测试：

```bash
bun run test
```

## 相关文档

- `ACTOR-FOR-AI-AGENTS.md`：如何用 actor / fiber 抽象实现 AI agent 能力
- `doc/runtime-foundations.md`：runtime foundation、边界与第一轮 adoption 说明

## 一句话总结

`depa-actor` 的核心价值不是“把函数包装成 actor”，而是提供一套足够小、足够清晰的消息与调度抽象，使复杂系统——尤其是 AI agent 运行时——能够用可组合、可测试的方式实现。  
