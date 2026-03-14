export class RuntimeIndexHook<TKey extends string, TValue> {
  private readonly entries = new Map<TKey, TValue>();

  constructor(initial?: Record<TKey, TValue>) {
    for (const [key, value] of Object.entries(initial ?? {}) as Array<[TKey, TValue]>) {
      this.entries.set(key, value);
    }
  }

  get(key: TKey): TValue | undefined {
    return this.entries.get(key);
  }

  set(key: TKey, value: TValue): void {
    this.entries.set(key, value);
  }

  delete(key: TKey): void {
    this.entries.delete(key);
  }

  has(key: TKey): boolean {
    return this.entries.has(key);
  }

  values(): TValue[] {
    return Array.from(this.entries.values());
  }

  snapshot(): Record<TKey, TValue> {
    return Object.fromEntries(this.entries.entries()) as Record<TKey, TValue>;
  }
}

export function createRuntimeIndexHook<TKey extends string, TValue>(
  initial?: Record<TKey, TValue>,
): RuntimeIndexHook<TKey, TValue> {
  return new RuntimeIndexHook<TKey, TValue>(initial);
}
