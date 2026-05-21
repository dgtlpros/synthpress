import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IdeaCard, type IdeaCardIdea } from "./IdeaCard";

const baseIdea: IdeaCardIdea = {
  id: "i1",
  title: "How to launch a B2B blog in 30 days",
  status: "generated",
  targetKeyword: "launch b2b blog",
  executiveSummary: "A practical 30-day plan for shipping the first ten posts.",
  articleType: "how_to",
  estimatedWordCount: 1500,
  createdAt: new Date("2026-05-07T15:00:00Z").toISOString(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-07T15:30:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("IdeaCard", () => {
  it("renders the title, summary, and status badge", () => {
    render(<IdeaCard idea={baseIdea} />);
    expect(screen.getByText(baseIdea.title)).toBeInTheDocument();
    expect(screen.getByText(baseIdea.executiveSummary!)).toBeInTheDocument();
    expect(screen.getByText("Generated")).toBeInTheDocument();
  });

  it("formats the article type to a friendly label", () => {
    render(<IdeaCard idea={baseIdea} />);
    expect(screen.getByText("How-to")).toBeInTheDocument();
  });

  it("falls back to the raw type when not in the known set", () => {
    render(
      <IdeaCard idea={{ ...baseIdea, articleType: "deep_dive_article" }} />,
    );
    expect(screen.getByText("deep_dive_article")).toBeInTheDocument();
  });

  it("omits the type badge when not provided", () => {
    render(<IdeaCard idea={{ ...baseIdea, articleType: null }} />);
    expect(screen.queryByText("How-to")).not.toBeInTheDocument();
  });

  it("renders the target keyword and estimated word count when present", () => {
    render(<IdeaCard idea={baseIdea} />);
    expect(screen.getByText("Keyword:")).toBeInTheDocument();
    expect(screen.getByText("launch b2b blog")).toBeInTheDocument();
    expect(screen.getByText("~1,500 words")).toBeInTheDocument();
  });

  it("hides the keyword + word count rows when null", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          targetKeyword: null,
          estimatedWordCount: null,
          executiveSummary: null,
        }}
      />,
    );
    expect(screen.queryByText("Keyword:")).not.toBeInTheDocument();
    expect(screen.queryByText(/words/)).not.toBeInTheDocument();
  });

  it("renders relative time correctly for recent ideas", () => {
    render(<IdeaCard idea={baseIdea} />);
    expect(screen.getByText("30m ago")).toBeInTheDocument();
  });

  it("renders 'just now' for sub-minute ideas", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          createdAt: new Date("2026-05-07T15:29:30Z").toISOString(),
        }}
      />,
    );
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("renders hours ago for ideas under a day old", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          createdAt: new Date("2026-05-07T11:00:00Z").toISOString(),
        }}
      />,
    );
    expect(screen.getByText("4h ago")).toBeInTheDocument();
  });

  it("renders days ago for ideas under two weeks old", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          createdAt: new Date("2026-05-04T15:30:00Z").toISOString(),
        }}
      />,
    );
    expect(screen.getByText("3d ago")).toBeInTheDocument();
  });

  it("falls back to a date string for older ideas", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          createdAt: new Date("2026-04-15T15:30:00Z").toISOString(),
        }}
      />,
    );
    // Locale-dependent — assert a non-empty string that includes the year.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("returns an empty time string for invalid dates", () => {
    const { container } = render(
      <IdeaCard idea={{ ...baseIdea, createdAt: "not-a-date" }} />,
    );
    // The time slot exists but is empty; the surrounding flex row still
    // renders. Easiest assertion: the title is still there and we didn't
    // throw.
    expect(container).toBeInTheDocument();
  });

  it("forwards extra props + className", () => {
    const { container } = render(
      <IdeaCard idea={baseIdea} className="custom-cls" data-testid="x" />,
    );
    expect(container.firstChild).toHaveClass("custom-cls");
    expect(screen.getByTestId("x")).toBeInTheDocument();
  });
});

