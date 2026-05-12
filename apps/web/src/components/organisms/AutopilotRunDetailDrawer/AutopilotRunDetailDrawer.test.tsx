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

  it("renders the reason from output when there's no error_message", () => {
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
    expect(screen.getByText("daily_article_cap_reached")).toBeInTheDocument();
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
