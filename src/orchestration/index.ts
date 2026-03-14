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
} from './types';

export { DEFAULT_ORCHESTRATOR_OPTIONS } from './types';

export { createOrchestratorState, reduceOrchestrator } from './reducer';

export { applyFailure } from './recovery';

export {
  computeEffectivePriority,
  selectNextFiberId,
  scheduleOne,
} from './scheduler';
export type { ScheduleResult } from './scheduler';

export { createAiAgentSchedulerHooks } from './presets/aiAgent';

export { dispatchEffects } from './runtimeAdapter';
