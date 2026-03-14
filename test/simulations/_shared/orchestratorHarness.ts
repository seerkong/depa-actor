import {
  createOrchestratorState,
  createAiAgentSchedulerHooks,
  reduceOrchestrator,
  scheduleOne,
  type OrchestratorState,
  type FiberWaitingReason,
  type SuspendPolicy,
} from "../../../src/orchestration"

export type FiberLane = "interactive" | "member" | "background" | "collective"

export type StepFn<TSchema extends Record<string, any>> = (ctx: {
  fiberId: string
  lane: FiberLane
  payload: any
  now: number
}) =>
  | { kind: "yield"; nextPayload: any }
  | { kind: "suspend"; reason: FiberWaitingReason; suspendPolicy?: SuspendPolicy }
  | { kind: "complete" }

export function createHarness<TSchema extends Record<string, any>>(options?: {
  agingStep?: number
  defaultSuspendPolicy?: SuspendPolicy
}) {
  let state = createOrchestratorState<any>({
    agingStep: options?.agingStep ?? 0,
    defaultSuspendPolicy: options?.defaultSuspendPolicy ?? "continue_others",
    schedulerHooks: createAiAgentSchedulerHooks(),
  }) as OrchestratorState<any>

  const steps = new Map<string, StepFn<TSchema>>()

  const spawn = (input: {
    fiberId: string
    actorId: string
    basePriority: number
    lane?: FiberLane
    payload: any
    parentId?: string
  }) => {
    state =
      reduceOrchestrator(state, {
        type: "spawn",
        fiber: {
          id: input.fiberId,
          actorId: input.actorId,
          parentId: input.parentId,
          basePriority: input.basePriority,
          lane: input.lane,
          step: { tag: "step", payload: input.payload },
        } as any,
        now: Date.now(),
      }).state
  }

  const setStep = (fiberId: string, fn: StepFn<TSchema>) => {
    steps.set(fiberId, fn)
  }

  const suspendFiber = (fiberId: string, now: number, reason: FiberWaitingReason, policy?: SuspendPolicy) => {
    state = reduceOrchestrator(state, {
      type: "suspend",
      fiberId,
      now,
      reason,
      suspendPolicy: policy,
    } as any).state
  }

  const resumeFiber = (fiberId: string, now: number, payload: any) => {
    state = reduceOrchestrator(state, {
      type: "resume",
      fiberId,
      now,
      nextStep: { tag: "step", payload },
    } as any).state
  }

  const runOne = (now: number): { selectedFiberId?: string } => {
    const r = scheduleOne(state, now)
    state = r.state
    const selected = r.selectedFiberId
    if (!selected) {
      return {}
    }
    const fiber = (state.fibers as any)[selected]
    const lane = (fiber?.lane ?? "interactive") as FiberLane
    const payload = fiber?.step?.payload
    const fn = steps.get(selected)
    if (!fn) {
      // If no handler, treat as complete.
      state = reduceOrchestrator(state, { type: "complete", fiberId: selected, now } as any).state
      return { selectedFiberId: selected }
    }
    const out = fn({ fiberId: selected, lane, payload, now })
    if (out.kind === "yield") {
      state =
        reduceOrchestrator(state, {
          type: "yield",
          fiberId: selected,
          now,
          nextStep: { tag: "step", payload: out.nextPayload },
        } as any).state
      return { selectedFiberId: selected }
    }
    if (out.kind === "suspend") {
      state =
        reduceOrchestrator(state, {
          type: "suspend",
          fiberId: selected,
          now,
          reason: out.reason,
          suspendPolicy: out.suspendPolicy,
        } as any).state
      return { selectedFiberId: selected }
    }
    state = reduceOrchestrator(state, { type: "complete", fiberId: selected, now } as any).state
    return { selectedFiberId: selected }
  }

  return {
    getState: () => state,
    spawn,
    setStep,
    suspendFiber,
    resumeFiber,
    runOne,
  }
}
