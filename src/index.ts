// depa-actor — Core
export type {
  MailboxSchema,
  ActorEnvelope,
  TaggedEnvelope,
  MailboxPriority,
  ActorRef,
  ActorSelf,
  ActorHandler,
  TagHandler,
  ActorDef,
  ActorLogKind,
  ActorLogEntry,
} from './core/types';

export { ActorSystem } from './core/ActorSystem';

// depa-actor — Runtime
export type { ActorPlugin } from './runtime/ActorRuntime';
export { ActorRuntime } from './runtime/ActorRuntime';
export {
  CompletionSignalRegistry,
  CompletionBindingRegistry,
  createCompletionSignalRegistry,
  createCompletionBindingRegistry,
} from './runtime/completion';
export type {
  CompletionWaiter,
} from './runtime/completion';
export type {
  SnapshotRecoveryState,
  RuntimeSnapshotManifestBase,
  RuntimeRootSnapshotBase,
  ActorSnapshotBase,
  FiberSnapshotBase,
  SnapshotCodec,
  RecoveryHooks,
  PersistenceEffectPort,
} from './runtime/snapshot';
export {
  createSnapshotCodec,
  createRecoveryHooks,
  createPersistenceEffectPort,
} from './runtime/snapshot';
export { RuntimeIndexHook, createRuntimeIndexHook } from './runtime/indexing';

// depa-actor — Pipeline (DOP bridge)
export type {
  ActorPipelineDef,
  PipelineDerivedAdapter,
  PipelineInnerRuntimeAdapter,
  PipelineInnerInputAdapter,
  PipelineInnerConfigAdapter,
  PipelineCoreLogic,
  PipelineOutputAdapter,
} from './pipeline/ActorPipeline';
export { createPipelineHandler } from './pipeline/ActorPipeline';

// depa-actor — Dispatch bridge
export type { DispatchRoute } from './dispatch/ActorDispatchAdapter';
export { createDispatchHandler } from './dispatch/ActorDispatchAdapter';

// depa-actor — Orchestration (Fiber Scheduling)
export type {
  FiberId,
  FiberStatus,
  FiberWaitingReason,
  SuspendPolicy,
  SchedulerHooks,
  FiberStep,
  FiberRecord,
  SpawnFiberInput,
  DeadLetterRecord,
  OrchestratorOptions,
  OrchestratorState,
  FiberAction,
  FiberEffect,
  ReduceResult,
  ScheduleResult,
} from './orchestration';

export {
  DEFAULT_ORCHESTRATOR_OPTIONS,
  createOrchestratorState,
  reduceOrchestrator,
  applyFailure,
  computeEffectivePriority,
  selectNextFiberId,
  scheduleOne,
  createAiAgentSchedulerHooks,
  dispatchEffects,
} from './orchestration';
