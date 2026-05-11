import { describe, expect, it } from "vitest";
import { getActiveJobLabel } from "./active-job-labels";

const ARTICLE_TYPE = "generate_article";
const IDEAS_TYPE = "generate_ideas";

describe("getActiveJobLabel — generate_article", () => {
  it("maps pending → Queued at 5% (active)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "pending",
      currentStep: null,
      errorMessage: null,
      output: null,
    });
    expect(label).toEqual({
      label: "Queued",
      detail: null,
      variant: "default",
      isActive: true,
      progressPercent: 5,
    });
  });

  it.each([
    ["loading_context", "Preparing article…", 15],
    ["writing_article", "Writing article…", 45],
    ["saving_article", "Saving draft…", 75],
    ["logging_usage", "Finalizing…", 90],
    ["completed", "Article ready for review", 100],
  ])("maps processing step %s → %s @ %d%%", (step, expectedLabel, pct) => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "processing",
      currentStep: step,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe(expectedLabel);
    expect(label.variant).toBe("brand");
    expect(label.isActive).toBe(true);
    expect(label.progressPercent).toBe(pct);
  });

  it("falls back to a generic 35% for an unknown processing step", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "processing",
      currentStep: "this_step_does_not_exist",
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Generating article…");
    expect(label.progressPercent).toBe(35);
  });

  it("falls back to the generic label when current_step is null", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "processing",
      currentStep: null,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Generating article…");
    expect(label.progressPercent).toBe(35);
  });

  it("maps completed → Article ready for review @ 100%", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { model: "claude" },
    });
    expect(label).toEqual({
      label: "Article ready for review",
      detail: null,
      variant: "success",
      isActive: false,
      progressPercent: 100,
    });
  });

  it("maps failed (no refund) → Generation failed @ 100%", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "failed",
      currentStep: "writing_article",
      errorMessage: "model timed out",
      output: null,
    });
    expect(label.label).toBe("Generation failed");
    expect(label.variant).toBe("error");
    expect(label.isActive).toBe(false);
    expect(label.progressPercent).toBe(100);
    expect(label.detail).toBe("model timed out");
  });

  it("maps failed + refunded → Generation failed · Refunded (warning)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "failed",
      currentStep: "writing_article",
      errorMessage: "model timed out",
      output: { refunded: true, refundedCredits: 5 },
    });
    expect(label.label).toBe("Generation failed · Refunded");
    expect(label.variant).toBe("warning");
    expect(label.progressPercent).toBe(100);
  });

  it("trims very long detail messages with an ellipsis", () => {
    const long = "x".repeat(500);
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "failed",
      currentStep: null,
      errorMessage: long,
      output: null,
    });
    expect(label.detail).toMatch(/…$/);
    expect(label.detail!.length).toBe(138);
  });

  it("returns null detail for empty / whitespace-only error messages", () => {
    expect(
      getActiveJobLabel({
        type: ARTICLE_TYPE,
        status: "failed",
        currentStep: null,
        errorMessage: "   ",
        output: null,
      }).detail,
    ).toBeNull();

    expect(
      getActiveJobLabel({
        type: ARTICLE_TYPE,
        status: "failed",
        currentStep: null,
        errorMessage: null,
        output: null,
      }).detail,
    ).toBeNull();
  });

  it("ignores a non-string errorMessage when computing detail", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "failed",
      currentStep: null,
      // @ts-expect-error — exercise the runtime guard
      errorMessage: 42,
      output: null,
    });
    expect(label.detail).toBeNull();
  });

  it("ignores non-object output when checking refunded flag", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "failed",
      currentStep: null,
      errorMessage: null,
      output: "refunded",
    });
    expect(label.label).toBe("Generation failed");
    expect(label.variant).toBe("error");
  });

  it("ignores array output when checking refunded flag", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "failed",
      currentStep: null,
      errorMessage: null,
      output: [{ refunded: true }],
    });
    expect(label.label).toBe("Generation failed");
    expect(label.variant).toBe("error");
  });

  it("treats refunded values other than true as not refunded", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "failed",
      currentStep: null,
      errorMessage: null,
      output: { refunded: "yes" },
    });
    expect(label.label).toBe("Generation failed");
  });

  it("maps cancelled → Cancelled @ 100% (default badge, inactive)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "cancelled",
      currentStep: null,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Cancelled");
    expect(label.isActive).toBe(false);
    expect(label.progressPercent).toBe(100);
  });

  it("forwards an unknown status as-is with null progress (forward-compat)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "needs_human",
      currentStep: null,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("needs_human");
    expect(label.isActive).toBe(false);
    expect(label.progressPercent).toBeNull();
  });
});

describe("getActiveJobLabel — generate_ideas", () => {
  it("maps pending → Queued @ 5%", () => {
    const label = getActiveJobLabel({
      type: IDEAS_TYPE,
      status: "pending",
      currentStep: null,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Queued");
    expect(label.progressPercent).toBe(5);
  });

  it.each([
    ["loading_context", "Preparing ideas…", 15],
    ["generating_ideas", "Generating ideas…", 50],
    ["saving_ideas", "Saving ideas…", 80],
    ["logging_usage", "Finalizing…", 90],
    ["completed", "Ideas ready for review", 100],
  ])("maps processing step %s → %s @ %d%%", (step, expectedLabel, pct) => {
    const label = getActiveJobLabel({
      type: IDEAS_TYPE,
      status: "processing",
      currentStep: step,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe(expectedLabel);
    expect(label.progressPercent).toBe(pct);
  });

  it("falls back to a generic 35% for an unknown idea step", () => {
    const label = getActiveJobLabel({
      type: IDEAS_TYPE,
      status: "processing",
      currentStep: "writing_article", // wrong type for idea jobs
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Generating ideas…");
    expect(label.progressPercent).toBe(35);
  });

  it("maps completed → Ideas ready for review @ 100%", () => {
    const label = getActiveJobLabel({
      type: IDEAS_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Ideas ready for review");
    expect(label.progressPercent).toBe(100);
  });
});

describe("getActiveJobLabel — unknown job type", () => {
  it("falls back to the article-shaped step map", () => {
    // A job type the UI doesn't know about defaults to the article
    // mapping (the only multi-step type today). Better to render
    // SOMETHING than to hide the row.
    const label = getActiveJobLabel({
      type: "future_job_type",
      status: "processing",
      currentStep: "writing_article",
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Writing article…");
    expect(label.progressPercent).toBe(45);
  });
});
