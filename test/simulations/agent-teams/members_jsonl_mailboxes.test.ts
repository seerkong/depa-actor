import { describe, test, expect } from "bun:test"

import { createHarness } from "../_shared/orchestratorHarness"

type JsonlMessage = { from: string; text: string; ts: number }

describe("s09 Member inbox (depa-actor simulation)", () => {
  test("member drains JSONL mailbox before its next LLM step", () => {
    const roster = new Map<string, { mailboxJsonl: string[]; injected: string[] }>()

    const memberId = "m-1"
    roster.set(memberId, { mailboxJsonl: [], injected: [] })

    const h = createHarness({ agingStep: 0, defaultSuspendPolicy: "continue_others" })

    h.spawn({
      fiberId: "member-fiber",
      actorId: "member-actor",
      basePriority: 1,
      lane: "member",
      payload: { kind: "member", member_id: memberId, phase: "drain_then_llm" },
    })

    const sendToMember = (msg: JsonlMessage) => {
      const rec = roster.get(memberId)!
      rec.mailboxJsonl.push(JSON.stringify(msg))
    }

    // Simulate two sessions sharing a process-scoped roster by using the same map.
    sendToMember({ from: "lead", text: "hello", ts: 1 })
    sendToMember({ from: "lead", text: "run task", ts: 2 })

    h.setStep("member-fiber", ({ payload }) => {
      const rec = roster.get(String(payload.member_id))!

      // Drain mailbox (JSONL) into injected messages.
      while (rec.mailboxJsonl.length) {
        const line = rec.mailboxJsonl.shift()!
        const parsed = JSON.parse(line) as JsonlMessage
        rec.injected.push(`Message from ${parsed.from}: ${parsed.text}`)
      }

      // "LLM" step uses injected messages as its input.
      const llmInput = [...rec.injected]
      expect(llmInput).toEqual(["Message from lead: hello", "Message from lead: run task"])
      return { kind: "complete" }
    })

    h.runOne(10)
  })
})
