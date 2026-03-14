/**
 * AI Agent Orchestration Simulation — Minimal Abstract Tests
 *
 * Validates depa-actor primitives can model AIAgent orchestration patterns
 * without depending on any AIAgent production code.
 *
 * Mailbox tags: step / yield / cancel / tool_call / tool_result / spawn_child / child_done / complete
 */

import { describe, test, expect } from 'bun:test';
import { ActorSystem } from '../src/core/ActorSystem';
import type { ActorDef, ActorLogEntry } from '../src/core/types';
import {
  createOrchestratorState,
  reduceOrchestrator,
  scheduleOne,
  selectNextFiberId,
  computeEffectivePriority,
} from '../src/orchestration';

// ─── Minimal Schema ──────────────────────────────────────────────────

type AgentSchema = {
  step: { round: number };
  yield: { round: number };
  cancel: { reason: string };
  tool_call: { name: string; args: Record<string, unknown> };
  tool_result: { name: string; result: unknown };
  spawn_child: { childId: string };
  child_done: { childId: string; result: unknown };
  complete: { finalResult: unknown };
};

// ─── Helpers ─────────────────────────────────────────────────────────

const EXTERNAL = '__external__';

function createSystem(onLog?: (entry: ActorLogEntry<AgentSchema>) => void) {
  const system = new ActorSystem<void, AgentSchema>(() => undefined, onLog);
  // Register a dummy external sender so sendFrom works
  system.register(EXTERNAL, { initialState: undefined, handler() {} });
  return system;
}

