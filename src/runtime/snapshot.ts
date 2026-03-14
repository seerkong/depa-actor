export type SnapshotRecoveryState = {
  restoredFromSnapshot: boolean;
  snapshotVersion?: number;
  restoredAt?: number;
};

export type RuntimeSnapshotManifestBase = {
  version: number;
  createdAt: string;
  updatedAt: string;
  actorKeys: string[];
  fiberIds: string[];
  indexFiles: string[];
  derivedIndexFiles?: string[];
  savedAt?: number;
  vmFile: string;
  actorFiles: Record<string, string>;
  fiberFiles: Record<string, string>;
};

export type RuntimeRootSnapshotBase = {
  version: number;
  controlActorKey: string;
  actorKeys: string[];
  updatedAt: string;
  recovery?: SnapshotRecoveryState;
};

export type ActorSnapshotBase<TActorType extends string = string> = {
  version: number;
  key: string;
  id: string;
  type: TActorType;
  parentKey?: string;
  updatedAt?: string;
  recovery?: SnapshotRecoveryState;
};

export type FiberSnapshotBase = {
  version: number;
  fiberId: string;
  actorKey?: string;
  actorId?: string;
  parentFiberId?: string;
  status?: string;
  lane?: string;
  workloadKind?: string;
  kind?: string;
  waitingReason?: string | null;
  createdAt?: number;
  lastRunAt?: number | null;
  lastYieldAt?: number | null;
  resumeMetadata?: Record<string, unknown> | null;
  updatedAt?: string;
  workload?: string;
  metadata?: Record<string, unknown>;
};

export interface SnapshotCodec<TState, TSnapshot> {
  serialize: (state: TState) => TSnapshot;
  hydrate: (snapshot: TSnapshot) => TState;
}

export interface RecoveryHooks<TState, TSnapshot> {
  beforeSerialize?: (state: TState) => TState;
  beforeHydrate?: (snapshot: TSnapshot) => TSnapshot;
  afterHydrate?: (state: TState) => TState;
}

export interface PersistenceEffectPort<TManifest, TSnapshotState> {
  save: (params: { manifest: TManifest; state: TSnapshotState }) => Promise<void>;
  load: () => Promise<{ manifest: TManifest; state: TSnapshotState } | null>;
}

export function createSnapshotCodec<TState, TSnapshot>(
  codec: SnapshotCodec<TState, TSnapshot>,
): SnapshotCodec<TState, TSnapshot> {
  return codec;
}

export function createRecoveryHooks<TState, TSnapshot>(
  hooks: RecoveryHooks<TState, TSnapshot>,
): RecoveryHooks<TState, TSnapshot> {
  return hooks;
}

export function createPersistenceEffectPort<TManifest, TSnapshotState>(
  port: PersistenceEffectPort<TManifest, TSnapshotState>,
): PersistenceEffectPort<TManifest, TSnapshotState> {
  return port;
}
