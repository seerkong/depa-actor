/**
 * depa-actor — Core Type Definitions
 *
 * Synthesizes:
 * - depa-data-graph ActorSystem (true actor model, mailbox queue, microtask drain)
 * - depa-processor (dispatch routing, DOP pipeline)
 * - OneAgentActor domain needs (multi-mailbox, typed tags)
 */

// ─── MailboxSchema ───────────────────────────────────────────────────
// Record<tag, payload> — each key is a mailbox name, value is payload type.
// Example: { cancel: boolean; human_input: string; tool_call: ToolCallData }

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type MailboxSchema = Record<string, unknown>;

// ─── ActorEnvelope ───────────────────────────────────────────────────
// tag + payload replaces the old single `msg` field.

export interface ActorEnvelope<TSchema extends MailboxSchema = MailboxSchema> {
  id: number;
  ts: number;
  from: string;
  to: string;
  tag: keyof TSchema & string;
  payload: TSchema[keyof TSchema & string];
}

/** Type-safe envelope for a specific tag */
export type TaggedEnvelope<
  TSchema extends MailboxSchema,
  TTag extends keyof TSchema & string,
> = Omit<ActorEnvelope<TSchema>, 'tag' | 'payload'> & {
  tag: TTag;
  payload: TSchema[TTag];
};

// ─── Mailbox Priority ────────────────────────────────────────────────

export type MailboxPriority<TSchema extends MailboxSchema> = {
  [K in keyof TSchema & string]?: number;
};

// ─── ActorRef ────────────────────────────────────────────────────────
// Capability-based reference: can send, no management.

export interface ActorRef<TSchema extends MailboxSchema = MailboxSchema> {
  readonly id: string;
  send<TTag extends keyof TSchema & string>(tag: TTag, payload: TSchema[TTag]): void;
}

// ─── ActorSelf ───────────────────────────────────────────────────────
// Handler-side reference with state access and selective receive.

export interface ActorSelf<
  TRuntime,
  TSchema extends MailboxSchema,
  TState = void,
> {
  readonly id: string;
  readonly ref: ActorRef<TSchema>;
  readonly runtime: TRuntime;
  state: TState;

  /** Send to a specific actor */
  send(to: string, tag: keyof TSchema & string, payload: TSchema[keyof TSchema & string]): void;

  /** Broadcast to all actors */
  broadcast(
    tag: keyof TSchema & string,
    payload: TSchema[keyof TSchema & string],
    opts?: { excludeSelf?: boolean },
  ): void;

  // ── Selective Receive ──
  /** Check if there are pending messages for a specific tag */
  hasPending<TTag extends keyof TSchema & string>(tag: TTag): boolean;

  /** Drain all pending messages for a specific tag (removes them from queue) */
  drainMailbox<TTag extends keyof TSchema & string>(tag: TTag): TaggedEnvelope<TSchema, TTag>[];
}

// ─── ActorHandler ────────────────────────────────────────────────────

/** Unified handler — receives all envelopes, switch on tag */
export type ActorHandler<
  TRuntime,
  TSchema extends MailboxSchema,
  TState = void,
> = (
  self: ActorSelf<TRuntime, TSchema, TState>,
  envelope: ActorEnvelope<TSchema>,
) => void | Promise<void>;

/** Per-tag handler — handles a single tag */
export type TagHandler<
  TRuntime,
  TSchema extends MailboxSchema,
  TState,
  TTag extends keyof TSchema & string,
> = (
  self: ActorSelf<TRuntime, TSchema, TState>,
  envelope: TaggedEnvelope<TSchema, TTag>,
) => void | Promise<void>;

// ─── ActorDef ────────────────────────────────────────────────────────
// Definition for registering an actor. Supports both unified and per-tag handlers.

export interface ActorDef<
  TRuntime,
  TSchema extends MailboxSchema,
  TState = void,
> {
  initialState: TState;

  /** Mailbox priority — lower number = higher priority. Default: 100 */
  priority?: MailboxPriority<TSchema>;

  /** Unified handler (fallback for tags not in `handlers`) */
  handler?: ActorHandler<TRuntime, TSchema, TState>;

  /** Per-tag handlers — takes precedence over `handler` for matching tags */
  handlers?: {
    [TTag in keyof TSchema & string]?: TagHandler<TRuntime, TSchema, TState, TTag>;
  };
}

// ─── Log ─────────────────────────────────────────────────────────────

export type ActorLogKind = 'send' | 'deliver' | 'error';

export interface ActorLogEntry<TSchema extends MailboxSchema = MailboxSchema>
  extends ActorEnvelope<TSchema> {
  kind: ActorLogKind;
  error?: string;
}
