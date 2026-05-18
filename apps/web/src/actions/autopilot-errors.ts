/**
 * Error copy surfaced as `result.error` from the autopilot server
 * actions. Lives in its own module so it can be re-exported without
 * tripping the Next.js "use server"-files-may-only-export-async-functions
 * rule that applies to `autopilot.ts`.
 *
 * UI maps these strings to friendly copy so the wording can change
 * without touching the action.
 */
export const AUTOPILOT_ACTION_ERRORS = {
  not_signed_in: "You must be signed in.",
  blog_not_found: "Blog not found.",
  autopilot_disabled:
    "Enable autopilot first. Open the Automation tab, set Mode to Autopilot and turn on the Enabled toggle.",
} as const;
