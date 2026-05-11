import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ActiveArticleJobRow } from "@/services/article-generation-service";
import { ActiveJobRow } from "./ActiveJobRow";

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

describe("ActiveJobRow", () => {
  it("renders the active label + blog name + spinner for in-flight jobs", () => {
    render(<ActiveJobRow job={makeJob()} onDismiss={vi.fn()} />);

    expect(screen.getByText("Writing article…")).toBeInTheDocument();
    expect(screen.getByText("Indie Stories")).toBeInTheDocument();
    // Spinner is announced via role="status" / aria-label="Loading"
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    // Active jobs render an "Active" badge.
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("appends the article title to the subtitle when available", () => {
    render(
      <ActiveJobRow
        job={makeJob({
          article: {
            id: "article-1",
            title: "How to launch a B2B blog",
            status: "ready_for_review",
          },
        })}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Indie Stories · How to launch a B2B blog/),
    ).toBeInTheDocument();
  });

  it("shows a View article link with the right URL when the article is ready", () => {
    render(
      <ActiveJobRow
        job={makeJob({
          status: "completed",
          currentStep: "completed",
          completedAt: "2026-05-11T00:01:00Z",
          article: {
            id: "article-1",
            title: "Done",
            status: "ready_for_review",
          },
        })}
        onDismiss={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /view article/i });
    expect(link).toHaveAttribute(
      "href",
      "/teams/t1/projects/p1/blogs/b1/posts/article-1",
    );
  });

  it("hides the View article link when the article placeholder is still 'generating'", () => {
    render(
      <ActiveJobRow
        job={makeJob({
          article: {
            id: "article-1",
            title: "...",
            status: "generating",
          },
        })}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /view article/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the View article link for a failed article (so the salvaged body is reachable)", () => {
    render(
      <ActiveJobRow
        job={makeJob({
          status: "failed",
          currentStep: "writing_article",
          errorMessage: "schema mismatch",
          completedAt: "2026-05-11T00:01:00Z",
          article: {
            id: "article-1",
            title: "Half-baked",
            status: "failed",
          },
        })}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /view article/i }),
    ).toHaveAttribute("href", "/teams/t1/projects/p1/blogs/b1/posts/article-1");
  });

  it("renders the failed label + error detail + Failed badge", () => {
    render(
      <ActiveJobRow
        job={makeJob({
          status: "failed",
          currentStep: "writing_article",
          errorMessage: "model timeout",
          completedAt: "2026-05-11T00:01:00Z",
        })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Generation failed")).toBeInTheDocument();
    expect(screen.getByText("model timeout")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders the refunded badge when output.refunded is true", () => {
    render(
      <ActiveJobRow
        job={makeJob({
          status: "failed",
          currentStep: "writing_article",
          errorMessage: "model timeout",
          completedAt: "2026-05-11T00:01:00Z",
          output: { refunded: true, refundedCredits: 5 },
        })}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Generation failed · Refunded"),
    ).toBeInTheDocument();
    expect(screen.getByText("Refunded")).toBeInTheDocument();
  });

  it("fires onDismiss(jobId) when the Dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <ActiveJobRow
        job={makeJob({
          id: "job-X",
          status: "completed",
          currentStep: "completed",
          completedAt: "2026-05-11T00:01:00Z",
          article: {
            id: "article-1",
            title: "Done",
            status: "ready_for_review",
          },
        })}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith("job-X");
  });

  it("does not render a Dismiss button for active jobs (active jobs cannot be hidden)", () => {
    render(<ActiveJobRow job={makeJob()} onDismiss={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /dismiss/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the success badge for completed jobs", () => {
    render(
      <ActiveJobRow
        job={makeJob({
          status: "completed",
          currentStep: "completed",
          completedAt: "2026-05-11T00:01:00Z",
          article: {
            id: "article-1",
            title: "Done",
            status: "ready_for_review",
          },
        })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Article ready for review")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("renders the cancelled label + Done badge for cancelled jobs", () => {
    render(
      <ActiveJobRow
        job={makeJob({
          status: "cancelled",
          currentStep: null,
          completedAt: "2026-05-11T00:01:00Z",
        })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
});
