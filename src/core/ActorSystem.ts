/**
 * depa-actor — ActorSystem
 *
 * Multi-mailbox actor system with priority-based drain.
 * Evolved from depa-data-graph ActorSystem with MailboxSchema support.
 */

import type {
  MailboxSchema,
  ActorEnvelope,
  ActorLogEntry,
  ActorDef,
  ActorRef,
  ActorSelf,
  TaggedEnvelope,
  TagHandler,
} from './types';

// ─── ActorCell (internal) ────────────────────────────────────────────

type ActorCell<TRuntime, TSchema extends MailboxSchema, TState = void> = {
  id: string;
  def: ActorDef<TRuntime, TSchema, TState>;
  state: TState;
  queue: ActorEnvelope<TSchema>[];
  processing: boolean;
};

// ─── ActorSystem ─────────────────────────────────────────────────────

export class ActorSystem<TRuntime, TSchema extends MailboxSchema> {
  private seq = 0;
  private cells = new Map<string, ActorCell<TRuntime, TSchema, unknown>>();

  constructor(
    private getRuntime: () => TRuntime,
    private onLog?: (entry: ActorLogEntry<TSchema>) => void,
  ) {}

  // ── Query ──

  ids(): string[] {
    return Array.from(this.cells.keys()).sort();
  }

  has(id: string): boolean {
    return this.cells.has(id);
  }

  // ── Registration ──

  register<TState = void>(
    id: string,
    def: ActorDef<TRuntime, TSchema, TState>,
  ): void {
    if (this.cells.has(id)) {
      throw new Error(`Actor already registered: ${id}`);
    }
    if (!def.handler && !def.handlers) {
      throw new Error(`Actor "${id}" must have at least handler or handlers`);
    }
    this.cells.set(id, {
      id,
      def: def as ActorDef<TRuntime, TSchema, unknown>,
      state: def.initialState as unknown,
      queue: [],
      processing: false,
    });
  }

  unregister(id: string): void {
    this.cells.delete(id);
  }

  // ── Messaging ──

  refFrom(from: string, to: string): ActorRef<TSchema> | undefined {
    if (!this.cells.has(to)) return undefined;
    return {
      id: to,
      send: (tag, payload) => this.sendFrom(from, to, tag, payload),
    };
  }

  sendFrom<TTag extends keyof TSchema & string>(
    from: string,
    to: string,
    tag: TTag,
    payload: TSchema[TTag],
  ): void {
    const target = this.cells.get(to);
    const envelope: ActorEnvelope<TSchema> = {
      id: ++this.seq,
      ts: Date.now(),
      from,
      to,
      tag,
      payload,
    };

    if (!target) {
      this.onLog?.({ kind: 'error', ...envelope, error: `Unknown actor: ${to}` });
      return;
    }

    this.onLog?.({ kind: 'send', ...envelope });
    target.queue.push(envelope);
    this.scheduleDrain(target);
  }

  broadcastFrom<TTag extends keyof TSchema & string>(
    from: string,
    tag: TTag,
    payload: TSchema[TTag],
    opts?: { excludeSelf?: boolean },
  ): void {
    for (const id of this.cells.keys()) {
      if (opts?.excludeSelf && id === from) continue;
      this.sendFrom(from, id, tag, payload);
    }
  }

  // ── Drain ──

  private scheduleDrain(cell: ActorCell<TRuntime, TSchema, unknown>): void {
    if (cell.processing) return;
    cell.processing = true;
    queueMicrotask(() => {
      void this.drain(cell);
    });
  }

  /**
   * Priority-based drain: sorts pending messages by tag priority,
   * then processes sequentially. Per-tag handlers take precedence.
   */
  private async drain(cell: ActorCell<TRuntime, TSchema, unknown>): Promise<void> {
    try {
      while (cell.queue.length > 0) {
        // Sort by priority (lower = higher priority, default 100)
        const priorities = cell.def.priority ?? {};
        cell.queue.sort((a, b) => {
          const pa = (priorities as Record<string, number | undefined>)[a.tag] ?? 100;
          const pb = (priorities as Record<string, number | undefined>)[b.tag] ?? 100;
          return pa - pb;
        });

        const envelope = cell.queue.shift()!;
        const self = this.makeSelf(cell);

        try {
          await this.dispatch(cell, self, envelope);
          this.onLog?.({ kind: 'deliver', ...envelope });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.onLog?.({ kind: 'error', ...envelope, error: message });
        }
      }
    } finally {
      cell.processing = false;
      if (cell.queue.length > 0) {
        this.scheduleDrain(cell);
      }
    }
  }

  /** Route envelope to per-tag handler or unified handler */
  private async dispatch(
    cell: ActorCell<TRuntime, TSchema, unknown>,
    self: ActorSelf<TRuntime, TSchema, unknown>,
    envelope: ActorEnvelope<TSchema>,
  ): Promise<void> {
    const tagHandler = cell.def.handlers?.[envelope.tag] as
      | TagHandler<TRuntime, TSchema, unknown, string>
      | undefined;

    if (tagHandler) {
      await tagHandler(self, envelope as TaggedEnvelope<TSchema, string>);
    } else if (cell.def.handler) {
      await cell.def.handler(self, envelope);
    } else {
      // No handler for this tag — log and skip
      this.onLog?.({
        kind: 'error',
        ...envelope,
        error: `No handler for tag "${envelope.tag}" on actor "${cell.id}"`,
      });
    }
  }

  /** Construct ActorSelf with selective receive capabilities */
  private makeSelf(
    cell: ActorCell<TRuntime, TSchema, unknown>,
  ): ActorSelf<TRuntime, TSchema, unknown> {
    return {
      id: cell.id,
      ref: {
        id: cell.id,
        send: (tag, payload) => this.sendFrom(cell.id, cell.id, tag, payload),
      },
      runtime: this.getRuntime(),
      state: cell.state,

      send: (to, tag, payload) => this.sendFrom(cell.id, to, tag, payload),
      broadcast: (tag, payload, opts) => this.broadcastFrom(cell.id, tag, payload, opts),

      // Selective receive
      hasPending: (tag) => cell.queue.some((e) => e.tag === tag),
      drainMailbox: <TTag extends keyof TSchema & string>(tag: TTag) => {
        const matching: TaggedEnvelope<TSchema, TTag>[] = [];
        const remaining: ActorEnvelope<TSchema>[] = [];
        for (const e of cell.queue) {
          if (e.tag === tag) {
            matching.push(e as TaggedEnvelope<TSchema, TTag>);
          } else {
            remaining.push(e);
          }
        }
        cell.queue.length = 0;
        cell.queue.push(...remaining);
        return matching;
      },
    };
  }
}
