import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useActiveTeamJobs", () => ({
  useActiveTeamJobs: vi.fn(),
}));

import { useActiveTeamJobs } from "@/hooks/useActiveTeamJobs";
import { ActiveJobsTrayConnector } from "./ActiveJobsTrayConnector";

const mockedHook = vi.mocked(useActiveTeamJobs);

afterEach(cleanup);

describe("ActiveJobsTrayConnector", () => {
  it("renders the tray with jobs from the hook", () => {
    mockedHook.mockReturnValue({
      jobs: [
        {
          id: "job-1",
          type: "generate_article",
          status: "processing",
          currentStep: "writing_article",
          errorMessage: null,
          output: null,
          createdAt: "2026-05-11T00:00:00Z",
          startedAt: "2026-05-11T00:00:01Z",
          completedAt: null,
          ideaId: "i1",
          blog: { id: "b1", name: "Blog", projectId: "p1", teamId: "t1" },
          article: null,
        },
      ],
      activeCount: 1,
      loading: false,
      error: null,
      dismiss: vi.fn(),
    });

    render(<ActiveJobsTrayConnector />);
    expect(
      screen.getByRole("button", { name: /1 task running/i }),
    ).toBeInTheDocument();
  });

  it("renders nothing when the hook returns no jobs", () => {
    mockedHook.mockReturnValue({
      jobs: [],
      activeCount: 0,
      loading: false,
      error: null,
      dismiss: vi.fn(),
    });
    const { container } = render(<ActiveJobsTrayConnector />);
    expect(container.firstChild).toBeNull();
  });
});
