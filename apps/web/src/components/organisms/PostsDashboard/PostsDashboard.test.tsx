import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PostsDashboard, type PostsDashboardPost } from "./PostsDashboard";

afterEach(cleanup);

function makePost(
  overrides: Partial<PostsDashboardPost> = {},
): PostsDashboardPost {
  return {
    id: "p1",
    title: "Hello world",
    status: "draft",
    excerpt: null,
    targetKeyword: null,
    authorPersona: null,
    wordCount: null,
    generatedByModel: null,
    scheduledAt: null,
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    destinationLabel: null,
    ...overrides,
  };
}

describe("PostsDashboard", () => {
  it("shows the empty state when there are no posts", () => {
    render(<PostsDashboard posts={[]} onCreatePost={vi.fn()} />);
    expect(screen.getByText("No posts yet")).toBeInTheDocument();
  });

  it("opens the inline create form when 'New post' is clicked", () => {
    render(<PostsDashboard posts={[]} onCreatePost={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New post" }));
    expect(screen.getByLabelText("New post title")).toBeInTheDocument();
  });

  it("invokes onCreatePost with the trimmed title", () => {
    const onCreate = vi.fn();
    render(<PostsDashboard posts={[]} onCreatePost={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "New post" }));
    fireEvent.change(screen.getByLabelText("New post title"), {
      target: { value: "  Big idea  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    expect(onCreate).toHaveBeenCalledWith({ title: "Big idea" });
  });

  it("renders a row per post and the stats counts", () => {
    const posts = [
      makePost({ id: "1", status: "draft", title: "Draft 1" }),
      makePost({ id: "2", status: "published", title: "Pub 1" }),
      makePost({ id: "3", status: "scheduled", title: "Sched 1" }),
      makePost({ id: "4", status: "failed", title: "Failed 1" }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    expect(screen.getByText("Draft 1")).toBeInTheDocument();
    expect(screen.getByText("Pub 1")).toBeInTheDocument();
    expect(screen.getByText("Sched 1")).toBeInTheDocument();
    expect(screen.getByText("Failed 1")).toBeInTheDocument();
    // The total count appears in both the "Total posts" StatCard and the "All"
    // tab badge — we just want at least one.
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("filters posts by status when a tab is clicked", () => {
    const posts = [
      makePost({ id: "1", status: "draft", title: "Draft 1" }),
      makePost({ id: "2", status: "published", title: "Pub 1" }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Published/ }));
    expect(screen.queryByText("Draft 1")).not.toBeInTheDocument();
    expect(screen.getByText("Pub 1")).toBeInTheDocument();
  });

  it("the 'Ready for review' filter matches both ready and ready_for_review", () => {
    const posts = [
      makePost({ id: "1", status: "ready", title: "Legacy ready" }),
      makePost({
        id: "2",
        status: "ready_for_review",
        title: "Canonical ready",
      }),
      makePost({ id: "3", status: "draft", title: "Just a draft" }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Ready for review/ }));
    expect(screen.getByText("Legacy ready")).toBeInTheDocument();
    expect(screen.getByText("Canonical ready")).toBeInTheDocument();
    expect(screen.queryByText("Just a draft")).not.toBeInTheDocument();
  });

  it("filters posts by search query", () => {
    const posts = [
      makePost({ id: "1", title: "Hello world" }),
      makePost({ id: "2", title: "Other story", targetKeyword: "ai" }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search posts"), {
      target: { value: "ai" },
    });
    expect(screen.getByText("Other story")).toBeInTheDocument();
    expect(screen.queryByText("Hello world")).not.toBeInTheDocument();
  });

  it("shows a no-match card when filter excludes everything", () => {
    const posts = [makePost({ id: "1", status: "draft", title: "Draft 1" })];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search posts"), {
      target: { value: "zzz" },
    });
    expect(
      screen.getByText("No posts match the current filter."),
    ).toBeInTheDocument();
  });

  it("invokes onPostClick when a row is clicked", () => {
    const onClick = vi.fn();
    const posts = [makePost({ id: "p1", title: "Click me" })];
    render(
      <PostsDashboard
        posts={posts}
        onCreatePost={vi.fn()}
        onPostClick={onClick}
      />,
    );
    fireEvent.click(screen.getByText("Click me"));
    expect(onClick).toHaveBeenCalledWith("p1");
  });

  it("supports Enter / Space to activate a row when interactive", () => {
    const onClick = vi.fn();
    const posts = [makePost({ id: "p1", title: "Activate" })];
    render(
      <PostsDashboard
        posts={posts}
        onCreatePost={vi.fn()}
        onPostClick={onClick}
      />,
    );
    const row = screen.getByText("Activate").closest("tr")!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onClick).toHaveBeenCalledWith("p1");
    onClick.mockClear();
    fireEvent.keyDown(row, { key: " " });
    expect(onClick).toHaveBeenCalledWith("p1");
  });

  it("renders an external destination label when provided", () => {
    const posts = [
      makePost({
        id: "p1",
        title: "X",
        destinationLabel: "WordPress (example.com)",
      }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    expect(screen.getByText("WordPress (example.com)")).toBeInTheDocument();
  });

  it("renders a 'Generate from an idea' link in the bottom toolbar when ideasHref is set", () => {
    render(
      <PostsDashboard
        posts={[makePost()]}
        onCreatePost={vi.fn()}
        ideasHref="/teams/t1/projects/p1/blogs/b1/ideas"
      />,
    );
    const link = screen.getByRole("link", { name: /generate from an idea/i });
    expect(link).toHaveAttribute("href", "/teams/t1/projects/p1/blogs/b1/ideas");
  });

  it("renders 'Untitled' when title is empty", () => {
    render(
      <PostsDashboard
        posts={[makePost({ title: "" })]}
        onCreatePost={vi.fn()}
      />,
    );
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("renders the bottom 'New post' button and opens the create form when clicked", () => {
    render(
      <PostsDashboard posts={[makePost()]} onCreatePost={vi.fn()} />,
    );
    const newPostBtns = screen.getAllByRole("button", { name: "New post" });
    expect(newPostBtns.length).toBeGreaterThan(0);
    // Click the bottom one (last in the DOM) to open the inline form.
    fireEvent.click(newPostBtns[newPostBtns.length - 1]);
    expect(screen.getByLabelText("New post title")).toBeInTheDocument();
  });

  it("hides the inline create form when Cancel is clicked", () => {
    render(<PostsDashboard posts={[]} onCreatePost={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New post" }));
    expect(screen.getByLabelText("New post title")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByLabelText("New post title"),
    ).not.toBeInTheDocument();
  });

  it("hides the AI Generate button when no callback is provided (posts dashboard)", () => {
    render(<PostsDashboard posts={[makePost()]} onCreatePost={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /Generate with AI/ }),
    ).not.toBeInTheDocument();
  });

  it("hides the AI Generate button in the empty state when no callback is provided", () => {
    render(<PostsDashboard posts={[]} onCreatePost={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /Generate with AI/ }),
    ).not.toBeInTheDocument();
  });

  it("ignores empty / whitespace titles when Create draft is clicked", () => {
    const onCreate = vi.fn();
    render(<PostsDashboard posts={[]} onCreatePost={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "New post" }));
    fireEvent.change(screen.getByLabelText("New post title"), {
      target: { value: "   " },
    });
    const createDraft = screen.getByRole("button", { name: "Create draft" });
    expect(createDraft).toBeDisabled();
  });

  it("disables status filter tabs that have a count of 0", () => {
    render(<PostsDashboard posts={[makePost()]} onCreatePost={vi.fn()} />);
    expect(
      screen.getByRole("tab", { name: /Published/ }),
    ).toBeDisabled();
  });

  it("renders 'just now' / m / h / d relative times", () => {
    const now = Date.now();
    const posts = [
      makePost({
        id: "now",
        title: "Now",
        updatedAt: new Date(now).toISOString(),
      }),
      makePost({
        id: "min",
        title: "MinAgo",
        updatedAt: new Date(now - 5 * 60_000).toISOString(),
      }),
      makePost({
        id: "hr",
        title: "HourAgo",
        updatedAt: new Date(now - 5 * 60 * 60_000).toISOString(),
      }),
      makePost({
        id: "day",
        title: "DayAgo",
        updatedAt: new Date(now - 3 * 24 * 60 * 60_000).toISOString(),
      }),
      makePost({
        id: "old",
        title: "Old",
        updatedAt: new Date(now - 30 * 24 * 60 * 60_000).toISOString(),
      }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    expect(screen.getByText("just now")).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    expect(screen.getByText("5h ago")).toBeInTheDocument();
    expect(screen.getByText("3d ago")).toBeInTheDocument();
  });

  it("renders '—' for null updatedAt and invalid date strings", () => {
    const posts = [
      makePost({
        id: "null",
        title: "NullDate",
        updatedAt: "",
      }),
      makePost({
        id: "bad",
        title: "BadDate",
        scheduledAt: "not-a-date",
      }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    // The em-dash is rendered when the date is invalid.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders '—' for an invalid relative date string", () => {
    render(
      <PostsDashboard
        posts={[
          makePost({
            id: "bad-rel",
            title: "Bad rel",
            updatedAt: "not-a-date",
          }),
        ]}
        onCreatePost={vi.fn()}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the 'Go to Ideas' link on the empty state when ideasHref is set", () => {
    render(
      <PostsDashboard
        posts={[]}
        onCreatePost={vi.fn()}
        ideasHref="/teams/t1/projects/p1/blogs/b1/ideas"
      />,
    );
    const link = screen.getByRole("link", { name: /go to ideas/i });
    expect(link).toHaveAttribute("href", "/teams/t1/projects/p1/blogs/b1/ideas");
  });

  it("omits the 'Go to Ideas' link on the empty state when ideasHref is not provided", () => {
    render(<PostsDashboard posts={[]} onCreatePost={vi.fn()} />);
    expect(
      screen.queryByRole("link", { name: /go to ideas/i }),
    ).not.toBeInTheDocument();
    // The manual "New post" fallback is still there.
    expect(
      screen.getByRole("button", { name: "New post" }),
    ).toBeInTheDocument();
  });

  it("renders the 'generating' hint when generating posts exist", () => {
    const posts = [
      makePost({ id: "g1", status: "generating", title: "Gen 1" }),
      makePost({ id: "g2", status: "generating", title: "Gen 2" }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    expect(screen.getByText("2 generating")).toBeInTheDocument();
  });

  it("renders the 'scheduled' hint when scheduled posts exist", () => {
    const posts = [
      makePost({ id: "s1", status: "scheduled", title: "Sched" }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    expect(screen.getByText("1 scheduled")).toBeInTheDocument();
  });

  it("renders an absolute scheduled time when the date is valid", () => {
    // Pick a deterministic timestamp so we can assert against the locale string.
    const iso = "2026-06-15T14:30:00.000Z";
    const expected = new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    render(
      <PostsDashboard
        posts={[
          makePost({ id: "scheduled", title: "Scheduled", scheduledAt: iso }),
        ]}
        onCreatePost={vi.fn()}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("renders 'No destination' when destinationLabel is null", () => {
    render(
      <PostsDashboard
        posts={[makePost({ destinationLabel: null })]}
        onCreatePost={vi.fn()}
      />,
    );
    expect(screen.getByText("No destination")).toBeInTheDocument();
  });

  it("renders the word count in the table when present", () => {
    render(
      <PostsDashboard
        posts={[makePost({ wordCount: 1820 })]}
        onCreatePost={vi.fn()}
      />,
    );
    expect(screen.getByText("1,820")).toBeInTheDocument();
  });

  it("renders the author persona under the title when present", () => {
    render(
      <PostsDashboard
        posts={[makePost({ authorPersona: "Editorial team" })]}
        onCreatePost={vi.fn()}
      />,
    );
    expect(screen.getByText("By Editorial team")).toBeInTheDocument();
  });

  it("renders rows as non-interactive when no onPostClick is provided", () => {
    const posts = [makePost({ id: "p1", title: "Static" })];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    const row = screen.getByText("Static").closest("tr")!;
    expect(row).not.toHaveAttribute("tabIndex");
  });

  it("ignores other key presses on a row", () => {
    const onClick = vi.fn();
    const posts = [makePost({ id: "p1", title: "Activate" })];
    render(
      <PostsDashboard
        posts={posts}
        onCreatePost={vi.fn()}
        onPostClick={onClick}
      />,
    );
    const row = screen.getByText("Activate").closest("tr")!;
    fireEvent.keyDown(row, { key: "Tab" });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls onPostClick with the article id when a row is clicked", () => {
    const onClick = vi.fn();
    const posts = [
      makePost({ id: "row-1", title: "First post" }),
      makePost({ id: "row-2", title: "Second post" }),
    ];
    render(
      <PostsDashboard
        posts={posts}
        onCreatePost={vi.fn()}
        onPostClick={onClick}
      />,
    );

    fireEvent.click(screen.getByText("Second post"));
    expect(onClick).toHaveBeenCalledWith("row-2");
  });

  it("renders the article excerpt under the title for AI-generated rows", () => {
    const posts = [
      makePost({
        id: "p1",
        title: "How to ship faster",
        excerpt: "A 30-day plan to ship your first ten posts.",
        generatedByModel: "claude-sonnet-4-6",
      }),
    ];
    render(
      <PostsDashboard posts={posts} onCreatePost={vi.fn()} />,
    );
    expect(
      screen.getByText("A 30-day plan to ship your first ten posts."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("via claude-sonnet-4-6"),
    ).toBeInTheDocument();
  });

  it("combines author persona + model in the subtitle when both are set", () => {
    const posts = [
      makePost({
        id: "p1",
        title: "Manual + AI hybrid",
        excerpt: null,
        authorPersona: "Editorial team",
        generatedByModel: "claude-sonnet-4-6",
      }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    expect(
      screen.getByText("By Editorial team · via claude-sonnet-4-6"),
    ).toBeInTheDocument();
  });

  it("displays the failed status badge inside the row for failed articles", () => {
    const posts = [makePost({ id: "p1", status: "failed", title: "Bad run" })];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    // "Failed" also appears in the stat card label + filter tab; scope
    // to the row so we only assert on the badge.
    const row = screen.getByText("Bad run").closest("tr")!;
    expect(row.textContent).toContain("Failed");
  });

  it("displays the generating status badge inside the row for in-flight articles", () => {
    const posts = [
      makePost({ id: "p1", status: "generating", title: "In flight" }),
    ];
    render(<PostsDashboard posts={posts} onCreatePost={vi.fn()} />);
    const row = screen.getByText("In flight").closest("tr")!;
    expect(row.textContent).toContain("Generating");
  });
});
