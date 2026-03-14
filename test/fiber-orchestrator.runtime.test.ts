/**
 * Fiber Orchestrator — Runtime Adapter Tests
 *
 * Validates dispatchEffects bridges orchestration effects to ActorRuntime.
 */

import { describe, test, expect } from 'bun:test';
import { ActorRuntime } from '../src/runtime/ActorRuntime';
import { dispatchEffects } from '../src/orchestration/runtimeAdapter';
import {
  createOrchestratorState,
  reduceOrchestrator,
  scheduleOne,
} from '../src/orchestration';
import type { FiberEffect } from '../src/orchestration';

// ─── Schema ──────────────────────────────────────────────────────────

type TestSchema = {
  step: { round: number };
  cancel: { reason: string };
  dlq: { error: string };
};

// ─── Helpers ─────────────────────────────────────────────────────────

function createTestRuntime() {
  const delivered: Array<{ from: string; to: string; tag: string; payload: unknown }> = [];

  const runtime = new ActorRuntime<void, TestSchema>(
    () => undefined,
    [],
  );

  // Register a target actor that records deliveries
  runtime.register('target-actor', {
    initialState: undefined,
    handler(_self, env) {
      delivered.push({ from: env.from, to: env.to, tag: env.tag, payload: env.payload });
    },
  });

  // Register a DLQ actor
  runtime.register('dlq-actor', {
    initialState: undefined,
    handler(_self, env) {
      delivered.push({ from: env.from, to: env.to, tag: env.tag, payload: env.payload });
    },
  });

  // Register scheduler sender
  runtime.register('__fiber_scheduler__', {
    initialState: undefined,
    handler() {},
  });

  return { runtime, delivered };
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Fiber Orchestrator — Runtime Adapter', () => {
  test('dispatchEffects sends "send" effects to runtime', async () => {
    const { runtime, delivered } = createTestRuntime();

    const effects: FiberEffect<TestSchema>[] = [
      {
        kind: 'send',
        fiberId: 'f1',
        to: 'target-actor',
        step: { tag: 'step', payload: { round: 42 } },
      },
    ];

    dispatchEffects(runtime, effects);
    await flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].to).toBe('target-actor');
    expect(delivered[0].tag).toBe('step');
    expect(delivered[0].payload).toEqual({ round: 42 });
  });

  test('dispatchEffects sends routed dead_letter effects', async () => {
    const { runtime, delivered } = createTestRuntime();

    const effects: FiberEffect<TestSchema>[] = [
      {
        kind: 'dead_letter',
        fiberId: 'f1',
        reason: 'timeout',
        to: 'dlq-actor',
        step: { tag: 'dlq', payload: { error: 'timed out' } },
      },
    ];

    dispatchEffects(runtime, effects);
    await flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].to).toBe('dlq-actor');
    expect(delivered[0].tag).toBe('dlq');
  });

  test('dispatchEffects ignores dead_letter without route', async () => {
    const { runtime, delivered } = createTestRuntime();

    const effects: FiberEffect<TestSchema>[] = [
      {
        kind: 'dead_letter',
        fiberId: 'f1',
        reason: 'no route',
      },
    ];

    dispatchEffects(runtime, effects);
    await flush();

    expect(delivered).toHaveLength(0);
  });

  test('dispatchEffects uses custom senderId', async () => {
    const { runtime, delivered } = createTestRuntime();

    // Register custom sender
    runtime.register('custom-sender', {
      initialState: undefined,
      handler() {},
    });

    const effects: FiberEffect<TestSchema>[] = [
      {
        kind: 'send',
        fiberId: 'f1',
        to: 'target-actor',
        step: { tag: 'step', payload: { round: 1 } },
      },
    ];

    dispatchEffects(runtime, effects, 'custom-sender');
    await flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].from).toBe('custom-sender');
  });

  test('end-to-end: spawn → schedule → dispatch effects to runtime', async () => {
    const { runtime, delivered } = createTestRuntime();

    let state = createOrchestratorState<TestSchema>();
    state = reduceOrchestrator(state, {
      type: 'spawn',
      fiber: {
        id: 'f1',
        actorId: 'target-actor',
        basePriority: 10,
        step: { tag: 'step', payload: { round: 0 } },
      },
      now: 0,
    }).state;

    const result = scheduleOne(state, 10);
    dispatchEffects(runtime, result.effects);
    await flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].tag).toBe('step');
    expect(delivered[0].payload).toEqual({ round: 0 });
  });

  test('multiple effects dispatched in order', async () => {
    const { runtime, delivered } = createTestRuntime();

    const effects: FiberEffect<TestSchema>[] = [
      {
        kind: 'send',
        fiberId: 'f1',
        to: 'target-actor',
        step: { tag: 'step', payload: { round: 1 } },
      },
      {
        kind: 'send',
        fiberId: 'f2',
        to: 'target-actor',
        step: { tag: 'step', payload: { round: 2 } },
      },
    ];

    dispatchEffects(runtime, effects);
    await flush();

    expect(delivered).toHaveLength(2);
    expect((delivered[0].payload as { round: number }).round).toBe(1);
    expect((delivered[1].payload as { round: number }).round).toBe(2);
  });
});
