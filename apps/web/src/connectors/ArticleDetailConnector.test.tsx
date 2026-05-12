import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useArticleEdit", () => ({
  useArticleEdit: vi.fn(),
}));

vi.mock("./ArticleWordPressPublishConnector", () => ({
  ArticleWordPressPublishConnector: vi.fn(
    (props: { hasBody: boolean; hasWordPressConnection: boolean }) => (
      <div
        data-testid="wp-publish-connector"
        data-has-body={String(props.hasBody)}
        data-has-connection={String(props.hasWordPressConnection)}
      />
    ),
  ),
}));

import { useArticleEdit } from "@/hooks/useArticleEdit";
import { ArticleWordPressPublishConnector } from "./ArticleWordPressPublishConnector";
import { ArticleDetailConnector } from "./ArticleDetailConnector";
import type { ArticleDetailData } from "@/components/organisms/ArticleDetail";

const mockedUseArticleEdit = vi.mocked(useArticleEdit);

const baseArticle: ArticleDetailData = {
  id: "a1",
  title: "How to launch a B2B blog",
  slug: "how-to-launch-a-b2b-blog",
  status: "ready_for_review",
  excerpt: "A 30-day plan.",
  metaDescription: "Step-by-step playbook.",
  targetKeyword: "launch b2b blog",
  contentMarkdown: "# Heading\n\nBody.",
  wordCount: 1500,
  generatedByModel: "claude-sonnet-4-6",
  errorMessage: null,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  wpPostId: null,
  wpPostUrl: null,
};

const setField = vi.fn();
const enterEdit = vi.fn();
const cancelEdit = vi.fn();
const save = vi.fn();
const resetSaveError = vi.fn();

function defaultHookValue(
  overrides: Partial<ReturnType<typeof useArticleEdit>> = {},
): ReturnType<typeof useArticleEdit> {
  return {
    value: {
      title: baseArticle.title,
      slug: baseArticle.slug ?? "",
      excerpt: baseArticle.excerpt ?? "",
      metaDescription: baseArticle.metaDescription ?? "",
      targetKeyword: baseArticle.targetKeyword ?? "",
      contentMarkdown: baseArticle.contentMarkdown ?? "",
    },
    setField,
    isEditing: false,
    enterEdit,
    cancelEdit,
    save,
    isSaving: false,
    saveError: null,
    resetSaveError,
    ...overrides,
  };
}

const baseProps = {
  teamId: "t1",
  projectId: "p1",
  blogId: "b1",
  article: baseArticle,
  hasWordPressConnection: true,
  connectionsHref: "/teams/t1/projects/p1/blogs/b1/connections",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseArticleEdit.mockReturnValue(defaultHookValue());
});

afterEach(cleanup);

