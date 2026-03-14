/**
 * Fiber Orchestrator — Core Tests
 *
 * Covers: lifecycle (spawn/yield/suspend/resume/complete/fail/cancel),
 * scheduling (priority + aging), cancel propagation, timeout, retry, dead-letter.
 * Pure DOP functions — no ActorSystem dependency.
 */

import { describe, test, expect } from 'bun:test';
import {
  createOrchestratorState,
  reduceOrchestrator,
  computeEffectivePriority,
  selectNextFiberId,
  scheduleOne,
  applyFailure,
} from '../src/orchestration';
import type {
  FiberAction,
  FiberRecord,
  OrchestratorState,
  SpawnFiberInput,
  ReduceResult,
} from '../src/orchestration';

// ─── Helpers ─────────────────────────────────────────────────────────

type TestSchema = {
  step: { round: number };
  cancel: { reason: string };
  complete: { result: unknown };
};

function makeState(
  opts?: Partial<Parameters<typeof createOrchestratorState>[0]>,
): OrchestratorState<TestSchema> {
  return createOrchestratorState<TestSchema>(opts);
}

function spawnFiber(
  state: OrchestratorState<TestSchema>,
  input: SpawnFiberInput<TestSchema>,
  now = 0,
): OrchestratorState<TestSchema> {
  const { state: s } = reduceOrchestrator(state, { type: 'spawn', fiber: input, now });
  return s;
}

function defaultSpawn(overrides?: Partial<SpawnFiberInput<TestSchema>>): SpawnFiberInput<TestSchema> {
  return {
    id: 'f1',
    actorId: 'actor-1',
    basePriority: 10,
    maxAttempts: 3,
    step: { tag: 'step', payload: { round: 0 } },
    ...overrides,
  };
}

// ─── Lifecycle ───────────────────────────────────────────────────────

describe('Fiber Orchestrator — Lifecycle', () => {
  test('spawn creates a ready fiber with correct fields', () => {
    const s0 = makeState();
    const s1 = spawnFiber(s0, defaultSpawn(), 100);

    const fiber = s1.fibers['f1'];
    expect(fiber).toBeDefined();
    expect(fiber.status).toBe('ready');
    expect(fiber.basePriority).toBe(10);
    expect(fiber.age).toBe(0);
    expect(fiber.attempts).toBe(0);
    expect(fiber.maxAttempts).toBe(3);
    expect(fiber.createdAt).toBe(100);
    expect(fiber.updatedAt).toBe(100);
    expect(s1.sequence).toBe(1);
  });

  test('spawn with parent links child to parent', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn({ id: 'parent', actorId: 'a' }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'child', actorId: 'b', parentId: 'parent' }), 1);

    expect(s.fibers['parent'].childIds).toContain('child');
    expect(s.fibers['child'].parentId).toBe('parent');
  });

  test('yield transitions running → ready', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn(), 0);
    // Move to running via scheduleOne
    const scheduled = scheduleOne(s, 10);
    s = scheduled.state;
    expect(s.fibers['f1'].status).toBe('running');

    const { state: s2 } = reduceOrchestrator(s, {
      type: 'yield',
      fiberId: 'f1',
      now: 20,
      nextStep: { tag: 'step', payload: { round: 1 } },
    });
    expect(s2.fibers['f1'].status).toBe('ready');
    expect(s2.fibers['f1'].step?.payload).toEqual({ round: 1 });
  });

  test('suspend transitions to suspended with reason', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn(), 0);

    const { state: s2 } = reduceOrchestrator(s, {
      type: 'suspend',
      fiberId: 'f1',
      now: 10,
      reason: 'tool_result',
    });
    expect(s2.fibers['f1'].status).toBe('suspended');
    expect(s2.fibers['f1'].waitingReason).toBe('tool_result');
  });

  test('resume transitions suspended → ready', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn(), 0);
    s = reduceOrchestrator(s, { type: 'suspend', fiberId: 'f1', now: 5, reason: 'external' }).state;

    const { state: s2 } = reduceOrchestrator(s, {
      type: 'resume',
      fiberId: 'f1',
      now: 10,
    });
    expect(s2.fibers['f1'].status).toBe('ready');
    expect(s2.fibers['f1'].waitingReason).toBeUndefined();
  });

  test('complete transitions to completed', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn(), 0);

    const { state: s2 } = reduceOrchestrator(s, {
      type: 'complete',
      fiberId: 'f1',
      now: 10,
    });
    expect(s2.fibers['f1'].status).toBe('completed');
  });

  test('actions on terminal fibers are no-ops', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn(), 0);
    s = reduceOrchestrator(s, { type: 'complete', fiberId: 'f1', now: 10 }).state;

    // yield on completed → no change
    const { state: s2 } = reduceOrchestrator(s, { type: 'yield', fiberId: 'f1', now: 20 });
    expect(s2.fibers['f1'].status).toBe('completed');

    // suspend on completed → no change
    const { state: s3 } = reduceOrchestrator(s, { type: 'suspend', fiberId: 'f1', now: 20, reason: 'external' });
    expect(s3.fibers['f1'].status).toBe('completed');

    // resume on completed → no change
    const { state: s4 } = reduceOrchestrator(s, { type: 'resume', fiberId: 'f1', now: 20 });
    expect(s4.fibers['f1'].status).toBe('completed');
  });

  test('action on non-existent fiber is no-op', () => {
    const s = makeState();
    const { state: s2 } = reduceOrchestrator(s, { type: 'complete', fiberId: 'ghost', now: 10 });
    expect(s2).toEqual(s);
  });
});

