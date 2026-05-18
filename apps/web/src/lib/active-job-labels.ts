import type { Json } from "@/lib/supabase/database.types";

/**
 * Pure mapping from `article_jobs.{type, status, current_step, output}`
 * into the user-facing label + badge variant + estimated progress
 * percentage the global tray renders.
 *
 * Lives in `lib/` (not `components/`) because both the dumb organism
 * AND the controller hook need to call it (the hook uses the
 * `isActive` flag below to decide whether a row is dismissible). Pure
 * function, fully unit-testable.
 *
 * Tone: short, present-tense, optimistic on success, factual on
 * failure. No exclamation marks, no emojis (the badge variant carries
 * the color signal).
 *
 * About `progressPercent`:
 *   * It's an ESTIMATE derived from `current_step`, NOT a true
 *     measure of model output. Claude doesn't stream "we're 47 %
 *     done"; we infer progress from which orchestration step the
 *     workflow has reached.
 *   * Always present (non-null) for jobs we know how to map. `null`
 *     for unknown statuses we want to render but can't bucket.
 *   * Failed/cancelled jobs return 100 — the work is "done" in the
 *     finished sense, the variant tells the user it ended badly.
 */

export type ActiveJobBadgeVariant =
  | "default"
  | "brand"
  | "success"
  | "error"
  | "warning";

export interface ActiveJobLabel {
  /** Headline shown in the row (e.g. "Writing article…"). */
  label: string;
  /** Optional secondary line (e.g. error message excerpt). */
  detail: string | null;
  /** Maps onto the `Badge` atom's variant prop. */
  variant: ActiveJobBadgeVariant;
  /**
   * `true` when the job is still running (pending / processing). The
   * tray uses this to:
   *   * disable the per-row dismiss button (active jobs aren't
   *     dismissible)
   *   * show a progress bar instead of an outcome badge
   *   * pluralize the collapsed-state count ("2 tasks running")
   */
  isActive: boolean;
  /**
   * Estimated progress 0–100 for the row's progress bar. `null` for
   * statuses we can't map (forward-compat). See module-level comment
   * for caveats.
   */
  progressPercent: number | null;
}

interface StepMapping {
  /** User-facing label for the step. */
  label: string;
  /** Estimated progress 0–100 when this step is current. */
  progressPercent: number;
}

const ARTICLE_STEP_MAP: Record<string, StepMapping> = {
  loading_context: { label: "Preparing article…", progressPercent: 15 },
  writing_article: { label: "Writing article…", progressPercent: 45 },
  saving_article: { label: "Saving draft…", progressPercent: 75 },
  // Image-picker step runs after the draft is saved but before
  // usage logging. Slotted between `saving_article` (75 %) and
  // `logging_usage` (90 %) so the progress bar always moves
  // forward — never backward — as the workflow advances.
  picking_images: { label: "Choosing images…", progressPercent: 85 },
  logging_usage: { label: "Finalizing…", progressPercent: 90 },
  // Autopilot-only step (gated on blog settings + WordPress
  // connection). Slotted between `logging_usage` (90 %) and
  // `completed` (100 %) so the bar stays monotonic regardless of
  // whether auto-send runs.
  sending_to_wordpress: {
    label: "Sending to WordPress draft…",
    progressPercent: 95,
  },
  completed: { label: "Article ready for review", progressPercent: 100 },
};

const IDEA_STEP_MAP: Record<string, StepMapping> = {
  loading_context: { label: "Preparing ideas…", progressPercent: 15 },
  generating_ideas: { label: "Generating ideas…", progressPercent: 50 },
  saving_ideas: { label: "Saving ideas…", progressPercent: 80 },
  logging_usage: { label: "Finalizing…", progressPercent: 90 },
  completed: { label: "Ideas ready for review", progressPercent: 100 },
};

/**
 * Generic fallback when we don't recognize the `current_step` for a
 * processing job. Picks something between "barely started" and
 * "almost done" so the bar conveys "real work is happening" without
 * lying about how far along we are.
 */
const FALLBACK_PROCESSING: StepMapping = {
  label: "Generating article…",
  progressPercent: 35,
};

const FALLBACK_PROCESSING_IDEAS: StepMapping = {
  label: "Generating ideas…",
  progressPercent: 35,
};

function isObjectLike(v: Json | null | undefined): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readRefunded(output: Json | null | undefined): boolean {
  if (!isObjectLike(output)) return false;
  return output.refunded === true;
}

/**
 * Counts the image-picker warnings stored in
 * `output.imageSummary.warnings` (written by
 * `runGenerateArticleFromIdeaJob`'s v7 image-picker step). Returns 0
 * when:
 *   * `output` is missing / not an object
 *   * `imageSummary` is missing (legacy jobs from before v7)
 *   * `warnings` isn't an array (forward-compat against shape drift)
 *
 * Used to render the `Completed with N image warning(s)` subtitle
 * on the active-jobs tray row so users notice incomplete picks
 * without opening the autopilot run drawer.
 */
function readImageWarningCount(output: Json | null | undefined): number {
  if (!isObjectLike(output)) return 0;
  const summary = output.imageSummary;
  if (!isObjectLike(summary)) return 0;
  const warnings = summary.warnings;
  if (!Array.isArray(warnings)) return 0;
  return warnings.length;
}

