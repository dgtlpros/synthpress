import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ActiveArticleJobRow } from "@/lib/active-jobs";
import { ActiveJobsTray } from "./ActiveJobsTray";

afterEach(cleanup);

function makeJob(
  overrides: Partial<ActiveArticleJobRow> = {},
): ActiveArticleJobRow {
  return {
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
    blog: { id: "b1", name: "Indie Stories", projectId: "p1", teamId: "t1" },
    article: null,
    ...overrides,
  };
}

describe("ActiveJobsTray", () => {
  it("renders nothing when there are no jobs (quiet pages stay quiet)", () => {
    const { container } = render(
      <ActiveJobsTray jobs={[]} activeCount={0} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the collapsed pill by default with the active-count copy", () => {
    render(
      <ActiveJobsTray
        jobs={[makeJob()]}
        activeCount={1}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /1 task running/i }),
    ).toBeInTheDocument();
  });

  it("pluralizes the running label", () => {
    render(
      <ActiveJobsTray
        jobs={[makeJob({ id: "a" }), makeJob({ id: "b" })]}
        activeCount={2}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /2 tasks running/i }),
    ).toBeInTheDocument();
  });

  it("falls back to 'updates' copy when only finished jobs are present", () => {
    render(
      <ActiveJobsTray
        jobs={[
          makeJob({
            id: "x",
            status: "completed",
            currentStep: "completed",
            completedAt: "2026-05-11T00:01:00Z",
          }),
        ]}
        activeCount={0}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /1 update$/i }),
    ).toBeInTheDocument();
  });

  it("pluralizes the updates copy", () => {
    render(
      <ActiveJobsTray
        jobs={[
          makeJob({ id: "x", status: "completed", currentStep: "completed" }),
          makeJob({ id: "y", status: "completed", currentStep: "completed" }),
        ]}
        activeCount={0}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /2 updates/i }),
    ).toBeInTheDocument();
  });

  it("expands into the panel and lists the jobs when the pill is clicked", () => {
    render(
      <ActiveJobsTray
        jobs={[
          makeJob({ id: "a" }),
          makeJob({
            id: "b",
            status: "completed",
            currentStep: "completed",
            article: { id: "art-b", title: "Done", status: "ready_for_review" },
          }),
        ]}
        activeCount={1}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /1 task running/i }));

    const dialog = screen.getByRole("dialog", { name: /background tasks/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Writing article…")).toBeInTheDocument();
    expect(screen.getByText("Article ready for review")).toBeInTheDocument();
    // Subtitle reflects both buckets.
    expect(screen.getByText("1 running · 1 finished")).toBeInTheDocument();
  });

  it("collapses back when the header collapse button is clicked", () => {
    render(
      <ActiveJobsTray
        jobs={[makeJob()]}
        activeCount={1}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 task running/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /collapse background tasks/i }),
    );
    expect(
      screen.queryByRole("dialog", { name: /background tasks/i }),
    ).not.toBeInTheDocument();
  });

  it("shows only the running half of the subtitle when nothing is finished yet", () => {
    render(
      <ActiveJobsTray
        jobs={[makeJob()]}
        activeCount={1}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 task running/i }));
    expect(screen.getByText("1 running")).toBeInTheDocument();
  });

  it("shows only the finished half of the subtitle when there's no live work", () => {
    render(
      <ActiveJobsTray
        jobs={[
          makeJob({
            id: "x",
            status: "completed",
            currentStep: "completed",
          }),
        ]}
        activeCount={0}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 update/i }));
    expect(screen.getByText("1 finished")).toBeInTheDocument();
  });

  it("uses plural copy in the panel subtitle when there are multiple of each", () => {
    render(
      <ActiveJobsTray
        jobs={[
          makeJob({ id: "a" }),
          makeJob({ id: "b" }),
          makeJob({
            id: "c",
            status: "completed",
            currentStep: "completed",
            completedAt: "2026-05-11T00:01:00Z",
          }),
          makeJob({
            id: "d",
            status: "failed",
            currentStep: "writing_article",
            completedAt: "2026-05-11T00:01:00Z",
          }),
        ]}
        activeCount={2}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /2 tasks running/i }));
    expect(screen.getByText("2 running · 2 finished")).toBeInTheDocument();
  });

  it("forwards onDismiss(jobId) from row clicks", () => {
    const onDismiss = vi.fn();
    render(
      <ActiveJobsTray
        jobs={[
          makeJob({
            id: "finished-1",
            status: "completed",
            currentStep: "completed",
            article: {
              id: "article-1",
              title: "Done",
              status: "ready_for_review",
            },
          }),
        ]}
        activeCount={0}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 update/i }));
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith("finished-1");
  });

  describe("multiple concurrent jobs", () => {
    it("renders one row per active job with INDEPENDENT progress bars + percentages", () => {
      render(
        <ActiveJobsTray
          jobs={[
            // Three concurrent generate_article jobs, each at a different step.
            makeJob({
              id: "a",
              currentStep: "loading_context",
              article: { id: "art-a", title: "Alpha post", status: "generating" },
            }),
            makeJob({
              id: "b",
              currentStep: "writing_article",
              article: { id: "art-b", title: "Beta post", status: "generating" },
            }),
            makeJob({
              id: "c",
              currentStep: "saving_article",
              article: { id: "art-c", title: "Gamma post", status: "generating" },
            }),
          ]}
          activeCount={3}
          onDismiss={vi.fn()}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /3 tasks running/i }),
      );

      // Three rows, three progress bars, each with its OWN aria-valuenow.
      const bars = screen.getAllByRole("progressbar");
      expect(bars).toHaveLength(3);
      expect(bars.map((b) => b.getAttribute("aria-valuenow"))).toEqual([
        "15",
        "45",
        "75",
      ]);

      // Three labels, each unique to that step.
      expect(screen.getByText("Preparing article…")).toBeInTheDocument();
      expect(screen.getByText("Writing article…")).toBeInTheDocument();
      expect(screen.getByText("Saving draft…")).toBeInTheDocument();
      expect(screen.getByText("15%")).toBeInTheDocument();
      expect(screen.getByText("45%")).toBeInTheDocument();
      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("renders active + recent finished jobs side by side, with progress bars only on the active rows", () => {
      render(
        <ActiveJobsTray
          jobs={[
            makeJob({
              id: "a",
              currentStep: "writing_article",
              article: { id: "art-a", title: "Alpha post", status: "generating" },
            }),
            makeJob({
              id: "b",
              status: "completed",
              currentStep: "completed",
              completedAt: "2026-05-11T00:01:00Z",
              article: {
                id: "art-b",
                title: "Beta post",
                status: "ready_for_review",
              },
            }),
            makeJob({
              id: "c",
              status: "failed",
              currentStep: "writing_article",
              errorMessage: "schema mismatch",
              completedAt: "2026-05-11T00:01:00Z",
              output: { refunded: true, refundedCredits: 5 },
            }),
          ]}
          activeCount={1}
          onDismiss={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /1 task running/i }));

      // Only the active row gets a progress bar.
      expect(screen.getAllByRole("progressbar")).toHaveLength(1);
      expect(screen.getByText("Article ready for review")).toBeInTheDocument();
      expect(
        screen.getByText("Generation failed · Refunded"),
      ).toBeInTheDocument();
    });

    it("caps the panel height and lets the row list scroll when there are many jobs", () => {
      const jobs = Array.from({ length: 20 }, (_, i) =>
        makeJob({
          id: `j-${i}`,
          currentStep: "writing_article",
          article: {
            id: `art-${i}`,
            title: `Post ${i}`,
            status: "generating",
          },
        }),
      );
      render(
        <ActiveJobsTray jobs={jobs} activeCount={20} onDismiss={vi.fn()} />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /20 tasks running/i }),
      );

      const list = screen.getByRole("list", { name: /background task list/i });
      // The list itself is the scroll container.
      expect(list.className).toContain("overflow-y-auto");
      // Panel container has a max-height so it can't blow past the
      // viewport.
      const dialog = screen.getByRole("dialog", { name: /background tasks/i });
      expect(dialog.className).toMatch(/max-h-\[\d+vh\]/);
      // All 20 rows render — confirms we don't silently drop any.
      expect(screen.getAllByRole("progressbar")).toHaveLength(20);
    });
  });
});
