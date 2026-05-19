import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { AutopilotRunDetailDrawer } from "./AutopilotRunDetailDrawer";
import type { BlogAutopilotRunDetail } from "@/services/blog-autopilot-run-service";

const NOW = "2026-05-11T08:30:00Z";

function makeRun(
  overrides: Partial<BlogAutopilotRunDetail["run"]> = {},
): BlogAutopilotRunDetail["run"] {
  return {
    id: "run-1",
    team_id: "t1",
    project_id: "p1",
    blog_id: "b1",
    triggered_by_user_id: null,
    trigger_source: "cron",
    status: "completed",
    started_at: NOW,
    completed_at: NOW,
    scheduled_for: null,
    current_step: "completed",
    error_message: null,
    input: { triggerSource: "cron" },
    output: {
      reason: "ok",
      ideasAutoApproved: 0,
      requireReview: true,
    },
    ideas_generated: 0,
    articles_started: 0,
    articles_completed: 0,
    articles_failed: 0,
    tokens_spent: 0,
    tokens_refunded: 0,
    wp_drafts_expected: 0,
    wp_drafts_created: 0,
    wp_drafts_already_sent: 0,
    wp_drafts_skipped: 0,
    wp_drafts_failed: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<BlogAutopilotRunDetail> = {},
): BlogAutopilotRunDetail {
  return {
    run: makeRun(),
    jobs: [],
    articles: [],
    ideas: [],
    ...overrides,
  };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(cleanup);

describe("AutopilotRunDetailDrawer — states", () => {
  it("shows the loading spinner when isLoading=true", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={null}
        isLoading
        error={null}
      />,
    );
    expect(screen.getByTestId("autopilot-detail-loading")).toHaveTextContent(
      /Loading run details/i,
    );
  });

  it("shows the error message with role=alert", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={null}
        isLoading={false}
        error="Run not found."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Run not found.");
  });

  it("shows the empty state when no detail / no error / not loading", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={null}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/No run selected/i)).toBeInTheDocument();
  });

  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={onClose}
        detail={null}
        isLoading={false}
        error={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("AutopilotRunDetailDrawer — header + summary", () => {
  it("renders the trigger source, status badge, and run id", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ status: "skipped", trigger_source: "manual" }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText(/run id: run-1/)).toBeInTheDocument();
  });

  it("renders 'Still running' when completed_at is null", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ status: "processing", completed_at: null }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/Still running/i)).toBeInTheDocument();
  });

  it("formats and renders the current_step when present", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ current_step: "generating_articles" }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Generating articles")).toBeInTheDocument();
  });

  it("forwards an unknown trigger_source verbatim (forward-compat)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ trigger_source: "future_trigger" as never }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("future_trigger")).toBeInTheDocument();
  });

  it("hides the step label when current_step is null", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({ run: makeRun({ current_step: null }) })}
        isLoading={false}
        error={null}
      />,
    );
    // No step labels from the STEP_LABELS table render in the header.
    expect(screen.queryByText("Generating articles")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading settings")).not.toBeInTheDocument();
  });

  it("forwards an unknown step verbatim (forward-compat)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ current_step: "future_step" }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("future_step")).toBeInTheDocument();
  });

  it("renders the auto-approved counter from output.ideasAutoApproved", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            ideas_generated: 5,
            articles_started: 3,
            output: { ideasAutoApproved: 5, requireReview: false },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    // Use the dt label to find the dd value cell.
    const label = screen.getByText("Auto-approved");
    const dd = label.parentElement!.querySelector("dd");
    expect(dd).toHaveTextContent("5");
  });

  it("paints articlesFailed in error tone when > 0", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ articles_failed: 2 }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    const label = screen.getByText("Articles failed");
    const dd = label.parentElement!.querySelector("dd");
    expect(dd).toHaveClass("text-error");
  });

  it("paints tokensRefunded in warning tone when > 0", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ tokens_refunded: 5 }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    const label = screen.getByText("Tokens refunded");
    const dd = label.parentElement!.querySelector("dd");
    expect(dd).toHaveClass("text-warning");
  });
});

// ============================================================================
// WordPress draft summary (v11)
// ============================================================================

