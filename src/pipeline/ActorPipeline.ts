/**
 * depa-actor — ActorPipeline
 *
 * Adapts the DOP 6-step pipeline (from depa-processor) to actor context.
 *
 * Mapping:
 *   OuterRuntime = ActorSelf
 *   OuterInput   = envelope payload
 *   OuterConfig  = actor state
 *
 * createPipelineHandler() wraps a pipeline definition into an ActorHandler.
 */

import type {
  MailboxSchema,
  ActorSelf,
  ActorHandler,
} from '../core/types';

// ─── Pipeline Adapter Types ──────────────────────────────────────────

export type PipelineDerivedAdapter<
  TRuntime, TSchema extends MailboxSchema, TState, TDerived,
> = (
  self: ActorSelf<TRuntime, TSchema, TState>,
  payload: TSchema[keyof TSchema & string],
  state: TState,
) => TDerived;

export type PipelineInnerRuntimeAdapter<
  TRuntime, TSchema extends MailboxSchema, TState, TDerived, TInnerRuntime,
> = (
  self: ActorSelf<TRuntime, TSchema, TState>,
  payload: TSchema[keyof TSchema & string],
  state: TState,
  derived: TDerived,
) => TInnerRuntime;

export type PipelineInnerInputAdapter<
  TRuntime, TSchema extends MailboxSchema, TState, TDerived, TInnerInput,
> = (
  self: ActorSelf<TRuntime, TSchema, TState>,
  payload: TSchema[keyof TSchema & string],
  state: TState,
  derived: TDerived,
) => TInnerInput;

export type PipelineInnerConfigAdapter<
  TRuntime, TSchema extends MailboxSchema, TState, TDerived, TInnerConfig,
> = (
  self: ActorSelf<TRuntime, TSchema, TState>,
  payload: TSchema[keyof TSchema & string],
  state: TState,
  derived: TDerived,
) => TInnerConfig;

export type PipelineCoreLogic<TInnerRuntime, TInnerInput, TInnerConfig, TInnerOutput> = (
  runtime: TInnerRuntime,
  input: TInnerInput,
  config: TInnerConfig,
) => TInnerOutput | Promise<TInnerOutput>;

export type PipelineOutputAdapter<
  TRuntime, TSchema extends MailboxSchema, TState, TDerived, TInnerOutput,
> = (
  self: ActorSelf<TRuntime, TSchema, TState>,
  payload: TSchema[keyof TSchema & string],
  state: TState,
  derived: TDerived,
  innerOutput: TInnerOutput,
) => void | Promise<void>;

// ─── Pipeline Definition ─────────────────────────────────────────────

export interface ActorPipelineDef<
  TRuntime,
  TSchema extends MailboxSchema,
  TState,
  TDerived,
  TInnerRuntime,
  TInnerInput,
  TInnerConfig,
  TInnerOutput,
> {
  computeDerived: PipelineDerivedAdapter<TRuntime, TSchema, TState, TDerived>;
  innerRuntime: PipelineInnerRuntimeAdapter<TRuntime, TSchema, TState, TDerived, TInnerRuntime>;
  innerInput: PipelineInnerInputAdapter<TRuntime, TSchema, TState, TDerived, TInnerInput>;
  innerConfig: PipelineInnerConfigAdapter<TRuntime, TSchema, TState, TDerived, TInnerConfig>;
  coreLogic: PipelineCoreLogic<TInnerRuntime, TInnerInput, TInnerConfig, TInnerOutput>;
  output: PipelineOutputAdapter<TRuntime, TSchema, TState, TDerived, TInnerOutput>;
}

// ─── createPipelineHandler ───────────────────────────────────────────

export function createPipelineHandler<
  TRuntime,
  TSchema extends MailboxSchema,
  TState,
  TDerived,
  TInnerRuntime,
  TInnerInput,
  TInnerConfig,
  TInnerOutput,
>(
  pipeline: ActorPipelineDef<
    TRuntime, TSchema, TState, TDerived,
    TInnerRuntime, TInnerInput, TInnerConfig, TInnerOutput
  >,
): ActorHandler<TRuntime, TSchema, TState> {
  return async (self, envelope) => {
    const payload = envelope.payload;
    const state = self.state;

    // Step 1: Compute derived
    const derived = pipeline.computeDerived(self, payload, state);

    // Step 2: Transform runtime
    const innerRuntime = pipeline.innerRuntime(self, payload, state, derived);

    // Step 3: Transform input
    const innerInput = pipeline.innerInput(self, payload, state, derived);

    // Step 4: Transform config
    const innerConfig = pipeline.innerConfig(self, payload, state, derived);

    // Step 5: Core logic
    const innerOutput = await pipeline.coreLogic(innerRuntime, innerInput, innerConfig);

    // Step 6: Output (side effects on actor state / send messages)
    await pipeline.output(self, payload, state, derived, innerOutput);
  };
}
