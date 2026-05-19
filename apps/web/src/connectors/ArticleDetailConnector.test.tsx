import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

vi.mock("@/hooks/useArticleEdit", () => ({
  useArticleEdit: vi.fn(),
}));

vi.mock("@/hooks/useUnsplashSearch", () => ({
  useUnsplashSearch: vi.fn(),
}));

vi.mock("@/components/molecules/UnsplashPicker", () => ({
  UnsplashPicker: vi.fn((props: { open: boolean }) =>
    props.open ? (
      <div data-testid="unsplash-picker" />
    ) : (
      <div data-testid="unsplash-picker-closed" />
    ),
  ),
}));

vi.mock("@/actions/article-images", () => ({
  getRecentBlogImageUploads: vi.fn(),
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
import { useUnsplashSearch } from "@/hooks/useUnsplashSearch";
import { UnsplashPicker } from "@/components/molecules/UnsplashPicker";
import { getRecentBlogImageUploads } from "@/actions/article-images";
import { ArticleWordPressPublishConnector } from "./ArticleWordPressPublishConnector";
import { ArticleDetailConnector } from "./ArticleDetailConnector";
import type { ArticleDetailData } from "@/components/organisms/ArticleDetail";

const mockedUseArticleEdit = vi.mocked(useArticleEdit);
const mockedUseUnsplashSearch = vi.mocked(useUnsplashSearch);
const mockedUnsplashPicker = vi.mocked(UnsplashPicker);
const mockedGetRecents = vi.mocked(getRecentBlogImageUploads);

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
  featuredImageUrl: null,
  featuredImageAlt: null,
  wpFeaturedMediaId: null,
  featuredImageAttribution: null,
};

const setField = vi.fn();
const selectFeaturedImage = vi.fn();
const selectSectionImage = vi.fn();
const setSectionImageAlt = vi.fn();
const clearSectionImage = vi.fn();
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
      featuredImageUrl: "",
      featuredImageAlt: "",
    },
    setField,
    selectFeaturedImage,
    sectionImages: {},
    selectSectionImage,
    setSectionImageAlt,
    clearSectionImage,
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

const unsplashSetQuery = vi.fn();
const unsplashSearch = vi.fn();
const unsplashResetError = vi.fn();

function defaultUnsplashHookValue(
  overrides: Partial<ReturnType<typeof useUnsplashSearch>> = {},
): ReturnType<typeof useUnsplashSearch> {
  return {
    query: "",
    setQuery: unsplashSetQuery,
    search: unsplashSearch,
    isSearching: false,
    results: [],
    totalResults: null,
    error: null,
    resetError: unsplashResetError,
    hasSearched: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseArticleEdit.mockReturnValue(defaultHookValue());
  mockedUseUnsplashSearch.mockReturnValue(defaultUnsplashHookValue());
  // Default: no recents. Tests that exercise the recents flow override.
  mockedGetRecents.mockResolvedValue({ data: [], error: null });
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
      featuredImageUrl: "",
      featuredImageAlt: "",
    });
  });

  it("forwards stored featured-image fields into the initial value", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{
          ...baseArticle,
          featuredImageUrl: "https://example.com/img.jpg",
          featuredImageAlt: "A photo of a cat",
        }}
      />,
    );
    const initialValue = mockedUseArticleEdit.mock.calls[0]![0]!.initialValue;
    expect(initialValue.featuredImageUrl).toBe("https://example.com/img.jpg");
    expect(initialValue.featuredImageAlt).toBe("A photo of a cat");
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

  it("forwards featuredImageUrl + wpFeaturedMediaId to the publish connector", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{
          ...baseArticle,
          featuredImageUrl: "https://example.com/img.jpg",
          featuredImageAlt: "alt",
          wpFeaturedMediaId: 99,
        }}
      />,
    );
    const calls = vi.mocked(ArticleWordPressPublishConnector).mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0]).toMatchObject({
      featuredImageUrl: "https://example.com/img.jpg",
      wpFeaturedMediaId: 99,
    });
  });
});

// ============================================================================
// Unsplash picker wiring (only relevant in edit mode)
// ============================================================================

