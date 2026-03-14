import { describe, test, expect } from 'bun:test';

import {
  createAiAgentSchedulerHooks,
  createOrchestratorState,
  reduceOrchestrator,
  selectNextFiberId,
} from '../src/orchestration';

type Schema = {
  step: { n: number };
};

describe('Orchestration scheduler hooks', () => {
  test('without hooks, scheduler does not apply AI pause_all lane gating', () => {
    let s = createOrchestratorState<Schema>({ agingStep: 0, defaultSuspendPolicy: 'pause_all' });

    // A suspended fiber simulates a human wait.
    s =
      reduceOrchestrator(s, {
        type: 'spawn',
        fiber: { id: 'blocker', actorId: 'a', basePriority: 1, lane: 'interactive', step: { tag: 'step', payload: { n: 0 } } } as any,
        now: 0,
      }).state;
    s =
      reduceOrchestrator(s, {
        type: 'suspend',
        fiberId: 'blocker',
        now: 1,
        reason: 'human_answer',
        suspendPolicy: 'pause_all',
      } as any).state;

    // Ready fibers.
    s =
      reduceOrchestrator(s, {
        type: 'spawn',
        fiber: { id: 'fg', actorId: 'fg', basePriority: 1, lane: 'interactive', step: { tag: 'step', payload: { n: 1 } } } as any,
        now: 0,
      }).state;
    s =
      reduceOrchestrator(s, {
        type: 'spawn',
        fiber: { id: 'bg', actorId: 'bg', basePriority: 50, lane: 'background', step: { tag: 'step', payload: { n: 2 } } } as any,
        now: 0,
      }).state;

    // If the scheduler were applying AI gating by default, it would pick 'bg'.
    // Generic scheduler should pick 'fg' (lowest priority number).
    expect(selectNextFiberId(s)).toBe('fg');
  });

  test('AI preset hooks reproduce pause_all gating behavior', () => {
    let s = createOrchestratorState<Schema>({
      agingStep: 0,
      defaultSuspendPolicy: 'pause_all',
      schedulerHooks: createAiAgentSchedulerHooks<Schema>(),
    });

    s =
      reduceOrchestrator(s, {
        type: 'spawn',
        fiber: { id: 'blocker', actorId: 'a', basePriority: 1, lane: 'interactive', step: { tag: 'step', payload: { n: 0 } } } as any,
        now: 0,
      }).state;
    s =
      reduceOrchestrator(s, {
        type: 'suspend',
        fiberId: 'blocker',
        now: 1,
        reason: 'human_answer',
        suspendPolicy: 'pause_all',
      } as any).state;

    s =
      reduceOrchestrator(s, {
        type: 'spawn',
        fiber: { id: 'fg', actorId: 'fg', basePriority: 1, lane: 'interactive', step: { tag: 'step', payload: { n: 1 } } } as any,
        now: 0,
      }).state;
    s =
      reduceOrchestrator(s, {
        type: 'spawn',
        fiber: { id: 'bg', actorId: 'bg', basePriority: 50, lane: 'background', step: { tag: 'step', payload: { n: 2 } } } as any,
        now: 0,
      }).state;

    expect(selectNextFiberId(s)).toBe('bg');
  });
});
