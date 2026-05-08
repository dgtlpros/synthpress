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
});
