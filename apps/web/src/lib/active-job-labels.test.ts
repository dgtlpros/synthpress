import { describe, expect, it } from "vitest";
import { getActiveJobLabel } from "./active-job-labels";

describe("getActiveJobLabel", () => {
  it("maps pending → Queued (active)", () => {
    const label = getActiveJobLabel({
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
    });
  });

  it.each([
    ["loading_context", "Preparing article…"],
    ["generating_ideas", "Generating ideas…"],
    ["saving_ideas", "Saving ideas…"],
    ["generating_outline", "Drafting outline…"],
    ["writing_article", "Writing article…"],
    ["saving_article", "Saving draft…"],
    ["logging_usage", "Finalizing…"],
    ["completed", "Article ready for review"],
  ])("maps processing step %s → %s", (step, expectedLabel) => {
    const label = getActiveJobLabel({
      status: "processing",
      currentStep: step,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe(expectedLabel);
    expect(label.variant).toBe("brand");
    expect(label.isActive).toBe(true);
  });

  it("falls back to a generic label for an unknown processing step", () => {
    const label = getActiveJobLabel({
      status: "processing",
      currentStep: "this_step_does_not_exist",
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Generating article…");
  });

  it("falls back to a generic label when current_step is null", () => {
    const label = getActiveJobLabel({
      status: "processing",
      currentStep: null,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Generating article…");
  });

  it("maps completed → Article ready for review (success badge, inactive)", () => {
    const label = getActiveJobLabel({
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
    });
  });

  it("maps failed (no refund) → Generation failed", () => {
    const label = getActiveJobLabel({
      status: "failed",
      currentStep: "writing_article",
      errorMessage: "model timed out",
      output: null,
    });
    expect(label.label).toBe("Generation failed");
    expect(label.variant).toBe("error");
    expect(label.isActive).toBe(false);
    expect(label.detail).toBe("model timed out");
  });

  it("maps failed + refunded → Generation failed · Refunded (warning badge)", () => {
    const label = getActiveJobLabel({
      status: "failed",
      currentStep: "writing_article",
      errorMessage: "model timed out",
      output: { refunded: true, refundedCredits: 5 },
    });
    expect(label.label).toBe("Generation failed · Refunded");
    expect(label.variant).toBe("warning");
  });

  it("trims very long detail messages with an ellipsis", () => {
    const long = "x".repeat(500);
    const label = getActiveJobLabel({
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
        status: "failed",
        currentStep: null,
        errorMessage: "   ",
        output: null,
      }).detail,
    ).toBeNull();

    expect(
      getActiveJobLabel({
        status: "failed",
        currentStep: null,
        errorMessage: null,
        output: null,
      }).detail,
    ).toBeNull();
  });

  it("ignores a non-string errorMessage when computing detail", () => {
    const label = getActiveJobLabel({
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
      status: "failed",
      currentStep: null,
      errorMessage: null,
      output: { refunded: "yes" },
    });
    expect(label.label).toBe("Generation failed");
  });

  it("maps cancelled → Cancelled (default badge, inactive)", () => {
    const label = getActiveJobLabel({
      status: "cancelled",
      currentStep: null,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("Cancelled");
    expect(label.isActive).toBe(false);
  });

  it("forwards an unknown status as-is for forward compatibility", () => {
    const label = getActiveJobLabel({
      status: "needs_human",
      currentStep: null,
      errorMessage: null,
      output: null,
    });
    expect(label.label).toBe("needs_human");
    expect(label.isActive).toBe(false);
  });
});
