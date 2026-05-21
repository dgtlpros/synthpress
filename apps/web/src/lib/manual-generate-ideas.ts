/**
 * Manual "Generate ideas" count bounds. The server action validates
 * and clamps server-side; the UI advertises 1..20 in the modal
 * selector (autopilot uses its own `MAX_AUTOPILOT_IDEAS_PER_RUN`
 * cap in the scheduler).
 *
 * 20 was previously 50 (when the field was hidden + dev-only). 20
 * is deliberately conservative — the AI tends to repeat itself
 * past ~15, and a single click that consumes the user's entire
 * token balance is a worse UX than rejecting the request.
 *
 * Lives in `lib/` rather than next to the server action because
 * client components (the modal connector + the Ideas page) need
 * the bounds at render time, and a `"use server"` module is only
 * allowed to export async functions.
 */
export const MANUAL_GENERATE_IDEAS_MIN_COUNT = 1;
export const MANUAL_GENERATE_IDEAS_MAX_COUNT = 20;

/**
 * Default the manual modal opens with. 5 strikes a balance between
 * "useful batch" and "doesn't blow the token budget on one click";
 * autopilot keeps its own internal default (`IDEA_DEFAULT_COUNT`)
 * for the unconfigured path.
 */
export const MANUAL_GENERATE_IDEAS_DEFAULT_COUNT = 5;

/**
 * Clamp a raw count into the manual-generate range. Callers should
 * already have rejected NaN / non-finite inputs at the validation
 * layer; the guard here exists only to protect against a refactor
 * that loses that upstream check.
 */
export function clampManualGenerateIdeasCount(count: number): number {
  /* v8 ignore next 1 -- defensive: callers reject NaN/non-finite before
     this function is reached, so this guard is unreachable via the
     public API and only protects against a refactor losing the
     upstream validation. */
  if (!Number.isFinite(count)) return MANUAL_GENERATE_IDEAS_DEFAULT_COUNT;
  const floored = Math.floor(count);
  if (floored < MANUAL_GENERATE_IDEAS_MIN_COUNT) {
    return MANUAL_GENERATE_IDEAS_MIN_COUNT;
  }
  if (floored > MANUAL_GENERATE_IDEAS_MAX_COUNT) {
    return MANUAL_GENERATE_IDEAS_MAX_COUNT;
  }
  return floored;
}