describe("ArticleDetailConnector — Unsplash picker", () => {
  it("seeds the Unsplash hook with the article's target keyword as the initial query", () => {
    render(<ArticleDetailConnector {...baseProps} />);
    expect(mockedUseUnsplashSearch).toHaveBeenCalledWith({
      teamId: "t1",
      initialQuery: "launch b2b blog",
    });
  });

  it("falls back to the article title when no target keyword is set", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{ ...baseArticle, targetKeyword: null }}
      />,
    );
    expect(mockedUseUnsplashSearch).toHaveBeenCalledWith({
      teamId: "t1",
      initialQuery: baseArticle.title,
    });
  });

  it("uses an empty initial query when both keyword and title are blank", () => {
    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{
          ...baseArticle,
          targetKeyword: null,
          title: "   ",
        }}
      />,
    );
    expect(mockedUseUnsplashSearch).toHaveBeenCalledWith({
      teamId: "t1",
      initialQuery: "",
    });
  });

  it("passes onPickFromUnsplash to the form in edit mode (which opens the picker)", () => {
    // Use `mockReturnValue` (not `Once`) because clicking the button
    // triggers a state update + re-render, which would otherwise
    // pop us out of edit mode after the first call.
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(<ArticleDetailConnector {...baseProps} />);
    const button = screen.getByRole("button", {
      name: /pick from image library/i,
    });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    // Opening the picker re-prefills the query AND clears any
    // lingering error from a previous session.
    expect(unsplashSetQuery).toHaveBeenCalledWith("launch b2b blog");
    expect(unsplashResetError).toHaveBeenCalled();

    // The picker mock surface flips to "open".
    expect(screen.getByTestId("unsplash-picker")).toBeInTheDocument();
  });

  it("does NOT render the picker (open) in read mode", () => {
    render(<ArticleDetailConnector {...baseProps} />);
    expect(screen.queryByTestId("unsplash-picker")).not.toBeInTheDocument();
  });

  // Tiny helper: builds a "full" NormalizedImageSearchResult shape
  // for tests that don't care about the optional fields. Keeps each
  // call site readable.
  function fullPhoto(
    overrides: Partial<{
      providerPhotoId: string;
      regularUrl: string;
      altDescription: string | null;
      description: string | null;
      photographerName: string | null;
      photographerProfileUrl: string | null;
      photoUrl: string | null;
      downloadLocation: string | null;
      provider: string;
    }>,
  ) {
    return {
      provider: overrides.provider ?? "unsplash",
      providerPhotoId: overrides.providerPhotoId ?? "abc",
      thumbUrl: "https://images.unsplash.com/x?w=200",
      regularUrl:
        overrides.regularUrl ?? "https://images.unsplash.com/x?w=1080",
      fullUrl: null,
      altDescription: overrides.altDescription ?? null,
      description: overrides.description ?? null,
      photographerName:
        overrides.photographerName === undefined
          ? "Annie Spratt"
          : overrides.photographerName,
      photographerProfileUrl:
        overrides.photographerProfileUrl === undefined
          ? "https://unsplash.com/@anniespratt"
          : overrides.photographerProfileUrl,
      photoUrl:
        overrides.photoUrl === undefined
          ? "https://unsplash.com/photos/abc"
          : overrides.photoUrl,
      downloadLocation:
        overrides.downloadLocation ??
        "https://api.unsplash.com/photos/abc/download",
    };
  }

  it("on photo select: updates featuredImageUrl + featuredImageAlt + retains attribution metadata", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );

    const lastCall = mockedUnsplashPicker.mock.calls.at(-1)!;
    const { onSelect } = lastCall[0] as {
      onSelect: (photo: ReturnType<typeof fullPhoto>) => void;
    };
    onSelect(
      fullPhoto({
        providerPhotoId: "photo-x",
        regularUrl: "https://images.unsplash.com/photo-x?w=1080",
        altDescription: "A modern smart home",
      }),
    );

    expect(selectFeaturedImage).toHaveBeenCalledWith({
      imageUrl: "https://images.unsplash.com/photo-x?w=1080",
      altText: "A modern smart home",
      metadata: expect.objectContaining({
        provider: "unsplash",
        providerPhotoId: "photo-x",
        imageUrl: "https://images.unsplash.com/photo-x?w=1080",
        photographerName: "Annie Spratt",
        photographerProfileUrl: "https://unsplash.com/@anniespratt",
        photoUrl: "https://unsplash.com/photos/abc",
        downloadLocation: "https://api.unsplash.com/photos/abc/download",
        wpMediaId: null,
      }),
    });
  });

  it("falls back to description when altDescription is missing", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: ReturnType<typeof fullPhoto>) => void;
    };
    onSelect(fullPhoto({ description: "Wide shot of a desk" }));

    expect(selectFeaturedImage).toHaveBeenCalledWith(
      expect.objectContaining({ altText: "Wide shot of a desk" }),
    );
  });

  it("falls back to a 'Photo for <title>' alt when alt + description are both missing", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: ReturnType<typeof fullPhoto>) => void;
    };
    onSelect(fullPhoto({}));

    expect(selectFeaturedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        altText: `Photo for "${baseArticle.title}"`,
      }),
    );
  });

  it("falls back to an empty alt when alt + description + title are all missing", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(
      <ArticleDetailConnector
        {...baseProps}
        article={{
          ...baseArticle,
          targetKeyword: null,
          title: "",
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: ReturnType<typeof fullPhoto>) => void;
    };
    onSelect(fullPhoto({}));

    expect(selectFeaturedImage).toHaveBeenCalledWith(
      expect.objectContaining({ altText: "" }),
    );
  });

  it("forwards a null downloadLocation when Unsplash doesn't supply one", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: ReturnType<typeof fullPhoto>) => void;
    };
    // Unsplash optional fields can be missing entirely on the
    // result. Pass `undefined` to simulate.
    onSelect({
      ...fullPhoto({}),
      downloadLocation: undefined as unknown as string,
    });

    expect(selectFeaturedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ downloadLocation: null }),
      }),
    );
  });

  it("forwards null photographer fields when the provider doesn't supply them (e.g. AI image gen)", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: ReturnType<typeof fullPhoto>) => void;
    };
    onSelect(
      fullPhoto({
        photographerName: null,
        photographerProfileUrl: null,
        photoUrl: null,
      }),
    );

    expect(selectFeaturedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          photographerName: null,
          photographerProfileUrl: null,
          photoUrl: null,
        }),
      }),
    );
  });

  it("does NOT call save when a photo is selected — selection is form-state only", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: ReturnType<typeof fullPhoto>) => void;
    };
    onSelect(fullPhoto({ altDescription: "alt" }));

    expect(save).not.toHaveBeenCalled();
  });

  it("swallows recents-fetch errors silently — picker still opens with empty recents", async () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));
    mockedGetRecents.mockResolvedValueOnce({
      data: null,
      error: "db down",
    });

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    // Wait for the effect to settle (it's async even on the error path).
    await vi.waitFor(() => expect(mockedGetRecents).toHaveBeenCalled());

    const lastCall = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      recentUploads: unknown[];
    };
    // Stays as the initial empty array; the error is swallowed.
    expect(lastCall.recentUploads).toEqual([]);
  });

  it("loads recently-used uploads when the picker opens and forwards them to the picker", async () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));
    const recents = [
      {
        id: "row-1",
        imageUrl: "https://example.com/used.jpg",
        altText: "Previously used",
        provider: "unsplash",
        providerPhotoId: "abc",
        photographerName: "Annie Spratt",
        photographerProfileUrl: "https://unsplash.com/@anniespratt",
        photoUrl: "https://unsplash.com/photos/abc",
        downloadLocation: "https://api.unsplash.com/photos/abc/download",
        wpMediaId: 99,
      },
    ];
    mockedGetRecents.mockResolvedValueOnce({ data: recents, error: null });

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );

    expect(mockedGetRecents).toHaveBeenCalledWith("t1", "b1");
    // Wait for the effect's async fetch to resolve and re-render.
    await vi.waitFor(() => {
      const lastCall = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
        recentUploads: typeof recents;
      };
      expect(lastCall.recentUploads).toEqual(recents);
    });
  });

  it("on recent select: calls selectFeaturedImage with the row's metadata + cached wpMediaId", async () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));
    const recents = [
      {
        id: "row-1",
        imageUrl: "https://example.com/used.jpg",
        altText: "Reused",
        provider: "unsplash",
        providerPhotoId: "abc",
        photographerName: "Annie Spratt",
        photographerProfileUrl: "https://unsplash.com/@anniespratt",
        photoUrl: "https://unsplash.com/photos/abc",
        downloadLocation: "https://api.unsplash.com/photos/abc/download",
        wpMediaId: 99,
      },
    ];
    mockedGetRecents.mockResolvedValueOnce({ data: recents, error: null });

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    await vi.waitFor(() => {
      const lastCall = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
        recentUploads: typeof recents;
      };
      expect(lastCall.recentUploads).toEqual(recents);
    });

    const { onSelectRecent } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelectRecent: (u: (typeof recents)[number]) => void;
    };
    onSelectRecent(recents[0]!);

    expect(selectFeaturedImage).toHaveBeenCalledWith({
      imageUrl: "https://example.com/used.jpg",
      altText: "Reused",
      metadata: expect.objectContaining({
        provider: "unsplash",
        providerPhotoId: "abc",
        imageUrl: "https://example.com/used.jpg",
        altText: "Reused",
        photographerName: "Annie Spratt",
        wpMediaId: 99,
      }),
    });
  });

  it("uses an empty alt when the recent row has no altText", async () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));
    const recents = [
      {
        id: "row-1",
        imageUrl: "https://example.com/used.jpg",
        altText: null,
        provider: "manual_url",
        providerPhotoId: null,
        photographerName: null,
        photographerProfileUrl: null,
        photoUrl: null,
        downloadLocation: null,
        wpMediaId: null,
      },
    ];
    mockedGetRecents.mockResolvedValueOnce({ data: recents, error: null });

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    await vi.waitFor(() => expect(mockedUnsplashPicker).toHaveBeenCalled());

    const { onSelectRecent } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelectRecent: (u: (typeof recents)[number]) => void;
    };
    onSelectRecent(recents[0]!);

    expect(selectFeaturedImage).toHaveBeenCalledWith(
      expect.objectContaining({ altText: "" }),
    );
  });

  it("closes the picker when its onClose fires", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));

    render(<ArticleDetailConnector {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    expect(screen.getByTestId("unsplash-picker")).toBeInTheDocument();

    const { onClose } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onClose: () => void;
    };
    // Simulate a close from the modal (escape, backdrop click, etc.).
    // Wrap in act() so React flushes the resulting state update +
    // re-render before our assertion reads from the DOM.
    act(() => onClose());
    // After the re-render the picker mock returns the "closed" stub.
    expect(screen.queryByTestId("unsplash-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("unsplash-picker-closed")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Section image picker target — discriminator + per-slot handlers
// ---------------------------------------------------------------------------
describe("ArticleDetailConnector — section image picker", () => {
  /**
   * Helper: render the connector in edit mode WITH the section
   * surface enabled (i.e. `initialSectionImages` passed). Also
   * stub the body so the form's section card renders two H2 slots
   * (`intro`, `faq`).
   */
  function renderWithSections(
    overrides: {
      sectionImages?: Record<string, { imageUrl: string; altText: string }>;
    } = {},
  ) {
    mockedUseArticleEdit.mockReturnValue(
      defaultHookValue({
        isEditing: true,
        value: {
          title: baseArticle.title,
          slug: "",
          excerpt: "",
          metaDescription: "",
          targetKeyword: "launch b2b blog",
          contentMarkdown: "## Intro\n\nBody.\n\n## FAQ\n\nBody.\n",
          featuredImageUrl: "",
          featuredImageAlt: "",
        },
        sectionImages: Object.fromEntries(
          Object.entries(overrides.sectionImages ?? {}).map(([k, v]) => [
            k,
            {
              sectionKey: k,
              sectionHeading: k,
              sortOrder: 0,
              imageUrl: v.imageUrl,
              altText: v.altText,
              metadata: null,
            },
          ]),
        ),
      }),
    );
    return render(
      <ArticleDetailConnector {...baseProps} initialSectionImages={[]} />,
    );
  }

  it("does NOT render the section editor when initialSectionImages is omitted", () => {
    mockedUseArticleEdit.mockReturnValue(defaultHookValue({ isEditing: true }));
    render(<ArticleDetailConnector {...baseProps} />);
    expect(screen.queryByText(/^Section images$/i)).not.toBeInTheDocument();
  });

  it("renders the section editor when initialSectionImages is supplied", () => {
    renderWithSections();
    expect(
      screen.getByRole("heading", { name: /^Section images$/i }),
    ).toBeInTheDocument();
    // Two H2s in the body → two "Pick image" buttons.
    expect(
      screen.getAllByRole("button", { name: /^Pick image$/i }),
    ).toHaveLength(2);
  });

  it("opens the picker with the section heading as the search query when 'Pick image' is clicked", () => {
    renderWithSections();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Pick image$/i })[0]!,
    );
    // The connector calls `unsplash.setQuery(section.sectionHeading)`
    // before opening the picker.
    expect(unsplashSetQuery).toHaveBeenCalledWith("Intro");
    expect(screen.getByTestId("unsplash-picker")).toBeInTheDocument();
  });

  it("forwards a section selection to selectSectionImage (NOT selectFeaturedImage)", () => {
    renderWithSections();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Pick image$/i })[0]!,
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (photo: unknown) => void;
    };
    onSelect({
      provider: "unsplash",
      providerPhotoId: "abc",
      thumbUrl: "https://x.com/t",
      regularUrl: "https://x.com/r",
      fullUrl: null,
      altDescription: "A great photo",
      description: null,
      photographerName: "Annie",
      photographerProfileUrl: "https://unsplash.com/@annie",
      photoUrl: "https://unsplash.com/photos/abc",
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
    });

    expect(selectFeaturedImage).not.toHaveBeenCalled();
    expect(selectSectionImage).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "intro",
        sectionHeading: "Intro",
        sortOrder: 0,
        imageUrl: "https://x.com/r",
        altText: "A great photo",
        metadata: expect.objectContaining({
          provider: "unsplash",
          providerPhotoId: "abc",
          role: "section",
          sectionKey: "intro",
          sectionHeading: "Intro",
          sortOrder: 0,
          wpMediaId: null,
        }),
      }),
    );
  });

  it("normalizes null photographer / photo URL fields on section picks (forwards as null)", () => {
    renderWithSections();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Pick image$/i })[0]!,
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: unknown) => void;
    };
    // Simulate a future provider (or Unsplash row missing optional
    // fields) — every nullable field is null. The connector should
    // forward each as `null` instead of `undefined`.
    onSelect({
      provider: "ai",
      providerPhotoId: "gen-1",
      thumbUrl: "https://x.com/t",
      regularUrl: "https://x.com/r",
      fullUrl: null,
      altDescription: "AI generated photo",
      description: null,
      photographerName: null,
      photographerProfileUrl: null,
      photoUrl: null,
      downloadLocation: null,
    });
    expect(selectSectionImage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          provider: "ai",
          photographerName: null,
          photographerProfileUrl: null,
          photoUrl: null,
          downloadLocation: null,
        }),
      }),
    );
  });

  it("falls back to 'Image for <heading>' when the photo has no descriptions", () => {
    renderWithSections();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Pick image$/i })[1]!, // FAQ
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: unknown) => void;
    };
    onSelect({
      provider: "unsplash",
      providerPhotoId: "x",
      thumbUrl: "https://x.com/t",
      regularUrl: "https://x.com/r",
      fullUrl: null,
      altDescription: null,
      description: null,
      photographerName: "A",
      photographerProfileUrl: "https://unsplash.com/@a",
      photoUrl: "https://unsplash.com/photos/x",
      downloadLocation: null,
    });
    expect(selectSectionImage).toHaveBeenCalledWith(
      expect.objectContaining({ altText: 'Image for "FAQ"' }),
    );
  });

  it("falls back to '' when alt + description AND the section heading are all blank", () => {
    mockedUseArticleEdit.mockReturnValue(
      defaultHookValue({
        isEditing: true,
        value: {
          title: "",
          slug: "",
          excerpt: "",
          metaDescription: "",
          targetKeyword: "",
          contentMarkdown: "## \n\nBody.\n", // empty H2 → synthetic key
          featuredImageUrl: "",
          featuredImageAlt: "",
        },
        sectionImages: {},
      }),
    );
    render(<ArticleDetailConnector {...baseProps} initialSectionImages={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Pick image$/i }));
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: unknown) => void;
    };
    onSelect({
      provider: "unsplash",
      providerPhotoId: "x",
      thumbUrl: "https://x.com/t",
      regularUrl: "https://x.com/r",
      fullUrl: null,
      altDescription: null,
      description: null,
      photographerName: "A",
      photographerProfileUrl: null,
      photoUrl: null,
      downloadLocation: null,
    });
    expect(selectSectionImage).toHaveBeenCalledWith(
      expect.objectContaining({ altText: "" }),
    );
  });

  it("clears the section image when the slot's Remove button is clicked", () => {
    renderWithSections({
      sectionImages: {
        intro: { imageUrl: "https://example.com/intro.jpg", altText: "Hero" },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/i }));
    expect(clearSectionImage).toHaveBeenCalledWith("intro");
  });

  it("updates the section image alt via setSectionImageAlt", () => {
    renderWithSections({
      sectionImages: {
        intro: { imageUrl: "https://example.com/intro.jpg", altText: "Old" },
      },
    });
    fireEvent.change(screen.getByLabelText(/section image alt text/i), {
      target: { value: "New alt" },
    });
    expect(setSectionImageAlt).toHaveBeenCalledWith("intro", "New alt");
  });

  it("routes the picker to selectSectionImage when a recently-used image is picked from a section context", async () => {
    renderWithSections();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Pick image$/i })[0]!,
    );
    // Wait for recents fetch effect to fire (default mock resolves []).
    await vi.waitFor(() => expect(mockedGetRecents).toHaveBeenCalled());

    const { onSelectRecent } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelectRecent: (u: {
        id: string;
        imageUrl: string;
        altText: string | null;
        provider: string;
        providerPhotoId: string | null;
        photographerName: string | null;
        photographerProfileUrl: string | null;
        photoUrl: string | null;
        downloadLocation: string | null;
        wpMediaId: number | null;
      }) => void;
    };
    onSelectRecent({
      id: "row-1",
      imageUrl: "https://example.com/reused.jpg",
      altText: "Reused alt",
      provider: "unsplash",
      providerPhotoId: "abc",
      photographerName: "Annie",
      photographerProfileUrl: "https://unsplash.com/@a",
      photoUrl: "https://unsplash.com/photos/abc",
      downloadLocation: "https://api.unsplash.com/photos/abc/download",
      wpMediaId: 99,
    });

    expect(selectFeaturedImage).not.toHaveBeenCalled();
    expect(selectSectionImage).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "intro",
        imageUrl: "https://example.com/reused.jpg",
        altText: "Reused alt",
        metadata: expect.objectContaining({
          role: "section",
          wpMediaId: 99,
        }),
      }),
    );
  });

  it("recent selection in a section context falls back to '' when altText is null", async () => {
    renderWithSections();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Pick image$/i })[0]!,
    );
    await vi.waitFor(() => expect(mockedGetRecents).toHaveBeenCalled());

    const { onSelectRecent } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelectRecent: (u: {
        id: string;
        imageUrl: string;
        altText: string | null;
        provider: string;
        providerPhotoId: string | null;
        photographerName: string | null;
        photographerProfileUrl: string | null;
        photoUrl: string | null;
        downloadLocation: string | null;
        wpMediaId: number | null;
      }) => void;
    };
    onSelectRecent({
      id: "row-1",
      imageUrl: "https://example.com/x.jpg",
      altText: null,
      provider: "manual_url",
      providerPhotoId: null,
      photographerName: null,
      photographerProfileUrl: null,
      photoUrl: null,
      downloadLocation: null,
      wpMediaId: null,
    });
    expect(selectSectionImage).toHaveBeenCalledWith(
      expect.objectContaining({ altText: "" }),
    );
  });

  it("clicking the featured 'Pick from image library' button after a section pick re-targets the picker", () => {
    renderWithSections();
    // First open the picker for the intro section.
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Pick image$/i })[0]!,
    );
    // Then click the featured-image picker button.
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    // The query should now be the featured default (target keyword).
    expect(unsplashSetQuery).toHaveBeenLastCalledWith("launch b2b blog");

    // A subsequent onSelect goes to selectFeaturedImage.
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: unknown) => void;
    };
    onSelect({
      provider: "unsplash",
      providerPhotoId: "z",
      thumbUrl: "https://x.com/t",
      regularUrl: "https://x.com/r",
      fullUrl: null,
      altDescription: "Hero",
      description: null,
      photographerName: "Annie",
      photographerProfileUrl: "https://unsplash.com/@a",
      photoUrl: "https://unsplash.com/photos/z",
      downloadLocation: null,
    });
    expect(selectFeaturedImage).toHaveBeenCalled();
    expect(selectSectionImage).not.toHaveBeenCalled();
  });

  it("closing the picker mid-section then opening the featured picker correctly re-targets", () => {
    renderWithSections();
    // Open the picker for the intro section.
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Pick image$/i })[0]!,
    );
    // Close (escape / backdrop).
    const closeProps = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onClose: () => void;
    };
    act(() => closeProps.onClose());
    // Open the featured picker — should route the next selection to
    // selectFeaturedImage, NOT selectSectionImage.
    fireEvent.click(
      screen.getByRole("button", { name: /pick from image library/i }),
    );
    const { onSelect } = mockedUnsplashPicker.mock.calls.at(-1)![0] as {
      onSelect: (p: unknown) => void;
    };
    onSelect({
      provider: "unsplash",
      providerPhotoId: "x",
      thumbUrl: "",
      regularUrl: "https://x.com/r",
      altDescription: "Hero",
      description: null,
      photographerName: "A",
      photographerProfileUrl: null,
      photoUrl: null,
      downloadLocation: null,
    });
    expect(selectFeaturedImage).toHaveBeenCalled();
    expect(selectSectionImage).not.toHaveBeenCalled();
  });
});
