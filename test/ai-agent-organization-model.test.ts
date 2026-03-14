import { describe, expect, test } from "bun:test"

type AssignMode = "final" | "none" | "stream"
type WatchState = "watched" | "unwatched"

type Member = {
  memberId: string
  name: string
  watchState: WatchState
  inbox: string[]
}

type AutonomousHolon = {
  holonId: string
  name: string
  memberIds: string[]
  watchState: WatchState
  queuedTaskIds: string[]
}

type LeaderLedHolon = {
  holonId: string
  name: string
  memberIds: string[]
  leaderMemberId: string | null
  watchState: WatchState
  queuedTaskIds: string[]
}

function watch<T extends { watchState: WatchState }>(target: T): T {
  target.watchState = "watched"
  return target
}

function unwatch<T extends { watchState: WatchState }>(target: T): T {
  target.watchState = "unwatched"
  return target
}

function assignToMember(member: Member, mode: AssignMode, content: string) {
  member.inbox.push(content)
  if (mode === "stream") {
    watch(member)
  }
  return {
    ok: true,
    member_id: member.memberId,
    mode,
    watch_state: member.watchState,
  }
}

function assignToAutonomousHolon(holon: AutonomousHolon, mode: AssignMode, taskId: string) {
  holon.queuedTaskIds.push(taskId)
  if (mode === "stream") {
    watch(holon)
  }
  return {
    ok: true,
    holon_id: holon.holonId,
    task_id: taskId,
    member_ids: [...holon.memberIds],
    queued: true,
    mode,
    watch_state: holon.watchState,
  }
}

function appointLeaderLedHolonLeader(holon: LeaderLedHolon, memberId: string) {
  if (!holon.memberIds.includes(memberId)) {
    holon.memberIds.push(memberId)
  }
  holon.leaderMemberId = memberId
  return holon
}

function assignToLeaderLedHolon(holon: LeaderLedHolon, mode: AssignMode, taskId: string) {
  holon.queuedTaskIds.push(taskId)
  if (mode === "stream") {
    watch(holon)
  }
  return {
    ok: true,
    holon_id: holon.holonId,
    task_id: taskId,
    leader_member_id: holon.leaderMemberId,
    member_ids: [...holon.memberIds],
    mode,
    watch_state: holon.watchState,
  }
}

describe("AI agent organization model simulation", () => {
  test("member assign:s makes the member watched and watch survives completion until unwatch", () => {
    const member: Member = {
      memberId: "mem-1",
      name: "alice",
      watchState: "unwatched",
      inbox: [],
    }

    const assigned = assignToMember(member, "stream", "review the persistence layer")
    expect(assigned.ok).toBe(true)
    expect(assigned.watch_state).toBe("watched")
    expect(member.inbox).toEqual(["review the persistence layer"])

    // Task completion should not clear watched state implicitly.
    expect(member.watchState).toBe("watched")

    unwatch(member)
    expect(member.watchState).toBe("unwatched")
  })

  test("autonomous holon assign queues work for its members and supports watched state", () => {
    const holon: AutonomousHolon = {
      holonId: "holon-1",
      name: "research",
      memberIds: ["mem-1", "mem-2"],
      watchState: "unwatched",
      queuedTaskIds: [],
    }

    const assigned = assignToAutonomousHolon(holon, "stream", "task-1")
    expect(assigned.ok).toBe(true)
    expect(assigned.member_ids).toEqual(["mem-1", "mem-2"])
    expect(assigned.task_id).toBe("task-1")
    expect(assigned.queued).toBe(true)
    expect(assigned.watch_state).toBe("watched")

    unwatch(holon)
    expect(holon.watchState).toBe("unwatched")
  })

  test("leader-led holon appoint establishes leader semantics for later assign calls", () => {
    const holon: LeaderLedHolon = {
      holonId: "holon-2",
      name: "alpha",
      memberIds: ["mem-1"],
      leaderMemberId: null,
      watchState: "unwatched",
      queuedTaskIds: [],
    }

    appointLeaderLedHolonLeader(holon, "mem-1")
    const assigned = assignToLeaderLedHolon(holon, "final", "task-2")

    expect(assigned.ok).toBe(true)
    expect(assigned.leader_member_id).toBe("mem-1")
    expect(assigned.member_ids).toEqual(["mem-1"])
    expect(assigned.task_id).toBe("task-2")
    expect(assigned.watch_state).toBe("unwatched")
  })
})
