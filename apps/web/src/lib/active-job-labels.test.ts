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
    ["picking_images", "Choosing images…", 85],
    ["logging_usage", "Finalizing…", 90],
    ["sending_to_wordpress", "Sending to WordPress draft…", 95],
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

  it("maps completed with image warnings → 'Completed with N image warnings' subtitle", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: {
        model: "claude",
        imageSummary: {
          providerId: "unsplash",
          warnings: [
            "Skipped section X: no results.",
            "Skipped section Y: rate limit.",
          ],
        },
      },
    });
    expect(label.label).toBe("Article ready for review");
    expect(label.detail).toBe("Completed with 2 image warnings");
    expect(label.variant).toBe("success");
  });

  it("singularizes the image-warnings subtitle when there's exactly one", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { imageSummary: { warnings: ["only one"] } },
    });
    expect(label.detail).toBe("Completed with 1 image warning");
  });

  it("does NOT add an image-warnings subtitle when warnings is empty", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { imageSummary: { warnings: [] } },
    });
    expect(label.detail).toBeNull();
  });

  it("does NOT add an image-warnings subtitle for legacy completed jobs (no imageSummary)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { model: "claude", tokens: 1234 },
    });
    expect(label.detail).toBeNull();
  });

  it("does NOT add an image-warnings subtitle for completed IDEA jobs (image picker doesn't run)", () => {
    const label = getActiveJobLabel({
      type: "generate_ideas",
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      // Idea jobs never write imageSummary, but defensively the
      // label should ignore it even if it were present (the image
      // picker isn't part of the idea workflow).
      output: { imageSummary: { warnings: ["should be ignored"] } },
    });
    expect(label.detail).toBeNull();
  });

  it("does NOT add an image-warnings subtitle when imageSummary.warnings is malformed (not an array)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { imageSummary: { warnings: "oops" } },
    });
    expect(label.detail).toBeNull();
  });

  it("does NOT add an image-warnings subtitle when imageSummary is malformed (not an object)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { imageSummary: 42 },
    });
    expect(label.detail).toBeNull();
  });

  it("subtitles 'WordPress draft send failed' when wpPublish.status === 'failed'", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: {
        wpPublish: { status: "failed", warning: "WordPress rejected request." },
      },
    });
    expect(label.detail).toBe("WordPress draft send failed");
    expect(label.variant).toBe("success");
  });

  it("subtitles 'WordPress not connected' when wpPublish.status === 'skipped_no_connection'", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { wpPublish: { status: "skipped_no_connection" } },
    });
    expect(label.detail).toBe("WordPress not connected");
  });

  it("does NOT add a subtitle for wpPublish.status === 'draft_created' (happy path)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: {
        wpPublish: { status: "draft_created", wpPostId: 7, wpPostUrl: null },
      },
    });
    expect(label.detail).toBeNull();
  });

  it("does NOT add a subtitle for wpPublish.status === 'already_sent'", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: {
        wpPublish: { status: "already_sent", wpPostId: 7, wpPostUrl: null },
      },
    });
    expect(label.detail).toBeNull();
  });

  it("combines image + WordPress warnings into a single 'Completed with warnings' subtitle", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: {
        imageSummary: { warnings: ["bad pick"] },
        wpPublish: { status: "failed", warning: "WP rejected." },
      },
    });
    expect(label.detail).toBe("Completed with warnings");
  });

  it("ignores wpPublish on idea jobs (image picker + WP send don't run for ideas)", () => {
    const label = getActiveJobLabel({
      type: "generate_ideas",
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { wpPublish: { status: "failed", warning: "irrelevant" } },
    });
    expect(label.detail).toBeNull();
  });

  it("does NOT subtitle when wpPublish is malformed (not an object)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { wpPublish: 42 },
    });
    expect(label.detail).toBeNull();
  });

  it("does NOT subtitle when wpPublish.status is an unknown value (forward-compat)", () => {
    const label = getActiveJobLabel({
      type: ARTICLE_TYPE,
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      output: { wpPublish: { status: "some_future_status" } },
    });
    expect(label.detail).toBeNull();
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
