import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useAutopilotRunDetail", () => ({
  useAutopilotRunDetail: vi.fn(),
}));

import { useAutopilotRunDetail } from "@/hooks/useAutopilotRunDetail";
import { AutopilotRunDetailDrawerConnector } from "./AutopilotRunDetailDrawerConnector";

const mockedHook = vi.mocked(useAutopilotRunDetail);

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
    mockedHook.mockReturnValue({ detail: null, isLoading: false, error: null });
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
    mockedHook.mockReturnValue({ detail: null, isLoading: true, error: null });
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
    mockedHook.mockReturnValue({ detail: null, isLoading: false, error: null });
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
});
