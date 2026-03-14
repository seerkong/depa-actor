/**
 * AI Agent Orchestration — Human Wait Policy (Multi-Actor Simulation)
 *
 * Based on local AI agent session/tool state machine design.
 *
 * Scenario:
 * - control actor spawns two delegate actors (delegate-1, delegate-2)
 * - delegate-1 runs a tool-execution-like state machine and may suspend waiting for:
 *   - human clarification
 *   - human approval
 *   - human answer
 * - two control policies are validated:
 *   1) pause_all: if any actor waits for human input, all scheduling pauses
 *   2) continue_others: other actors keep running while one waits
 */

import { describe, test, expect } from 'bun:test';
import {
  createOrchestratorState,
  createAiAgentSchedulerHooks,
  reduceOrchestrator,
  scheduleOne,
  selectNextFiberId,
} from '../src/orchestration';
import type { OrchestratorState } from '../src/orchestration';

type MultiActorSchema = {
  step: {
    actor: string;
    state: string;
    event: string;
  };
};

function spawnStep(
  state: OrchestratorState<MultiActorSchema>,
  input: {
    id: string;
    actorId: string;
    parentId?: string;
    basePriority: number;
    lane?: 'interactive' | 'member' | 'background' | 'collective';
    payload: MultiActorSchema['step'];
  },
  now: number,
): OrchestratorState<MultiActorSchema> {
  return reduceOrchestrator(state, {
    type: 'spawn',
    fiber: {
      id: input.id,
      actorId: input.actorId,
      parentId: input.parentId,
      basePriority: input.basePriority,
      lane: input.lane,
      step: { tag: 'step', payload: input.payload },
    } as any,
    now,
  }).state;
}

function yieldTo(
  state: OrchestratorState<MultiActorSchema>,
  fiberId: string,
  now: number,
  payload: MultiActorSchema['step'],
): OrchestratorState<MultiActorSchema> {
  return reduceOrchestrator(state, {
    type: 'yield',
    fiberId,
    now,
    nextStep: { tag: 'step', payload },
  }).state;
}

function suspendHuman(
  state: OrchestratorState<MultiActorSchema>,
  fiberId: string,
  now: number,
  reason: 'human_clarification' | 'human_approval' | 'human_answer',
): OrchestratorState<MultiActorSchema> {
  return reduceOrchestrator(state, {
    type: 'suspend',
    fiberId,
    now,
    reason,
  }).state;
}

function suspendHumanWithPolicy(
  state: OrchestratorState<MultiActorSchema>,
  fiberId: string,
  now: number,
  reason: 'human_clarification' | 'human_approval' | 'human_answer',
  policy: 'pause_all' | 'continue_others',
): OrchestratorState<MultiActorSchema> {
  // Intentionally uses an extra field to express per-fiber policy.
  return reduceOrchestrator(state, {
    type: 'suspend',
    fiberId,
    now,
    reason,
    suspendPolicy: policy,
  }).state;
}

function resumeHuman(
  state: OrchestratorState<MultiActorSchema>,
  fiberId: string,
  now: number,
  payload: MultiActorSchema['step'],
): OrchestratorState<MultiActorSchema> {
  return reduceOrchestrator(state, {
    type: 'resume',
    fiberId,
    now,
    nextStep: { tag: 'step', payload },
  }).state;
}

function completeFiber(
  state: OrchestratorState<MultiActorSchema>,
  fiberId: string,
  now: number,
): OrchestratorState<MultiActorSchema> {
  return reduceOrchestrator(state, {
    type: 'complete',
    fiberId,
    now,
  }).state;
}

function scheduleAndTrace(
  state: OrchestratorState<MultiActorSchema>,
  now: number,
  trace: string[],
): { state: OrchestratorState<MultiActorSchema>; selected?: string } {
  const r = scheduleOne(state, now);
  if (!r.selectedFiberId) {
    trace.push('SCHED:none');
    return { state: r.state };
  }

  expect(r.effects).toHaveLength(1);
  const eff = r.effects[0];
  if (eff.kind !== 'send') {
    throw new Error('expected send effect');
  }
  trace.push(`${eff.to}:${eff.step.payload.state}`);
  return { state: r.state, selected: r.selectedFiberId };
}

