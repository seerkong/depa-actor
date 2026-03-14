import type { MailboxSchema } from '../core/types';
import type { ActorRuntime } from '../runtime/ActorRuntime';
import type { FiberEffect } from './types';

export function dispatchEffects<TRuntime, TSchema extends MailboxSchema>(
  runtime: ActorRuntime<TRuntime, TSchema>,
  effects: FiberEffect<TSchema>[],
  senderId?: string,
): void {
  const from = senderId ?? '__fiber_scheduler__';
  for (const effect of effects) {
    if (effect.kind === 'send') {
      runtime.sendFrom(from, effect.to, effect.step.tag, effect.step.payload);
    }
    if (effect.kind === 'dead_letter' && effect.to && effect.step) {
      runtime.sendFrom(from, effect.to, effect.step.tag, effect.step.payload);
    }
  }
}
