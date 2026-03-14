import { describe, test, expect } from "bun:test"

import { createHarness } from "../_shared/orchestratorHarness"
import { reduceOrchestrator } from "../../../src/orchestration"

type Schema = {
  step: any
}

describe("shutdown simulation (depa-actor)", () => {
  test("shutdown is modeled as terminal cancel and propagates to children", () => {
    const h = createHarness<Schema>({ agingStep: 0, defaultSuspendPolicy: "continue_others" })

    h.spawn({
      fiberId: "member-main",
      actorId: "member-main",
      basePriority: 0,
      lane: "member",
      payload: { phase: "waiting_llm" },
    })
    h.spawn({
      fiberId: "worker-child",
      actorId: "worker-child",
      parentId: "member-main",
      basePriority: 5,
      lane: "background",
      payload: { phase: "waiting_tool" },
    })

    h.suspendFiber("member-main", 1, "external")
    h.suspendFiber("worker-child", 1, "external")

    const cancelled = reduceOrchestrator(h.getState() as any, {
      type: "cancel",
      fiberId: "member-main",
      now: 2,
      reason: "shutdown_requested",
      propagateToChildren: true,
    })

    expect(cancelled.state.fibers["member-main"].status).toBe("cancelled")
    expect(cancelled.state.fibers["worker-child"].status).toBe("cancelled")
    expect(cancelled.state.fibers["member-main"].lastError).toBe("shutdown_requested")
    expect(cancelled.state.fibers["worker-child"].lastError).toBe("shutdown_requested")
  })

  test("shutdown without propagation stops only the target fiber", () => {
    const h = createHarness<Schema>({ agingStep: 0, defaultSuspendPolicy: "continue_others" })

    h.spawn({
      fiberId: "member-main",
      actorId: "member-main",
      basePriority: 0,
      lane: "member",
      payload: { phase: "waiting_llm" },
    })
    h.spawn({
      fiberId: "worker-child",
      actorId: "worker-child",
      parentId: "member-main",
      basePriority: 5,
      lane: "background",
      payload: { phase: "waiting_tool" },
    })

    h.suspendFiber("member-main", 1, "external")
    h.suspendFiber("worker-child", 1, "external")

    const cancelled = reduceOrchestrator(h.getState() as any, {
      type: "cancel",
      fiberId: "worker-child",
      now: 2,
      reason: "shutdown_requested",
      propagateToChildren: false,
    })

    expect(cancelled.state.fibers["worker-child"].status).toBe("cancelled")
    expect(cancelled.state.fibers["member-main"].status).toBe("suspended")
  })
})