describe("ArticleDetailConnector", () => {
  it("renders the read view by default with an Edit button", () => {
    render(<ArticleDetailConnector {...baseProps} />);
    expect(
      screen.getByRole("heading", { level: 1, name: baseArticle.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("invokes enterEdit when the Edit button is clicked", () => {
    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(enterEdit).toHaveBeenCalledOnce();
  });

  it("renders the edit form when isEditing is true", () => {
    mockedUseArticleEdit.mockReturnValueOnce(
      defaultHookValue({ isEditing: true }),
    );

    render(<ArticleDetailConnector {...baseProps} />);
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe(
      baseArticle.title,
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("calls save when the form is submitted", () => {
    mockedUseArticleEdit.mockReturnValueOnce(
      defaultHookValue({ isEditing: true }),
    );

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(save).toHaveBeenCalledOnce();
  });

  it("calls cancelEdit when the form's Cancel is clicked", () => {
    mockedUseArticleEdit.mockReturnValueOnce(
      defaultHookValue({ isEditing: true }),
    );

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancelEdit).toHaveBeenCalledOnce();
  });

  it("propagates the saveError to the form", () => {
    mockedUseArticleEdit.mockReturnValueOnce(
      defaultHookValue({
        isEditing: true,
        saveError: "Title is required.",
      }),
    );

    render(<ArticleDetailConnector {...baseProps} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/title is required/i);
  });

  it("derives the form's initial value from the article (slug, excerpt, etc.)", () => {
    render(<ArticleDetailConnector {...baseProps} />);
    const initialValue = mockedUseArticleEdit.mock.calls[0]![0]!.initialValue;
    expect(initialValue).toEqual({
      title: baseArticle.title,
      slug: baseArticle.slug,
      excerpt: baseArticle.excerpt,
      metaDescription: baseArticle.metaDescription,
      targetKeyword: baseArticle.targetKeyword,
      contentMarkdown: baseArticle.contentMarkdown,
    });
  });

  it("collapses null fields to empty strings in the initial value", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{
          ...baseArticle,
          slug: null,
          excerpt: null,
          metaDescription: null,
          targetKeyword: null,
          contentMarkdown: null,
        }}
      />,
    );
    const initialValue = mockedUseArticleEdit.mock.calls[0]![0]!.initialValue;
    expect(initialValue.slug).toBe("");
    expect(initialValue.excerpt).toBe("");
    expect(initialValue.metaDescription).toBe("");
    expect(initialValue.targetKeyword).toBe("");
    expect(initialValue.contentMarkdown).toBe("");
  });

  it("mounts the WordPress publish connector in read mode", () => {
    render(<ArticleDetailConnector {...baseProps} />);
    expect(screen.getByTestId("wp-publish-connector")).toBeInTheDocument();
  });

  it("forwards hasWordPressConnection + computed hasBody to the publish connector", () => {
    render(<ArticleDetailConnector {...baseProps} />);
    const node = screen.getByTestId("wp-publish-connector");
    expect(node).toHaveAttribute("data-has-connection", "true");
    expect(node).toHaveAttribute("data-has-body", "true");
  });

  it("computes hasBody=false when contentMarkdown is null", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{ ...baseArticle, contentMarkdown: null }}
      />,
    );
    expect(screen.getByTestId("wp-publish-connector")).toHaveAttribute(
      "data-has-body",
      "false",
    );
  });

  it("computes hasBody=false when contentMarkdown is whitespace-only", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{ ...baseArticle, contentMarkdown: "   \n   " }}
      />,
    );
    expect(screen.getByTestId("wp-publish-connector")).toHaveAttribute(
      "data-has-body",
      "false",
    );
  });

  it("forwards hasWordPressConnection=false through to the publish connector", () => {
    render(
      <ArticleDetailConnector {...baseProps} hasWordPressConnection={false} />,
    );
    expect(screen.getByTestId("wp-publish-connector")).toHaveAttribute(
      "data-has-connection",
      "false",
    );
  });

  it("does NOT mount the WordPress publish connector while editing", () => {
    mockedUseArticleEdit.mockReturnValueOnce(
      defaultHookValue({ isEditing: true }),
    );
    render(<ArticleDetailConnector {...baseProps} />);
    expect(
      screen.queryByTestId("wp-publish-connector"),
    ).not.toBeInTheDocument();
  });

  it("forwards the connectionsHref + articleStatus props to the publish connector", () => {
    render(<ArticleDetailConnector {...baseProps} />);
    const calls = vi.mocked(ArticleWordPressPublishConnector).mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0]).toMatchObject({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      articleId: "a1",
      connectionsHref: baseProps.connectionsHref,
      wpPostId: null,
      wpPostUrl: null,
      articleStatus: "ready_for_review",
    });
  });

  it("forwards persisted wp fields to the publish connector", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{
          ...baseArticle,
          wpPostId: 7,
          wpPostUrl: "https://example.com/?p=7",
        }}
      />,
    );
    const calls = vi.mocked(ArticleWordPressPublishConnector).mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0]).toMatchObject({
      wpPostId: 7,
      wpPostUrl: "https://example.com/?p=7",
    });
  });

  it("forwards articleStatus=published to the publish connector when the article is live", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{
          ...baseArticle,
          status: "published",
          wpPostId: 7,
          wpPostUrl: "https://example.com/?p=7",
        }}
      />,
    );
    const calls = vi.mocked(ArticleWordPressPublishConnector).mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0]).toMatchObject({ articleStatus: "published" });
  });
});