describe("AutopilotRunDetailDrawer — WordPress draft summary", () => {
  it("does NOT render the WordPress drafts section when wp_drafts_expected is 0", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        detail={makeDetail()}
        onClose={vi.fn()}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryByText("WordPress drafts")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("autopilot-run-wp-summary"),
    ).not.toBeInTheDocument();
  });

  it("renders the 5-counter section when wp_drafts_expected > 0", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        detail={makeDetail({
          run: makeRun({
            wp_drafts_expected: 5,
            wp_drafts_created: 3,
            wp_drafts_already_sent: 1,
            wp_drafts_skipped: 0,
            wp_drafts_failed: 1,
          }),
        })}
        onClose={vi.fn()}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("WordPress drafts")).toBeInTheDocument();
    // Each counter is the value's textContent — assert one of each.
    const section = screen.getByTestId("autopilot-run-wp-summary");
    expect(within(section).getByText("Expected")).toBeInTheDocument();
    expect(within(section).getByText("5")).toBeInTheDocument();
    expect(within(section).getByText("Drafts created")).toBeInTheDocument();
    expect(within(section).getByText("3")).toBeInTheDocument();
    expect(within(section).getByText("Already sent")).toBeInTheDocument();
    // Two `1`s exist (already sent + failed) so assert via dd siblings:
    const failedLabel = within(section).getByText("Failed");
    const failedDd = failedLabel.parentElement!.querySelector("dd");
    expect(failedDd).toHaveTextContent("1");
    expect(failedDd).toHaveClass("text-error");
  });

  it("renders the failure warning when wp_drafts_failed > 0", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        detail={makeDetail({
          run: makeRun({
            wp_drafts_expected: 2,
            wp_drafts_created: 1,
            wp_drafts_failed: 1,
          }),
        })}
        onClose={vi.fn()}
        isLoading={false}
        error={null}
      />,
    );
    const alert = screen.getByTestId("autopilot-run-wp-failed-warning");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(
      /Some articles could not be sent to WordPress drafts\./i,
    );
  });

  it("renders the skipped warning when wp_drafts_skipped > 0", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        detail={makeDetail({
          run: makeRun({
            wp_drafts_expected: 2,
            wp_drafts_skipped: 2,
          }),
        })}
        onClose={vi.fn()}
        isLoading={false}
        error={null}
      />,
    );
    const warn = screen.getByTestId("autopilot-run-wp-skipped-warning");
    expect(warn).toHaveTextContent(
      /Some WordPress draft sends were skipped because WordPress was not connected\./i,
    );
    expect(warn).toHaveClass("text-warning");
    // Skipped-without-failed should NOT render the role=alert paragraph.
    expect(
      screen.queryByTestId("autopilot-run-wp-failed-warning"),
    ).not.toBeInTheDocument();
  });

  it("renders BOTH warnings when failed > 0 AND skipped > 0", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        detail={makeDetail({
          run: makeRun({
            wp_drafts_expected: 3,
            wp_drafts_failed: 1,
            wp_drafts_skipped: 2,
          }),
        })}
        onClose={vi.fn()}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByTestId("autopilot-run-wp-failed-warning"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("autopilot-run-wp-skipped-warning"),
    ).toBeInTheDocument();
  });

  it("renders neither warning on the happy path (all expected → created)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        detail={makeDetail({
          run: makeRun({
            wp_drafts_expected: 4,
            wp_drafts_created: 4,
          }),
        })}
        onClose={vi.fn()}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-run-wp-failed-warning"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("autopilot-run-wp-skipped-warning"),
    ).not.toBeInTheDocument();
  });
});

