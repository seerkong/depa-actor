import { describe, test, expect } from "bun:test"

import { reduceOrchestrator, selectNextFiberId } from "../../../src/orchestration"
import { createHarness } from "../_shared/orchestratorHarness"

type Schema = {
  step: any
}

describe("cancel simulation (depa-actor)", () => {
  test("foreground interrupt can keep main fiber resumable while a delegate fiber is shut down separately", () => {
    const h = createHarness<Schema>({ agingStep: 0, defaultSuspendPolicy: "continue_others" })

    h.spawn({
      fiberId: "main",
      actorId: "main",
      basePriority: 0,
      lane: "interactive",
      payload: { phase: "waiting_llm" },
    })
    h.spawn({
      fiberId: "delegate-1",
      actorId: "delegate-1",
      parentId: "main",
      basePriority: 5,
      lane: "background",
      payload: { phase: "waiting_llm" },
    })

    h.suspendFiber("main", 1, "external")
    h.suspendFiber("delegate-1", 1, "external")

    expect(h.getState().fibers.main.status).toBe("suspended")
    expect(h.getState().fibers["delegate-1"].status).toBe("suspended")

    // App-level cancel semantics are modeled as a resume of the main fiber
    // back into a drain/safe-boundary state, not a terminal orchestrator cancel.
    h.resumeFiber("main", 2, { phase: "drain_cancelled_turn" })

    // Child teardown is a separate actor-lifecycle concern, modeled with core cancel.
    const next = reduceOrchestrator(h.getState() as any, {
      type: "cancel",
      fiberId: "delegate-1",
      now: 2,
      reason: "shutdown_requested",
      propagateToChildren: true,
    })

    expect(next.state.fibers.main.status).toBe("ready")
    expect(next.state.fibers.main.step?.payload).toEqual({ phase: "drain_cancelled_turn" })
    expect(next.state.fibers["delegate-1"].status).toBe("cancelled")
    expect(selectNextFiberId(next.state as any)).toBe("main")
  })
})
