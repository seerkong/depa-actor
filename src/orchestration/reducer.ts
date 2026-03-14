import type { MailboxSchema } from '../core/types';
import { applyFailure } from './recovery';
import {
  DEFAULT_ORCHESTRATOR_OPTIONS,
  type FiberAction,
  type FiberId,
  type FiberRecord,
  type OrchestratorOptions,
  type OrchestratorState,
  type ReduceResult,
  type SpawnFiberInput,
  type SuspendPolicy,
} from './types';

function isTerminalStatus(status: FiberRecord<MailboxSchema>['status']): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed' || status === 'dead_letter';
}

function cloneFiberMap<TSchema extends MailboxSchema>(
  state: OrchestratorState<TSchema>,
): Record<FiberId, FiberRecord<TSchema>> {
  return { ...state.fibers };
}

function upsertParentChildRelation<TSchema extends MailboxSchema>(
  fibers: Record<FiberId, FiberRecord<TSchema>>,
  fiber: SpawnFiberInput<TSchema>,
  now: number,
): void {
  if (!fiber.parentId) {
    return;
  }
  const parent = fibers[fiber.parentId];
  if (!parent) {
    return;
  }

  if (!parent.childIds.includes(fiber.id)) {
    fibers[fiber.parentId] = {
      ...parent,
      childIds: [...parent.childIds, fiber.id],
      updatedAt: now,
    };
  }
}

function createFiberRecord<TSchema extends MailboxSchema>(
  input: SpawnFiberInput<TSchema>,
  now: number,
  order: number,
  state: OrchestratorState<TSchema>,
): FiberRecord<TSchema> {
  const timeoutMs = input.timeoutMs ?? state.options.defaultTimeoutMs;
  return {
    id: input.id,
    actorId: input.actorId,
    parentId: input.parentId,
    childIds: [],
    lane: input.lane ?? 'default',
    status: 'ready',
    basePriority: input.basePriority,
    age: 0,
    attempts: 0,
    maxAttempts: Math.max(0, input.maxAttempts ?? 0),
    step: input.step,
    waitingReason: undefined,
    suspendPolicy: undefined,
    timeoutMs: timeoutMs > 0 ? timeoutMs : undefined,
    timeoutAt: undefined,
    retryAt: undefined,
    lastError: undefined,
    order,
    createdAt: now,
    updatedAt: now,
  };
}

export function createOrchestratorState<TSchema extends MailboxSchema>(
  options?: Partial<OrchestratorOptions<TSchema>>,
): OrchestratorState<TSchema> {
  const raw = (options ?? {}) as Partial<OrchestratorOptions<TSchema>>;
  const effectiveDefault: SuspendPolicy =
    (raw.defaultSuspendPolicy as SuspendPolicy | undefined) ??
    (DEFAULT_ORCHESTRATOR_OPTIONS.defaultSuspendPolicy as SuspendPolicy);

  const base = {
    ...DEFAULT_ORCHESTRATOR_OPTIONS,
    ...raw,
  } as OrchestratorOptions<TSchema>;

  return {
    options: {
      ...base,
      defaultSuspendPolicy: effectiveDefault,
    },
    fibers: {},
    deadLetters: [],
    sequence: 0,
  };
}

function applyTick<TSchema extends MailboxSchema>(
  state: OrchestratorState<TSchema>,
  now: number,
): ReduceResult<TSchema> {
  let nextState = state;
  let aggregatedEffects: ReduceResult<TSchema>['effects'] = [];

  const ids = Object.keys(state.fibers);
  for (const id of ids) {
    const fiber = nextState.fibers[id];
    if (!fiber) {
      continue;
    }
    if (isTerminalStatus(fiber.status)) {
      continue;
    }

    if (
      nextState.options.timeoutEnabled &&
      fiber.timeoutAt !== undefined &&
      now >= fiber.timeoutAt &&
      (fiber.status === 'running' || fiber.status === 'ready' || fiber.status === 'suspended')
    ) {
      const timed = applyFailure(nextState, id, now, 'timeout');
      nextState = timed.state;
      aggregatedEffects = [...aggregatedEffects, ...timed.effects];
      continue;
    }

    const iter = nextState.fibers[id];
    if (
      iter &&
      iter.status === 'suspended' &&
      iter.waitingReason === 'retry_backoff' &&
      iter.retryAt !== undefined &&
      now >= iter.retryAt
    ) {
      nextState = {
        ...nextState,
        fibers: {
          ...nextState.fibers,
          [id]: {
            ...iter,
            status: 'ready',
            waitingReason: undefined,
            retryAt: undefined,
            timeoutAt: undefined,
            updatedAt: now,
          },
        },
      };
    }
  }

  return {
    state: nextState,
    effects: aggregatedEffects,
  };
}

