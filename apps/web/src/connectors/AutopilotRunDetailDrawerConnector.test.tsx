import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("@/hooks/useAutopilotRunDetail", () => ({
  useAutopilotRunDetail: vi.fn(),
}));
vi.mock("@/actions/articles", () => ({
  retryAutopilotWordPressDraftSend: vi.fn(),
}));

import { useAutopilotRunDetail } from "@/hooks/useAutopilotRunDetail";
import { retryAutopilotWordPressDraftSend } from "@/actions/articles";
import { AutopilotRunDetailDrawerConnector } from "./AutopilotRunDetailDrawerConnector";

const mockedHook = vi.mocked(useAutopilotRunDetail);
const mockedRetry = vi.mocked(retryAutopilotWordPressDraftSend);

// Shared `refetch` mock so existing tests can spread a known
// shape into the hook stub and the retry tests can assert
// invocations.
const refetch = vi.fn();

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("AutopilotRunDetailDrawerConnector", () => {
  it("forwards runId / teamId / projectId / blogId to the hook", () => {
    mockedHook.mockReturnValue({
      detail: null,
      isLoading: false,
      error: null,
      refetch,
    });
    render(
      <AutopilotRunDetailDrawerConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        runId="run-1"
        onClose={vi.fn()}
      />,
    );
    expect(mockedHook).toHaveBeenCalledWith({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      runId: "run-1",
    });
  });

  it("renders the drawer in loading state when the hook is loading", () => {
    mockedHook.mockReturnValue({
      detail: null,
      isLoading: true,
      error: null,
      refetch,
    });
    render(
      <AutopilotRunDetailDrawerConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        runId="run-1"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("autopilot-detail-loading")).toBeInTheDocument();
  });

  it("renders the drawer's error state when the hook surfaces an error", () => {
    mockedHook.mockReturnValue({
      detail: null,
      isLoading: false,
      error: "Run not found.",
      refetch,
    });
    render(
      <AutopilotRunDetailDrawerConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        runId="run-1"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Run not found.");
  });

  it("forwards postsHref + automationSettingsHref to the drawer", () => {
    mockedHook.mockReturnValue({
      detail: {
        run: {
          id: "run-1",
          status: "failed",
          trigger_source: "cron",
          current_step: null,
          error_message: null,
          input: null,
          output: { autopilotPaused: true },
          ideas_generated: 0,
          articles_started: 0,
          articles_completed: 0,
          articles_failed: 0,
          tokens_spent: 0,
          tokens_refunded: 0,
          created_at: "2026-05-11T08:00:00Z",
          completed_at: "2026-05-11T08:00:01Z",
          team_id: "t1",
          project_id: "p1",
          blog_id: "b1",
          triggered_by_user_id: null,
          scheduled_for: null,
          started_at: null,
          updated_at: "2026-05-11T08:00:01Z",
        } as never,
        jobs: [],
        articles: [],
        ideas: [],
      },
      isLoading: false,
      error: null,
      refetch,
    });

    render(
      <AutopilotRunDetailDrawerConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        runId="run-1"
        onClose={vi.fn()}
        postsHref="/posts"
        automationSettingsHref="/auto"
      />,
    );

    // Auto-paused warning links to the forwarded automationSettingsHref.
    const link = screen.getByRole("link", { name: /Automation tab/i });
    expect(link).toHaveAttribute("href", "/auto");
  });

  it("opens the drawer iff runId !== null", () => {
    mockedHook.mockReturnValue({
      detail: null,
      isLoading: false,
      error: null,
      refetch,
    });
    const { rerender } = render(
      <AutopilotRunDetailDrawerConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        runId={null}
        onClose={vi.fn()}
      />,
    );
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();

    rerender(
      <AutopilotRunDetailDrawerConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        runId="run-1"
        onClose={vi.fn()}
      />,
    );
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // WordPress draft retry flow (v12)
  // -------------------------------------------------------------------------
  describe("retry WordPress draft", () => {
    /**
     * Hook stub with a single failed-WP job so the drawer
     * actually renders a clickable retry button. Reused across
     * the retry-flow tests below.
     */
    function failedJobDetail() {
      return {
        detail: {
          run: {
            id: "run-1",
            status: "completed",
            trigger_source: "cron",
            current_step: "completed",
            error_message: null,
            input: { autopilotRunId: "run-1" },
            output: {},
            ideas_generated: 1,
            articles_started: 1,
            articles_completed: 1,
            articles_failed: 0,
            tokens_spent: 0,
            tokens_refunded: 0,
            wp_drafts_expected: 1,
            wp_drafts_created: 0,
            wp_drafts_already_sent: 0,
            wp_drafts_skipped: 0,
            wp_drafts_failed: 1,
            created_at: "2026-05-11T08:00:00Z",
            completed_at: "2026-05-11T08:00:01Z",
            team_id: "t1",
            project_id: "p1",
            blog_id: "b1",
            triggered_by_user_id: null,
            scheduled_for: null,
            started_at: null,
            updated_at: "2026-05-11T08:00:01Z",
          },
          jobs: [
            {
              id: "job-1",
              type: "generate_article",
              status: "completed",
              currentStep: "completed",
              errorMessage: null,
              input: { autopilotRunId: "run-1" },
              output: {
                wpPublish: { status: "failed", warning: "old failure" },
              },
              articleId: "art-1",
              articleIdeaId: "idea-1",
              createdAt: "2026-05-11T08:00:00Z",
              startedAt: "2026-05-11T08:00:00Z",
              completedAt: "2026-05-11T08:00:01Z",
            },
          ],
          articles: [
            {
              id: "art-1",
              title: "Article",
              slug: "article",
              status: "ready_for_review",
              wordCount: 100,
              targetKeyword: "kw",
              createdAt: "2026-05-11T08:00:00Z",
              updatedAt: "2026-05-11T08:00:00Z",
            },
          ],
          ideas: [],
        },
        isLoading: false,
        error: null,
        refetch,
      };
    }

    it("calls retryAutopilotWordPressDraftSend with the right ids when the retry button is clicked", async () => {
      mockedHook.mockReturnValue(failedJobDetail() as never);
      mockedRetry.mockResolvedValue({
        data: { jobId: "job-1", wpPublish: { status: "draft_created" } },
        error: null,
      } as never);

      render(
        <AutopilotRunDetailDrawerConnector
          teamId="t1"
          projectId="p1"
          blogId="b1"
          runId="run-1"
          onClose={vi.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("autopilot-job-job-1-wp-retry"));
      });

      expect(mockedRetry).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "run-1",
        "job-1",
      );
    });

    it("refetches the drawer's detail on success", async () => {
      mockedHook.mockReturnValue(failedJobDetail() as never);
      mockedRetry.mockResolvedValue({
        data: { jobId: "job-1", wpPublish: { status: "draft_created" } },
        error: null,
      } as never);

      render(
        <AutopilotRunDetailDrawerConnector
          teamId="t1"
          projectId="p1"
          blogId="b1"
          runId="run-1"
          onClose={vi.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("autopilot-job-job-1-wp-retry"));
      });

      await waitFor(() => expect(refetch).toHaveBeenCalled());
    });

    it("surfaces the action's error string as a per-row alert when retry fails", async () => {
      mockedHook.mockReturnValue(failedJobDetail() as never);
      mockedRetry.mockResolvedValue({
        data: null,
        error: "Connect WordPress before retrying the draft send.",
      } as never);

      render(
        <AutopilotRunDetailDrawerConnector
          teamId="t1"
          projectId="p1"
          blogId="b1"
          runId="run-1"
          onClose={vi.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("autopilot-job-job-1-wp-retry"));
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("autopilot-job-job-1-wp-retry-error"),
        ).toHaveTextContent("Connect WordPress before retrying");
      });
      // Refetch should NOT fire on failure — the detail is
      // unchanged on the server.
      expect(refetch).not.toHaveBeenCalled();
    });

    it("flips the button to its 'Retrying…' state synchronously after click", async () => {
      mockedHook.mockReturnValue(failedJobDetail() as never);
      let resolveRetry: (v: unknown) => void = () => {};
      mockedRetry.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveRetry = res as never;
          }),
      );

      render(
        <AutopilotRunDetailDrawerConnector
          teamId="t1"
          projectId="p1"
          blogId="b1"
          runId="run-1"
          onClose={vi.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("autopilot-job-job-1-wp-retry"));
      });

      expect(
        screen.getByTestId("autopilot-job-job-1-wp-retry"),
      ).toHaveTextContent("Retrying…");

      // Drain so RTL cleanup doesn't warn.
      await act(async () => {
        resolveRetry({
          data: { jobId: "job-1", wpPublish: { status: "draft_created" } },
          error: null,
        });
      });
    });

    it("clears a stale per-row error on the next click before the new attempt resolves", async () => {
      mockedHook.mockReturnValue(failedJobDetail() as never);
      // First attempt: fails.
      mockedRetry.mockResolvedValueOnce({
        data: null,
        error: "boom",
      } as never);

      render(
        <AutopilotRunDetailDrawerConnector
          teamId="t1"
          projectId="p1"
          blogId="b1"
          runId="run-1"
          onClose={vi.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("autopilot-job-job-1-wp-retry"));
      });
      await waitFor(() =>
        expect(
          screen.getByTestId("autopilot-job-job-1-wp-retry-error"),
        ).toBeInTheDocument(),
      );

      // Second attempt: takes a beat — we assert the error is
      // cleared synchronously before it resolves.
      let resolveSecond: (v: unknown) => void = () => {};
      mockedRetry.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveSecond = res as never;
          }),
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("autopilot-job-job-1-wp-retry"));
      });

      expect(
        screen.queryByTestId("autopilot-job-job-1-wp-retry-error"),
      ).not.toBeInTheDocument();

      await act(async () => {
        resolveSecond({
          data: { jobId: "job-1", wpPublish: { status: "draft_created" } },
          error: null,
        });
      });
    });

    it("ignores a second click on a row whose retry is already in flight (defensive)", async () => {
      mockedHook.mockReturnValue(failedJobDetail() as never);
      let resolveRetry: (v: unknown) => void = () => {};
      mockedRetry.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveRetry = res as never;
          }),
      );

      render(
        <AutopilotRunDetailDrawerConnector
          teamId="t1"
          projectId="p1"
          blogId="b1"
          runId="run-1"
          onClose={vi.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("autopilot-job-job-1-wp-retry"));
      });
      // Click again while in flight — the button is disabled by
      // the drawer, but the connector also guards.
      await act(async () => {
        fireEvent.click(screen.getByTestId("autopilot-job-job-1-wp-retry"));
      });

      expect(mockedRetry).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveRetry({
          data: { jobId: "job-1", wpPublish: { status: "draft_created" } },
          error: null,
        });
      });
    });
  });
});
