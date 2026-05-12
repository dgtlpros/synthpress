import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AutopilotRunRow, type AutopilotRunRowData } from "./AutopilotRunRow";

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

describe("AutopilotRunRow", () => {
  it("renders the status badge + trigger source + relative time", () => {
    render(<AutopilotRunRow run={makeRun()} />);
    // "Completed" appears twice — once as the status badge, once as
    // the current_step label. Both are correct.
    expect(screen.getAllByText("Completed").length).toBe(2);
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("29m ago")).toBeInTheDocument();
  });

  it("formats the manual trigger source as 'Manual'", () => {
    render(<AutopilotRunRow run={makeRun({ triggerSource: "manual" })} />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("forwards an unknown trigger source as-is (forward-compat)", () => {
    render(
      <AutopilotRunRow
        run={makeRun({ triggerSource: "future_source" as never })}
      />,
    );
    expect(screen.getByText("future_source")).toBeInTheDocument();
  });

  it("formats the current step in friendly text", () => {
    render(
      <AutopilotRunRow run={makeRun({ currentStep: "generating_articles" })} />,
    );
    expect(screen.getByText(/Generating articles/)).toBeInTheDocument();
  });

  it("falls back to the raw current step when not in the known set", () => {
    render(<AutopilotRunRow run={makeRun({ currentStep: "doing_voodoo" })} />);
    expect(screen.getByText(/doing_voodoo/)).toBeInTheDocument();
  });

  it("hides the step row when current_step is null", () => {
    render(<AutopilotRunRow run={makeRun({ currentStep: null })} />);
    expect(screen.queryByText(/Step:/)).not.toBeInTheDocument();
  });

  it("renders 'just now' for recent runs", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          createdAt: new Date("2026-05-11T08:29:35Z").toISOString(),
          completedAt: null,
        })}
      />,
    );
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("renders the counter line when there are non-zero counters", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          ideasGenerated: 10,
          articlesStarted: 3,
          articlesCompleted: 2,
          articlesFailed: 1,
          tokensSpent: 25,
          tokensRefunded: 5,
        })}
      />,
    );
    expect(screen.getByText(/10 ideas generated/)).toBeInTheDocument();
    expect(screen.getByText(/3 article jobs started/)).toBeInTheDocument();
    expect(screen.getByText(/2 completed/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
    expect(screen.getByText(/25 tokens spent/)).toBeInTheDocument();
    expect(screen.getByText(/5 refunded/)).toBeInTheDocument();
  });

  it("hides the counter line entirely when every counter is zero", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          status: "skipped",
          ideasGenerated: 0,
          articlesStarted: 0,
          articlesCompleted: 0,
          articlesFailed: 0,
          tokensSpent: 0,
          tokensRefunded: 0,
        })}
      />,
    );
    expect(
      screen.queryByText(/articles? jobs? started/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens spent/)).not.toBeInTheDocument();
  });

  it("renders the error message for failed runs", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          status: "failed",
          errorMessage: "Claude returned 529 (overloaded)",
        })}
      />,
    );
    expect(
      screen.getByText("Claude returned 529 (overloaded)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders output.reason for skipped runs (when no error)", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          status: "skipped",
          articlesStarted: 0,
          tokensSpent: 0,
          output: { reason: "daily_article_cap_reached" },
        })}
      />,
    );
    expect(screen.getByText(/daily_article_cap_reached/)).toBeInTheDocument();
  });

  it("does not render the reason line when output.reason is missing", () => {
    render(
      <AutopilotRunRow
        run={makeRun({ output: {}, articlesStarted: 0, tokensSpent: 0 })}
      />,
    );
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
  });

  it("does not render the reason line when error_message is present (the alert wins)", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          status: "failed",
          errorMessage: "boom",
          output: { reason: "anything" },
          articlesStarted: 0,
          tokensSpent: 0,
        })}
      />,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
  });

  it("ignores non-string output.reason values", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          articlesStarted: 0,
          tokensSpent: 0,
          output: { reason: 42 } as never,
        })}
      />,
    );
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
  });

  it("ignores empty-string output.reason values", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          articlesStarted: 0,
          tokensSpent: 0,
          output: { reason: "" },
        })}
      />,
    );
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
  });

  it("renders a fallback 'N article jobs started' line when output has spawnedArticleJobIds but articlesStarted is 0", () => {
    // Defensive — covers the case where a future feature writes
    // spawnedArticleJobIds without bumping the counter.
    render(
      <AutopilotRunRow
        run={makeRun({
          articlesStarted: 0,
          tokensSpent: 0,
          output: { spawnedArticleJobIds: ["j1", "j2", "j3"] },
        })}
      />,
    );
    expect(screen.getByText("3 article jobs started")).toBeInTheDocument();
  });

  it("hides the fallback jobs line when articlesStarted already reflects the count", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          articlesStarted: 3,
          output: { spawnedArticleJobIds: ["j1", "j2", "j3"] },
        })}
      />,
    );
    // The "N article jobs started" string appears in the counter
    // line, but NOT in the fallback line below it.
    expect(screen.getAllByText(/article jobs started/)).toHaveLength(1);
  });

  it("ignores non-array output.spawnedArticleJobIds", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          articlesStarted: 0,
          tokensSpent: 0,
          output: { spawnedArticleJobIds: "not-an-array" } as never,
        })}
      />,
    );
    expect(screen.queryByText(/article jobs started/)).not.toBeInTheDocument();
  });

  it("uses createdAt for the time stamp when completedAt is null (still running)", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          status: "processing",
          createdAt: new Date("2026-05-11T08:25:00Z").toISOString(),
          completedAt: null,
        })}
      />,
    );
    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  it("treats a malformed timestamp as empty string", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          createdAt: "not-a-date",
          completedAt: null,
        })}
      />,
    );
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    expect(screen.queryByText(/just now/)).not.toBeInTheDocument();
  });

  it.each([
    [60 * 60 * 1000, /h ago$/],
    [3 * 24 * 60 * 60 * 1000, /d ago$/],
  ])("formats older runs (%i ms back) as %s", (ms, pattern) => {
    render(
      <AutopilotRunRow
        run={makeRun({
          createdAt: new Date(Date.now() - ms).toISOString(),
          completedAt: null,
        })}
      />,
    );
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  it("returns no time stamp when both completedAt and createdAt resolve to falsy/empty", () => {
    // The relativeTime() helper short-circuits on null. The row
    // always passes one of completedAt/createdAt, so this covers
    // the early return without faking the data shape too hard.
    render(
      <AutopilotRunRow
        run={makeRun({
          createdAt: "",
          completedAt: null,
        })}
      />,
    );
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });

  it("renders the counter line when only ideasGenerated is non-zero (other counters all 0)", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          ideasGenerated: 7,
          articlesStarted: 0,
          articlesCompleted: 0,
          articlesFailed: 0,
          tokensSpent: 0,
          tokensRefunded: 0,
        })}
      />,
    );
    expect(screen.getByText(/7 ideas generated/)).toBeInTheDocument();
    expect(screen.queryByText(/article jobs started/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens spent/)).not.toBeInTheDocument();
  });

  it("renders the counter line when only tokensRefunded is non-zero", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          ideasGenerated: 0,
          articlesStarted: 0,
          articlesCompleted: 0,
          articlesFailed: 0,
          tokensSpent: 0,
          tokensRefunded: 5,
        })}
      />,
    );
    expect(screen.getByText(/5 refunded/)).toBeInTheDocument();
  });

  it("treats output=null the same as 'no output' when computing reason / spawnedJobsCount", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          output: null,
          articlesStarted: 0,
          tokensSpent: 0,
        })}
      />,
    );
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/article jobs started/)).not.toBeInTheDocument();
  });

  it("falls back to the locale date for very old runs (> 14d)", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          createdAt: new Date("2026-04-01T08:00:00Z").toISOString(),
          completedAt: null,
        })}
      />,
    );
    expect(
      screen.getByText(new Date("2026-04-01T08:00:00Z").toLocaleDateString()),
    ).toBeInTheDocument();
  });

  // ── Auto-approve counter ────────────────────────────────────────────────
  it("renders 'N auto-approved' when output.ideasAutoApproved > 0", () => {
    render(
      <AutopilotRunRow
        run={makeRun({
          ideasGenerated: 5,
          articlesStarted: 3,
          output: {
            reason: "ok",
            ideasAutoApproved: 5,
            requireReview: false,
          },
        })}
      />,
    );
    expect(screen.getByText("5 auto-approved")).toBeInTheDocument();
  });

  it("does NOT render 'auto-approved' when ideasAutoApproved is 0 or missing", () => {
    // Default `output: { reason: "ok" }` from makeRun → no
    // ideasAutoApproved field.
    render(<AutopilotRunRow run={makeRun({ articlesStarted: 1 })} />);
    expect(screen.queryByText(/auto-approved/i)).not.toBeInTheDocument();
  });

  it("ignores non-numeric / negative ideasAutoApproved (defensive: corrupt jsonb)", () => {
    // Two scenarios in one test — both should hide the chip.
    const { unmount } = render(
      <AutopilotRunRow
        run={makeRun({
          articlesStarted: 1,
          output: { ideasAutoApproved: "lots" as unknown as number },
        })}
      />,
    );
    expect(screen.queryByText(/auto-approved/i)).not.toBeInTheDocument();
    unmount();

    render(
      <AutopilotRunRow
        run={makeRun({
          articlesStarted: 1,
          output: { ideasAutoApproved: -3 },
        })}
      />,
    );
    expect(screen.queryByText(/auto-approved/i)).not.toBeInTheDocument();
  });

  it("shows the counter line when ideasAutoApproved > 0 even if everything else is zero", () => {
    // Edge case: idea-gen happened on a previous tick (so this run
    // didn't generate anything new) but auto-approve still cleaned
    // up a stale `generated` row. The counter line should still
    // render so the operator can see the activity.
    render(
      <AutopilotRunRow
        run={makeRun({
          ideasGenerated: 0,
          articlesStarted: 0,
          articlesCompleted: 0,
          articlesFailed: 0,
          tokensSpent: 0,
          tokensRefunded: 0,
          output: { ideasAutoApproved: 1 },
        })}
      />,
    );
    expect(screen.getByText("1 auto-approved")).toBeInTheDocument();
  });

  // ── Clickability ────────────────────────────────────────────────────────
  it("wraps the row in a button when onSelect is provided", () => {
    render(
      <AutopilotRunRow run={makeRun({ id: "r-click" })} onSelect={vi.fn()} />,
    );
    const btn = screen.getByRole("button", {
      name: /View details for autopilot run r-click/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it("calls onSelect with the run id when the button is clicked", () => {
    const onSelect = vi.fn();
    render(
      <AutopilotRunRow run={makeRun({ id: "r-click" })} onSelect={onSelect} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /View details for autopilot run r-click/i,
      }),
    );
    expect(onSelect).toHaveBeenCalledWith("r-click");
  });

  it("does NOT render a button when onSelect is omitted", () => {
    render(<AutopilotRunRow run={makeRun()} />);
    expect(
      screen.queryByRole("button", {
        name: /View details for autopilot run/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("renders the failure message inside the button (no role=alert) when clickable", () => {
    // Putting role=alert inside a click target is a screen-reader
    // anti-pattern (auto-announce on render). The clickable variant
    // drops the role; the standalone variant keeps it.
    render(
      <AutopilotRunRow
        run={makeRun({ status: "failed", errorMessage: "boom" })}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
