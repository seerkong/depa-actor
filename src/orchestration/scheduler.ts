import type { MailboxSchema } from '../core/types';
import type { FiberEffect, FiberId, FiberRecord, OrchestratorState } from './types';

export interface ScheduleResult<TSchema extends MailboxSchema> {
  state: OrchestratorState<TSchema>;
  effects: FiberEffect<TSchema>[];
  selectedFiberId?: FiberId;
}

function isSchedulable<TSchema extends MailboxSchema>(fiber: FiberRecord<TSchema>): boolean {
  return fiber.status === 'ready';
}

export function computeEffectivePriority<TSchema extends MailboxSchema>(
  fiber: FiberRecord<TSchema>,
  agingStep: number,
): number {
  return fiber.basePriority - fiber.age * Math.max(0, agingStep);
}

export function selectNextFiberId<TSchema extends MailboxSchema>(
  state: OrchestratorState<TSchema>,
  now?: number,
): FiberId | undefined {
  const hooks = state.options.schedulerHooks;
  const selectionNow = typeof now === 'number' ? now : Date.now();
  let candidates = Object.values(state.fibers).filter(isSchedulable);

  if (hooks?.filterCandidates) {
    candidates = hooks.filterCandidates({ state, candidates, now: selectionNow });
  } else if (hooks?.filterCandidate) {
    const f = hooks.filterCandidate;
    candidates = candidates.filter(fiber => f({ state, fiber, now: selectionNow }));
  }

  if (candidates.length === 0) {
    return undefined;
  }

  const agingStep = state.options.agingStep;
  candidates.sort((a, b) => {
    const pa = computeEffectivePriority(a, agingStep);
    const pb = computeEffectivePriority(b, agingStep);
    if (pa !== pb) {
      return pa - pb;
    }
    return a.order - b.order;
  });

  return candidates[0]?.id;
}

export function scheduleOne<TSchema extends MailboxSchema>(
  state: OrchestratorState<TSchema>,
  now: number,
): ScheduleResult<TSchema> {
  const selectedFiberId = selectNextFiberId(state, now);
  if (!selectedFiberId) {
    return { state, effects: [] };
  }

  const selected = state.fibers[selectedFiberId];
  if (!selected) {
    return { state, effects: [] };
  }

  const timeoutMs = selected.timeoutMs ?? state.options.defaultTimeoutMs;
  const timeoutAt = state.options.timeoutEnabled && timeoutMs > 0 ? now + timeoutMs : undefined;

  const nextFibers: Record<FiberId, FiberRecord<TSchema>> = { ...state.fibers };
  for (const [id, fiber] of Object.entries(state.fibers)) {
    if (id === selectedFiberId) {
      nextFibers[id] = {
        ...fiber,
        status: 'running',
        age: 0,
        timeoutAt,
        updatedAt: now,
      };
      continue;
    }

    if (fiber.status === 'ready') {
      nextFibers[id] = {
        ...fiber,
        age: fiber.age + Math.max(0, state.options.agingStep),
        updatedAt: now,
      };
    }
  }

  const effects: FiberEffect<TSchema>[] = [];
  const withStep = nextFibers[selectedFiberId];
  if (withStep?.step) {
    effects.push({
      kind: 'send',
      fiberId: selectedFiberId,
      to: withStep.actorId,
      step: withStep.step,
    });
  }

  return {
    state: {
      ...state,
      fibers: nextFibers,
    },
    effects,
    selectedFiberId,
  };
}