/** Flush microtask queue so drain completes */
async function flush() {
  // Multiple rounds to ensure nested microtasks settle
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('AI Agent Orchestration Simulation', () => {
  test('system helpers: ids/has/unregister/refFrom/broadcastFrom', async () => {
    const trace: string[] = [];
    const system = createSystem();

    system.register('alpha', {
      initialState: undefined,
      handler(_self, env) {
        trace.push(`alpha:${env.tag}`);
      },
    });

    system.register('beta', {
      initialState: undefined,
      handler(_self, env) {
        trace.push(`beta:${env.tag}`);
      },
    });

    expect(system.has('alpha')).toBe(true);
    expect(system.has('missing')).toBe(false);

    const ids = system.ids();
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');

    const ref = system.refFrom('alpha', 'beta');
    expect(ref).toBeDefined();
    ref?.send('step', { round: 9 });

    system.broadcastFrom('alpha', 'cancel', { reason: 'broadcast' }, { excludeSelf: true });
    await flush();

    expect(trace).toContain('beta:step');
    expect(trace).toContain('beta:cancel');
    expect(trace).not.toContain('alpha:cancel');

    system.unregister('beta');
    expect(system.has('beta')).toBe(false);
  });

  test('selective receive: hasPending + drainMailbox', async () => {
    const trace: string[] = [];
    const system = createSystem();

    const actorDef: ActorDef<void, AgentSchema, void> = {
      initialState: undefined,
      priority: {
        step: 100,
        cancel: 100,
      },
      handlers: {
        step(self, env) {
          trace.push(`step:${env.payload.round}`);
          const pendingBefore = self.hasPending('cancel');
          trace.push(`pending_cancel:${String(pendingBefore)}`);
          const drained = self.drainMailbox('cancel');
          trace.push(`drained_cancel:${drained.length}`);
          const pendingAfter = self.hasPending('cancel');
          trace.push(`pending_cancel_after:${String(pendingAfter)}`);
        },
      },
    };

    system.register('selector', actorDef);
    system.sendFrom(EXTERNAL, 'selector', 'step', { round: 1 });
    system.sendFrom(EXTERNAL, 'selector', 'cancel', { reason: 'x' });
    await flush();

    expect(trace).toEqual([
      'step:1',
      'pending_cancel:true',
      'drained_cancel:1',
      'pending_cancel_after:false',
    ]);
  });

  // (a) 循环推进: step -> yield -> step -> complete
  test('loop progression: step → yield → step → complete', async () => {
    const system = createSystem();
    const trace: string[] = [];

    const agentDef: ActorDef<void, AgentSchema, { round: number }> = {
      initialState: { round: 0 },
      handlers: {
        step(self, env) {
          self.state.round = env.payload.round;
          trace.push(`step:${env.payload.round}`);
          if (env.payload.round < 2) {
            // yield back, simulating LLM partial output
            self.send(self.id, 'yield', { round: env.payload.round });
          } else {
            self.send(self.id, 'complete', { finalResult: 'done' });
          }
        },
        yield(self, env) {
          trace.push(`yield:${env.payload.round}`);
          // drive next step
          self.send(self.id, 'step', { round: env.payload.round + 1 });
        },
        complete(_self, env) {
          trace.push(`complete:${JSON.stringify(env.payload.finalResult)}`);
        },
      },
    };

    system.register('agent', agentDef);
    system.sendFrom(EXTERNAL, 'agent', 'step', { round: 0 });
    await flush();

    expect(trace).toEqual([
      'step:0',
      'yield:0',
      'step:1',
      'yield:1',
      'step:2',
      'complete:"done"',
    ]);
  });

  // (b) 取消中断: cancel 优先于 step
  test('cancel interrupts pending steps', async () => {
    const system = createSystem();
    const trace: string[] = [];

    const agentDef: ActorDef<void, AgentSchema, { cancelled: boolean }> = {
      initialState: { cancelled: false },
      priority: {
        cancel: 1,   // highest
        step: 100,
      },
      handlers: {
        cancel(self, env) {
          self.state.cancelled = true;
          trace.push(`cancelled:${env.payload.reason}`);
        },
        step(self, env) {
          if (self.state.cancelled) {
            trace.push(`step:skipped:${env.payload.round}`);
            return;
          }
          trace.push(`step:${env.payload.round}`);
        },
        complete(_self) {
          trace.push('complete');
        },
      },
    };

    system.register('agent', agentDef);

    // Enqueue step first, then cancel — cancel should drain first due to priority
    system.sendFrom(EXTERNAL, 'agent', 'step', { round: 1 });
    system.sendFrom(EXTERNAL, 'agent', 'cancel', { reason: 'user_abort' });
    await flush();

    // cancel processed first, then step is skipped
    expect(trace[0]).toBe('cancelled:user_abort');
    expect(trace[1]).toBe('step:skipped:1');
    expect(trace).toHaveLength(2);
  });

  // (c) 工具结果回注: tool_call -> tool_result drives next step
  test('tool_call → tool_result drives completion', async () => {
    const system = createSystem();
    const trace: string[] = [];

    const agentDef: ActorDef<void, AgentSchema, { waitingTool: boolean }> = {
      initialState: { waitingTool: false },
      handlers: {
        step(self) {
          trace.push('step:need_tool');
          self.state.waitingTool = true;
          // Emit tool_call to an external tool executor
          self.send('tool-executor', 'tool_call', { name: 'search', args: { q: 'hello' } });
        },
        tool_result(self, env) {
          trace.push(`tool_result:${env.payload.name}:${JSON.stringify(env.payload.result)}`);
          self.state.waitingTool = false;
          self.send(self.id, 'complete', { finalResult: env.payload.result });
        },
        complete(_self, env) {
          trace.push(`complete:${JSON.stringify(env.payload.finalResult)}`);
        },
      },
    };

    // Tool executor: receives tool_call, sends tool_result back
    const toolDef: ActorDef<void, AgentSchema, void> = {
      initialState: undefined,
      handlers: {
        tool_call(self, env) {
          trace.push(`executor:${env.payload.name}`);
          self.send(env.from, 'tool_result', { name: env.payload.name, result: 42 });
        },
      },
    };

    system.register('agent', agentDef);
    system.register('tool-executor', toolDef);
    system.sendFrom(EXTERNAL, 'agent', 'step', { round: 0 });
    await flush();

    expect(trace).toEqual([
      'step:need_tool',
      'executor:search',
      'tool_result:search:42',
      'complete:42',
    ]);
  });

  // (d) 多 agent 协同: parent spawn_child, child_done 后 parent 恢复
  test('multi-agent: parent spawns child, resumes on child_done', async () => {
    const system = createSystem();
    const trace: string[] = [];

    const parentDef: ActorDef<void, AgentSchema, { waiting: boolean }> = {
      initialState: { waiting: false },
      handlers: {
        step(self) {
          trace.push('parent:step');
          self.state.waiting = true;
          self.send(self.id, 'spawn_child', { childId: 'child-1' });
        },
        spawn_child(self, env) {
          trace.push(`parent:spawn:${env.payload.childId}`);
          // Kick off the child
          self.send(env.payload.childId, 'step', { round: 0 });
        },
        child_done(self, env) {
          trace.push(`parent:child_done:${JSON.stringify(env.payload.result)}`);
          self.state.waiting = false;
          self.send(self.id, 'complete', { finalResult: env.payload.result });
        },
        complete(_self, env) {
          trace.push(`parent:complete:${JSON.stringify(env.payload.finalResult)}`);
        },
      },
    };

    const childDef: ActorDef<void, AgentSchema, void> = {
      initialState: undefined,
      handlers: {
        step(self, env) {
          trace.push(`child:step:${env.payload.round}`);
          // Child finishes immediately, notifies parent
          self.send(env.from, 'child_done', { childId: self.id, result: 'child_output' });
        },
      },
    };

    system.register('parent', parentDef);
    system.register('child-1', childDef);
    system.sendFrom(EXTERNAL, 'parent', 'step', { round: 0 });
    await flush();

    expect(trace).toEqual([
      'parent:step',
      'parent:spawn:child-1',
      'child:step:0',
      'parent:child_done:"child_output"',
      'parent:complete:"child_output"',
    ]);
  });

  // (e) 优先级控制: 控制消息优先于普通步进消息
  test('priority: control messages processed before normal steps', async () => {
    const system = createSystem();
    const trace: string[] = [];

    const agentDef: ActorDef<void, AgentSchema, void> = {
      initialState: undefined,
      priority: {
        cancel: 1,
        tool_result: 10,
        step: 100,
      },
      handler(_self, env) {
        trace.push(`${env.tag}:${JSON.stringify(env.payload)}`);
      },
    };

    system.register('agent', agentDef);

    // Enqueue in reverse priority order
    system.sendFrom(EXTERNAL, 'agent', 'step', { round: 1 });
    system.sendFrom(EXTERNAL, 'agent', 'step', { round: 2 });
    system.sendFrom(EXTERNAL, 'agent', 'tool_result', { name: 'x', result: null });
    system.sendFrom(EXTERNAL, 'agent', 'cancel', { reason: 'timeout' });
    await flush();

    // cancel (1) → tool_result (10) → step (100) × 2
    expect(trace[0]).toContain('cancel');
    expect(trace[1]).toContain('tool_result');
    expect(trace[2]).toContain('step');
    expect(trace[3]).toContain('step');
  });

  // (f) 会话状态机: 人机权限确认流转
  test('session FSM: waiting permission resumes after human approval', () => {
    type SessionSchema = {
      step: {
        state:
          | 'Idle'
          | 'Processing'
          | 'ToolCalling'
          | 'PermissionCheck'
          | 'WaitingPermission'
          | 'ToolExecution'
          | 'Responding';
        event: string;
      };
    };

    let state = createOrchestratorState<SessionSchema>();
    const trace: string[] = [];

    state = reduceOrchestrator(state, {
      type: 'spawn',
      fiber: {
        id: 'session-approval',
        actorId: 'session-actor',
        basePriority: 10,
        step: { tag: 'step', payload: { state: 'Idle', event: 'user_message' } },
      },
      now: 0,
    }).state;

    const r1 = scheduleOne(state, 1);
    state = r1.state;
    expect(r1.selectedFiberId).toBe('session-approval');
    if (!r1.effects[0] || r1.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r1.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-approval',
      now: 2,
      nextStep: { tag: 'step', payload: { state: 'Processing', event: 'llm_tool_call' } },
    }).state;

    const r2 = scheduleOne(state, 3);
    state = r2.state;
    if (!r2.effects[0] || r2.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r2.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-approval',
      now: 4,
      nextStep: { tag: 'step', payload: { state: 'ToolCalling', event: 'needs_permission' } },
    }).state;

    const r3 = scheduleOne(state, 5);
    state = r3.state;
    if (!r3.effects[0] || r3.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r3.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-approval',
      now: 6,
      nextStep: { tag: 'step', payload: { state: 'PermissionCheck', event: 'request_human_permission' } },
    }).state;

    const r4 = scheduleOne(state, 7);
    state = r4.state;
    if (!r4.effects[0] || r4.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r4.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-approval',
      now: 8,
      nextStep: { tag: 'step', payload: { state: 'WaitingPermission', event: 'await_human_approval' } },
    }).state;

    const r5 = scheduleOne(state, 9);
    state = r5.state;
    if (!r5.effects[0] || r5.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r5.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'suspend',
      fiberId: 'session-approval',
      now: 10,
      reason: 'external',
    }).state;

    expect(state.fibers['session-approval'].status).toBe('suspended');
    expect(state.fibers['session-approval'].waitingReason).toBe('external');
    expect(selectNextFiberId(state)).toBeUndefined();

    // Human approves
    state = reduceOrchestrator(state, {
      type: 'resume',
      fiberId: 'session-approval',
      now: 11,
      nextStep: { tag: 'step', payload: { state: 'ToolExecution', event: 'approved' } },
    }).state;

    const r6 = scheduleOne(state, 12);
    state = r6.state;
    if (!r6.effects[0] || r6.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r6.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-approval',
      now: 13,
      nextStep: { tag: 'step', payload: { state: 'Processing', event: 'tool_done' } },
    }).state;

    const r7 = scheduleOne(state, 14);
    state = r7.state;
    if (!r7.effects[0] || r7.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r7.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-approval',
      now: 15,
      nextStep: { tag: 'step', payload: { state: 'Responding', event: 'compose_response' } },
    }).state;

    const r8 = scheduleOne(state, 16);
    state = r8.state;
    if (!r8.effects[0] || r8.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r8.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-approval',
      now: 17,
      nextStep: { tag: 'step', payload: { state: 'Idle', event: 'response_done' } },
    }).state;

    const r9 = scheduleOne(state, 18);
    state = r9.state;
    if (!r9.effects[0] || r9.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r9.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'complete',
      fiberId: 'session-approval',
      now: 19,
    }).state;

    expect(trace).toEqual([
      'Idle',
      'Processing',
      'ToolCalling',
      'PermissionCheck',
      'WaitingPermission',
      'ToolExecution',
      'Processing',
      'Responding',
      'Idle',
    ]);
    expect(state.fibers['session-approval'].status).toBe('completed');
  });

  // (g) 会话状态机: 需要用户回答后恢复处理并返回空闲
  test('session FSM: waiting answer resumes after human reply', () => {
    type SessionSchema = {
      step: {
        state: 'Idle' | 'Processing' | 'ToolCalling' | 'WaitingAnswer' | 'Responding';
        event: string;
      };
    };

    let state = createOrchestratorState<SessionSchema>();
    const trace: string[] = [];

    state = reduceOrchestrator(state, {
      type: 'spawn',
      fiber: {
        id: 'session-answer',
        actorId: 'session-actor',
        basePriority: 10,
        step: { tag: 'step', payload: { state: 'Idle', event: 'user_message' } },
      },
      now: 0,
    }).state;

    for (const [now, next] of [
      [1, { state: 'Processing', event: 'llm_tool_call' }],
      [3, { state: 'ToolCalling', event: 'need_user_answer' }],
      [5, { state: 'WaitingAnswer', event: 'await_human_answer' }],
    ] as const) {
      const scheduled = scheduleOne(state, now);
      state = scheduled.state;
      if (!scheduled.effects[0] || scheduled.effects[0].kind !== 'send') {
        throw new Error('expected send effect');
      }
      trace.push(scheduled.effects[0].step.payload.state);
      state = reduceOrchestrator(state, {
        type: 'yield',
        fiberId: 'session-answer',
        now: now + 1,
        nextStep: { tag: 'step', payload: next },
      }).state;
    }

    const waiting = scheduleOne(state, 7);
    state = waiting.state;
    if (!waiting.effects[0] || waiting.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(waiting.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'suspend',
      fiberId: 'session-answer',
      now: 8,
      reason: 'external',
    }).state;

    expect(state.fibers['session-answer'].status).toBe('suspended');

    // Human replies
    state = reduceOrchestrator(state, {
      type: 'resume',
      fiberId: 'session-answer',
      now: 9,
      nextStep: { tag: 'step', payload: { state: 'Processing', event: 'answer_received' } },
    }).state;

    const r5 = scheduleOne(state, 10);
    state = r5.state;
    if (!r5.effects[0] || r5.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r5.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-answer',
      now: 11,
      nextStep: { tag: 'step', payload: { state: 'Responding', event: 'compose_response' } },
    }).state;

    const r6 = scheduleOne(state, 12);
    state = r6.state;
    if (!r6.effects[0] || r6.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r6.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'session-answer',
      now: 13,
      nextStep: { tag: 'step', payload: { state: 'Idle', event: 'response_done' } },
    }).state;

    const r7 = scheduleOne(state, 14);
    state = r7.state;
    if (!r7.effects[0] || r7.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(r7.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'complete',
      fiberId: 'session-answer',
      now: 15,
    }).state;

    expect(trace).toEqual([
      'Idle',
      'Processing',
      'ToolCalling',
      'WaitingAnswer',
      'Processing',
      'Responding',
      'Idle',
    ]);
    expect(state.fibers['session-answer'].status).toBe('completed');
  });

  // (h) 工具执行状态机: 澄清/审批/回答的人机交互闭环
  test('tool FSM: clarification + approval + answer human-in-the-loop', () => {
    type ToolSchema = {
      step: {
        state:
          | 'Pending'
          | 'Validating'
          | 'WaitingClarification'
          | 'CheckingPermission'
          | 'WaitingApproval'
          | 'Executing'
          | 'Processing'
          | 'WaitingAnswer';
        event: string;
      };
    };

    let state = createOrchestratorState<ToolSchema>();
    const trace: string[] = [];

    state = reduceOrchestrator(state, {
      type: 'spawn',
      fiber: {
        id: 'tool-flow',
        actorId: 'tool-actor',
        basePriority: 5,
        step: { tag: 'step', payload: { state: 'Pending', event: 'tool_call' } },
      },
      now: 0,
    }).state;

    // Pending -> Validating -> WaitingClarification
    const s1 = scheduleOne(state, 1);
    state = s1.state;
    if (!s1.effects[0] || s1.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s1.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'tool-flow',
      now: 2,
      nextStep: { tag: 'step', payload: { state: 'Validating', event: 'validate' } },
    }).state;

    const s2 = scheduleOne(state, 3);
    state = s2.state;
    if (!s2.effects[0] || s2.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s2.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'tool-flow',
      now: 4,
      nextStep: { tag: 'step', payload: { state: 'WaitingClarification', event: 'need_clarification' } },
    }).state;

    const s3 = scheduleOne(state, 5);
    state = s3.state;
    if (!s3.effects[0] || s3.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s3.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'suspend',
      fiberId: 'tool-flow',
      now: 6,
      reason: 'external',
    }).state;

    // Human clarification
    state = reduceOrchestrator(state, {
      type: 'resume',
      fiberId: 'tool-flow',
      now: 7,
      nextStep: { tag: 'step', payload: { state: 'Validating', event: 'clarified' } },
    }).state;

    const s4 = scheduleOne(state, 8);
    state = s4.state;
    if (!s4.effects[0] || s4.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s4.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'tool-flow',
      now: 9,
      nextStep: { tag: 'step', payload: { state: 'CheckingPermission', event: 'permission_check' } },
    }).state;

    const s5 = scheduleOne(state, 10);
    state = s5.state;
    if (!s5.effects[0] || s5.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s5.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'tool-flow',
      now: 11,
      nextStep: { tag: 'step', payload: { state: 'WaitingApproval', event: 'need_approval' } },
    }).state;

    const s6 = scheduleOne(state, 12);
    state = s6.state;
    if (!s6.effects[0] || s6.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s6.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'suspend',
      fiberId: 'tool-flow',
      now: 13,
      reason: 'external',
    }).state;

    // Human approval
    state = reduceOrchestrator(state, {
      type: 'resume',
      fiberId: 'tool-flow',
      now: 14,
      nextStep: { tag: 'step', payload: { state: 'Executing', event: 'approved' } },
    }).state;

    const s7 = scheduleOne(state, 15);
    state = s7.state;
    if (!s7.effects[0] || s7.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s7.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'tool-flow',
      now: 16,
      nextStep: { tag: 'step', payload: { state: 'Processing', event: 'execution_started' } },
    }).state;

    const s8 = scheduleOne(state, 17);
    state = s8.state;
    if (!s8.effects[0] || s8.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s8.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'yield',
      fiberId: 'tool-flow',
      now: 18,
      nextStep: { tag: 'step', payload: { state: 'WaitingAnswer', event: 'need_answer' } },
    }).state;

    const s9 = scheduleOne(state, 19);
    state = s9.state;
    if (!s9.effects[0] || s9.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s9.effects[0].step.payload.state);
    state = reduceOrchestrator(state, {
      type: 'suspend',
      fiberId: 'tool-flow',
      now: 20,
      reason: 'external',
    }).state;

    // Human answer
    state = reduceOrchestrator(state, {
      type: 'resume',
      fiberId: 'tool-flow',
      now: 21,
      nextStep: { tag: 'step', payload: { state: 'Processing', event: 'answer_received' } },
    }).state;

    const s10 = scheduleOne(state, 22);
    state = s10.state;
    if (!s10.effects[0] || s10.effects[0].kind !== 'send') {
      throw new Error('expected send effect');
    }
    trace.push(s10.effects[0].step.payload.state);

    state = reduceOrchestrator(state, {
      type: 'complete',
      fiberId: 'tool-flow',
      now: 23,
    }).state;

    expect(trace).toEqual([
      'Pending',
      'Validating',
      'WaitingClarification',
      'Validating',
      'CheckingPermission',
      'WaitingApproval',
      'Executing',
      'Processing',
      'WaitingAnswer',
      'Processing',
    ]);
    expect(state.fibers['tool-flow'].status).toBe('completed');
  });

  // ─── Orchestration API validation (formerly skipped) ─────────────────

  test('aging: starvation prevention for low-priority fibers', () => {
    // Use orchestration API to verify aging prevents starvation
    type S = AgentSchema;
    let state = createOrchestratorState<S>({ agingStep: 10 });

    // Spawn a high-priority and a low-priority fiber
    state = reduceOrchestrator(state, {
      type: 'spawn',
      fiber: { id: 'high', actorId: 'a', basePriority: 5, step: { tag: 'step', payload: { round: 0 } } },
      now: 0,
    }).state;
    state = reduceOrchestrator(state, {
      type: 'spawn',
      fiber: { id: 'low', actorId: 'b', basePriority: 50, step: { tag: 'step', payload: { round: 0 } } },
      now: 1,
    }).state;

    // Initially high wins
    expect(selectNextFiberId(state)).toBe('high');

    // Simulate multiple rounds: schedule high, yield it back, low ages each time
    for (let i = 0; i < 5; i++) {
      const result = scheduleOne(state, i * 10);
      state = result.state;
      // yield the selected fiber back to ready
      if (result.selectedFiberId) {
        state = reduceOrchestrator(state, {
          type: 'yield',
          fiberId: result.selectedFiberId,
          now: i * 10 + 5,
        }).state;
      }
    }

    // After 5 rounds of aging at step=10, low.age=50 → effective = 50 - 50*10 = -450
    // high.age resets each time it runs → effective = 5
    // low should now win
    const effLow = computeEffectivePriority(state.fibers['low'], 10);
    const effHigh = computeEffectivePriority(state.fibers['high'], 10);
    expect(effLow).toBeLessThan(effHigh);
    expect(selectNextFiberId(state)).toBe('low');
  });

  test('timeout / retry / dead-letter parameterized strategies', () => {
    // Use orchestration API to verify timeout → retry → dead-letter cycle
    type S = AgentSchema;
    let state = createOrchestratorState<S>({
      timeoutEnabled: true,
      defaultTimeoutMs: 100,
      retryEnabled: true,
      retryDelayMs: 50,
      retryBackoffMultiplier: 1,
      deadLetterEnabled: true,
    });

    state = reduceOrchestrator(state, {
      type: 'spawn',
      fiber: {
        id: 'f1',
        actorId: 'agent',
        basePriority: 10,
        maxAttempts: 1,
        step: { tag: 'step', payload: { round: 0 } },
      },
      now: 0,
    }).state;

    // Schedule → running with timeout
    state = scheduleOne(state, 0).state;
    expect(state.fibers['f1'].status).toBe('running');
    expect(state.fibers['f1'].timeoutAt).toBe(100);

    // Tick at timeout → retry (attempt 1)
    let r = reduceOrchestrator(state, { type: 'tick', now: 100 });
    expect(r.state.fibers['f1'].status).toBe('suspended');
    expect(r.state.fibers['f1'].waitingReason).toBe('retry_backoff');
    expect(r.state.fibers['f1'].attempts).toBe(1);

    // Tick past retryAt → ready again
    r = reduceOrchestrator(r.state, { type: 'tick', now: 150 });
    expect(r.state.fibers['f1'].status).toBe('ready');

    // Schedule and timeout again → maxAttempts exhausted → dead letter
    state = scheduleOne(r.state, 150).state;
    r = reduceOrchestrator(state, { type: 'tick', now: 250 });
    expect(r.state.fibers['f1'].status).toBe('dead_letter');
    expect(r.state.deadLetters).toHaveLength(1);
    expect(r.state.deadLetters[0].reason).toBe('timeout');
    expect(r.effects.some(e => e.kind === 'dead_letter')).toBe(true);
  });
});
