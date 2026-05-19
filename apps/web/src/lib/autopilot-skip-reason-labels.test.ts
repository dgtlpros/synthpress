import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_SKIP_REASONS,
  AUTOPILOT_SKIP_REASON_VALUES,
} from "./autopilot-skip-reasons";
import {
  formatAutopilotSkipReason,
  getAutopilotSkipReasonDescription,
  getAutopilotSkipReasonLabel,
  getKnownAutopilotSkipReasons,
} from "./autopilot-skip-reason-labels";

describe("getAutopilotSkipReasonLabel", () => {
  it("returns the friendly label for every canonical reason", () => {
    // Pinned coverage: every key emitted by the scheduler MUST
    // resolve to a non-empty label so the recent-runs panel never
    // renders raw snake_case to the user. If a future PR adds a
    // new reason to the constants, this test fails until the
    // labels module is updated.
    for (const reason of AUTOPILOT_SKIP_REASON_VALUES) {
      const label = getAutopilotSkipReasonLabel(reason);
      expect(label, `missing label for ${reason}`).toBeTruthy();
      expect(label!.length).toBeGreaterThan(0);
    }
  });

  it.each([
    [AUTOPILOT_SKIP_REASONS.OK, "Completed"],
    [AUTOPILOT_SKIP_REASONS.PARTIAL_FAILURE, "Completed with issues"],
    [
      AUTOPILOT_SKIP_REASONS.DAILY_ARTICLE_CAP_REACHED,
      "Daily article target reached",
    ],
    [
      AUTOPILOT_SKIP_REASONS.ACTIVE_ARTICLE_JOB_LIMIT_REACHED,
      "Autopilot is waiting for current article jobs to finish",
    ],
    [
      AUTOPILOT_SKIP_REASONS.ACTIVE_TEAM_ARTICLE_JOB_LIMIT_REACHED,
      "Autopilot is waiting for team article jobs to finish",
    ],
    [
      AUTOPILOT_SKIP_REASONS.NO_APPROVED_IDEAS_IN_BACKLOG,
      "No approved ideas available",
    ],
    [
      AUTOPILOT_SKIP_REASONS.BACKLOG_EMPTY_NO_BUDGET_FOR_IDEAS,
      "No approved ideas and no idea budget",
    ],
    [
      AUTOPILOT_SKIP_REASONS.IDEA_GENERATION_FAILED,
      "Idea generation failed",
    ],
    [
      AUTOPILOT_SKIP_REASONS.INSUFFICIENT_BALANCE,
      "Insufficient token balance",
    ],
    [
      AUTOPILOT_SKIP_REASONS.INSUFFICIENT_TOKEN_BUDGET,
      "Daily token budget reached",
    ],
    [AUTOPILOT_SKIP_REASONS.NO_WORK_NEEDED, "No work needed"],
    [AUTOPILOT_SKIP_REASONS.AUTOPILOT_DISABLED, "Autopilot disabled"],
    [AUTOPILOT_SKIP_REASONS.DRY_RUN, "Dry run completed"],
    [AUTOPILOT_SKIP_REASONS.TEAM_BILLING_UNAVAILABLE, "Billing unavailable"],
    [AUTOPILOT_SKIP_REASONS.BLOG_NOT_FOUND, "Blog not found"],
  ])("returns %s → %s", (reason, expected) => {
    expect(getAutopilotSkipReasonLabel(reason)).toBe(expected);
  });

  it("returns null for null input", () => {
    expect(getAutopilotSkipReasonLabel(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(getAutopilotSkipReasonLabel(undefined)).toBeNull();
  });

  it("returns null for empty / whitespace-only strings", () => {
    expect(getAutopilotSkipReasonLabel("")).toBeNull();
    expect(getAutopilotSkipReasonLabel("   ")).toBeNull();
    expect(getAutopilotSkipReasonLabel("\n\t")).toBeNull();
  });

  it("returns null when given a non-string value (defensive)", () => {
    expect(getAutopilotSkipReasonLabel(42 as unknown as string)).toBeNull();
    expect(getAutopilotSkipReasonLabel({} as unknown as string)).toBeNull();
  });

  it("falls back to title-cased copy for unknown snake_case reasons (forward-compat)", () => {
    expect(
      getAutopilotSkipReasonLabel("midjourney_quota_reached"),
    ).toBe("Midjourney Quota Reached");
    expect(
      getAutopilotSkipReasonLabel("vector_index_unavailable"),
    ).toBe("Vector Index Unavailable");
  });

  it("title-cases a single-word unknown reason", () => {
    expect(getAutopilotSkipReasonLabel("queued")).toBe("Queued");
  });

  it("ignores empty segments from double underscores when title-casing", () => {
    expect(getAutopilotSkipReasonLabel("foo__bar")).toBe("Foo Bar");
  });

  it("trims whitespace before lookup", () => {
    expect(getAutopilotSkipReasonLabel("  ok  ")).toBe("Completed");
  });
});

describe("getAutopilotSkipReasonDescription", () => {
  it("returns the friendly description for known reasons (or null when intentional)", () => {
    expect(getAutopilotSkipReasonDescription("ok")).toBeNull();
    expect(
      getAutopilotSkipReasonDescription("daily_article_cap_reached"),
    ).toMatch(/configured number of article jobs/i);
    expect(
      getAutopilotSkipReasonDescription("no_approved_ideas_in_backlog"),
    ).toMatch(/needs approved ideas/i);
  });

  it("returns null for null / undefined / empty / non-string", () => {
    expect(getAutopilotSkipReasonDescription(null)).toBeNull();
    expect(getAutopilotSkipReasonDescription(undefined)).toBeNull();
    expect(getAutopilotSkipReasonDescription("")).toBeNull();
    expect(getAutopilotSkipReasonDescription("   ")).toBeNull();
    expect(
      getAutopilotSkipReasonDescription(7 as unknown as string),
    ).toBeNull();
  });

  it("returns null for unknown reasons (we don't fabricate copy)", () => {
    expect(
      getAutopilotSkipReasonDescription("midjourney_quota_reached"),
    ).toBeNull();
  });
});

describe("formatAutopilotSkipReason", () => {
  it("returns label + description + tone for known reasons", () => {
    expect(formatAutopilotSkipReason("ok")).toEqual({
      label: "Completed",
      description: null,
      tone: "success",
    });
    expect(formatAutopilotSkipReason("partial_failure")).toEqual({
      label: "Completed with issues",
      description: "Some work completed, but one or more steps had issues.",
      tone: "warning",
    });
  });

  it("classifies operational throttle reasons as default tone (NOT warning/danger)", () => {
    // The active-job throttles are operational backpressure, not
    // failures. The recent-runs panel should NOT visually shout at
    // a user whose blog is just waiting for in-flight jobs.
    expect(
      formatAutopilotSkipReason("active_article_job_limit_reached").tone,
    ).toBe("default");
    expect(
      formatAutopilotSkipReason("active_team_article_job_limit_reached")
        .tone,
    ).toBe("default");
  });

  it("classifies idea_generation_failed + blog_not_found as danger tone", () => {
    expect(formatAutopilotSkipReason("idea_generation_failed").tone).toBe(
      "danger",
    );
    expect(formatAutopilotSkipReason("blog_not_found").tone).toBe("danger");
  });

  it("classifies actionable issues (insufficient_balance, partial_failure, billing) as warning", () => {
    expect(formatAutopilotSkipReason("insufficient_balance").tone).toBe(
      "warning",
    );
    expect(formatAutopilotSkipReason("partial_failure").tone).toBe("warning");
    expect(
      formatAutopilotSkipReason("team_billing_unavailable").tone,
    ).toBe("warning");
    expect(
      formatAutopilotSkipReason("backlog_empty_no_budget_for_ideas").tone,
    ).toBe("warning");
  });

  it("returns label/description nulls + default tone for null / undefined / empty", () => {
    expect(formatAutopilotSkipReason(null)).toEqual({
      label: null,
      description: null,
      tone: "default",
    });
    expect(formatAutopilotSkipReason(undefined)).toEqual({
      label: null,
      description: null,
      tone: "default",
    });
    expect(formatAutopilotSkipReason("")).toEqual({
      label: null,
      description: null,
      tone: "default",
    });
    expect(formatAutopilotSkipReason("   ")).toEqual({
      label: null,
      description: null,
      tone: "default",
    });
    expect(
      formatAutopilotSkipReason(99 as unknown as string),
    ).toEqual({ label: null, description: null, tone: "default" });
  });

  it("returns title-cased label + null description + default tone for unknown reasons", () => {
    expect(formatAutopilotSkipReason("midjourney_quota_reached")).toEqual({
      label: "Midjourney Quota Reached",
      description: null,
      tone: "default",
    });
  });
});

describe("operational throttle copy posture (regex guards)", () => {
  // The operational throttle reasons are explicitly framed as
  // BACKPRESSURE — autopilot is waiting for in-flight work. They
  // are NOT subscription / pricing / plan / paywall messages. If
  // someone tries to surface the active-job limit as a paywall in
  // a future PR, this test catches it before it ships.
  const PROHIBITED = /\b(plan|subscription|tier|pricing|upgrade|paywall)\b/i;

  it("active_article_job_limit_reached label has no plan/subscription/tier/pricing/upgrade/paywall language", () => {
    const label = getAutopilotSkipReasonLabel(
      "active_article_job_limit_reached",
    );
    expect(label).not.toBeNull();
    expect(label!).not.toMatch(PROHIBITED);
  });

  it("active_article_job_limit_reached description has no plan/subscription/tier/pricing/upgrade/paywall language", () => {
    const description = getAutopilotSkipReasonDescription(
      "active_article_job_limit_reached",
    );
    expect(description).not.toBeNull();
    expect(description!).not.toMatch(PROHIBITED);
  });

  it("active_team_article_job_limit_reached label has no plan/subscription/tier/pricing/upgrade/paywall language", () => {
    const label = getAutopilotSkipReasonLabel(
      "active_team_article_job_limit_reached",
    );
    expect(label).not.toBeNull();
    expect(label!).not.toMatch(PROHIBITED);
  });

  it("active_team_article_job_limit_reached description has no plan/subscription/tier/pricing/upgrade/paywall language", () => {
    const description = getAutopilotSkipReasonDescription(
      "active_team_article_job_limit_reached",
    );
    expect(description).not.toBeNull();
    expect(description!).not.toMatch(PROHIBITED);
  });

  it("active-throttle copy DOES use backpressure / waiting language", () => {
    // Positive contract: the copy must communicate "we are
    // waiting for current jobs to finish" so users understand
    // the next cron tick will continue automatically.
    expect(
      getAutopilotSkipReasonLabel("active_article_job_limit_reached"),
    ).toMatch(/waiting for current article jobs/i);
    expect(
      getAutopilotSkipReasonDescription("active_article_job_limit_reached"),
    ).toMatch(/next scheduled run/i);
  });
});

describe("getKnownAutopilotSkipReasons", () => {
  it("returns a complete set covering every canonical reason", () => {
    const known = getKnownAutopilotSkipReasons();
    for (const reason of AUTOPILOT_SKIP_REASON_VALUES) {
      expect(known).toContain(reason);
    }
    expect(known.length).toBe(AUTOPILOT_SKIP_REASON_VALUES.length);
  });
});
