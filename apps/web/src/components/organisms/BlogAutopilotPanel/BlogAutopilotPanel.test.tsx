import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AutopilotRunRowData } from "@/components/molecules/AutopilotRunRow";
import { BlogAutopilotPanel } from "./BlogAutopilotPanel";

function makeRun(
  overrides: Partial<AutopilotRunRowData> = {},
): AutopilotRunRowData {
  return {
    id: "run-1",
    status: "completed",
    triggerSource: "cron",
    currentStep: "completed",
    errorMessage: null,
    output: { reason: "ok" },
    ideasGenerated: 0,
    articlesStarted: 1,
    articlesCompleted: 0,
    articlesFailed: 0,
    tokensSpent: 5,
    tokensRefunded: 0,
    createdAt: new Date("2026-05-11T08:00:00Z").toISOString(),
    startedAt: new Date("2026-05-11T08:00:01Z").toISOString(),
    completedAt: new Date("2026-05-11T08:01:00Z").toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-11T08:30:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BlogAutopilotPanel", () => {
  it("renders the run-now button when autopilot is enabled", () => {
    render(
      <BlogAutopilotPanel
        blogName="Indie Stories"
        autopilotEnabled
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /run autopilot now/i }),
    ).not.toBeDisabled();
    // Helper text is hidden when autopilot is enabled.
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("disables the button + shows the helper text when autopilot is disabled", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /run autopilot now/i }),
    ).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(/autopilot is disabled/i);
  });

  it("links the helper text to the Automation tab when an href is provided", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        automationSettingsHref="/teams/t1/projects/p1/blogs/b1/settings#automation"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /automation tab/i }),
    ).toHaveAttribute(
      "href",
      "/teams/t1/projects/p1/blogs/b1/settings#automation",
    );
  });

  it("renders a static span for the Automation tab when no href is provided", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /automation tab/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Automation tab/)).toBeInTheDocument();
  });

  it("disables the button when no onRunNow handler is provided", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /run autopilot now/i }),
    ).toBeDisabled();
  });

  it("fires onRunNow when the button is clicked", () => {
    const onRunNow = vi.fn();
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
        onRunNow={onRunNow}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /run autopilot now/i }),
    );
    expect(onRunNow).toHaveBeenCalledOnce();
  });

  it("disables the button + shows loading state when isRunning=true", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
        onRunNow={vi.fn()}
        isRunning
      />,
    );
    const btn = screen.getByRole("button", { name: /run autopilot now/i });
    expect(btn).toBeDisabled();
  });

  it("renders a success result message with role=status", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
        onRunNow={vi.fn()}
        resultMessage={{
          kind: "success",
          message: "Started 2 article jobs.",
        }}
      />,
    );
    const status = screen.getByText("Started 2 article jobs.");
    expect(status).toHaveAttribute("role", "status");
  });

  it("renders an error result message with role=alert", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
        onRunNow={vi.fn()}
        resultMessage={{
          kind: "error",
          message: "Something went wrong.",
        }}
      />,
    );
    const alert = screen.getByText("Something went wrong.");
    expect(alert).toHaveAttribute("role", "alert");
  });

  it("renders a friendly empty state when there are no recent runs", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(screen.getByText(/no autopilot runs yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: /recent autopilot runs/i }),
    ).not.toBeInTheDocument();
  });

  // ── Auto-pause warning ──────────────────────────────────────────────────
  it("renders the failure-rate warning instead of the gray disabled note", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={new Date("2026-05-11T08:25:00Z").toISOString()}
        pausedMessage="Autopilot was paused because multiple recent runs failed."
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );

    const warning = screen.getByTestId("autopilot-paused-warning");
    expect(warning).toHaveAttribute("role", "alert");
    expect(warning).toHaveTextContent(/multiple recent runs failed/i);
    expect(warning).toHaveTextContent(/paused 5m ago/i);
    // The gray disabled note should NOT also render — the warning
    // replaces it so the user only sees one explanation.
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("falls through to the gray disabled note when no pausedReason is set", () => {
    // User-toggled disable (no scheduler pause) → existing gray note.
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason={null}
        pausedAt={null}
        pausedMessage={null}
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-paused-warning"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/autopilot is disabled/i);
  });

  it("does NOT render the warning when autopilot is enabled (defensive: stale paused metadata)", () => {
    // After the user re-enables autopilot the action wipes the paused
    // metadata, but if it lingers in the page tree for a tick this
    // panel still hides the warning so the user sees the armed state.
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled
        pausedReason="failure_rate"
        pausedAt={new Date().toISOString()}
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("autopilot-paused-warning"),
    ).not.toBeInTheDocument();
  });

  it("links the warning's Automation tab when an href is provided", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={new Date("2026-05-11T08:00:00Z").toISOString()}
        pausedMessage="Autopilot was paused."
        automationSettingsHref="/settings#automation"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /automation tab/i }),
    ).toHaveAttribute("href", "/settings#automation");
  });

  it("renders the warning's Automation tab as a static span when no href is provided", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={new Date().toISOString()}
        pausedMessage="m"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /automation tab/i }),
    ).not.toBeInTheDocument();
    const warning = screen.getByTestId("autopilot-paused-warning");
    expect(warning).toHaveTextContent(/Automation tab/);
  });

  it("falls back to a generic message when pausedMessage is null", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={new Date().toISOString()}
        pausedMessage={null}
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    const warning = screen.getByTestId("autopilot-paused-warning");
    expect(warning).toHaveTextContent(
      /Review recent runs, then re-enable autopilot/i,
    );
  });

  it("hides the 'Paused …' timestamp line when pausedAt is null", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={null}
        pausedMessage="m"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    const warning = screen.getByTestId("autopilot-paused-warning");
    expect(warning).not.toHaveTextContent(/Paused\s+\d/);
  });

  it("renders 'just now' / 'h ago' / 'd ago' / locale-date variants of pausedAt", () => {
    // 30 seconds ago → "just now"
    const { unmount: u1 } = render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={new Date("2026-05-11T08:29:30Z").toISOString()}
        pausedMessage="m"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("autopilot-paused-warning"),
    ).toHaveTextContent(/Paused just now/i);
    u1();

    // 90 minutes ago → "1h ago"
    const { unmount: u2 } = render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={new Date("2026-05-11T07:00:00Z").toISOString()}
        pausedMessage="m"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("autopilot-paused-warning"),
    ).toHaveTextContent(/Paused 1h ago/i);
    u2();

    // 3 days ago → "3d ago"
    const { unmount: u3 } = render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={new Date("2026-05-08T08:30:00Z").toISOString()}
        pausedMessage="m"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("autopilot-paused-warning"),
    ).toHaveTextContent(/Paused 3d ago/i);
    u3();

    // 30 days ago → falls through to locale date (any non-relative form)
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt={new Date("2026-04-11T08:30:00Z").toISOString()}
        pausedMessage="m"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    // Should NOT contain any of the relative forms.
    const warning = screen.getByTestId("autopilot-paused-warning");
    expect(warning).not.toHaveTextContent(/just now|m ago|h ago|d ago/);
    expect(warning).toHaveTextContent(/Paused\s+\S+/);
  });

  it("ignores invalid pausedAt strings without crashing", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled={false}
        pausedReason="failure_rate"
        pausedAt="not-a-date"
        pausedMessage="m"
        recentRuns={[]}
        onRunNow={vi.fn()}
      />,
    );
    // Empty string → no "Paused …" sentence rendered.
    expect(
      screen.getByTestId("autopilot-paused-warning"),
    ).not.toHaveTextContent(/Paused\s+\w/);
  });

  it("renders a row per recent run inside a labeled list", () => {
    render(
      <BlogAutopilotPanel
        blogName="x"
        autopilotEnabled
        recentRuns={[
          makeRun({ id: "r1", status: "completed" }),
          makeRun({ id: "r2", status: "skipped" }),
          makeRun({ id: "r3", status: "failed", errorMessage: "boom" }),
        ]}
        onRunNow={vi.fn()}
      />,
    );
    const list = screen.getByRole("list", { name: /recent autopilot runs/i });
    expect(list.querySelectorAll("li").length).toBe(3);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
