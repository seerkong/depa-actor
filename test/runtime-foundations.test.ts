import { describe, expect, test } from 'bun:test';

import {
  ActorRuntime,
  type ActorSnapshotBase,
  type FiberSnapshotBase,
  type RuntimeRootSnapshotBase,
  type RuntimeSnapshotManifestBase,
  createCompletionBindingRegistry,
  createCompletionSignalRegistry,
  createRuntimeIndexHook,
  createPersistenceEffectPort,
  createRecoveryHooks,
  createSnapshotCodec,
} from '../src/index';

type TestSchema = {
  ping: { id: string };
};

describe('runtime foundations', () => {
  test('CompletionSignalRegistry waits by key and resolves all current waiters', () => {
    const registry = createCompletionSignalRegistry<string, { ok: boolean }>();
    const results: Array<{ ok: boolean }> = [];

    const unsubscribe = registry.subscribe('task-1', (result) => {
      results.push(result);
    });
    registry.subscribe('task-1', (result) => {
      results.push(result);
    });

    expect(registry.has('task-1')).toBe(true);
    expect(registry.count('task-1')).toBe(2);

    unsubscribe();
    expect(registry.count('task-1')).toBe(1);

    registry.resolve('task-1', { ok: true });

    expect(results).toEqual([{ ok: true }]);
    expect(registry.has('task-1')).toBe(false);
  });

  test('CompletionBindingRegistry stores and snapshots child completion bindings', () => {
    const registry = createCompletionBindingRegistry<string, { parentId: string }>({
      childA: { parentId: 'parent-1' },
    });

    expect(registry.get('childA')).toEqual({ parentId: 'parent-1' });
    registry.set('childB', { parentId: 'parent-2' });
    expect(registry.snapshot()).toEqual({
      childA: { parentId: 'parent-1' },
      childB: { parentId: 'parent-2' },
    });
    registry.delete('childA');
    expect(registry.has('childA')).toBe(false);
  });

  test('ActorRuntime facets mount product state without modifying actor shell', () => {
    const runtime = new ActorRuntime<void, TestSchema>(() => undefined);

    const facet = runtime.ensureFacet('product-runtime', () => ({
      currentTurn: 1,
      indexes: [] as string[],
    }));
    facet.indexes.push('alpha');

    expect(runtime.getFacet<{ currentTurn: number; indexes: string[] }>('product-runtime')).toEqual({
      currentTurn: 1,
      indexes: ['alpha'],
    });
  });

  test('RuntimeIndexHook stores actor or fiber derived indexes without mutating runtime shell shape', () => {
    const index = createRuntimeIndexHook<string, { actorId: string; lane: string }>({
      'fiber-1': { actorId: 'actor-1', lane: 'interactive' },
    });

    index.set('fiber-2', { actorId: 'actor-2', lane: 'background' });

    expect(index.get('fiber-1')).toEqual({ actorId: 'actor-1', lane: 'interactive' });
    expect(index.values()).toEqual([
      { actorId: 'actor-1', lane: 'interactive' },
      { actorId: 'actor-2', lane: 'background' },
    ]);
    expect(index.snapshot()).toEqual({
      'fiber-1': { actorId: 'actor-1', lane: 'interactive' },
      'fiber-2': { actorId: 'actor-2', lane: 'background' },
    });
  });

  test('snapshot codec, recovery hooks, and persistence effect port expose protocol-only contracts', async () => {
    const manifestBase: RuntimeSnapshotManifestBase = {
      version: 1,
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      actorKeys: ['actor-1'],
      fiberIds: ['fiber-1'],
      indexFiles: ['indexes/actors.json'],
      vmFile: 'vm.json',
      actorFiles: { 'actor-1': 'actors/actor-1.json' },
      fiberFiles: { 'fiber-1': 'fibers/fiber-1.json' },
    };
    const runtimeRootBase: RuntimeRootSnapshotBase = {
      version: 1,
      controlActorKey: 'actor-1',
      actorKeys: ['actor-1'],
      updatedAt: '2026-04-02T00:00:00.000Z',
      recovery: { restoredFromSnapshot: true, snapshotVersion: 1 },
    };
    const actorBase: ActorSnapshotBase<'delegate'> = {
      version: 1,
      key: 'actor-1',
      id: 'delegate:1',
      type: 'delegate',
      updatedAt: '2026-04-02T00:00:00.000Z',
    };
    const fiberBase: FiberSnapshotBase = {
      version: 1,
      fiberId: 'fiber-1',
      actorKey: 'actor-1',
      actorId: 'delegate:1',
      status: 'ready',
    };
    const codec = createSnapshotCodec({
      serialize: (state: { count: number }) => ({ count: state.count }),
      hydrate: (snapshot: { count: number }) => ({ count: snapshot.count }),
    });
    const hooks = createRecoveryHooks({
      beforeSerialize: (state: { count: number }) => ({ count: state.count + 1 }),
      beforeHydrate: (snapshot: { count: number }) => ({ count: snapshot.count + 1 }),
      afterHydrate: (state: { count: number }) => ({ count: state.count + 1 }),
    });
    let persisted: { manifest: { version: number }; state: { count: number } } | null = null;
    const port = createPersistenceEffectPort({
      save: async (params: { manifest: { version: number }; state: { count: number } }) => {
        persisted = params;
      },
      load: async () => persisted,
    });

    const serialized = codec.serialize(hooks.beforeSerialize?.({ count: 1 }) ?? { count: 1 });
    await port.save({ manifest: { version: 1 }, state: serialized });
    const loaded = await port.load();
    const hydrated = codec.hydrate(hooks.beforeHydrate?.(loaded!.state) ?? loaded!.state);
    const finalState = hooks.afterHydrate?.(hydrated) ?? hydrated;

    expect(loaded).toEqual({ manifest: { version: 1 }, state: { count: 2 } });
    expect(finalState).toEqual({ count: 4 });
    expect(manifestBase.actorFiles['actor-1']).toBe('actors/actor-1.json');
    expect(runtimeRootBase.controlActorKey).toBe('actor-1');
    expect(actorBase.type).toBe('delegate');
    expect(fiberBase.fiberId).toBe('fiber-1');
  });
});