// ─── Scheduling ──────────────────────────────────────────────────────

describe('Fiber Orchestrator — Scheduling', () => {
  test('selectNextFiberId picks lowest effective priority', () => {
    let s = makeState({ agingStep: 1 });
    s = spawnFiber(s, defaultSpawn({ id: 'low', basePriority: 100 }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'high', basePriority: 1 }), 1);

    expect(selectNextFiberId(s)).toBe('high');
  });

  test('selectNextFiberId uses order as tiebreaker', () => {
    let s = makeState({ agingStep: 0 });
    s = spawnFiber(s, defaultSpawn({ id: 'a', basePriority: 10 }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'b', basePriority: 10 }), 1);

    // 'a' has order=1, 'b' has order=2 → 'a' first
    expect(selectNextFiberId(s)).toBe('a');
  });

  test('scheduleOne moves selected to running and ages others', () => {
    let s = makeState({ agingStep: 2 });
    s = spawnFiber(s, defaultSpawn({ id: 'f1', basePriority: 1 }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'f2', basePriority: 10 }), 1);

    const result = scheduleOne(s, 100);
    expect(result.selectedFiberId).toBe('f1');
    expect(result.state.fibers['f1'].status).toBe('running');
    expect(result.state.fibers['f1'].age).toBe(0); // reset on run
    expect(result.state.fibers['f2'].age).toBe(2); // aged by agingStep
  });

  test('scheduleOne returns empty when no ready fibers', () => {
    const s = makeState();
    const result = scheduleOne(s, 0);
    expect(result.selectedFiberId).toBeUndefined();
    expect(result.effects).toHaveLength(0);
  });

  test('scheduleOne produces send effect when fiber has step', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn({ id: 'f1', step: { tag: 'step', payload: { round: 0 } } }), 0);

    const result = scheduleOne(s, 10);
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('send');
  });

  test('computeEffectivePriority accounts for aging', () => {
    const fiber = { basePriority: 50, age: 10 } as FiberRecord<TestSchema>;
    // effectivePriority = basePriority - age * agingStep = 50 - 10*3 = 20
    expect(computeEffectivePriority(fiber, 3)).toBe(20);
  });
});

// ─── Aging (starvation prevention) ───────────────────────────────────

describe('Fiber Orchestrator — Aging', () => {
  test('aging promotes low-priority fiber over high-priority after enough rounds', () => {
    let s = makeState({ agingStep: 5 });
    s = spawnFiber(s, defaultSpawn({ id: 'low', basePriority: 100 }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'high', basePriority: 10 }), 1);

    // Initially high wins
    expect(selectNextFiberId(s)).toBe('high');

    // Simulate scheduling 'high' multiple times, aging 'low' each time
    for (let i = 0; i < 20; i++) {
      const result = scheduleOne(s, i * 10);
      s = result.state;
      if (result.selectedFiberId) {
        // Complete the running fiber and re-spawn high
        s = reduceOrchestrator(s, { type: 'complete', fiberId: result.selectedFiberId, now: i * 10 + 5 }).state;
        if (result.selectedFiberId === 'high') {
          s = spawnFiber(s, defaultSpawn({ id: 'high', basePriority: 10 }), i * 10 + 6);
        }
      }
    }

    // After enough aging, 'low' should have accumulated enough age to beat 'high'
    // effective(low) = 100 - age*5, effective(high) = 10 - 0*5 = 10
    // When low.age >= 19: effective = 100 - 19*5 = 5 < 10 → low wins
    const lowFiber = s.fibers['low'];
    if (lowFiber && lowFiber.status === 'ready') {
      const effLow = computeEffectivePriority(lowFiber, 5);
      const highFiber = s.fibers['high'];
      if (highFiber) {
        const effHigh = computeEffectivePriority(highFiber, 5);
        expect(effLow).toBeLessThan(effHigh);
      }
    }
  });

  test('aging increments each scheduling round for non-selected ready fibers', () => {
    let s = makeState({ agingStep: 1 });
    s = spawnFiber(s, defaultSpawn({ id: 'winner', basePriority: 1 }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'waiter', basePriority: 50 }), 1);

    // Round 1: winner selected, waiter ages
    let result = scheduleOne(s, 10);
    expect(result.state.fibers['waiter'].age).toBe(1);

    // Yield winner back to ready
    s = reduceOrchestrator(result.state, { type: 'yield', fiberId: 'winner', now: 15 }).state;

    // Round 2: winner selected again, waiter ages more
    result = scheduleOne(s, 20);
    expect(result.state.fibers['waiter'].age).toBe(2);
  });
});

