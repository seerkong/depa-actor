import { describe, test, expect } from "bun:test"

import { createHarness } from "../_shared/orchestratorHarness"

type ProtocolName = "shutdown" | "plan_approval"
type ProtocolKind = "shutdown_request" | "shutdown_response" | "plan_request" | "plan_review"
type Decision = "approve" | "reject"

type Envelope = {
  type: "rad_member_protocol"
  v: 1
  protocol: ProtocolName
  kind: ProtocolKind
  request_id: string
  payload: any
}

type RecordState = {
  status: "pending" | "approved" | "rejected"
  decision?: Decision
}

function ingest(store: Map<string, RecordState>, env: Envelope) {
  const current = store.get(env.request_id) ?? { status: "pending" as const }
  if (env.protocol === "plan_approval" && env.kind === "plan_review") {
    const decision: Decision = env.payload?.decision === "reject" ? "reject" : "approve"
    store.set(env.request_id, { status: decision === "approve" ? "approved" : "rejected", decision })
    return
  }
  if (env.protocol === "shutdown" && env.kind === "shutdown_response") {
    const decision: Decision = env.payload?.decision === "reject" ? "reject" : "approve"
    store.set(env.request_id, { status: decision === "approve" ? "approved" : "rejected", decision })
    return
  }
  store.set(env.request_id, current)
}

describe("s10 Member Protocols (depa-actor simulation)", () => {
  test("plan approval and shutdown FSM correlate by request_id", () => {
    const mailboxJsonl: string[] = []
    const fsm = new Map<string, RecordState>()

    const h = createHarness({ agingStep: 0 })
    h.spawn({
      fiberId: "protocol-engine",
      actorId: "protocol-engine",
      basePriority: 1,
      lane: "member",
      payload: { phase: "drain" },
    })

    const push = (env: Envelope) => mailboxJsonl.push(JSON.stringify(env))

    push({
      type: "rad_member_protocol",
      v: 1,
      protocol: "plan_approval",
      kind: "plan_request",
      request_id: "req-A",
      payload: { plan: "do A" },
    })
    push({
      type: "rad_member_protocol",
      v: 1,
      protocol: "plan_approval",
      kind: "plan_request",
      request_id: "req-B",
      payload: { plan: "do B" },
    })
    push({
      type: "rad_member_protocol",
      v: 1,
      protocol: "plan_approval",
      kind: "plan_review",
      request_id: "req-A",
      payload: { decision: "approve" },
    })
    push({
      type: "rad_member_protocol",
      v: 1,
      protocol: "shutdown",
      kind: "shutdown_request",
      request_id: "req-S",
      payload: { reason: "done" },
    })
    push({
      type: "rad_member_protocol",
      v: 1,
      protocol: "shutdown",
      kind: "shutdown_response",
      request_id: "req-S",
      payload: { decision: "reject" },
    })

    h.setStep("protocol-engine", () => {
      while (mailboxJsonl.length) {
        const env = JSON.parse(mailboxJsonl.shift()!) as Envelope
        if (env.type === "rad_member_protocol" && env.v === 1) {
          ingest(fsm, env)
        }
      }
      return { kind: "complete" }
    })

    h.runOne(1)

    expect(fsm.get("req-A")?.status).toBe("approved")
    expect(fsm.get("req-B")?.status).toBe("pending")
    expect(fsm.get("req-S")?.status).toBe("rejected")
    expect(fsm.get("req-S")?.decision).toBe("reject")
  })
})