describe("AutopilotRunDetailDrawer — failure / reason / paused", () => {
  it("renders the error_message section when present", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            status: "failed",
            error_message: "Anthropic returned 529.",
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.includes("529"))).toBe(true);
  });

  it("renders the friendly reason label + description when there's no error_message", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            status: "skipped",
            output: { reason: "daily_article_cap_reached" },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    const reasonCard = screen.getByTestId("autopilot-detail-reason");
    expect(reasonCard).toHaveTextContent(/Daily article target reached/i);
    expect(reasonCard).toHaveTextContent(/configured number of article jobs/i);
    // Raw key still attached for e2e selectors but NOT rendered as
    // user-facing copy.
    expect(reasonCard).toHaveAttribute(
      "data-reason-key",
      "daily_article_cap_reached",
    );
    // Confirm the raw snake_case key is gone from the visible text.
    expect(reasonCard.textContent ?? "").not.toContain(
      "daily_article_cap_reached",
    );
  });

  it("renders backpressure copy for the active-job throttle reasons (NOT plan/subscription wording)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            status: "skipped",
            output: { reason: "active_article_job_limit_reached" },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    const reasonCard = screen.getByTestId("autopilot-detail-reason");
    expect(reasonCard).toHaveTextContent(/waiting for current article jobs/i);
    expect(reasonCard).toHaveTextContent(
      /continue on the next scheduled run/i,
    );
    expect(reasonCard.textContent ?? "").not.toMatch(
      /\b(plan|subscription|tier|pricing|upgrade|paywall)\b/i,
    );
  });

  it("preserves the raw `output.reason` key as a data attribute on the Reason section", () => {
    // The drawer surfaces friendly copy in the Reason section but
    // operators / e2e tests still need access to the raw key.
    // The ReasonCard pins it onto a `data-reason-key` attribute
    // so a future label refactor can't accidentally drop the
    // underlying value from the debug surface.
    const detail = makeDetail({
      run: makeRun({
        status: "skipped",
        output: { reason: "daily_article_cap_reached" },
      }),
    });
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={detail}
        isLoading={false}
        error={null}
      />,
    );
    // Raw key still on the data attribute even though the visible
    // copy is the friendly label.
    expect(screen.getByTestId("autopilot-detail-reason")).toHaveAttribute(
      "data-reason-key",
      "daily_article_cap_reached",
    );
    // The drawer also exposes the entire raw output via the "Raw
    // run output" details panel; the panel renders the JSON pre
    // when expanded. We assert on the section being present rather
    // than its expanded body — jsdom's <details> toggle behavior
    // is unreliable. The structural data on `detail.run.output` is
    // not mutated on the read path.
    expect(screen.getByTestId("raw-output")).toBeInTheDocument();
    expect(detail.run.output).toEqual({ reason: "daily_article_cap_reached" });
  });

  it("does NOT render reason when both error_message and reason are present (error wins)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            status: "failed",
            error_message: "boom",
            output: { reason: "should-not-show" },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryByText("should-not-show")).not.toBeInTheDocument();
  });

  it("renders the auto-paused warning with link to Automation tab", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            status: "failed",
            output: { autopilotPaused: true, pauseReason: "failure_rate" },
          }),
        })}
        isLoading={false}
        error={null}
        automationSettingsHref="/settings#automation"
      />,
    );
    const warning = screen.getByTestId("autopilot-paused-detail-warning");
    expect(warning).toHaveTextContent(/multiple recent runs failed/i);
    expect(
      within(warning).getByRole("link", { name: /Automation tab/i }),
    ).toHaveAttribute("href", "/settings#automation");
  });

  it("renders the auto-paused warning without a link when no href provided", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            output: { autopilotPaused: true },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    const warning = screen.getByTestId("autopilot-paused-detail-warning");
    expect(within(warning).queryByRole("link")).not.toBeInTheDocument();
    expect(warning).toHaveTextContent(/Automation tab/);
  });
});

