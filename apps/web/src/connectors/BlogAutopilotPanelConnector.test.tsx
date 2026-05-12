import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useRunAutopilotNow", () => ({
  useRunAutopilotNow: vi.fn(),
}));

vi.mock("@/connectors/AutopilotRunDetailDrawerConnector", () => ({
  AutopilotRunDetailDrawerConnector: vi.fn(
    ({ runId, onClose }: { runId: string | null; onClose: () => void }) => (
      <div data-testid="drawer-connector" data-run-id={runId ?? ""}>
        <button type="button" onClick={onClose}>
          mock-close
        </button>
      </div>
    ),
  ),
}));

import { useRunAutopilotNow } from "@/hooks/useRunAutopilotNow";
import { BlogAutopilotPanelConnector } from "./BlogAutopilotPanelConnector";

const mockedHook = vi.mocked(useRunAutopilotNow);

beforeEach(() => {
  // Default hook stub for tests that don't override.
  mockedHook.mockReturnValue({
    run: vi.fn(),
    isRunning: false,
    resultMessage: null,
    lastResult: null,
    reset: vi.fn(),
  });
});

afterEach(cleanup);

describe("BlogAutopilotPanelConnector", () => {
  it("renders the panel with the hook's run handler + state", () => {
    const runMock = vi.fn();
    mockedHook.mockReturnValue({
      run: runMock,
      isRunning: false,
      resultMessage: null,
      lastResult: null,
      reset: vi.fn(),
    });

    render(
      <BlogAutopilotPanelConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Indie Stories"
        autopilotEnabled
        automationSettingsHref="/teams/t1/projects/p1/blogs/b1/settings#automation"
        recentRuns={[]}
      />,
    );

    const button = screen.getByRole("button", {
      name: /run autopilot now/i,
    });
    expect(button).not.toBeDisabled();
    button.click();
    expect(runMock).toHaveBeenCalledOnce();
  });

  it("forwards a success message from the hook to the panel (role=status)", () => {
    mockedHook.mockReturnValue({
      run: vi.fn(),
      isRunning: false,
      resultMessage: { kind: "success", message: "Started 1 article job." },
      lastResult: null,
      reset: vi.fn(),
    });

    render(
      <BlogAutopilotPanelConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
      />,
    );

    const node = screen.getByText("Started 1 article job.");
    expect(node).toHaveAttribute("role", "status");
  });

  it("forwards an error message from the hook to the panel (role=alert)", () => {
    mockedHook.mockReturnValue({
      run: vi.fn(),
      isRunning: false,
      resultMessage: { kind: "error", message: "Something went wrong." },
      lastResult: null,
      reset: vi.fn(),
    });

    render(
      <BlogAutopilotPanelConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
      />,
    );

    const node = screen.getByText("Something went wrong.");
    expect(node).toHaveAttribute("role", "alert");
  });

  it("renders the disabled state when autopilotEnabled=false (button gated by panel)", () => {
    mockedHook.mockReturnValue({
      run: vi.fn(),
      isRunning: false,
      resultMessage: null,
      lastResult: null,
      reset: vi.fn(),
    });

    render(
      <BlogAutopilotPanelConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="x"
        autopilotEnabled={false}
        recentRuns={[]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /run autopilot now/i }),
    ).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(
      /autopilot is disabled/i,
    );
  });

  it("forwards auto-pause metadata to the panel as a warning banner", () => {
    mockedHook.mockReturnValue({
      run: vi.fn(),
      isRunning: false,
      resultMessage: null,
      lastResult: null,
      reset: vi.fn(),
    });

    render(
      <BlogAutopilotPanelConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="x"
        autopilotEnabled={false}
        recentRuns={[]}
        pausedReason="failure_rate"
        pausedAt={new Date().toISOString()}
        pausedMessage="Autopilot was paused because multiple recent runs failed."
      />,
    );

    const warning = screen.getByTestId("autopilot-paused-warning");
    expect(warning).toHaveTextContent(/multiple recent runs failed/i);
  });

  // ── Drawer integration ────────────────────────────────────────────────────
  it("mounts the drawer connector with runId=null until a row is clicked", () => {
    render(
      <BlogAutopilotPanelConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="x"
        autopilotEnabled
        recentRuns={[]}
      />,
    );
    const drawer = screen.getByTestId("drawer-connector");
    expect(drawer.dataset.runId).toBe("");
  });

  it("opens the drawer with the clicked run's id", () => {
    render(
      <BlogAutopilotPanelConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="x"
        autopilotEnabled
        recentRuns={[
          {
            id: "r-clicked",
            status: "completed",
            triggerSource: "cron",
            currentStep: "completed",
            errorMessage: null,
            output: { reason: "ok" },
            ideasGenerated: 0,
            articlesStarted: 0,
            articlesCompleted: 0,
            articlesFailed: 0,
            tokensSpent: 0,
            tokensRefunded: 0,
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /View details for autopilot run r-clicked/i,
      }),
    );

    expect(screen.getByTestId("drawer-connector").dataset.runId).toBe(
      "r-clicked",
    );
  });

  it("clears the selected run when the drawer's onClose fires", () => {
    render(
      <BlogAutopilotPanelConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="x"
        autopilotEnabled
        recentRuns={[
          {
            id: "r-x",
            status: "completed",
            triggerSource: "cron",
            currentStep: null,
            errorMessage: null,
            output: null,
            ideasGenerated: 0,
            articlesStarted: 0,
            articlesCompleted: 0,
            articlesFailed: 0,
            tokensSpent: 0,
            tokensRefunded: 0,
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
          },
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /View details for autopilot run r-x/i,
      }),
    );
    expect(screen.getByTestId("drawer-connector").dataset.runId).toBe("r-x");

    fireEvent.click(screen.getByRole("button", { name: /mock-close/i }));
    expect(screen.getByTestId("drawer-connector").dataset.runId).toBe("");
  });
});
