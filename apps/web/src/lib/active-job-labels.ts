import type { Json } from "@/lib/supabase/database.types";

/**
 * Pure mapping from `article_jobs.{status, current_step, output}` into
 * the user-facing label + badge variant the global tray renders.
 *
 * Lives in `lib/` (not `components/`) because both the dumb organism
 * AND the controller hook need to call it (the hook uses the
 * `isActive` flag below to decide whether a row is dismissible). Pure
 * function, fully unit-testable.
 *
 * Tone: short, present-tense, optimistic on success, factual on
 * failure. No exclamation marks, no emojis (the badge variant carries
 * the color signal).
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
   *   * show a spinner instead of an outcome badge
   *   * pluralize the collapsed-state count ("2 tasks running")
   */
  isActive: boolean;
}

const STEP_LABELS: Record<string, string> = {
  loading_context: "Preparing article…",
  generating_ideas: "Generating ideas…",
  saving_ideas: "Saving ideas…",
  generating_outline: "Drafting outline…",
  writing_article: "Writing article…",
  saving_article: "Saving draft…",
  logging_usage: "Finalizing…",
  completed: "Article ready for review",
};

function isObjectLike(v: Json | null | undefined): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readRefunded(output: Json | null | undefined): boolean {
  if (!isObjectLike(output)) return false;
  return output.refunded === true;
}

function trimDetail(detail: string | null | undefined): string | null {
  if (typeof detail !== "string") return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;
  // Keep error messages short — the row is narrow.
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
}

export interface JobLabelInput {
  status: string;
  currentStep: string | null;
  errorMessage: string | null;
  output: Json | null;
}

export function getActiveJobLabel(input: JobLabelInput): ActiveJobLabel {
  if (input.status === "pending") {
    return {
      label: "Queued",
      detail: null,
      variant: "default",
      isActive: true,
    };
  }

  if (input.status === "processing") {
    const step = input.currentStep ?? "";
    const label = STEP_LABELS[step] ?? "Generating article…";
    return {
      label,
      detail: null,
      variant: "brand",
      isActive: true,
    };
  }

  if (input.status === "completed") {
    return {
      label: "Article ready for review",
      detail: null,
      variant: "success",
      isActive: false,
    };
  }

  if (input.status === "failed") {
    const refunded = readRefunded(input.output);
    return {
      label: refunded
        ? "Generation failed · Refunded"
        : "Generation failed",
      detail: trimDetail(input.errorMessage),
      variant: refunded ? "warning" : "error",
      isActive: false,
    };
  }

  if (input.status === "cancelled") {
    return {
      label: "Cancelled",
      detail: null,
      variant: "default",
      isActive: false,
    };
  }

  // Forward-compat: unknown status. Surface it as-is rather than
  // hiding it — easier to debug a typo than to silently miss a row.
  return {
    label: input.status,
    detail: null,
    variant: "default",
    isActive: false,
  };
}
