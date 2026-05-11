import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ActiveArticleJobRow } from "@/services/article-generation-service";
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
});