export function reduceOrchestrator<TSchema extends MailboxSchema>(
  state: OrchestratorState<TSchema>,
  action: FiberAction<TSchema>,
): ReduceResult<TSchema> {
  if (action.type === 'tick') {
    return applyTick(state, action.now);
  }

  if (action.type === 'spawn') {
    const nextSequence = state.sequence + 1;
    const nextFibers = cloneFiberMap(state);
    const record = createFiberRecord(action.fiber, action.now, nextSequence, state);
    nextFibers[action.fiber.id] = record;
    upsertParentChildRelation(nextFibers, action.fiber, action.now);
    return {
      state: {
        ...state,
        sequence: nextSequence,
        fibers: nextFibers,
      },
      effects: [],
    };
  }

  const current = state.fibers[action.fiberId];
  if (!current) {
    return { state, effects: [] };
  }

  if (action.type === 'yield') {
    if (isTerminalStatus(current.status)) {
      return { state, effects: [] };
    }
    return {
      state: {
        ...state,
        fibers: {
          ...state.fibers,
          [action.fiberId]: {
            ...current,
            status: 'ready',
            waitingReason: undefined,
            suspendPolicy: undefined,
            timeoutAt: undefined,
            step: action.nextStep ?? current.step,
            updatedAt: action.now,
          },
        },
      },
      effects: [],
    };
  }

  if (action.type === 'suspend') {
    if (isTerminalStatus(current.status)) {
      return { state, effects: [] };
    }

    const effectivePolicy: SuspendPolicy =
      (action.suspendPolicy as SuspendPolicy | undefined) ??
      (state.options.defaultSuspendPolicy as SuspendPolicy | undefined) ??
      'continue_others';
    return {
      state: {
        ...state,
        fibers: {
          ...state.fibers,
          [action.fiberId]: {
            ...current,
            status: 'suspended',
            waitingReason: action.reason,
            suspendPolicy: effectivePolicy,
            timeoutAt: undefined,
            updatedAt: action.now,
          },
        },
      },
      effects: [],
    };
  }

  if (action.type === 'resume') {
    if (isTerminalStatus(current.status)) {
      return { state, effects: [] };
    }
    return {
      state: {
        ...state,
        fibers: {
          ...state.fibers,
          [action.fiberId]: {
            ...current,
            status: 'ready',
            waitingReason: undefined,
            suspendPolicy: undefined,
            retryAt: undefined,
            timeoutAt: undefined,
            step: action.nextStep ?? current.step,
            updatedAt: action.now,
          },
        },
      },
      effects: [],
    };
  }

  if (action.type === 'complete') {
    return {
      state: {
        ...state,
        fibers: {
          ...state.fibers,
          [action.fiberId]: {
            ...current,
            status: 'completed',
            waitingReason: undefined,
            suspendPolicy: undefined,
            timeoutAt: undefined,
            updatedAt: action.now,
          },
        },
      },
      effects: [],
    };
  }

  if (action.type === 'fail') {
    return applyFailure(state, action.fiberId, action.now, action.error);
  }

  if (action.type === 'cancel') {
    const nextFibers = cloneFiberMap(state);
    const queue = [action.fiberId];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);

      const item = nextFibers[id];
      if (!item) {
        continue;
      }

      nextFibers[id] = {
        ...item,
        status: 'cancelled',
        waitingReason: undefined,
        suspendPolicy: undefined,
        timeoutAt: undefined,
        retryAt: undefined,
        lastError: action.reason,
        updatedAt: action.now,
      };

      if (action.propagateToChildren) {
        for (const childId of item.childIds) {
          queue.push(childId);
        }
      }
    }

    return {
      state: {
        ...state,
        fibers: nextFibers,
      },
      effects: [],
    };
  }

  return { state, effects: [] };
}
