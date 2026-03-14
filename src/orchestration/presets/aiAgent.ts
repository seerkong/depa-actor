import type { MailboxSchema } from '../../core/types';

import type { FiberRecord, OrchestratorState, SchedulerHooks, SuspendPolicy } from '../types';

function isAiHumanWaitReason(reason: unknown): boolean {
  return reason === 'human_clarification' || reason === 'human_approval' || reason === 'human_answer';
}

function getEffectiveSuspendPolicy(fiber: FiberRecord<MailboxSchema>): SuspendPolicy | undefined {
  const raw = (fiber as any)?.suspendPolicy;
  return raw === 'continue_others' || raw === 'pause_all' ? raw : undefined;
}

function isBlockingLaneForPauseAll(lane: unknown): boolean {
  // Treat any non-background lane as blocking by default.
  if (lane === 'background' || lane === 'collective') {
    return false;
  }
  return true;
}

function isAllowedLaneDuringPauseAll(lane: unknown): boolean {
  return lane === 'background' || lane === 'collective';
}

function hasPauseAllHumanWaitInBlockingLane<TSchema extends MailboxSchema>(state: OrchestratorState<TSchema>): boolean {
  return Object.values(state.fibers as any).some((fiber: any) => {
    return (
      fiber?.status === 'suspended' &&
      isAiHumanWaitReason(fiber?.waitingReason) &&
      getEffectiveSuspendPolicy(fiber as FiberRecord<MailboxSchema>) === 'pause_all' &&
      isBlockingLaneForPauseAll(fiber?.lane)
    );
  });
}

// AIAgent-compatible scheduling hooks:
// - When a pause_all human wait exists in a blocking lane (interactive/member), only allow background/collective lanes.
export function createAiAgentSchedulerHooks<TSchema extends MailboxSchema>(): SchedulerHooks<TSchema> {
  return {
    filterCandidate: ({ state, fiber }) => {
      if (!hasPauseAllHumanWaitInBlockingLane(state)) {
        return true;
      }
      return isAllowedLaneDuringPauseAll((fiber as any)?.lane);
    },
  };
}
