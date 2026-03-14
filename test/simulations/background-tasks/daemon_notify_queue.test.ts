import { describe, test, expect } from "bun:test"

import { selectNextFiberId } from "../../../src/orchestration"
import { createHarness } from "../_shared/orchestratorHarness"

type Schema = {
  step: any
}

describe("s08 Detached work notifications (depa-actor simulation)", () => {
  test("daemon background fiber runs under pause_all and notifies via a queue", () => {
    const notifyQueue: Array<{ task_id: string; status: string; output: string }> = []
    const injected: string[] = []

    const h = createHarness<Schema>({ agingStep: 0, defaultSuspendPolicy: "pause_all" })

    // Main fiber is blocked on human approval (pause_all), so interactive/member must not run.
    h.spawn({
      fiberId: "main",
      actorId: "main",
      basePriority: 0,
      lane: "interactive",
      payload: { kind: "main", phase: "drain" },
    })
    h.suspendFiber("main", 1, "human_approval", "pause_all")

    // A foreground member that would normally be higher priority must be gated.
    h.spawn({
      fiberId: "member",
      actorId: "member",
      basePriority: 10,
      lane: "member",
      payload: { kind: "member" },
    })

    // Background daemon fiber can continue and post completion notifications.
    h.spawn({
      fiberId: "bg-task-1",
      actorId: "bg",
      basePriority: 10,
      lane: "background",
      payload: { kind: "background", task_id: "task-1" },
    })

    h.setStep("bg-task-1", ({ payload }) => {
      notifyQueue.push({ task_id: String(payload.task_id), status: "completed", output: "ok" })
      return { kind: "complete" }
    })

    h.setStep("main", () => {
      // Safe-boundary injection: only when main is resumed/draining.
      while (notifyQueue.length) {
        const ev = notifyQueue.shift()!
        injected.push(`BackgroundTaskDone:${ev.task_id}:${ev.status}:${ev.output}`)
      }
      return { kind: "yield", nextPayload: { kind: "main", phase: "idle" } }
    })

    // Under pause_all, scheduler should select detached work first.
    expect(selectNextFiberId(h.getState() as any)).toBe("bg-task-1")
    h.runOne(2)
    expect(notifyQueue).toHaveLength(1)
    expect(injected).toHaveLength(0)

    // Main is still blocked until resume, and member is gated.
    expect(selectNextFiberId(h.getState() as any)).toBeUndefined()

    // Resume main, then it can drain notifyQueue.
    h.resumeFiber("main", 3, { kind: "main", phase: "drain" })
    expect(selectNextFiberId(h.getState() as any)).toBe("main")
    h.runOne(4)

    expect(injected).toEqual(["BackgroundTaskDone:task-1:completed:ok"])
  })
})
