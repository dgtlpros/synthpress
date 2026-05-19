import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/articles", () => ({
  updateArticle: vi.fn(),
}));

import { updateArticle } from "@/actions/articles";
import { useArticleEdit, type ArticleEditFormValue } from "./useArticleEdit";

const mockedUpdate = vi.mocked(updateArticle);

const initialValue: ArticleEditFormValue = {
  title: "Initial title",
  slug: "initial-slug",
  excerpt: "Initial excerpt",
  metaDescription: "Initial meta description",
  targetKeyword: "initial",
  contentMarkdown: "Initial body.",
  featuredImageUrl: "",
  featuredImageAlt: "",
};

const baseProps = {
  teamId: "t1",
  projectId: "p1",
  blogId: "b1",
  articleId: "a1",
  initialValue,
};

beforeEach(() => {
  refreshMock.mockClear();
  mockedUpdate.mockReset();
});

describe("useArticleEdit", () => {
  it("starts in read mode with the initial value", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    expect(result.current.isEditing).toBe(false);
    expect(result.current.value).toEqual(initialValue);
  });

  it("enters edit mode and resets the form to the initial value", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => {
      result.current.setField("title", "user typed something");
    });
    expect(result.current.value.title).toBe("user typed something");

    act(() => result.current.enterEdit());
    expect(result.current.isEditing).toBe(true);
    expect(result.current.value).toEqual(initialValue);
  });

  it("cancelEdit exits edit mode and resets the form", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() => result.current.setField("title", "X"));
    act(() => result.current.cancelEdit());

    expect(result.current.isEditing).toBe(false);
    expect(result.current.value).toEqual(initialValue);
  });

  it("setField updates only the targeted key", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.setField("excerpt", "new excerpt"));
    expect(result.current.value.excerpt).toBe("new excerpt");
    expect(result.current.value.title).toBe(initialValue.title);
  });

  it("calls the action with trimmed/null-coalesced fields on save (mixed)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() => {
      result.current.setField("title", "  Edited title  ");
      result.current.setField("slug", "   ");
      result.current.setField("excerpt", "");
      result.current.setField("metaDescription", "  meta  ");
      result.current.setField("targetKeyword", "  kw  ");
      result.current.setField("contentMarkdown", "  body.  ");
      result.current.setField(
        "featuredImageUrl",
        "  https://example.com/img.jpg  ",
      );
      result.current.setField("featuredImageAlt", "  A photo  ");
    });

    act(() => result.current.save());

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", "a1", {
        // title is NOT trimmed at the boundary — the service does the trim;
        // the hook just collapses other blanks to null.
        title: "  Edited title  ",
        slug: null,
        excerpt: null,
        metaDescription: "meta",
        targetKeyword: "kw",
        contentMarkdown: "body.",
        featuredImageUrl: "https://example.com/img.jpg",
        featuredImageAlt: "A photo",
        selectedImageMetadata: null,
      });
    });
  });

  it("collapses every blank optional field to null", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialValue: {
          title: "Title",
          slug: "  ",
          excerpt: "",
          metaDescription: "   ",
          targetKeyword: "",
          contentMarkdown: "  ",
          featuredImageUrl: "   ",
          featuredImageAlt: "",
        },
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", "a1", {
        title: "Title",
        slug: null,
        excerpt: null,
        metaDescription: null,
        targetKeyword: null,
        contentMarkdown: null,
        featuredImageUrl: null,
        featuredImageAlt: null,
        selectedImageMetadata: null,
      });
    });
  });

  it("preserves non-blank optional fields", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialValue: {
          title: "Title",
          slug: "the-slug",
          excerpt: "An excerpt.",
          metaDescription: "A meta.",
          targetKeyword: "kw",
          contentMarkdown: "Body.",
          featuredImageUrl: "https://example.com/img.jpg",
          featuredImageAlt: "A photo",
        },
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", "a1", {
        title: "Title",
        slug: "the-slug",
        excerpt: "An excerpt.",
        metaDescription: "A meta.",
        targetKeyword: "kw",
        contentMarkdown: "Body.",
        featuredImageUrl: "https://example.com/img.jpg",
        featuredImageAlt: "A photo",
        selectedImageMetadata: null,
      });
    });
  });

  it("exits edit mode + refreshes the route on a successful save", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());

    act(() => result.current.save());

    await waitFor(() => {
      expect(result.current.isEditing).toBe(false);
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(result.current.isSaving).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  it("invokes onSaved with the action result", async () => {
    const onSaved = vi.fn();
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({ ...baseProps, onSaved }),
    );

    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        articleId: "a1",
        status: "ready_for_review",
      });
    });
  });

  it("surfaces save errors and stays in edit mode", async () => {
    mockedUpdate.mockResolvedValue({
      data: null,
      error: "Title is required.",
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());

    act(() => result.current.save());

    await waitFor(() => {
      expect(result.current.saveError).toBe("Title is required.");
    });
    expect(result.current.isEditing).toBe(true);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("clears the save error via resetSaveError", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: "boom" });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() => result.current.save());
    await waitFor(() => {
      expect(result.current.saveError).toBe("boom");
    });

    act(() => result.current.resetSaveError());
    expect(result.current.saveError).toBeNull();
  });

  // --------------------------------------------------------------
  // selectFeaturedImage + pending-metadata behavior
  // --------------------------------------------------------------

  const SAMPLE_METADATA = {
    provider: "unsplash",
    providerPhotoId: "abc",
    imageUrl: "https://images.unsplash.com/photo-abc?w=1080",
    altText: "Desk with laptop",
    photographerName: "Annie Spratt",
    photographerProfileUrl: "https://unsplash.com/@anniespratt",
    photoUrl: "https://unsplash.com/photos/abc",
    downloadLocation: "https://api.unsplash.com/photos/abc/download",
    wpMediaId: null,
  };

  it("selectFeaturedImage updates URL + alt + retains metadata for save", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectFeaturedImage({
        imageUrl: SAMPLE_METADATA.imageUrl,
        altText: "Desk with laptop",
        metadata: SAMPLE_METADATA,
      }),
    );

    expect(result.current.value.featuredImageUrl).toBe(
      SAMPLE_METADATA.imageUrl,
    );
    expect(result.current.value.featuredImageAlt).toBe("Desk with laptop");

    act(() => result.current.save());
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({
          featuredImageUrl: SAMPLE_METADATA.imageUrl,
          featuredImageAlt: "Desk with laptop",
          selectedImageMetadata: SAMPLE_METADATA,
        }),
      );
    });
  });

  it("auto-clears pending metadata when the user manually edits the URL field", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectFeaturedImage({
        imageUrl: SAMPLE_METADATA.imageUrl,
        altText: "Desk with laptop",
        metadata: SAMPLE_METADATA,
      }),
    );
    // User edits the URL by hand → metadata should drop.
    act(() =>
      result.current.setField(
        "featuredImageUrl",
        "https://example.com/manual.jpg",
      ),
    );

    act(() => result.current.save());
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({
          featuredImageUrl: "https://example.com/manual.jpg",
          selectedImageMetadata: null,
        }),
      );
    });
  });

  it("preserves pending metadata when setField writes the SAME URL the picker selected (no-op edit)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectFeaturedImage({
        imageUrl: SAMPLE_METADATA.imageUrl,
        altText: "Desk with laptop",
        metadata: SAMPLE_METADATA,
      }),
    );
    // setField with the same URL — happens if a controlled input
    // re-renders. Metadata should NOT be cleared.
    act(() =>
      result.current.setField("featuredImageUrl", SAMPLE_METADATA.imageUrl),
    );

    act(() => result.current.save());
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({
          selectedImageMetadata: SAMPLE_METADATA,
        }),
      );
    });
  });

  it("does NOT touch metadata when setField writes a non-URL field", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectFeaturedImage({
        imageUrl: SAMPLE_METADATA.imageUrl,
        altText: "Desk with laptop",
        metadata: SAMPLE_METADATA,
      }),
    );
    // Edit the alt field — metadata stays.
    act(() => result.current.setField("featuredImageAlt", "New alt"));

    act(() => result.current.save());
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({
          selectedImageMetadata: SAMPLE_METADATA,
        }),
      );
    });
  });

  it("clears pending metadata on cancelEdit", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectFeaturedImage({
        imageUrl: SAMPLE_METADATA.imageUrl,
        altText: "Desk with laptop",
        metadata: SAMPLE_METADATA,
      }),
    );
    act(() => result.current.cancelEdit());
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({ selectedImageMetadata: null }),
      );
    });
  });

  it("clears pending metadata on enterEdit", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectFeaturedImage({
        imageUrl: SAMPLE_METADATA.imageUrl,
        altText: "Desk with laptop",
        metadata: SAMPLE_METADATA,
      }),
    );
    // enterEdit again (e.g. after a back-and-forth) should also wipe
    // the pending metadata so the form starts from a clean slate.
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({ selectedImageMetadata: null }),
      );
    });
  });

  it("drops pending metadata after a successful save (so a follow-up save without a fresh pick doesn't re-insert)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectFeaturedImage({
        imageUrl: SAMPLE_METADATA.imageUrl,
        altText: "Desk with laptop",
        metadata: SAMPLE_METADATA,
      }),
    );
    act(() => result.current.save());
    await waitFor(() => expect(result.current.isSaving).toBe(false));

    // Re-enter + save without picking again. Metadata should be null.
    act(() => result.current.enterEdit());
    act(() => result.current.save());
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenLastCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({ selectedImageMetadata: null }),
      ),
    );
  });

  it("keeps pending metadata after a FAILED save (user can retry without re-picking)", async () => {
    mockedUpdate.mockResolvedValueOnce({ data: null, error: "boom" });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectFeaturedImage({
        imageUrl: SAMPLE_METADATA.imageUrl,
        altText: "Desk with laptop",
        metadata: SAMPLE_METADATA,
      }),
    );
    act(() => result.current.save());
    await waitFor(() => expect(result.current.saveError).toBe("boom"));

    // Retry — metadata is still in flight.
    mockedUpdate.mockResolvedValueOnce({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    act(() => result.current.save());
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenLastCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({ selectedImageMetadata: SAMPLE_METADATA }),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Section-image surface
// ---------------------------------------------------------------------------

const SECTION_METADATA = {
  provider: "unsplash",
  providerPhotoId: "sec-1",
  imageUrl: "https://example.com/section.jpg",
  altText: "Section hero",
  photographerName: "Pat",
  photographerProfileUrl: "https://unsplash.com/@pat",
  photoUrl: "https://unsplash.com/photos/sec-1",
  downloadLocation: "https://api.unsplash.com/photos/sec-1/download",
  wpMediaId: null,
};

describe("useArticleEdit — section images", () => {
  it("starts with an empty sectionImages map when no initial is supplied", () => {
    const { result } = renderHook(() => useArticleEdit(baseProps));
    expect(result.current.sectionImages).toEqual({});
  });

  it("seeds sectionImages from initialSectionImages keyed by sectionKey", () => {
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/intro.jpg",
            altText: "Intro alt",
          },
          {
            sectionKey: "faq",
            sectionHeading: "FAQ",
            sortOrder: 1,
            imageUrl: "https://example.com/faq.jpg",
            altText: null,
          },
        ],
      }),
    );
    expect(Object.keys(result.current.sectionImages).sort()).toEqual([
      "faq",
      "intro",
    ]);
    expect(result.current.sectionImages.intro).toMatchObject({
      sectionKey: "intro",
      sectionHeading: "Intro",
      sortOrder: 0,
      imageUrl: "https://example.com/intro.jpg",
      altText: "Intro alt",
      metadata: null,
    });
    // Null alt collapses to empty string for the controlled input.
    expect(result.current.sectionImages.faq?.altText).toBe("");
  });

  it("selectSectionImage adds a new draft with the supplied metadata", () => {
    const { result } = renderHook(() =>
      useArticleEdit({ ...baseProps, initialSectionImages: [] }),
    );
    act(() =>
      result.current.selectSectionImage({
        sectionKey: "intro",
        sectionHeading: "Intro",
        sortOrder: 0,
        imageUrl: SECTION_METADATA.imageUrl,
        altText: "Hero",
        metadata: SECTION_METADATA,
      }),
    );
    expect(result.current.sectionImages.intro).toMatchObject({
      imageUrl: SECTION_METADATA.imageUrl,
      altText: "Hero",
      metadata: SECTION_METADATA,
    });
  });

  it("selectSectionImage REPLACES an existing draft (fresh pick beats server-loaded row)", () => {
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/old.jpg",
            altText: "Old",
          },
        ],
      }),
    );
    act(() =>
      result.current.selectSectionImage({
        sectionKey: "intro",
        sectionHeading: "Intro",
        sortOrder: 0,
        imageUrl: "https://example.com/new.jpg",
        altText: "New",
        metadata: {
          ...SECTION_METADATA,
          imageUrl: "https://example.com/new.jpg",
        },
      }),
    );
    expect(result.current.sectionImages.intro?.imageUrl).toBe(
      "https://example.com/new.jpg",
    );
    expect(result.current.sectionImages.intro?.metadata).not.toBeNull();
  });

  it("setSectionImageAlt updates only the alt of an existing draft, preserving metadata=null for server rows", () => {
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/intro.jpg",
            altText: "Old alt",
          },
        ],
      }),
    );
    act(() => result.current.setSectionImageAlt("intro", "Updated alt"));
    expect(result.current.sectionImages.intro?.altText).toBe("Updated alt");
    // metadata stays null — the server-side sync UPDATEs the
    // existing row's alt without re-asserting attribution.
    expect(result.current.sectionImages.intro?.metadata).toBeNull();
  });

  it("setSectionImageAlt is a no-op when no draft exists for the key", () => {
    const { result } = renderHook(() =>
      useArticleEdit({ ...baseProps, initialSectionImages: [] }),
    );
    act(() => result.current.setSectionImageAlt("nonexistent", "x"));
    expect(result.current.sectionImages).toEqual({});
  });

  it("clearSectionImage drops the draft for the given key", () => {
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/intro.jpg",
            altText: "Intro",
          },
        ],
      }),
    );
    act(() => result.current.clearSectionImage("intro"));
    expect(result.current.sectionImages.intro).toBeUndefined();
  });

  it("clearSectionImage is a no-op when the key isn't in the draft map", () => {
    const { result } = renderHook(() =>
      useArticleEdit({ ...baseProps, initialSectionImages: [] }),
    );
    const before = result.current.sectionImages;
    act(() => result.current.clearSectionImage("never-existed"));
    // Same reference — no state churn = no re-render.
    expect(result.current.sectionImages).toBe(before);
  });

  it("save serializes the draft map into the action payload (with metadata for fresh picks)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({ ...baseProps, initialSectionImages: [] }),
    );
    act(() => result.current.enterEdit());
    act(() =>
      result.current.selectSectionImage({
        sectionKey: "intro",
        sectionHeading: "Intro",
        sortOrder: 0,
        imageUrl: SECTION_METADATA.imageUrl,
        altText: "Hero",
        metadata: SECTION_METADATA,
      }),
    );
    act(() => result.current.save());

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({
          sectionImages: [
            {
              sectionKey: "intro",
              sectionHeading: "Intro",
              sortOrder: 0,
              imageUrl: SECTION_METADATA.imageUrl,
              altText: "Hero",
              metadata: SECTION_METADATA,
            },
          ],
        }),
      ),
    );
  });

  it("save serializes alt-only edits with metadata=null (server preserves the existing row)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/intro.jpg",
            altText: "Old",
          },
        ],
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.setSectionImageAlt("intro", "Updated"));
    act(() => result.current.save());

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenLastCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({
          sectionImages: [
            expect.objectContaining({
              sectionKey: "intro",
              altText: "Updated",
              metadata: null,
            }),
          ],
        }),
      ),
    );
  });

  it("save serializes an empty array when the user cleared all sections (deletes all server rows)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/intro.jpg",
            altText: "Intro",
          },
        ],
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.clearSectionImage("intro"));
    act(() => result.current.save());

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenLastCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({ sectionImages: [] }),
      ),
    );
  });

  it("save omits sectionImages from the payload when initialSectionImages was never supplied (legacy mode)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() => useArticleEdit(baseProps));
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() => {
      const payload = mockedUpdate.mock.calls.at(-1)![4]!;
      expect(payload.sectionImages).toBeUndefined();
    });
  });

  it("cancelEdit re-seeds section drafts from initialSectionImages", () => {
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/intro.jpg",
            altText: "Server alt",
          },
        ],
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.setSectionImageAlt("intro", "User typed"));
    expect(result.current.sectionImages.intro?.altText).toBe("User typed");
    act(() => result.current.cancelEdit());
    expect(result.current.sectionImages.intro?.altText).toBe("Server alt");
  });

  it("enterEdit re-seeds section drafts from initialSectionImages (discards unsaved typing)", () => {
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/intro.jpg",
            altText: "Server alt",
          },
        ],
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.clearSectionImage("intro"));
    act(() => result.current.enterEdit());
    expect(result.current.sectionImages.intro?.altText).toBe("Server alt");
  });

  it("serializes draft alt='' as null in the action payload (collapses blank to null at the boundary)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "https://example.com/intro.jpg",
            altText: null, // null seeds altText="" in the draft
          },
        ],
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenLastCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({
          sectionImages: [
            expect.objectContaining({
              sectionKey: "intro",
              altText: null,
            }),
          ],
        }),
      ),
    );
  });

  it("drops empty-imageUrl drafts from the serialized payload (defensive)", async () => {
    mockedUpdate.mockResolvedValue({
      data: { articleId: "a1", status: "ready_for_review" },
      error: null,
    });
    const { result } = renderHook(() =>
      useArticleEdit({
        ...baseProps,
        initialSectionImages: [
          {
            sectionKey: "intro",
            sectionHeading: "Intro",
            sortOrder: 0,
            imageUrl: "   ", // blank URL — should NOT serialize
            altText: "alt",
          },
        ],
      }),
    );
    act(() => result.current.enterEdit());
    act(() => result.current.save());

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenLastCalledWith(
        "t1",
        "p1",
        "b1",
        "a1",
        expect.objectContaining({ sectionImages: [] }),
      ),
    );
  });
});