describe("AutopilotRunDetailDrawer — budget + backlog", () => {
  it("renders the budget / daily / backlog cards when output has them", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            output: {
              budget: {
                tokenBalance: 950,
                tokensSpentToday: 50,
                tokensRemainingFromBudget: 200,
              },
              daily: { cap: 5, articlesStartedToday: 2 },
              backlog: { approvedIdeasAvailable: 7 },
            },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("950")).toBeInTheDocument();
    expect(screen.getByText("Daily articles")).toBeInTheDocument();
    expect(screen.getByText("Idea backlog")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders 'no cap' when tokensRemainingFromBudget is null", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            output: {
              budget: {
                tokenBalance: 100,
                tokensSpentToday: 0,
                tokensRemainingFromBudget: null,
              },
            },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("no cap")).toBeInTheDocument();
  });

  it("renders only the daily card when budget + backlog are missing", () => {
    // Exercises the `{budget ? <Card> : null}` falsy branch — output
    // had only `daily`, so the Tokens + Idea backlog cards skip
    // their truthy branches.
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            output: { daily: { cap: 5, articlesStartedToday: 1 } },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Daily articles")).toBeInTheDocument();
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("Idea backlog")).not.toBeInTheDocument();
  });

  it("renders only the backlog card when budget + daily are missing", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            output: { backlog: { approvedIdeasAvailable: 3 } },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Idea backlog")).toBeInTheDocument();
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily articles")).not.toBeInTheDocument();
  });

  it("hides the budget section entirely when output has no budget/daily/backlog", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ output: { reason: "ok" } }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily articles")).not.toBeInTheDocument();
  });
});

