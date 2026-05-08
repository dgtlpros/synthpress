/**
 * Centralized model selection for the AI subsystem.
 *
 * Why a single map (not literal strings sprinkled across services):
 *   * Swapping the model for a step is a one-line change here. The
 *     orchestration code never sees a string literal like
 *     "claude-sonnet-4-6".
 *   * Per `docs/ai-pricing.md`, we want cheap Haiku for low-stakes
 *     supporting steps (idea brainstorming) and Sonnet for the
 *     expensive long-form writing. Splitting the constants by task
 *     bakes that policy into a single, reviewable file.
 *   * Future per-plan overrides ("Scale customers run on Opus")
 *     compose cleanly here without touching call sites.
 *
 * Why `lib/` (not server-only):
 *   The model identifiers themselves are not secret — only the API key
 *   is. Keeping them in `lib/` lets a future "this run will use Sonnet
 *   4.6" UI hint share the same constant without dragging server-only
 *   imports into the client bundle.
 */

export type AiTask = "ideaGeneration" | "outlineGeneration" | "articleGeneration";

/**
 * The default model for each task. Strings, not template literals,
 * because Anthropic's `@ai-sdk/anthropic` provider accepts plain ids.
 *
 * Calibration (see `docs/ai-pricing.md`):
 *   * Haiku 4.5  → ~$1 / 1M input, ~$5 / 1M output. Cheap supporting
 *                  steps (idea brainstorming, classification, image
 *                  query generation).
 *   * Sonnet 4.6 → ~$3 / 1M input, ~$15 / 1M output. Long-form writing
 *                  and outlines that benefit from the stronger model.
 */
export const AI_MODELS: Readonly<Record<AiTask, string>> = {
  ideaGeneration: "claude-haiku-4-5",
  outlineGeneration: "claude-sonnet-4-6",
  articleGeneration: "claude-sonnet-4-6",
} as const;

/**
 * Returns the configured model id for a task. Wrapped in a function so
 * future per-plan / per-experiment overrides slot in without changing
 * call sites.
 */
export function getModelForTask(task: AiTask): string {
  const model = AI_MODELS[task];
  /* v8 ignore next 3 -- defensive: AiTask union makes this unreachable */
  if (!model) {
    throw new Error(`AI_MODELS misconfigured for task "${task}"`);
  }
  return model;
}
