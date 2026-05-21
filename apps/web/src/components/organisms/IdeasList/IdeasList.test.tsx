import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { bucketForIdea, IdeasList } from "./IdeasList";
import type { IdeaCardIdea } from "@/components/molecules/IdeaCard";

afterEach(cleanup);

function makeIdea(overrides: Partial<IdeaCardIdea>): IdeaCardIdea {
  return {
    id: "i",
    title: "An idea",
    status: "generated",
    targetKeyword: null,
    executiveSummary: null,
    articleType: null,
    estimatedWordCount: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const sample: IdeaCardIdea[] = [
  makeIdea({
    id: "i1",
    title: "How to launch a B2B blog",
    status: "generated",
    targetKeyword: "b2b blog",
    executiveSummary: "A practical 30-day plan.",
    articleType: "how_to",
    estimatedWordCount: 1200,
  }),
  makeIdea({
    id: "i2",
    title: "5 mistakes teams make",
    status: "approved",
    targetKeyword: "team mistakes",
    executiveSummary: "What to avoid.",
    articleType: "listicle",
    estimatedWordCount: 1000,
  }),
  makeIdea({
    id: "i3",
    title: "Auth done right",
    status: "converted_to_article",
    targetKeyword: "auth",
    articleType: "tutorial",
  }),
  makeIdea({
    id: "i4",
    title: "Archived placeholder",
    status: "generated",
    isArchived: true,
  }),
];

function getTabBucketName(tab: HTMLElement): string {
  // Strip the trailing count badge so assertions match by label only.
  return tab.textContent?.replace(/\d+$/, "").trim() ?? "";
}

describe("IdeasList — bucketForIdea", () => {
  it("routes archived ideas to the Archived bucket regardless of status", () => {
    expect(
      bucketForIdea(makeIdea({ status: "approved", isArchived: true })),
    ).toBe("archived");
    expect(
      bucketForIdea(
        makeIdea({ status: "converted_to_article", isArchived: true }),
      ),
    ).toBe("archived");
  });

  it("routes generated + rejected ideas to Needs review", () => {
    expect(bucketForIdea(makeIdea({ status: "generated" }))).toBe(
      "needs_review",
    );
    expect(bucketForIdea(makeIdea({ status: "rejected" }))).toBe(
      "needs_review",
    );
  });

  it("routes approved to Approved + converted to Used", () => {
    expect(bucketForIdea(makeIdea({ status: "approved" }))).toBe("approved");
    expect(bucketForIdea(makeIdea({ status: "converted_to_article" }))).toBe(
      "used",
    );
  });
});

describe("IdeasList", () => {
  it("renders the global empty state when no ideas exist", () => {
    const onGenerate = vi.fn();
    render(<IdeasList ideas={[]} onGenerateClick={onGenerate} />);

    expect(
      screen.getByText(
        /Generate ideas to start building this blog'?s content backlog/i,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /generate ideas/i })
        .find((btn) => btn.textContent === "Generate ideas")!,
    );
    expect(onGenerate).toHaveBeenCalled();
  });

  it("renders bucket tabs with per-bucket counts", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);

    const tabs = screen.getAllByRole("tab");
    // Each tab's name includes the trailing count badge string.
    const tabsByLabel = Object.fromEntries(
      tabs.map((t) => [getTabBucketName(t), t]),
    );
    expect(tabsByLabel["Needs review"]).toHaveTextContent("1");
    expect(tabsByLabel["Approved"]).toHaveTextContent("1");
    expect(tabsByLabel["Used"]).toHaveTextContent("1");
    expect(tabsByLabel["Archived"]).toHaveTextContent("1");
  });

  it("renders the header summary counts", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    // Header summary uses a dl. "In progress" is unique to the header
    // (tabs say "Used") so we can match it directly; "Needs review"
    // collides with the tab label so we scope to the dl element.
    const headerSummary = document.querySelector("dl");
    expect(headerSummary).not.toBeNull();
    expect(headerSummary?.textContent).toContain("Needs review");
    expect(headerSummary?.textContent).toContain("In progress");
    expect(headerSummary?.textContent).toContain("Archived");
  });

  it("defaults to the Needs review tab", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    expect(screen.getByText("How to launch a B2B blog")).toBeInTheDocument();
    // The approved card is in a different tab, not currently visible.
    expect(screen.queryByText("5 mistakes teams make")).not.toBeInTheDocument();
  });

  it("switches tabs when a tab trigger is clicked", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /approved/i }));
    expect(screen.getByText("5 mistakes teams make")).toBeInTheDocument();
  });

  it("renders the Used tab content when active", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /^used/i }));
    expect(screen.getByText("Auth done right")).toBeInTheDocument();
  });

  it("renders archived ideas only in the Archived tab by default", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    expect(screen.queryByText("Archived placeholder")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /archived/i }));
    expect(screen.getByText("Archived placeholder")).toBeInTheDocument();
  });

  it("filters cards across tabs by search term", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/search ideas/i), {
      target: { value: "auth" },
    });
    // Active (Needs review) bucket now empty — the matching idea is
    // in the Used bucket.
    expect(
      screen.getByText(/no ideas match your filters/i),
    ).toBeInTheDocument();
    // Switch to Used — should find the Auth card.
    fireEvent.click(screen.getByRole("tab", { name: /^used/i }));
    expect(screen.getByText("Auth done right")).toBeInTheDocument();
  });

  it("filters by article type via the dropdown", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/filter by article type/i), {
      target: { value: "tutorial" },
    });
    // Tutorial idea lives in Used — Needs review bucket should be empty.
    expect(
      screen.getByText(/no ideas match your filters/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^used/i }));
    expect(screen.getByText("Auth done right")).toBeInTheDocument();
  });

  it("renders unknown article-type values verbatim in the filter dropdown", () => {
    // The dropdown labels known types via ARTICLE_TYPE_LABELS but
    // falls back to the raw value for anything the table doesn't
    // know about (e.g. an experimental type added by autopilot).
    const ideasWithUnknownType = [
      {
        ...sample[0]!,
        id: "i-unknown",
        articleType: "interview" as const,
      },
    ];
    render(
      <IdeasList ideas={ideasWithUnknownType} onGenerateClick={vi.fn()} />,
    );
    const select = screen.getByLabelText(
      /filter by article type/i,
    ) as HTMLSelectElement;
    // The option label is the raw value because ARTICLE_TYPE_LABELS
    // has no "interview" entry — the `?? type` fallback fires.
    expect(
      Array.from(select.options).some((o) => o.label === "interview"),
    ).toBe(true);
  });

  it("forwards Approve clicks with the idea id", () => {
    const onApprove = vi.fn();
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={onApprove}
        onRejectIdea={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("i1");
  });

  it("renders Archive on non-archived cards when handler is provided", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onArchiveIdea={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^archive$/i }),
    ).toBeInTheDocument();
  });

  it("forwards Archive clicks with the idea id", () => {
    const onArchive = vi.fn();
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onArchiveIdea={onArchive}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith("i1");
  });

  it("renders Unarchive only on archived cards in the Archived tab", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onUnarchiveIdea={vi.fn()}
      />,
    );
    // Default tab — no archived cards visible, no Unarchive button.
    expect(
      screen.queryByRole("button", { name: /unarchive/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /archived/i }));
    expect(
      screen.getByRole("button", { name: /unarchive/i }),
    ).toBeInTheDocument();
  });

  it("forwards Unarchive clicks with the idea id", () => {
    const onUnarchive = vi.fn();
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onUnarchiveIdea={onUnarchive}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /archived/i }));
    fireEvent.click(screen.getByRole("button", { name: /unarchive/i }));
    expect(onUnarchive).toHaveBeenCalledWith("i4");
  });

  it("shows the per-bucket empty state copy for Needs review", () => {
    render(
      <IdeasList
        ideas={[
          makeIdea({ id: "i", status: "approved", title: "Only approved" }),
        ]}
        onGenerateClick={vi.fn()}
      />,
    );
    // Default tab (Needs review) is empty in this fixture.
    expect(
      screen.getByText(/No ideas need review right now/i),
    ).toBeInTheDocument();
  });

  it("shows the per-bucket empty state copy for Approved", () => {
    render(
      <IdeasList
        ideas={[
          makeIdea({ id: "i", status: "generated", title: "Only generated" }),
        ]}
        onGenerateClick={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /approved/i }));
    expect(screen.getByText(/No approved ideas yet/i)).toBeInTheDocument();
  });

  it("shows the per-bucket empty state copy for Archived", () => {
    render(
      <IdeasList
        ideas={[
          makeIdea({ id: "i", status: "generated", title: "Only generated" }),
        ]}
        onGenerateClick={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /archived/i }));
    expect(screen.getByText(/No archived ideas/i)).toBeInTheDocument();
  });

  it("propagates a 'generating' pending state to the matching card", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
        onGenerateArticleFromIdea={vi.fn()}
        pendingIdeaId="i2"
        pendingIdeaAction="generating"
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /^approved/i }));
    const generate = screen.getByRole("button", {
      name: /generate article/i,
    });
    expect(generate).toHaveAttribute("aria-busy", "true");
  });

  it("renders an alert on the originating card when an error is set", () => {
    render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
        errorIdeaId="i1"
        errorMessage="This idea can't be changed to that status."
      />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(/can't be changed/i);
  });

  it("forwards a custom className to the root", () => {
    const { container } = render(
      <IdeasList
        ideas={sample}
        onGenerateClick={vi.fn()}
        className="custom-cls"
      />,
    );
    expect(container.firstChild).toHaveClass("custom-cls");
  });

  it("disables sibling action buttons in the same bucket while pending", () => {
    render(
      <IdeasList
        ideas={[
          makeIdea({ id: "a", status: "generated" }),
          makeIdea({ id: "b", status: "generated" }),
        ]}
        onGenerateClick={vi.fn()}
        onApproveIdea={vi.fn()}
        onRejectIdea={vi.fn()}
        pendingIdeaId="a"
        pendingIdeaAction="approved"
      />,
    );
    const approves = screen.getAllByRole("button", { name: /approve/i });
    // The pending card's Approve renders aria-busy; the sibling's
    // Approve disables.
    const busy = approves.find((b) => b.getAttribute("aria-busy") === "true");
    const idle = approves.find((b) => b.getAttribute("aria-busy") !== "true");
    expect(busy).toBeDefined();
    expect(idle).toBeDisabled();
  });

  it("displays the per-bucket aria label on each panel's list", () => {
    render(<IdeasList ideas={sample} onGenerateClick={vi.fn()} />);
    // Needs review default tab.
    const list = screen.getByRole("list", {
      name: /Article ideas — needs review/i,
    });
    expect(
      within(list).getByText("How to launch a B2B blog"),
    ).toBeInTheDocument();
  });
});