describe('AI Agent Orchestration — Human Wait Policy', () => {
  test('pause_all gate blocks interactive/member but allows background/collective lanes', () => {
    let s = createOrchestratorState<MultiActorSchema>({
      agingStep: 0,
      defaultSuspendPolicy: 'pause_all',
      schedulerHooks: createAiAgentSchedulerHooks<MultiActorSchema>(),
    });

    // interactive fibers
    s = spawnStep(
      s,
      {
        id: 'main-fiber',
        actorId: 'main',
        basePriority: 1,
        lane: 'interactive',
        payload: { actor: 'main', state: 'Processing', event: 'foreground' },
      },
      0,
    );
    s = spawnStep(
      s,
      {
        id: 'sub-1-fiber',
        actorId: 'sub-1',
        parentId: 'main-fiber',
        basePriority: 2,
        lane: 'member',
        payload: { actor: 'sub-1', state: 'Pending', event: 'tool_call' },
      },
      0,
    );

    // background/collective fibers
    s = spawnStep(
      s,
      {
        id: 'bg-fiber',
        actorId: 'bg',
        basePriority: 50,
        lane: 'background',
        payload: { actor: 'bg', state: 'Processing', event: 'background' },
      },
      0,
    );
    s = spawnStep(
      s,
      {
        id: 'auto-fiber',
        actorId: 'auto',
        basePriority: 60,
        lane: 'collective',
        payload: { actor: 'collective', state: 'Processing', event: 'collective' },
      },
      0,
    );

    // delegate-1 waits for human; pause_all should block interactive/member only.
    s = suspendHumanWithPolicy(s, 'sub-1-fiber', 1, 'human_answer', 'pause_all');

    // Even though main-fiber has higher priority, it must be gated.
    expect(selectNextFiberId(s)).toBe('bg-fiber');
  });

  test('mixed policies: pause_all fiber blocks even when global is continue_others', () => {
    let s = createOrchestratorState<MultiActorSchema>({
      agingStep: 0,
      defaultSuspendPolicy: 'continue_others',
      schedulerHooks: createAiAgentSchedulerHooks<MultiActorSchema>(),
    });

    s = spawnStep(
      s,
      {
        id: 'main-fiber',
        actorId: 'main',
        basePriority: 10,
        payload: { actor: 'main', state: 'Processing', event: 'spawn_children' },
      },
      0,
    );
    s = spawnStep(
      s,
      {
        id: 'worker-fiber',
        actorId: 'worker',
        basePriority: 20,
        payload: { actor: 'worker', state: 'Processing', event: 'background' },
      },
      0,
    );
    s = spawnStep(
      s,
      {
        id: 'sub-1-fiber',
        actorId: 'sub-1',
        parentId: 'main-fiber',
        basePriority: 1,
        payload: { actor: 'sub-1', state: 'Pending', event: 'tool_call' },
      },
      0,
    );
    s = spawnStep(
      s,
      {
        id: 'sub-2-fiber',
        actorId: 'sub-2',
        parentId: 'main-fiber',
        basePriority: 2,
        payload: { actor: 'sub-2', state: 'Pending', event: 'tool_call' },
      },
      0,
    );

    // Per-fiber pause_all should block global scheduling.
    s = suspendHumanWithPolicy(s, 'sub-1-fiber', 1, 'human_clarification', 'pause_all');
    expect(selectNextFiberId(s)).toBeUndefined();

    // Once the pause_all waiter resumes, continue_others wait should not block.
    s = resumeHuman(s, 'sub-1-fiber', 2, { actor: 'sub-1', state: 'Validating', event: 'clarified' });
    s = suspendHumanWithPolicy(s, 'sub-2-fiber', 3, 'human_clarification', 'continue_others');
    expect(selectNextFiberId(s)).toBe('sub-1-fiber');
  });

  test('pause_all: sub actor waiting for human pauses all other actors until all resumed', () => {
    let s = createOrchestratorState<MultiActorSchema>({
      agingStep: 0,
      defaultSuspendPolicy: 'pause_all',
      schedulerHooks: createAiAgentSchedulerHooks<MultiActorSchema>(),
    });

    // main + background worker are ready
    s = spawnStep(
      s,
      {
        id: 'main-fiber',
        actorId: 'main',
        basePriority: 10,
        payload: { actor: 'main', state: 'Processing', event: 'spawn_children' },
      },
      0,
    );
    s = spawnStep(
      s,
      {
        id: 'worker-fiber',
        actorId: 'worker',
        basePriority: 20,
        payload: { actor: 'worker', state: 'Processing', event: 'background' },
      },
      0,
    );

    const trace: string[] = [];

    // main runs and spawns children
    let scheduled = scheduleAndTrace(s, 1, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('main-fiber');

    s = spawnStep(
      s,
      {
        id: 'sub-1-fiber',
        actorId: 'sub-1',
        parentId: 'main-fiber',
        basePriority: 1,
        payload: { actor: 'sub-1', state: 'Pending', event: 'tool_call' },
      },
      2,
    );
    s = spawnStep(
      s,
      {
        id: 'sub-2-fiber',
        actorId: 'sub-2',
        parentId: 'main-fiber',
        basePriority: 2,
        payload: { actor: 'sub-2', state: 'Pending', event: 'tool_call' },
      },
      2,
    );
    s = yieldTo(s, 'main-fiber', 2, { actor: 'main', state: 'Processing', event: 'waiting' });

    // Verify parent-child relation exists
    expect(s.fibers['main-fiber'].childIds).toEqual(['sub-1-fiber', 'sub-2-fiber']);
    expect(s.fibers['sub-1-fiber'].parentId).toBe('main-fiber');
    expect(s.fibers['sub-2-fiber'].parentId).toBe('main-fiber');

    // Drive sub-1 towards human clarification wait
    scheduled = scheduleAndTrace(s, 3, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-1-fiber');
    s = yieldTo(s, 'sub-1-fiber', 4, { actor: 'sub-1', state: 'Validating', event: 'validate_args' });

    scheduled = scheduleAndTrace(s, 5, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-1-fiber');
    s = yieldTo(s, 'sub-1-fiber', 6, { actor: 'sub-1', state: 'WaitingClarification', event: 'need_clarification' });

    scheduled = scheduleAndTrace(s, 7, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-1-fiber');
    s = suspendHuman(s, 'sub-1-fiber', 8, 'human_clarification');

    // pause_all: no fibers can be scheduled while any is waiting for human
    expect(s.fibers['main-fiber'].status).toBe('ready');
    expect(s.fibers['worker-fiber'].status).toBe('ready');
    expect(s.fibers['sub-2-fiber'].status).toBe('ready');
    expect(s.fibers['sub-1-fiber'].status).toBe('suspended');
    expect(selectNextFiberId(s)).toBeUndefined();
    const paused = scheduleOne(s, 9);
    expect(paused.selectedFiberId).toBeUndefined();
    expect(paused.effects).toHaveLength(0);

    // Simulate a second sub actor also waiting for a human decision
    s = suspendHuman(s, 'sub-2-fiber', 10, 'human_approval');
    expect(selectNextFiberId(s)).toBeUndefined();

    // Resume only one: still paused because another is still waiting
    s = resumeHuman(s, 'sub-1-fiber', 11, { actor: 'sub-1', state: 'Validating', event: 'clarified' });
    expect(selectNextFiberId(s)).toBeUndefined();

    // Resume the rest: pause lifts
    s = resumeHuman(s, 'sub-2-fiber', 12, { actor: 'sub-2', state: 'Validating', event: 'approved' });
    expect(selectNextFiberId(s)).toBe('sub-1-fiber');

    // Continue sub-1: approval -> answer -> complete
    scheduled = scheduleAndTrace(s, 13, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-1-fiber');
    s = yieldTo(s, 'sub-1-fiber', 14, { actor: 'sub-1', state: 'WaitingApproval', event: 'need_approval' });

    scheduled = scheduleAndTrace(s, 15, trace);
    s = scheduled.state;
    s = suspendHuman(s, 'sub-1-fiber', 16, 'human_approval');
    expect(selectNextFiberId(s)).toBeUndefined();
    s = resumeHuman(s, 'sub-1-fiber', 17, { actor: 'sub-1', state: 'Executing', event: 'approved' });

    scheduled = scheduleAndTrace(s, 18, trace);
    s = scheduled.state;
    s = yieldTo(s, 'sub-1-fiber', 19, { actor: 'sub-1', state: 'WaitingAnswer', event: 'need_answer' });
    scheduled = scheduleAndTrace(s, 20, trace);
    s = scheduled.state;
    s = suspendHuman(s, 'sub-1-fiber', 21, 'human_answer');
    expect(selectNextFiberId(s)).toBeUndefined();
    s = resumeHuman(s, 'sub-1-fiber', 22, { actor: 'sub-1', state: 'Processing', event: 'answer_received' });
    scheduled = scheduleAndTrace(s, 23, trace);
    s = scheduled.state;
    s = completeFiber(s, 'sub-1-fiber', 24);
    expect(s.fibers['sub-1-fiber'].status).toBe('completed');

    // Unblocked scheduling: next is sub-2 (still ready)
    expect(selectNextFiberId(s)).toBe('sub-2-fiber');

    // Sanity: trace should include sub-1 progression and pauses
    expect(trace).toContain('main:Processing');
    expect(trace).toContain('sub-1:Pending');
    expect(trace).toContain('sub-1:Validating');
    expect(trace).toContain('sub-1:WaitingClarification');
  });

  test('continue_others: other actors keep running while a sub actor waits for human input', () => {
    let s = createOrchestratorState<MultiActorSchema>({
      agingStep: 0,
      defaultSuspendPolicy: 'continue_others',
      schedulerHooks: createAiAgentSchedulerHooks<MultiActorSchema>(),
    });

    s = spawnStep(
      s,
      {
        id: 'main-fiber',
        actorId: 'main',
        basePriority: 10,
        payload: { actor: 'main', state: 'Processing', event: 'spawn_children' },
      },
      0,
    );
    s = spawnStep(
      s,
      {
        id: 'worker-fiber',
        actorId: 'worker',
        basePriority: 20,
        payload: { actor: 'worker', state: 'Processing', event: 'background' },
      },
      0,
    );

    const trace: string[] = [];

    // main runs and spawns children
    let scheduled = scheduleAndTrace(s, 1, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('main-fiber');

    s = spawnStep(
      s,
      {
        id: 'sub-1-fiber',
        actorId: 'sub-1',
        parentId: 'main-fiber',
        basePriority: 1,
        payload: { actor: 'sub-1', state: 'Pending', event: 'tool_call' },
      },
      2,
    );
    s = spawnStep(
      s,
      {
        id: 'sub-2-fiber',
        actorId: 'sub-2',
        parentId: 'main-fiber',
        basePriority: 2,
        payload: { actor: 'sub-2', state: 'Pending', event: 'tool_call' },
      },
      2,
    );
    s = yieldTo(s, 'main-fiber', 2, { actor: 'main', state: 'Processing', event: 'waiting' });

    // sub-1 reaches a human wait point
    scheduled = scheduleAndTrace(s, 3, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-1-fiber');
    s = yieldTo(s, 'sub-1-fiber', 4, { actor: 'sub-1', state: 'WaitingClarification', event: 'need_clarification' });
    scheduled = scheduleAndTrace(s, 5, trace);
    s = scheduled.state;
    s = suspendHuman(s, 'sub-1-fiber', 6, 'human_clarification');

    // continue_others: scheduler should continue with other ready fibers
    expect(s.fibers['sub-1-fiber'].status).toBe('suspended');
    expect(selectNextFiberId(s)).toBe('sub-2-fiber');

    // Run sub-2 and worker while sub-1 is blocked
    scheduled = scheduleAndTrace(s, 7, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-2-fiber');
    s = completeFiber(s, 'sub-2-fiber', 8);

    scheduled = scheduleAndTrace(s, 9, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('main-fiber');
    s = yieldTo(s, 'main-fiber', 10, { actor: 'main', state: 'Processing', event: 'still_running' });

    scheduled = scheduleAndTrace(s, 11, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('main-fiber');
    s = yieldTo(s, 'main-fiber', 12, { actor: 'main', state: 'Processing', event: 'still_running_2' });

    scheduled = scheduleAndTrace(s, 13, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('main-fiber');
    s = yieldTo(s, 'main-fiber', 14, { actor: 'main', state: 'Processing', event: 'still_running_3' });

    // Human responds and sub-1 continues through approval + answer
    s = resumeHuman(s, 'sub-1-fiber', 15, { actor: 'sub-1', state: 'CheckingPermission', event: 'clarified' });
    scheduled = scheduleAndTrace(s, 16, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-1-fiber');
    s = yieldTo(s, 'sub-1-fiber', 17, { actor: 'sub-1', state: 'WaitingApproval', event: 'need_approval' });
    scheduled = scheduleAndTrace(s, 18, trace);
    s = scheduled.state;
    s = suspendHuman(s, 'sub-1-fiber', 19, 'human_approval');

    // While waiting approval, others can still run
    scheduled = scheduleAndTrace(s, 20, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('main-fiber');
    s = yieldTo(s, 'main-fiber', 21, { actor: 'main', state: 'Processing', event: 'runs_during_wait' });

    s = resumeHuman(s, 'sub-1-fiber', 22, { actor: 'sub-1', state: 'WaitingAnswer', event: 'approved_need_answer' });
    scheduled = scheduleAndTrace(s, 23, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-1-fiber');
    s = suspendHuman(s, 'sub-1-fiber', 24, 'human_answer');

    // While waiting answer, worker continues
    scheduled = scheduleAndTrace(s, 25, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('main-fiber');
    s = yieldTo(s, 'main-fiber', 26, { actor: 'main', state: 'Processing', event: 'runs_during_answer_wait' });

    s = resumeHuman(s, 'sub-1-fiber', 27, { actor: 'sub-1', state: 'Processing', event: 'answer_received' });
    scheduled = scheduleAndTrace(s, 28, trace);
    s = scheduled.state;
    expect(scheduled.selected).toBe('sub-1-fiber');
    s = completeFiber(s, 'sub-1-fiber', 29);
    expect(s.fibers['sub-1-fiber'].status).toBe('completed');

    // Sanity: trace shows work continued while sub-1 was suspended
    expect(trace).toContain('sub-1:WaitingClarification');
    expect(trace).toContain('sub-2:Pending');
    expect(trace).toContain('main:Processing');
  });
});