describe("AutopilotRunDetailDrawer — jobs section", () => {
  it("renders 'No article jobs spawned' when the jobs list is empty", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail()}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/No article jobs spawned by this run/i),
    ).toBeInTheDocument();
  });

  it("renders one row per spawned article job with 'View article' link", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: "completed",
              errorMessage: null,
              input: {},
              output: null,
              articleId: "art-1",
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
          articles: [
            {
              id: "art-1",
              title: "My article",
              slug: "my-article",
              status: "ready_for_review",
              wordCount: 1200,
              targetKeyword: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
        postsHref="/teams/t1/projects/p1/blogs/b1/posts"
      />,
    );

    expect(screen.getByText("My article")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View article/i })).toHaveAttribute(
      "href",
      "/teams/t1/projects/p1/blogs/b1/posts/art-1",
    );
  });

  it("hides the View Article link when no postsHref is provided", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: null,
              articleId: "art-1",
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: null,
              completedAt: null,
            },
          ],
          articles: [
            {
              id: "art-1",
              title: "X",
              slug: null,
              status: "ready_for_review",
              wordCount: null,
              targetKeyword: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /View article/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the job error message inline when status=failed", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "failed",
              currentStep: "writing_article",
              errorMessage: "claude exploded",
              input: {},
              output: { refunded: true },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/claude exploded/)).toBeInTheDocument();
    expect(screen.getByText(/Refunded/)).toBeInTheDocument();
  });

  it("falls back to job-type label when no article is linked", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-x",
              type: "generate_ideas",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: null,
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: null,
              completedAt: null,
            },
            {
              id: "job-y",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: null,
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: null,
              completedAt: null,
            },
            {
              id: "job-z",
              type: "future_unknown_type",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: null,
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: null,
              completedAt: null,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Generate ideas")).toBeInTheDocument();
    expect(screen.getByText("Generate article")).toBeInTheDocument();
    expect(screen.getByText("future_unknown_type")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Image picker warnings (v8 polish)
  // -------------------------------------------------------------------------

  it("renders the image-warnings badge + collapsible list when imageSummary has warnings", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                imageSummary: {
                  providerId: "unsplash",
                  featuredSelected: true,
                  sectionsFound: 3,
                  sectionImagesSelected: 2,
                  warnings: [
                    'Skipped section "Pricing": no results for "Pricing launch b2b blog" after 3 attempts.',
                    'Skipped section "FAQ": provider search failed (rate_limited).',
                  ],
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );

    // Badge in the row header.
    expect(
      screen.getByTestId("autopilot-job-job-1-image-warnings-badge"),
    ).toHaveTextContent(/2 image warnings/);

    // The expandable `<details>` summary.
    expect(screen.getByText("Image picker warnings")).toBeInTheDocument();

    // Both warning bodies render.
    expect(screen.getByText(/Skipped section "Pricing"/)).toBeInTheDocument();
    expect(screen.getByText(/Skipped section "FAQ"/)).toBeInTheDocument();
  });

  it("singularizes the badge text when there's exactly one warning", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                imageSummary: {
                  warnings: ['Skipped section "Pricing": no results.'],
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-1-image-warnings-badge"),
    ).toHaveTextContent(/^· 1 image warning$/);
  });

  it("does NOT render the image-warnings UI when warnings is empty", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                imageSummary: {
                  warnings: [],
                  featuredSelected: true,
                  sectionsFound: 2,
                  sectionImagesSelected: 2,
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-job-job-1-image-warnings-badge"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Image picker warnings")).not.toBeInTheDocument();
  });

  it("does NOT render the image-warnings UI for legacy jobs (no imageSummary)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: { model: "claude-x", tokens: 1234 },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryByText("Image picker warnings")).not.toBeInTheDocument();
  });

  it("does NOT render the image-warnings UI when output is null", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: null,
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryByText("Image picker warnings")).not.toBeInTheDocument();
  });

  it("filters non-string warnings defensively (forward-compat)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                imageSummary: {
                  warnings: ["valid", 42, null, "another valid"],
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    // Badge counts only the two strings.
    expect(
      screen.getByTestId("autopilot-job-job-1-image-warnings-badge"),
    ).toHaveTextContent(/2 image warnings/);
    expect(screen.getByText("valid")).toBeInTheDocument();
    expect(screen.getByText("another valid")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Autopilot WordPress draft auto-send (v10)
  // -------------------------------------------------------------------------

  it("renders 'Draft sent to WordPress' badge + link when wpPublish.status === 'draft_created'", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                wpPublish: {
                  attempted: true,
                  status: "draft_created",
                  wpPostId: 42,
                  wpPostUrl: "https://example.com/?p=42",
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-1-wp-badge"),
    ).toHaveTextContent(/Draft sent to WordPress/);
    const link = screen.getByTestId("autopilot-job-job-1-wp-link");
    expect(link).toHaveAttribute("href", "https://example.com/?p=42");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders 'WordPress draft already existed' badge for status='already_sent'", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                wpPublish: {
                  attempted: false,
                  status: "already_sent",
                  wpPostId: 7,
                  wpPostUrl: "https://example.com/?p=7",
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-1-wp-badge"),
    ).toHaveTextContent(/WordPress draft already existed/);
  });

  it("renders 'WordPress not connected' badge + warning text for status='skipped_no_connection'", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                wpPublish: {
                  attempted: false,
                  status: "skipped_no_connection",
                  warning: "Connect a WordPress site first.",
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-1-wp-badge"),
    ).toHaveTextContent(/WordPress not connected/);
    expect(
      screen.getByTestId("autopilot-job-job-1-wp-warning"),
    ).toHaveTextContent(/Connect a WordPress site first/);
  });

  it("renders 'WordPress draft send failed' badge + error text for status='failed'", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                wpPublish: {
                  attempted: true,
                  status: "failed",
                  warning: "WordPress rejected the request.",
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-1-wp-badge"),
    ).toHaveTextContent(/WordPress draft send failed/);
    const warning = screen.getByTestId("autopilot-job-job-1-wp-warning");
    expect(warning).toHaveTextContent(/WordPress rejected/);
    expect(warning).toHaveAttribute("role", "alert");
  });

  it("does NOT render the wp link when wpPostUrl is missing (e.g. WP omitted `link` in the response)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                wpPublish: {
                  attempted: true,
                  status: "draft_created",
                  wpPostId: 42,
                  wpPostUrl: null,
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-1-wp-badge"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("autopilot-job-job-1-wp-link"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render wpPublish UI for legacy jobs (no wpPublish in output)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: { model: "claude-x" },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-job-job-1-wp-badge"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render wpPublish UI when wpPublish.status is unknown (forward-compat)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                wpPublish: { status: "some_future_status", warning: "x" },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-job-job-1-wp-badge"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render wpPublish UI when wpPublish is malformed (status is not a string)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: { wpPublish: { status: 42 } },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-job-job-1-wp-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders image warnings + wpPublish badge together (combined warning UX)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                imageSummary: { warnings: ["bad pick"] },
                wpPublish: {
                  attempted: true,
                  status: "failed",
                  warning: "WP boom",
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-1-image-warnings-badge"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("autopilot-job-job-1-wp-badge"),
    ).toBeInTheDocument();
  });

  it("does NOT render the wp warning paragraph when status='already_sent' (success path, no warning string)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                wpPublish: {
                  attempted: false,
                  status: "already_sent",
                  wpPostId: 7,
                  wpPostUrl: null,
                },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    // Badge present.
    expect(
      screen.getByTestId("autopilot-job-job-1-wp-badge"),
    ).toBeInTheDocument();
    // No warning paragraph.
    expect(
      screen.queryByTestId("autopilot-job-job-1-wp-warning"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the image-warnings UI when imageSummary.warnings is not an array (malformed)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: null,
              errorMessage: null,
              input: {},
              output: {
                imageSummary: { warnings: "oops not an array" },
              },
              articleId: null,
              articleIdeaId: null,
              createdAt: NOW,
              startedAt: NOW,
              completedAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryByText("Image picker warnings")).not.toBeInTheDocument();
  });
});

