export type CompletionWaiter<TResult> = (result: TResult) => void;

export class CompletionSignalRegistry<TKey extends string, TResult> {
  private readonly waiters = new Map<TKey, Set<CompletionWaiter<TResult>>>();

  subscribe(key: TKey, waiter: CompletionWaiter<TResult>): () => void {
    const current = this.waiters.get(key) ?? new Set<CompletionWaiter<TResult>>();
    current.add(waiter);
    this.waiters.set(key, current);
    return () => {
      const next = this.waiters.get(key);
      if (!next) {
        return;
      }
      next.delete(waiter);
      if (next.size === 0) {
        this.waiters.delete(key);
      }
    };
  }

  resolve(key: TKey, result: TResult): void {
    const waiters = this.waiters.get(key);
    if (!waiters || waiters.size === 0) {
      return;
    }
    this.waiters.delete(key);
    for (const waiter of Array.from(waiters)) {
      waiter(result);
    }
  }

  has(key: TKey): boolean {
    return (this.waiters.get(key)?.size ?? 0) > 0;
  }

  count(key: TKey): number {
    return this.waiters.get(key)?.size ?? 0;
  }

  clear(key?: TKey): void {
    if (key !== undefined) {
      this.waiters.delete(key);
      return;
    }
    this.waiters.clear();
  }
}

export function createCompletionSignalRegistry<TKey extends string, TResult>(): CompletionSignalRegistry<TKey, TResult> {
  return new CompletionSignalRegistry<TKey, TResult>();
}

export class CompletionBindingRegistry<TKey extends string, TBinding> {
  private readonly bindings: Record<TKey, TBinding>;

  constructor(initial?: Record<TKey, TBinding>) {
    this.bindings = Object.assign(Object.create(null) as Record<TKey, TBinding>, initial ?? {});
  }

  get(key: TKey): TBinding | undefined {
    return this.bindings[key];
  }

  set(key: TKey, binding: TBinding): void {
    this.bindings[key] = binding;
  }

  delete(key: TKey): void {
    delete this.bindings[key];
  }

  has(key: TKey): boolean {
    return key in this.bindings;
  }

  snapshot(): Record<TKey, TBinding> {
    return { ...this.bindings };
  }
}

export function createCompletionBindingRegistry<TKey extends string, TBinding>(
  initial?: Record<TKey, TBinding>,
): CompletionBindingRegistry<TKey, TBinding> {
  return new CompletionBindingRegistry<TKey, TBinding>(initial);
}