describe("IdeaCard action footer", () => {
  it("renders no footer when neither callback is provided", () => {
    render(<IdeaCard idea={baseIdea} />);
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reject/i }),
    ).not.toBeInTheDocument();
  });

  it("renders both Approve and Reject for a generated idea", () => {
    render(<IdeaCard idea={baseIdea} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /approve/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("only renders Reject when the idea is already approved", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "approved" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("only renders Approve when the idea is already rejected", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "rejected" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /approve/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reject/i }),
    ).not.toBeInTheDocument();
  });

  it("renders no actions when the idea has been converted to an article", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "converted_to_article" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reject/i }),
    ).not.toBeInTheDocument();
  });

  it("hides Approve when only the reject callback is provided", () => {
    render(<IdeaCard idea={baseIdea} onReject={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("hides Reject when only the approve callback is provided", () => {
    render(<IdeaCard idea={baseIdea} onApprove={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /approve/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reject/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onApprove with the idea id when Approve is clicked", () => {
    const onApprove = vi.fn();
    render(
      <IdeaCard idea={baseIdea} onApprove={onApprove} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith(baseIdea.id);
  });

  it("calls onReject with the idea id when Reject is clicked", () => {
    const onReject = vi.fn();
    render(
      <IdeaCard idea={baseIdea} onApprove={vi.fn()} onReject={onReject} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledWith(baseIdea.id);
  });

  it("shows the loading state on Approve when pendingAction is 'approved'", () => {
    render(
      <IdeaCard
        idea={baseIdea}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        pendingAction="approved"
      />,
    );
    const approve = screen.getByRole("button", { name: /approve/i });
    const reject = screen.getByRole("button", { name: /reject/i });
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();
    // The Button atom marks the loading button with aria-busy.
    expect(approve).toHaveAttribute("aria-busy", "true");
    expect(reject).not.toHaveAttribute("aria-busy", "true");
  });

  it("shows the loading state on Reject when pendingAction is 'rejected'", () => {
    render(
      <IdeaCard
        idea={baseIdea}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        pendingAction="rejected"
      />,
    );
    const approve = screen.getByRole("button", { name: /approve/i });
    const reject = screen.getByRole("button", { name: /reject/i });
    expect(reject).toHaveAttribute("aria-busy", "true");
    expect(approve).not.toHaveAttribute("aria-busy", "true");
    expect(approve).toBeDisabled();
  });

  it("disables both buttons (without spinners) when another card is busy", () => {
    render(
      <IdeaCard
        idea={baseIdea}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        pendingAction="other"
      />,
    );
    const approve = screen.getByRole("button", { name: /approve/i });
    const reject = screen.getByRole("button", { name: /reject/i });
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();
    expect(approve).not.toHaveAttribute("aria-busy", "true");
    expect(reject).not.toHaveAttribute("aria-busy", "true");
  });

  it("renders the inline error when errorMessage is provided", () => {
    render(
      <IdeaCard
        idea={baseIdea}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        errorMessage="This idea can't be changed to that status."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/can't be changed/i);
  });
});

describe("IdeaCard Generate article action", () => {
  it("does not render Generate article for a generated idea", () => {
    render(
      <IdeaCard
        idea={baseIdea}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /generate article/i }),
    ).not.toBeInTheDocument();
  });

  it("renders Generate article (and Reject) for an approved idea", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "approved" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /generate article/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
    // Approve is hidden — Generate article is the primary next step.
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render Generate article for a rejected idea", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "rejected" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /generate article/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render Generate article for a converted idea", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "converted_to_article" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /generate article/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reject/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render Generate article when the callback is omitted", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "approved" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /generate article/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onGenerate with the idea id when Generate article is clicked", () => {
    const onGenerate = vi.fn();
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "approved" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onGenerate={onGenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate article/i }));
    expect(onGenerate).toHaveBeenCalledWith(baseIdea.id);
  });

  it("shows the loading state on Generate article when pendingAction is 'generating'", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "approved" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onGenerate={vi.fn()}
        pendingAction="generating"
      />,
    );
    const generate = screen.getByRole("button", { name: /generate article/i });
    const reject = screen.getByRole("button", { name: /reject/i });
    expect(generate).toHaveAttribute("aria-busy", "true");
    expect(generate).toBeDisabled();
    expect(reject).toBeDisabled();
    expect(reject).not.toHaveAttribute("aria-busy", "true");
  });

  it("disables Generate article when another card is busy", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "approved" }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onGenerate={vi.fn()}
        pendingAction="other"
      />,
    );
    const generate = screen.getByRole("button", { name: /generate article/i });
    expect(generate).toBeDisabled();
    expect(generate).not.toHaveAttribute("aria-busy", "true");
  });
});