// ============================================================================
// WordPress draft retry button (v12)
// ============================================================================

describe("AutopilotRunDetailDrawer — WordPress retry button", () => {
  /**
   * Builds a job stub keyed by id, with a `wpPublish` outcome of
   * the given status. Article id is hardcoded — every retry test
   * needs one set.
   */
  function makeJob(
    id: string,
    status:
      | "failed"
      | "skipped_no_connection"
      | "draft_created"
      | "already_sent",
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id,
      type: "generate_article",
      status: "completed",
      currentStep: "completed",
      errorMessage: null,
      input: { autopilotRunId: "run-1" },
      output: {
        wpPublish:
          status === "draft_created"
            ? { status, wpPostId: 1, wpPostUrl: "https://x" }
            : status === "already_sent"
              ? { status, wpPostId: 1, wpPostUrl: "https://x" }
              : { status, warning: "stub" },
      },
      articleId: "art-1",
      articleIdeaId: "idea-1",
      createdAt: "2026-05-11T08:00:30Z",
      startedAt: "2026-05-11T08:00:30Z",
      completedAt: "2026-05-11T08:01:00Z",
      ...overrides,
    };
  }

  it("renders the retry button for jobs whose wpPublish.status is 'failed'", () => {
    const onRetry = vi.fn();
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({ jobs: [makeJob("job-fail", "failed")] })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={onRetry}
      />,
    );
    const btn = screen.getByTestId("autopilot-job-job-fail-wp-retry");
    expect(btn).toHaveTextContent("Retry WordPress draft");
    expect(btn).not.toBeDisabled();
  });

  it("renders the retry button for jobs whose wpPublish.status is 'skipped_no_connection'", () => {
    const onRetry = vi.fn();
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [makeJob("job-skip", "skipped_no_connection")],
        })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={onRetry}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-skip-wp-retry"),
    ).toBeInTheDocument();
  });

  it("does NOT render the retry button for draft_created or already_sent jobs", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            makeJob("job-ok", "draft_created"),
            makeJob("job-already", "already_sent"),
          ],
        })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-job-job-ok-wp-retry"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("autopilot-job-job-already-wp-retry"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the retry button when wpPublish is missing entirely", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [
            {
              ...makeJob("job-nowp", "failed"),
              output: { creditsUsed: 5 }, // no wpPublish
            },
          ],
        })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-job-job-nowp-wp-retry"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the retry button when the job has no article id", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [{ ...makeJob("job-noart", "failed"), articleId: null }],
        })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-job-job-noart-wp-retry"),
    ).not.toBeInTheDocument();
  });

  it("hides the retry button entirely when onRetryWordPressDraft is not supplied (read-only viewers)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({ jobs: [makeJob("job-r", "failed")] })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-job-job-r-wp-retry"),
    ).not.toBeInTheDocument();
  });

  it("calls onRetryWordPressDraft with the job id when clicked", () => {
    const onRetry = vi.fn();
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({ jobs: [makeJob("job-r", "failed")] })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={onRetry}
      />,
    );
    fireEvent.click(screen.getByTestId("autopilot-job-job-r-wp-retry"));
    expect(onRetry).toHaveBeenCalledWith("job-r");
  });

  it("shows the loading state + disables the active row when retryingJobId matches", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({ jobs: [makeJob("job-r", "failed")] })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={vi.fn()}
        retryingJobId="job-r"
      />,
    );
    const btn = screen.getByTestId("autopilot-job-job-r-wp-retry");
    expect(btn).toHaveTextContent("Retrying…");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("disables all other rows' retry buttons while one row is retrying", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [makeJob("job-a", "failed"), makeJob("job-b", "failed")],
        })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={vi.fn()}
        retryingJobId="job-a"
      />,
    );
    const a = screen.getByTestId("autopilot-job-job-a-wp-retry");
    const b = screen.getByTestId("autopilot-job-job-b-wp-retry");
    expect(a).toHaveTextContent("Retrying…");
    expect(b).toHaveTextContent("Retry WordPress draft");
    expect(b).toBeDisabled();
  });

  it("renders a per-row error message from retryErrorByJobId with role=alert", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({ jobs: [makeJob("job-r", "failed")] })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={vi.fn()}
        retryErrorByJobId={{ "job-r": "Connect WordPress before retrying." }}
      />,
    );
    const alert = screen.getByTestId("autopilot-job-job-r-wp-retry-error");
    expect(alert).toHaveTextContent("Connect WordPress before retrying.");
    expect(alert).toHaveAttribute("role", "alert");
  });

  it("does not render an error message for rows whose id isn't in retryErrorByJobId", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          jobs: [makeJob("job-a", "failed"), makeJob("job-b", "failed")],
        })}
        isLoading={false}
        error={null}
        onRetryWordPressDraft={vi.fn()}
        retryErrorByJobId={{ "job-a": "boom" }}
      />,
    );
    expect(
      screen.getByTestId("autopilot-job-job-a-wp-retry-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("autopilot-job-job-b-wp-retry-error"),
    ).not.toBeInTheDocument();
  });
});