/**
 * Did the autopilot WordPress-draft auto-send step emit a warning?
 *
 * Returns the warning kind (`'failed'` | `'skipped_no_connection'`)
 * when the job's `output.wpPublish` carries a non-success status
 * that the user should know about. Returns `null` for the normal
 * success / skip-no-action cases (auto-send not configured, draft
 * already existed, draft created successfully).
 *
 * Same defensive shape-checks as image warnings — legacy jobs
 * (pre-auto-send) have no `wpPublish` and return `null`.
 */
type WpPublishWarning = "failed" | "skipped_no_connection";
function readWpPublishWarning(
  output: Json | null | undefined,
): WpPublishWarning | null {
  if (!isObjectLike(output)) return null;
  const wp = output.wpPublish;
  if (!isObjectLike(wp)) return null;
  if (wp.status === "failed") return "failed";
  if (wp.status === "skipped_no_connection") return "skipped_no_connection";
  return null;
}

/**
 * Renders the `Completed with …` subtitle for the active-jobs
 * tray row. Combines image-picker warnings + WordPress auto-send
 * warnings into a single line:
 *
 *   - Neither → `null` (no subtitle).
 *   - Only image warnings → `"Completed with N image warning(s)"`.
 *   - Only WP warning → `"WordPress draft send failed"` /
 *     `"WordPress not connected"`.
 *   - Both → `"Completed with warnings"` (keeps the row to one
 *     line; the autopilot run drawer surfaces the per-warning
 *     detail when the user wants it).
 */
function buildCompletedDetail(
  imageWarnings: number,
  wpWarning: WpPublishWarning | null,
): string | null {
  const hasImage = imageWarnings > 0;
  const hasWp = wpWarning !== null;
  if (!hasImage && !hasWp) return null;
  if (hasImage && hasWp) return "Completed with warnings";
  if (hasImage) {
    return `Completed with ${imageWarnings} image ${imageWarnings === 1 ? "warning" : "warnings"}`;
  }
  // wpWarning only.
  return wpWarning === "failed"
    ? "WordPress draft send failed"
    : "WordPress not connected";
}

function trimDetail(detail: string | null | undefined): string | null {
  if (typeof detail !== "string") return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;
  // Keep error messages short — the row is narrow.
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
}

export interface JobLabelInput {
  /**
   * `article_jobs.type` — drives which step map we use.
   * `"generate_ideas"` and `"generate_article"` are recognized; other
   * values fall back to the article map (the only multi-step type
   * today).
   */
  type: string;
  status: string;
  currentStep: string | null;
  errorMessage: string | null;
  output: Json | null;
}

function isIdeaJob(type: string): boolean {
  return type === "generate_ideas";
}

function processingMapping(input: JobLabelInput): StepMapping {
  const stepMap = isIdeaJob(input.type) ? IDEA_STEP_MAP : ARTICLE_STEP_MAP;
  const step = input.currentStep ?? "";
  return (
    stepMap[step] ??
    (isIdeaJob(input.type) ? FALLBACK_PROCESSING_IDEAS : FALLBACK_PROCESSING)
  );
}

export function getActiveJobLabel(input: JobLabelInput): ActiveJobLabel {
  if (input.status === "pending") {
    return {
      label: "Queued",
      detail: null,
      variant: "default",
      isActive: true,
      progressPercent: 5,
    };
  }

  if (input.status === "processing") {
    const mapping = processingMapping(input);
    return {
      label: mapping.label,
      detail: null,
      variant: "brand",
      isActive: true,
      progressPercent: mapping.progressPercent,
    };
  }

  if (input.status === "completed") {
    // For article jobs, surface a soft warning subtitle for the
    // two post-generation best-effort steps that can each have
    // their own warnings: image picker + autopilot WP-draft send.
    // Idea jobs never run either step so always get null detail.
    const imageWarnings = isIdeaJob(input.type)
      ? 0
      : readImageWarningCount(input.output);
    const wpWarning = isIdeaJob(input.type)
      ? null
      : readWpPublishWarning(input.output);
    return {
      label: isIdeaJob(input.type)
        ? "Ideas ready for review"
        : "Article ready for review",
      // Subtitle priority: when BOTH kinds of warning exist, show
      // the combined "Completed with warnings" so the row stays
      // one line; otherwise pick the specific message.
      detail: buildCompletedDetail(imageWarnings, wpWarning),
      variant: "success",
      isActive: false,
      progressPercent: 100,
    };
  }

  if (input.status === "failed") {
    const refunded = readRefunded(input.output);
    return {
      label: refunded ? "Generation failed · Refunded" : "Generation failed",
      detail: trimDetail(input.errorMessage),
      variant: refunded ? "warning" : "error",
      isActive: false,
      progressPercent: 100,
    };
  }

  if (input.status === "cancelled") {
    return {
      label: "Cancelled",
      detail: null,
      variant: "default",
      isActive: false,
      progressPercent: 100,
    };
  }

  // Forward-compat: unknown status. Surface it as-is rather than
  // hiding it — easier to debug a typo than to silently miss a row.
  // No progressPercent because we can't honestly estimate it.
  return {
    label: input.status,
    detail: null,
    variant: "default",
    isActive: false,
    progressPercent: null,
  };
}
