import type { MailboxSchema } from '../core/types';
import type { FiberEffect, FiberId, FiberRecord, OrchestratorState, ReduceResult } from './types';

function cloneFiberMap<TSchema extends MailboxSchema>(
  state: OrchestratorState<TSchema>,
): Record<FiberId, FiberRecord<TSchema>> {
  return { ...state.fibers };
}

function buildDeadLetterEffects<TSchema extends MailboxSchema>(
  state: OrchestratorState<TSchema>,
  fiber: FiberRecord<TSchema>,
  reason: string,
): FiberEffect<TSchema>[] {
  const effects: FiberEffect<TSchema>[] = [
    {
      kind: 'dead_letter',
      fiberId: fiber.id,
      reason,
    },
  ];

  const route = state.options.deadLetterFactory?.(fiber, reason);
  if (route) {
    effects.push({
      kind: 'dead_letter',
      fiberId: fiber.id,
      reason,
      to: route.to,
      step: route.step,
    });
  }

  return effects;
}

function computeRetryDelay(
  retryDelayMs: number,
  retryBackoffMultiplier: number,
  attempts: number,
): number {
  const base = Math.max(0, retryDelayMs);
  const multiplier = Math.max(1, retryBackoffMultiplier);
  return Math.floor(base * Math.pow(multiplier, Math.max(0, attempts - 1)));
}

export function applyFailure<TSchema extends MailboxSchema>(
  state: OrchestratorState<TSchema>,
  fiberId: FiberId,
  now: number,
  error: string,
): ReduceResult<TSchema> {
  const fiber = state.fibers[fiberId];
  if (!fiber) {
    return { state, effects: [] };
  }

  if (fiber.status === 'completed' || fiber.status === 'cancelled' || fiber.status === 'dead_letter') {
    return { state, effects: [] };
  }

  const nextFibers = cloneFiberMap(state);

  if (state.options.retryEnabled && fiber.attempts < fiber.maxAttempts) {
    const nextAttempts = fiber.attempts + 1;
    const delay = computeRetryDelay(
      state.options.retryDelayMs,
      state.options.retryBackoffMultiplier,
      nextAttempts,
    );
    const updated: FiberRecord<TSchema> = {
      ...fiber,
      status: 'suspended',
      waitingReason: 'retry_backoff',
      suspendPolicy: undefined,
      retryAt: now + delay,
      timeoutAt: undefined,
      attempts: nextAttempts,
      lastError: error,
      updatedAt: now,
    };
    nextFibers[fiberId] = updated;
    return {
      state: {
        ...state,
        fibers: nextFibers,
      },
      effects: [],
    };
  }

  if (state.options.deadLetterEnabled) {
    const updated: FiberRecord<TSchema> = {
      ...fiber,
      status: 'dead_letter',
      waitingReason: undefined,
      suspendPolicy: undefined,
      retryAt: undefined,
      lastError: error,
      updatedAt: now,
    };
    nextFibers[fiberId] = updated;

    const deadLetters = [
      ...state.deadLetters,
      {
        fiberId: fiber.id,
        actorId: fiber.actorId,
        reason: error,
        at: now,
        attempts: fiber.attempts,
        step: fiber.step,
      },
    ];

    return {
      state: {
        ...state,
        fibers: nextFibers,
        deadLetters,
      },
      effects: buildDeadLetterEffects(state, updated, error),
    };
  }

  const updated: FiberRecord<TSchema> = {
    ...fiber,
    status: 'failed',
    waitingReason: undefined,
    suspendPolicy: undefined,
    retryAt: undefined,
    lastError: error,
    updatedAt: now,
  };
  nextFibers[fiberId] = updated;

  return {
    state: {
      ...state,
      fibers: nextFibers,
    },
    effects: [],
  };
}