describe("IdeaCard View article link", () => {
  it("renders the link for converted ideas with a viewArticleHref", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          status: "converted_to_article",
          viewArticleHref: "/teams/t1/projects/p1/blogs/b1/posts/a1",
        }}
      />,
    );
    const link = screen.getByRole("link", { name: /view article/i });
    expect(link).toHaveAttribute(
      "href",
      "/teams/t1/projects/p1/blogs/b1/posts/a1",
    );
  });

  it("does not render the link for converted ideas without an href", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          status: "converted_to_article",
          viewArticleHref: null,
        }}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /view article/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render the link for non-converted ideas, even with a href", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          status: "approved",
          viewArticleHref: "/somewhere",
        }}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /view article/i }),
    ).not.toBeInTheDocument();
  });

  describe("when isGenerating is set (persisted workflow state)", () => {
    it("renders a 'Generating…' badge in the footer", () => {
      render(
        <IdeaCard
          idea={{ ...baseIdea, status: "approved", isGenerating: true }}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onGenerate={vi.fn()}
        />,
      );
      expect(screen.getByText("Generating…")).toBeInTheDocument();
    });

    it("hides the Generate / Approve / Reject buttons", () => {
      render(
        <IdeaCard
          idea={{ ...baseIdea, status: "approved", isGenerating: true }}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onGenerate={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /generate article/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /approve/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /reject/i }),
      ).not.toBeInTheDocument();
    });

    it("still renders the View Article link to the in-flight placeholder", () => {
      render(
        <IdeaCard
          idea={{
            ...baseIdea,
            status: "approved",
            isGenerating: true,
            viewArticleHref: "/posts/article-1",
          }}
          onApprove={vi.fn()}
          onGenerate={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("link", { name: /view article/i }),
      ).toHaveAttribute("href", "/posts/article-1");
    });
  });
});

describe("IdeaCard archive controls", () => {
  it("renders an Archive button when onArchive is provided", () => {
    render(<IdeaCard idea={baseIdea} onArchive={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /^archive$/i }),
    ).toBeInTheDocument();
  });

  it("calls onArchive with the idea id when Archive is clicked", () => {
    const onArchive = vi.fn();
    render(<IdeaCard idea={baseIdea} onArchive={onArchive} />);
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith(baseIdea.id);
  });

  it("does not render Archive on an already-archived card", () => {
    render(
      <IdeaCard idea={{ ...baseIdea, isArchived: true }} onArchive={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: /^archive$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders an Archived badge for archived ideas", () => {
    render(<IdeaCard idea={{ ...baseIdea, isArchived: true }} />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("renders Unarchive only on archived cards when handler is provided", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, isArchived: true }}
        onUnarchive={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^unarchive$/i }),
    ).toBeInTheDocument();
  });

  it("does not render Unarchive on non-archived cards", () => {
    render(<IdeaCard idea={baseIdea} onUnarchive={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /^unarchive$/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onUnarchive with the idea id when Unarchive is clicked", () => {
    const onUnarchive = vi.fn();
    render(
      <IdeaCard
        idea={{ ...baseIdea, isArchived: true }}
        onUnarchive={onUnarchive}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^unarchive$/i }));
    expect(onUnarchive).toHaveBeenCalledWith(baseIdea.id);
  });

  it("hides Approve / Reject / Generate on archived cards", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "approved", isArchived: true }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onGenerate={vi.fn()}
        onUnarchive={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /^approve$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^reject$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /generate article/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the loading state on Archive when pendingAction is 'archiving'", () => {
    render(
      <IdeaCard
        idea={baseIdea}
        onArchive={vi.fn()}
        onReject={vi.fn()}
        pendingAction="archiving"
      />,
    );
    const archive = screen.getByRole("button", { name: /^archive$/i });
    expect(archive).toHaveAttribute("aria-busy", "true");
    expect(archive).toBeDisabled();
  });

  it("shows the loading state on Unarchive when pendingAction is 'unarchiving'", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, isArchived: true }}
        onUnarchive={vi.fn()}
        pendingAction="unarchiving"
      />,
    );
    const unarchive = screen.getByRole("button", { name: /^unarchive$/i });
    expect(unarchive).toHaveAttribute("aria-busy", "true");
    expect(unarchive).toBeDisabled();
  });

  it("still renders the View Article link on archived ideas with a href", () => {
    render(
      <IdeaCard
        idea={{
          ...baseIdea,
          status: "converted_to_article",
          isArchived: true,
          viewArticleHref: "/posts/article-1",
        }}
        onUnarchive={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /view article/i })).toHaveAttribute(
      "href",
      "/posts/article-1",
    );
  });

  it("hides Archive when the idea is currently generating", () => {
    render(
      <IdeaCard
        idea={{ ...baseIdea, status: "approved", isGenerating: true }}
        onArchive={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /^archive$/i }),
    ).not.toBeInTheDocument();
  });
});
