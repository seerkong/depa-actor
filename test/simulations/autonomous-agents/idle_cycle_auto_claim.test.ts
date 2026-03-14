import { describe, test, expect } from "bun:test"

import { createHarness } from "../_shared/orchestratorHarness"

type TaskStatus = "pending" | "in_progress" | "completed"
type Task = { id: string; status: TaskStatus }

describe("s11 Collective idle cycle (depa-actor simulation)", () => {
  test("idle cycle: suspends when no work; auto-claim: claims pending tasks and completes them", () => {
    const board: Task[] = [
      { id: "task-1", status: "pending" },
      { id: "task-2", status: "pending" },
    ]

    const workerMailbox: string[] = []

    // Use agingStep to avoid starvation when one fiber yields in a tight loop.
    const h = createHarness({ agingStep: 1, defaultSuspendPolicy: "continue_others" })

    h.spawn({
      fiberId: "collective",
      actorId: "collective",
      basePriority: 5,
      lane: "collective",
      payload: { phase: "scan" },
    })
    h.spawn({
      fiberId: "worker",
      actorId: "worker",
      basePriority: 6,
      lane: "collective",
      payload: { phase: "wait" },
    })

    h.setStep("collective", () => {
      const inProgress = board.find((t) => t.status === "in_progress")
      if (inProgress) {
        return { kind: "yield", nextPayload: { phase: "scan" } }
      }

      const next = board.find((t) => t.status === "pending")
      if (!next) {
        return { kind: "suspend", reason: "external" }
      }

      next.status = "in_progress"
      workerMailbox.push(next.id)
      return { kind: "yield", nextPayload: { phase: "scan" } }
    })

    h.setStep("worker", () => {
      const taskId = workerMailbox.shift()
      if (!taskId) {
        return { kind: "yield", nextPayload: { phase: "wait" } }
      }
      const found = board.find((t) => t.id === taskId)
      if (found) {
        found.status = "completed"
      }
      return { kind: "yield", nextPayload: { phase: "wait" } }
    })

    // Drive until no more ready work.
    for (let i = 0; i < 20; i++) {
      const r = h.runOne(i)
      if (!r.selectedFiberId) break
    }

    expect(board.map((t) => t.status)).toEqual(["completed", "completed"])

    // Now there is no work; collective should eventually suspend external.
    // Resume collective once, it should suspend.
    h.resumeFiber("collective", 100, { phase: "scan" })
    h.runOne(101)
    const rec: any = (h.getState() as any).fibers["collective"]
    expect(rec.status).toBe("suspended")
    expect(rec.waitingReason).toBe("external")
  })
})