describe("AutopilotRunDetailDrawer — ideas section + raw json", () => {
  it("renders the ideas list when ideas are present", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          ideas: [
            {
              id: "idea-1",
              title: "Idea A",
              status: "approved",
              targetKeyword: "kw",
              executiveSummary: null,
              createdAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.getByRole("list", { name: /Ideas referenced by this run/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Idea A")).toBeInTheDocument();
    expect(screen.getByText(/Target keyword: kw/i)).toBeInTheDocument();
  });

  it("hides the 'Target keyword:' line when an idea has no target keyword", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          ideas: [
            {
              id: "idea-1",
              title: "Idea no kw",
              status: "approved",
              targetKeyword: null,
              executiveSummary: null,
              createdAt: NOW,
            },
          ],
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Idea no kw")).toBeInTheDocument();
    expect(screen.queryByText(/Target keyword:/i)).not.toBeInTheDocument();
  });

  it("hides the ideas section when there are no ideas", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({ ideas: [] })}
        isLoading={false}
        error={null}
      />,
    );
    expect(
      screen.queryByRole("list", { name: /Ideas referenced by this run/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the raw input + output sections (collapsed by default)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            input: { triggerSource: "cron", custom: 1 },
            output: { reason: "ok" },
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId("raw-input")).toBeInTheDocument();
    expect(screen.getByTestId("raw-output")).toBeInTheDocument();
    // The pre is hidden until the user opens the details; <pre> is
    // not rendered before open.
    expect(screen.queryByText(/"custom": 1/)).not.toBeInTheDocument();
  });

  it("opens the raw section and renders formatted JSON when expanded", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            input: { triggerSource: "cron", custom: 1 },
            output: null,
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    const details = screen.getByTestId("raw-input") as HTMLDetailsElement;
    // jsdom doesn't dispatch toggle on .open assignment; do both.
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(screen.getByText(/"custom": 1/)).toBeInTheDocument();
  });

  it("hides a raw section when its payload is null/empty", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({ input: null, output: null }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryByTestId("raw-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("raw-output")).not.toBeInTheDocument();
  });

  it("treats array input/output as null (defensive — runs always store objects)", () => {
    render(
      <AutopilotRunDetailDrawer
        open
        onClose={vi.fn()}
        detail={makeDetail({
          run: makeRun({
            input: ["bad", "shape"],
            output: ["also", "bad"],
          }),
        })}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryByTestId("raw-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("raw-output")).not.toBeInTheDocument();
  });
});