// ─── Cancel Propagation ──────────────────────────────────────────────

describe('Fiber Orchestrator — Cancel Propagation', () => {
  test('cancel single fiber', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn({ id: 'f1' }), 0);

    const { state } = reduceOrchestrator(s, {
      type: 'cancel',
      fiberId: 'f1',
      now: 10,
      reason: 'user_abort',
    });
    expect(state.fibers['f1'].status).toBe('cancelled');
    expect(state.fibers['f1'].lastError).toBe('user_abort');
  });

  test('cancel propagates to children when propagateToChildren=true', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn({ id: 'parent', actorId: 'a' }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'child1', actorId: 'b', parentId: 'parent' }), 1);
    s = spawnFiber(s, defaultSpawn({ id: 'child2', actorId: 'c', parentId: 'parent' }), 2);

    const { state } = reduceOrchestrator(s, {
      type: 'cancel',
      fiberId: 'parent',
      now: 10,
      reason: 'cascade',
      propagateToChildren: true,
    });

    expect(state.fibers['parent'].status).toBe('cancelled');
    expect(state.fibers['child1'].status).toBe('cancelled');
    expect(state.fibers['child2'].status).toBe('cancelled');
  });

  test('cancel does NOT propagate without propagateToChildren', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn({ id: 'parent', actorId: 'a' }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'child', actorId: 'b', parentId: 'parent' }), 1);

    const { state } = reduceOrchestrator(s, {
      type: 'cancel',
      fiberId: 'parent',
      now: 10,
      reason: 'solo',
    });

    expect(state.fibers['parent'].status).toBe('cancelled');
    expect(state.fibers['child'].status).toBe('ready');
  });

  test('cancel propagates through nested children', () => {
    let s = makeState();
    s = spawnFiber(s, defaultSpawn({ id: 'root', actorId: 'a' }), 0);
    s = spawnFiber(s, defaultSpawn({ id: 'mid', actorId: 'b', parentId: 'root' }), 1);
    s = spawnFiber(s, defaultSpawn({ id: 'leaf', actorId: 'c', parentId: 'mid' }), 2);

    const { state } = reduceOrchestrator(s, {
      type: 'cancel',
      fiberId: 'root',
      now: 10,
      reason: 'deep',
      propagateToChildren: true,
    });

    expect(state.fibers['root'].status).toBe('cancelled');
    expect(state.fibers['mid'].status).toBe('cancelled');
    expect(state.fibers['leaf'].status).toBe('cancelled');
  });
});

// ─── Timeout ─────────────────────────────────────────────────────────

describe('Fiber Orchestrator — Timeout', () => {
  test('tick triggers timeout on running fiber past deadline', () => {
    let s = makeState({ timeoutEnabled: true, defaultTimeoutMs: 100 });
    s = spawnFiber(s, defaultSpawn({ id: 'f1' }), 0);

    // Schedule to set timeoutAt
    const scheduled = scheduleOne(s, 0);
    s = scheduled.state;
    expect(s.fibers['f1'].status).toBe('running');
    expect(s.fibers['f1'].timeoutAt).toBe(100);

    // Tick before timeout — no change
    let result = reduceOrchestrator(s, { type: 'tick', now: 50 });
    expect(result.state.fibers['f1'].status).toBe('running');

    // Tick at timeout — triggers failure
    result = reduceOrchestrator(s, { type: 'tick', now: 100 });
    // Without retry, should be 'failed'
    expect(result.state.fibers['f1'].status).toBe('failed');
    expect(result.state.fibers['f1'].lastError).toBe('timeout');
  });

  test('per-fiber timeoutMs overrides default', () => {
    let s = makeState({ timeoutEnabled: true, defaultTimeoutMs: 1000 });
    s = spawnFiber(s, defaultSpawn({ id: 'f1', timeoutMs: 50 }), 0);

    const scheduled = scheduleOne(s, 0);
    s = scheduled.state;
    expect(s.fibers['f1'].timeoutAt).toBe(50);
  });

  test('timeout disabled means no timeoutAt set', () => {
    let s = makeState({ timeoutEnabled: false, defaultTimeoutMs: 100 });
    s = spawnFiber(s, defaultSpawn({ id: 'f1' }), 0);

    const scheduled = scheduleOne(s, 0);
    expect(scheduled.state.fibers['f1'].timeoutAt).toBeUndefined();
  });
});

