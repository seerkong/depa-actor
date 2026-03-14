/**
 * depa-actor — Dispatch Bridge
 *
 * Optional bridge to depa-processor DispatchEngine.
 * Only this file imports from depa-processor concepts.
 * No hard dependency — uses structural typing.
 */

import type {
  MailboxSchema,
  ActorSelf,
  ActorEnvelope,
  ActorHandler,
} from '../core/types';

// ─── DispatchRoute (structural, no import) ───────────────────────────

/**
 * A dispatch route maps a tag to a dispatch key and handler.
 * This is a structural interface — no dependency on depa-processor.
 */
export interface DispatchRoute<
  TRuntime,
  TSchema extends MailboxSchema,
  TState,
> {
  /** Which tags this route handles */
  tags: (keyof TSchema & string)[];

  /** Resolve dispatch key from envelope */
  resolveKey: (envelope: ActorEnvelope<TSchema>) => string;

  /** Route table: dispatch key → handler */
  routes: Record<string, (
    self: ActorSelf<TRuntime, TSchema, TState>,
    envelope: ActorEnvelope<TSchema>,
  ) => void | Promise<void>>;

  /** Fallback if no route matches */
  fallback?: (
    self: ActorSelf<TRuntime, TSchema, TState>,
    envelope: ActorEnvelope<TSchema>,
    key: string,
  ) => void | Promise<void>;
}

// ─── createDispatchHandler ───────────────────────────────────────────

/**
 * Creates an ActorHandler that routes envelopes through dispatch routes.
 * Falls back to `defaultHandler` for tags not covered by any route.
 */
export function createDispatchHandler<
  TRuntime,
  TSchema extends MailboxSchema,
  TState,
>(
  routes: DispatchRoute<TRuntime, TSchema, TState>[],
  defaultHandler?: ActorHandler<TRuntime, TSchema, TState>,
): ActorHandler<TRuntime, TSchema, TState> {
  // Build tag → route index for O(1) lookup
  const tagIndex = new Map<string, DispatchRoute<TRuntime, TSchema, TState>>();
  for (const route of routes) {
    for (const tag of route.tags) {
      tagIndex.set(tag, route);
    }
  }

  return async (self, envelope) => {
    const route = tagIndex.get(envelope.tag);

    if (route) {
      const key = route.resolveKey(envelope);
      const handler = route.routes[key];
      if (handler) {
        await handler(self, envelope);
      } else if (route.fallback) {
        await route.fallback(self, envelope, key);
      }
    } else if (defaultHandler) {
      await defaultHandler(self, envelope);
    }
  };
}
