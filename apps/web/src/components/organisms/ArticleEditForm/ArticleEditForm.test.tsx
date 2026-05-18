import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArticleEditForm, type ArticleEditFormValue } from "./ArticleEditForm";

afterEach(cleanup);

const baseValue: ArticleEditFormValue = {
  title: "Title",
  slug: "title",
  excerpt: "Excerpt.",
  metaDescription: "Meta description.",
  targetKeyword: "kw",
  contentMarkdown: "# Heading\n\nBody.",
  featuredImageUrl: "",
  featuredImageAlt: "",
};

describe("ArticleEditForm", () => {
  it("renders all editable fields with the supplied values", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe(
      baseValue.title,
    );
    expect((screen.getByLabelText(/^slug/i) as HTMLInputElement).value).toBe(
      baseValue.slug,
    );
    expect(
      (screen.getByLabelText(/target keyword/i) as HTMLInputElement).value,
    ).toBe(baseValue.targetKeyword);
    expect(
      (screen.getByLabelText(/excerpt/i) as HTMLTextAreaElement).value,
    ).toBe(baseValue.excerpt);
    expect(
      (screen.getByLabelText(/meta description/i) as HTMLTextAreaElement).value,
    ).toBe(baseValue.metaDescription);
    expect(
      (screen.getByLabelText(/article body/i) as HTMLTextAreaElement).value,
    ).toBe(baseValue.contentMarkdown);
  });

  it("calls onChange with the targeted key for every editable field", () => {
    const onChange = vi.fn();
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={onChange}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "New title" },
    });
    fireEvent.change(screen.getByLabelText(/^slug/i), {
      target: { value: "new-slug" },
    });
    fireEvent.change(screen.getByLabelText(/target keyword/i), {
      target: { value: "new keyword" },
    });
    fireEvent.change(screen.getByLabelText(/excerpt/i), {
      target: { value: "new excerpt" },
    });
    fireEvent.change(screen.getByLabelText(/meta description/i), {
      target: { value: "new meta" },
    });
    fireEvent.change(screen.getByLabelText(/article body/i), {
      target: { value: "new body" },
    });

    expect(onChange).toHaveBeenCalledWith("title", "New title");
    expect(onChange).toHaveBeenCalledWith("slug", "new-slug");
    expect(onChange).toHaveBeenCalledWith("targetKeyword", "new keyword");
    expect(onChange).toHaveBeenCalledWith("excerpt", "new excerpt");
    expect(onChange).toHaveBeenCalledWith("metaDescription", "new meta");
    expect(onChange).toHaveBeenCalledWith("contentMarkdown", "new body");
  });

  it("submits the form when Save is clicked", () => {
    const onSubmit = vi.fn();
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("does not submit when isSaving is true", () => {
    const onSubmit = vi.fn();
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        isSaving
      />,
    );
    fireEvent.submit(
      (screen.getByLabelText(/title/i) as HTMLInputElement).closest("form")!,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables inputs while saving", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        isSaving
      />,
    );
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
    expect(screen.getByLabelText(/article body/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });

  it("disables Save when title is empty", () => {
    render(
      <ArticleEditForm
        value={{ ...baseValue, title: "   " }}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders the inline error when errorMessage is provided", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        errorMessage="Title is required."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/title is required/i);
  });

  it("renders the featured image URL + alt inputs", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/featured image url/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/featured image alt text/i),
    ).toBeInTheDocument();
  });

  it("calls onChange with featuredImageUrl when the URL input changes", () => {
    const onChange = vi.fn();
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={onChange}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/featured image url/i), {
      target: { value: "https://example.com/img.jpg" },
    });
    expect(onChange).toHaveBeenCalledWith(
      "featuredImageUrl",
      "https://example.com/img.jpg",
    );
  });

  it("calls onChange with featuredImageAlt when the alt input changes", () => {
    const onChange = vi.fn();
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={onChange}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/featured image alt text/i), {
      target: { value: "A cat" },
    });
    expect(onChange).toHaveBeenCalledWith("featuredImageAlt", "A cat");
  });

  it("renders the featured image preview when a URL is set", () => {
    render(
      <ArticleEditForm
        value={{
          ...baseValue,
          featuredImageUrl: "https://example.com/img.jpg",
          featuredImageAlt: "A cat",
        }}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const preview = screen.getByAltText("A cat") as HTMLImageElement;
    expect(preview).toBeInTheDocument();
    expect(preview.src).toBe("https://example.com/img.jpg");
  });

  it("falls back to a generic preview alt when none is provided", () => {
    render(
      <ArticleEditForm
        value={{
          ...baseValue,
          featuredImageUrl: "https://example.com/img.jpg",
          featuredImageAlt: "",
        }}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByAltText(/featured image preview/i)).toBeInTheDocument();
  });

  it("hides the featured-image preview block when no URL is set", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    // The Markdown body card has its own collapsible <summary>Preview</summary>;
    // the featured-image preview is in a <p>Preview</p>. Scope the
    // query to the paragraph variant to assert the image preview is
    // missing without colliding with the markdown one.
    const previewLabels = screen.queryAllByText(/^Preview$/);
    expect(previewLabels.every((el) => el.tagName !== "P")).toBe(true);
    expect(
      screen.queryByAltText(/featured image preview/i),
    ).not.toBeInTheDocument();
  });

  it("disables the featured image inputs while saving", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        isSaving
      />,
    );
    expect(screen.getByLabelText(/featured image url/i)).toBeDisabled();
    expect(screen.getByLabelText(/featured image alt text/i)).toBeDisabled();
  });

  it("does NOT render 'Pick from Unsplash' when no callback is provided", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /pick from unsplash/i }),
    ).not.toBeInTheDocument();
  });

  it("renders 'Pick from Unsplash' when onPickFromUnsplash is provided", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        onPickFromUnsplash={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /pick from unsplash/i }),
    ).toBeInTheDocument();
  });

  it("fires onPickFromUnsplash when the button is clicked", () => {
    const onPick = vi.fn();
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        onPickFromUnsplash={onPick}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /pick from unsplash/i }),
    );
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("disables the Pick from Unsplash button while saving", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        onPickFromUnsplash={vi.fn()}
        isSaving
      />,
    );
    expect(
      screen.getByRole("button", { name: /pick from unsplash/i }),
    ).toBeDisabled();
  });

  it("renders the markdown preview inside the details disclosure", () => {
    render(
      <ArticleEditForm
        value={baseValue}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    // Heading is rendered by the MarkdownPreview inside the <details>.
    expect(
      screen.getByRole("heading", { level: 1, name: /heading/i }),
    ).toBeInTheDocument();
  });

  it("shows a placeholder in the preview when the body is empty", () => {
    render(
      <ArticleEditForm
        value={{ ...baseValue, contentMarkdown: "   " }}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nothing to preview yet/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Section images card — only renders when the connector wires it in
  // -------------------------------------------------------------------------
  describe("Section images card", () => {
    const sectionBody = "## Intro\n\nBody.\n\n## FAQ\n\nBody.\n";

    function renderSectionsForm(
      overrides: Partial<{
        sectionImages: Record<string, { imageUrl: string; altText: string }>;
        onPickSectionImage: (s: { sectionKey: string }) => void;
        onSectionImageAltChange: (k: string, alt: string) => void;
        onClearSectionImage: (k: string) => void;
        contentMarkdown: string;
        isSaving: boolean;
      }> = {},
    ) {
      return render(
        <ArticleEditForm
          value={{
            ...baseValue,
            contentMarkdown: overrides.contentMarkdown ?? sectionBody,
          }}
          onChange={vi.fn()}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          isSaving={overrides.isSaving}
          sectionImages={overrides.sectionImages ?? {}}
          onPickSectionImage={overrides.onPickSectionImage ?? vi.fn()}
          onSectionImageAltChange={
            overrides.onSectionImageAltChange ?? vi.fn()
          }
          onClearSectionImage={overrides.onClearSectionImage ?? vi.fn()}
        />,
      );
    }

    it("does NOT render the Section images card when no section props are supplied", () => {
      render(
        <ArticleEditForm
          value={{ ...baseValue, contentMarkdown: sectionBody }}
          onChange={vi.fn()}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
      expect(screen.queryByText(/Section images/i)).not.toBeInTheDocument();
    });

    it("renders a slot for every H2 derived from the body", () => {
      renderSectionsForm();
      expect(
        screen.getByRole("heading", { name: /^Section images$/i }),
      ).toBeInTheDocument();
      // "Intro" + "FAQ" appear in both the markdown preview (as
      // headings) AND the section slot labels. Two of each is the
      // expected count.
      expect(screen.getAllByText("Intro")).toHaveLength(2);
      expect(screen.getAllByText("FAQ")).toHaveLength(2);
      // Two "Pick image" buttons — one per H2.
      expect(
        screen.getAllByRole("button", { name: /^Pick image$/i }),
      ).toHaveLength(2);
    });

    it("shows the empty-state copy when the body has no H2 sections", () => {
      renderSectionsForm({ contentMarkdown: "# Title\n\nNo H2 here.\n" });
      expect(
        screen.getByText(
          /Add H2 sections to your article to attach section images/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^Pick image$/i }),
      ).not.toBeInTheDocument();
    });

    it("fires onPickSectionImage with the section descriptor when a slot's button is clicked", () => {
      const onPick = vi.fn();
      renderSectionsForm({ onPickSectionImage: onPick });
      const buttons = screen.getAllByRole("button", { name: /^Pick image$/i });
      fireEvent.click(buttons[0]!);
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionKey: "intro",
          sectionHeading: "Intro",
          sortOrder: 0,
        }),
      );
    });

    it("renders the preview + alt input + Remove button when the slot has an image", () => {
      renderSectionsForm({
        sectionImages: {
          intro: {
            imageUrl: "https://example.com/intro.jpg",
            altText: "Intro alt",
          },
        },
      });
      // Preview img
      expect(
        screen.getByRole("img", { name: /Intro alt/i }),
      ).toBeInTheDocument();
      // Alt input (scoped to "Section image alt text" so it
      // doesn't collide with the Featured image alt label).
      expect(
        (
          screen.getByLabelText(/section image alt text/i) as HTMLInputElement
        ).value,
      ).toBe("Intro alt");
      // Remove button on the intro slot
      expect(
        screen.getByRole("button", { name: /^Remove$/i }),
      ).toBeInTheDocument();
      // Status copy
      expect(screen.getByText("Image attached")).toBeInTheDocument();
    });

    it("button text flips to 'Replace image' when a slot has an image", () => {
      renderSectionsForm({
        sectionImages: {
          intro: { imageUrl: "https://example.com/i.jpg", altText: "" },
        },
      });
      expect(
        screen.getByRole("button", { name: /Replace image/i }),
      ).toBeInTheDocument();
      // FAQ slot is still empty → still "Pick image"
      expect(
        screen.getByRole("button", { name: /^Pick image$/i }),
      ).toBeInTheDocument();
    });

    it("fires onSectionImageAltChange with the sectionKey + new alt text", () => {
      const onAlt = vi.fn();
      renderSectionsForm({
        sectionImages: {
          intro: { imageUrl: "https://example.com/i.jpg", altText: "old" },
        },
        onSectionImageAltChange: onAlt,
      });
      fireEvent.change(screen.getByLabelText(/section image alt text/i), {
        target: { value: "new alt" },
      });
      expect(onAlt).toHaveBeenCalledWith("intro", "new alt");
    });

    it("fires onClearSectionImage with the sectionKey when Remove is clicked", () => {
      const onClear = vi.fn();
      renderSectionsForm({
        sectionImages: {
          intro: { imageUrl: "https://example.com/i.jpg", altText: "x" },
        },
        onClearSectionImage: onClear,
      });
      fireEvent.click(screen.getByRole("button", { name: /^Remove$/i }));
      expect(onClear).toHaveBeenCalledWith("intro");
    });

    it("disables Pick / Replace / Remove + alt input while saving", () => {
      renderSectionsForm({
        isSaving: true,
        sectionImages: {
          intro: { imageUrl: "https://example.com/i.jpg", altText: "x" },
        },
      });
      expect(
        screen.getByRole("button", { name: /Replace image/i }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Remove$/i })).toBeDisabled();
      expect(
        screen.getByLabelText(/section image alt text/i),
      ).toBeDisabled();
    });

    it("uses a fallback display label when a heading is empty", () => {
      // `## ` parses as an empty H2; the parser produces a synthetic
      // section-1 key. The slot UI shows the fallback label so the
      // row is still identifiable.
      renderSectionsForm({ contentMarkdown: "## \n\nBody.\n" });
      expect(screen.getByText("(empty heading)")).toBeInTheDocument();
    });

    it("uses 'Section image preview' as the img alt when no alt text is set", () => {
      renderSectionsForm({
        sectionImages: {
          intro: { imageUrl: "https://example.com/i.jpg", altText: "" },
        },
      });
      expect(
        screen.getByRole("img", { name: /Section image preview/i }),
      ).toBeInTheDocument();
    });
  });
});