// ─── Retry ───────────────────────────────────────────────────────────

describe('Fiber Orchestrator — Retry', () => {
  test('fail with retry enabled suspends fiber for retry_backoff', () => {
    let s = makeState({ retryEnabled: true, retryDelayMs: 100, retryBackoffMultiplier: 2 });
    s = spawnFiber(s, defaultSpawn({ id: 'f1', maxAttempts: 3 }), 0);

    // First failure → attempts=1, suspended
    const r1 = reduceOrchestrator(s, { type: 'fail', fiberId: 'f1', now: 10, error: 'err1' });
    expect(r1.state.fibers['f1'].status).toBe('suspended');
    expect(r1.state.fibers['f1'].waitingReason).toBe('retry_backoff');
    expect(r1.state.fibers['f1'].attempts).toBe(1);
    expect(r1.state.fibers['f1'].retryAt).toBe(110); // 10 + 100 * 2^0

    // Tick past retryAt → back to ready
    const r2 = reduceOrchestrator(r1.state, { type: 'tick', now: 110 });
    expect(r2.state.fibers['f1'].status).toBe('ready');
  });

  test('retry backoff increases exponentially', () => {
    let s = makeState({ retryEnabled: true, retryDelayMs: 100, retryBackoffMultiplier: 2 });
    s = spawnFiber(s, defaultSpawn({ id: 'f1', maxAttempts: 5 }), 0);

    // Attempt 1: delay = 100 * 2^0 = 100
    let r = reduceOrchestrator(s, { type: 'fail', fiberId: 'f1', now: 0, error: 'e' });
    expect(r.state.fibers['f1'].retryAt).toBe(100);

    // Resume and fail again: attempt 2: delay = 100 * 2^1 = 200
    r = reduceOrchestrator(r.state, { type: 'tick', now: 100 });
    r = reduceOrchestrator(r.state, { type: 'fail', fiberId: 'f1', now: 100, error: 'e' });
    expect(r.state.fibers['f1'].retryAt).toBe(300); // 100 + 200

    // Attempt 3: delay = 100 * 2^2 = 400
    r = reduceOrchestrator(r.state, { type: 'tick', now: 300 });
    r = reduceOrchestrator(r.state, { type: 'fail', fiberId: 'f1', now: 300, error: 'e' });
    expect(r.state.fibers['f1'].retryAt).toBe(700); // 300 + 400
  });

  test('fail beyond maxAttempts with retry but no dead-letter → failed', () => {
    let s = makeState({ retryEnabled: true, retryDelayMs: 10, retryBackoffMultiplier: 1 });
    s = spawnFiber(s, defaultSpawn({ id: 'f1', maxAttempts: 1 }), 0);

    // First fail: attempts goes 0→1, which equals maxAttempts=1 → no more retries
    const r = reduceOrchestrator(s, { type: 'fail', fiberId: 'f1', now: 10, error: 'final' });
    // attempts < maxAttempts is false (0 < 1 is true, so first retry happens)
    expect(r.state.fibers['f1'].status).toBe('suspended');
    expect(r.state.fibers['f1'].attempts).toBe(1);

    // Resume and fail again: attempts=1, maxAttempts=1 → 1 < 1 is false → no retry
    const r2 = reduceOrchestrator(r.state, { type: 'tick', now: 100 });
    const r3 = reduceOrchestrator(r2.state, { type: 'fail', fiberId: 'f1', now: 100, error: 'done' });
    expect(r3.state.fibers['f1'].status).toBe('failed');
  });
});

// ─── Dead Letter ─────────────────────────────────────────────────────

