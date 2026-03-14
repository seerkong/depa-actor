import type { MailboxSchema } from '../core/types';

export type FiberId = string;

export type FiberStatus =
  | 'ready'
  | 'running'
  | 'suspended'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'dead_letter';

// Core should not bake in domain-specific waiting reasons.
export type FiberWaitingReason = string;

export type SuspendPolicy = 'continue_others' | 'pause_all';

// Core keeps the lane mechanism but treats lane ids as opaque.
export type FiberLane = string;

export type SchedulerFilterCandidate<TSchema extends MailboxSchema> = (args: {
  state: OrchestratorState<TSchema>;
  fiber: FiberRecord<TSchema>;
  now: number;
}) => boolean;

export type SchedulerFilterCandidates<TSchema extends MailboxSchema> = (args: {
  state: OrchestratorState<TSchema>;
  candidates: Array<FiberRecord<TSchema>>;
  now: number;
}) => Array<FiberRecord<TSchema>>;

export interface SchedulerHooks<TSchema extends MailboxSchema> {
  filterCandidate?: SchedulerFilterCandidate<TSchema>;
  filterCandidates?: SchedulerFilterCandidates<TSchema>;
}

export type FiberStep<TSchema extends MailboxSchema> = {
  [K in keyof TSchema & string]: {
    tag: K;
    payload: TSchema[K];
  }
}[keyof TSchema & string];

export interface FiberRecord<TSchema extends MailboxSchema> {
  id: FiberId;
  actorId: string;
  parentId?: FiberId;
  childIds: FiberId[];
  lane: FiberLane;
  status: FiberStatus;
  basePriority: number;
  age: number;
  attempts: number;
  maxAttempts: number;
  step?: FiberStep<TSchema>;
  waitingReason?: FiberWaitingReason;
  suspendPolicy?: SuspendPolicy;
  timeoutMs?: number;
  timeoutAt?: number;
  retryAt?: number;
  lastError?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface SpawnFiberInput<TSchema extends MailboxSchema> {
  id: FiberId;
  actorId: string;
  parentId?: FiberId;
  basePriority: number;
  lane?: FiberLane;
  maxAttempts?: number;
  step?: FiberStep<TSchema>;
  timeoutMs?: number;
}

export interface DeadLetterRecord<TSchema extends MailboxSchema> {
  fiberId: FiberId;
  actorId: string;
  reason: string;
  at: number;
  attempts: number;
  step?: FiberStep<TSchema>;
}

export interface OrchestratorOptions<TSchema extends MailboxSchema> {
  senderId: string;
  agingStep: number;
  defaultSuspendPolicy: SuspendPolicy;
  schedulerHooks?: SchedulerHooks<TSchema>;
  timeoutEnabled: boolean;
  defaultTimeoutMs: number;
  retryEnabled: boolean;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
  deadLetterEnabled: boolean;
  deadLetterFactory?: (
    fiber: FiberRecord<TSchema>,
    reason: string,
  ) => { to: string; step: FiberStep<TSchema> } | null;
}

export interface OrchestratorState<TSchema extends MailboxSchema> {
  options: OrchestratorOptions<TSchema>;
  fibers: Record<FiberId, FiberRecord<TSchema>>;
  deadLetters: DeadLetterRecord<TSchema>[];
  sequence: number;
}

export type FiberAction<TSchema extends MailboxSchema> =
  | { type: 'spawn'; fiber: SpawnFiberInput<TSchema>; now: number }
  | { type: 'yield'; fiberId: FiberId; now: number; nextStep?: FiberStep<TSchema> }
  | {
      type: 'suspend';
      fiberId: FiberId;
      now: number;
      reason: FiberWaitingReason;
      suspendPolicy?: SuspendPolicy;
    }
  | { type: 'resume'; fiberId: FiberId; now: number; nextStep?: FiberStep<TSchema> }
  | { type: 'complete'; fiberId: FiberId; now: number }
  | { type: 'fail'; fiberId: FiberId; now: number; error: string }
  | { type: 'cancel'; fiberId: FiberId; now: number; reason: string; propagateToChildren?: boolean }
  | { type: 'tick'; now: number };

export type FiberEffect<TSchema extends MailboxSchema> =
  | {
      kind: 'send';
      fiberId: FiberId;
      to: string;
      step: FiberStep<TSchema>;
    }
  | {
      kind: 'dead_letter';
      fiberId: FiberId;
      reason: string;
      to?: string;
      step?: FiberStep<TSchema>;
    };

export interface ReduceResult<TSchema extends MailboxSchema> {
  state: OrchestratorState<TSchema>;
  effects: FiberEffect<TSchema>[];
}

export const DEFAULT_ORCHESTRATOR_OPTIONS: Omit<OrchestratorOptions<MailboxSchema>, 'deadLetterFactory'> = {
  senderId: '__fiber_scheduler__',
  agingStep: 1,
  defaultSuspendPolicy: 'continue_others',
  timeoutEnabled: false,
  defaultTimeoutMs: 0,
  retryEnabled: false,
  retryDelayMs: 0,
  retryBackoffMultiplier: 1,
  deadLetterEnabled: false,
};
