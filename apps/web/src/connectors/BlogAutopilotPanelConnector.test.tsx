import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useRunAutopilotNow", () => ({
  useRunAutopilotNow: vi.fn(),
}));

import { useRunAutopilotNow } from "@/hooks/useRunAutopilotNow";
import { BlogAutopilotPanelConnector } from "./BlogAutopilotPanelConnector";

const mockedHook = vi.mocked(useRunAutopilotNow);

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
    expect(screen.getByRole("note")).toHaveTextContent(/autopilot is disabled/i);
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
});