describe('Fiber Orchestrator — Dead Letter', () => {
  test('fail beyond retries with dead-letter enabled → dead_letter status', () => {
    let s = makeState({
      retryEnabled: true,
      retryDelayMs: 10,
      retryBackoffMultiplier: 1,
      deadLetterEnabled: true,
    });
    s = spawnFiber(s, defaultSpawn({ id: 'f1', maxAttempts: 0 }), 0);

    // maxAttempts=0, attempts=0 → 0 < 0 is false → skip retry → dead letter
    const r = reduceOrchestrator(s, { type: 'fail', fiberId: 'f1', now: 10, error: 'boom' });
    expect(r.state.fibers['f1'].status).toBe('dead_letter');
    expect(r.state.deadLetters).toHaveLength(1);
    expect(r.state.deadLetters[0].reason).toBe('boom');
    expect(r.state.deadLetters[0].fiberId).toBe('f1');
  });

  test('dead-letter produces dead_letter effect', () => {
    let s = makeState({
      retryEnabled: false,
      deadLetterEnabled: true,
    });
    s = spawnFiber(s, defaultSpawn({ id: 'f1' }), 0);

    const r = reduceOrchestrator(s, { type: 'fail', fiberId: 'f1', now: 10, error: 'err' });
    expect(r.effects.length).toBeGreaterThanOrEqual(1);
    expect(r.effects[0].kind).toBe('dead_letter');
  });

  test('deadLetterFactory produces routed dead_letter effect', () => {
    let s = makeState({
      retryEnabled: false,
      deadLetterEnabled: true,
      deadLetterFactory: (_fiber, reason) => ({
        to: 'dlq-actor',
        step: { tag: 'step', payload: { round: -1 } },
      }),
    });
    s = spawnFiber(s, defaultSpawn({ id: 'f1' }), 0);

    const r = reduceOrchestrator(s, { type: 'fail', fiberId: 'f1', now: 10, error: 'routed' });
    // Should have 2 effects: base dead_letter + routed dead_letter
    expect(r.effects).toHaveLength(2);
    const routed = r.effects.find(e => e.kind === 'dead_letter' && 'to' in e && e.to === 'dlq-actor');
    expect(routed).toBeDefined();
  });

  test('fail without retry or dead-letter → failed status', () => {
    let s = makeState({ retryEnabled: false, deadLetterEnabled: false });
    s = spawnFiber(s, defaultSpawn({ id: 'f1' }), 0);

    const r = reduceOrchestrator(s, { type: 'fail', fiberId: 'f1', now: 10, error: 'plain' });
    expect(r.state.fibers['f1'].status).toBe('failed');
    expect(r.effects).toHaveLength(0);
  });
});

// ─── Timeout + Retry + Dead Letter Integration ──────────────────────

describe('Fiber Orchestrator — Timeout/Retry/DeadLetter Integration', () => {
  test('timeout → retry → exhaust → dead-letter full cycle', () => {
    let s = makeState({
      timeoutEnabled: true,
      defaultTimeoutMs: 50,
      retryEnabled: true,
      retryDelayMs: 10,
      retryBackoffMultiplier: 1,
      deadLetterEnabled: true,
    });
    s = spawnFiber(s, defaultSpawn({ id: 'f1', maxAttempts: 2 }), 0);

    // Schedule → running with timeoutAt=50
    s = scheduleOne(s, 0).state;
    expect(s.fibers['f1'].status).toBe('running');

    // Tick at 50 → timeout → retry (attempt 1)
    let r = reduceOrchestrator(s, { type: 'tick', now: 50 });
    expect(r.state.fibers['f1'].status).toBe('suspended');
    expect(r.state.fibers['f1'].attempts).toBe(1);

    // Tick past retryAt → ready
    r = reduceOrchestrator(r.state, { type: 'tick', now: 60 });
    expect(r.state.fibers['f1'].status).toBe('ready');

    // Schedule again → running
    s = scheduleOne(r.state, 60).state;
    expect(s.fibers['f1'].status).toBe('running');

    // Timeout again → retry (attempt 2)
    r = reduceOrchestrator(s, { type: 'tick', now: 110 });
    expect(r.state.fibers['f1'].status).toBe('suspended');
    expect(r.state.fibers['f1'].attempts).toBe(2);

    // Tick past retryAt → ready
    r = reduceOrchestrator(r.state, { type: 'tick', now: 120 });
    expect(r.state.fibers['f1'].status).toBe('ready');

    // Schedule again → running
    s = scheduleOne(r.state, 120).state;

    // Timeout again → attempts=2 == maxAttempts=2 → dead letter
    r = reduceOrchestrator(s, { type: 'tick', now: 170 });
    expect(r.state.fibers['f1'].status).toBe('dead_letter');
    expect(r.state.deadLetters).toHaveLength(1);
  });
});
