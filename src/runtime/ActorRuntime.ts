/**
 * depa-actor — ActorRuntime
 *
 * Lifecycle and plugin layer over ActorSystem.
 * ActorSystem = engine, ActorRuntime = managed environment.
 *
 * Future AiAgentVm will hold an ActorRuntime instance.
 */

import type {
  MailboxSchema,
  ActorDef,
  ActorRef,
  ActorLogEntry,
} from '../core/types';
import { ActorSystem } from '../core/ActorSystem';

// ─── Plugin ──────────────────────────────────────────────────────────

export interface ActorPlugin<TRuntime, TSchema extends MailboxSchema> {
  name: string;
  onRegister?: (id: string, def: ActorDef<TRuntime, TSchema, unknown>) => void;
  onUnregister?: (id: string) => void;
  onLog?: (entry: ActorLogEntry<TSchema>) => void;
}

// ─── ActorRuntime ────────────────────────────────────────────────────

export class ActorRuntime<TRuntime, TSchema extends MailboxSchema> {
  readonly system: ActorSystem<TRuntime, TSchema>;
  private plugins: ActorPlugin<TRuntime, TSchema>[] = [];
  private facets = new Map<string, unknown>();

  constructor(
    getRuntime: () => TRuntime,
    plugins?: ActorPlugin<TRuntime, TSchema>[],
  ) {
    this.plugins = plugins ?? [];

    this.system = new ActorSystem<TRuntime, TSchema>(
      getRuntime,
      (entry) => this.handleLog(entry),
    );
  }

  // ── Plugin management ──

  addPlugin(plugin: ActorPlugin<TRuntime, TSchema>): void {
    this.plugins.push(plugin);
  }

  hasFacet(name: string): boolean {
    return this.facets.has(name);
  }

  getFacet<TFacet>(name: string): TFacet | undefined {
    return this.facets.get(name) as TFacet | undefined;
  }

  setFacet<TFacet>(name: string, facet: TFacet): TFacet {
    this.facets.set(name, facet);
    return facet;
  }

  ensureFacet<TFacet>(name: string, create: () => TFacet): TFacet {
    const existing = this.facets.get(name) as TFacet | undefined;
    if (existing !== undefined) {
      return existing;
    }
    const created = create();
    this.facets.set(name, created);
    return created;
  }

  // ── Delegated API (convenience) ──

  register<TState = void>(id: string, def: ActorDef<TRuntime, TSchema, TState>): void {
    this.system.register(id, def);
    for (const p of this.plugins) {
      p.onRegister?.(id, def as ActorDef<TRuntime, TSchema, unknown>);
    }
  }

  unregister(id: string): void {
    this.system.unregister(id);
    for (const p of this.plugins) {
      p.onUnregister?.(id);
    }
  }

  sendFrom<TTag extends keyof TSchema & string>(
    from: string,
    to: string,
    tag: TTag,
    payload: TSchema[TTag],
  ): void {
    this.system.sendFrom(from, to, tag, payload);
  }

  refFrom(from: string, to: string): ActorRef<TSchema> | undefined {
    return this.system.refFrom(from, to);
  }

  ids(): string[] {
    return this.system.ids();
  }

  has(id: string): boolean {
    return this.system.has(id);
  }

  // ── Internal ──

  private handleLog(entry: ActorLogEntry<TSchema>): void {
    for (const p of this.plugins) {
      p.onLog?.(entry);
    }
  }
}
