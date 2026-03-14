# Runtime Foundations

本文件说明 `depa-actor` 当前补齐的第一轮 runtime foundation，以及它与项目侧 AI runtime 的边界。

## 新增能力

- `CompletionSignalRegistry<TKey, TResult>`
  - 表达 keyed completion wait / resolve
  - 适合承载 task final、route final、异步结果回流等等待语义
- `CompletionBindingRegistry<TKey, TBinding>`
  - 表达 parent-child completion binding
  - 适合承载 child fiber / detached completion 的回流关联
- `SnapshotCodec<TState, TSnapshot>`
  - 表达 snapshot serialize / hydrate 协议
- `RuntimeSnapshotManifestBase`
- `RuntimeRootSnapshotBase`
- `ActorSnapshotBase<TActorType>`
- `FiberSnapshotBase`
  - 表达 actor / runtime root / fiber / manifest 的通用 snapshot 基础结构
  - 上层应通过扩展这些 base contracts 附加产品字段，而不是继续独立维护平行基础 schema
- `RecoveryHooks<TState, TSnapshot>`
  - 表达 beforeSerialize / beforeHydrate / afterHydrate hook
- `PersistenceEffectPort<TManifest, TSnapshotState>`
  - 表达 save / load effect port
  - 不假定文件系统、数据库或其他具体存储介质
- `RuntimeIndexHook<TKey, TValue>`
  - 表达 actor / fiber 的额外索引或派生视图
  - 适合通过 facet 挂载到 runtime，而不是继续复制 shell 结构
- `ActorRuntime` facets
  - 通过 `setFacet()`、`getFacet()`、`ensureFacet()` 挂载产品态或索引

## 设计边界

这些 foundation 只负责通用 actor runtime 机制：

- 如何等待 keyed completion
- 如何表达 child completion binding
- 如何定义 snapshot / recover protocol
- 如何通过 facet 挂载额外状态与索引

这些 foundation 不负责 AI-specific 语义：

- holon 治理语义（`autonomous | leader_led`）
- `TaskTree`
- plan approval / shutdown coordination
- questionnaire wait policy 的业务解释
- detached task contract、organization projection 等 AI-specific 中层

这些能力仍应保留在 `symbiont-*`、`core-logic` 与更高层。

## 第一轮 adoption

本仓库中第一轮真实 adoption 包括：

- `VmRuntimeContext`
  - 通过 `ActorRuntime` facet `cell.vm.runtimeContext` 挂载
  - holon assign / route final waiters 改为委托给 `CompletionSignalRegistry`
- `OrchestratorDriver`
  - child completion binding 改为建立在 `CompletionBindingRegistry` 上
  - fiber context 改为通过 `RuntimeIndexHook` facet `cell.orchestrator.fiberIndex` 管理
- runtime snapshot / recovery
  - `serializeActor` / `hydrateActor`
  - `serializeVM` / `hydrateVM`
  - 改为通过 vendor snapshot base contracts + codec / recovery hook protocol 暴露

## 为什么不直接把 AI runtime 状态搬进 vendor

因为 `depa-actor` 仍需服务 AI 之外的通用 actor runtime 场景。vendor 只沉淀“等待、恢复、扩展机制”，而不沉淀“这些机制在 AI runtime 中具体代表什么”。
