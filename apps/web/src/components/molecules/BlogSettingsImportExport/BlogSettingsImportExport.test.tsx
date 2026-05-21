import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import {
  buildBlogSettingsTemplate,
  buildBlogSettingsTemplateChangesPreview,
  serializeBlogSettingsTemplate,
} from "@/lib/blog-settings-template";
import {
  BlogSettingsImportExport,
  type BlogSettingsImportExportImportState,
  type BlogSettingsImportExportProps,
} from "./BlogSettingsImportExport";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(cleanup);

const sampleTemplate = buildBlogSettingsTemplate({
  blog: {
    name: "Indie",
    description: "Stories.",
    niche: "indie hackers",
    keywords: ["ai", "saas"],
    aiPromptTemplate: "",
  },
  settings: DEFAULT_BLOG_SETTINGS,
  exportedAt: "2026-05-20T18:00:00.000Z",
});
const sampleJson = serializeBlogSettingsTemplate(sampleTemplate);
const sampleChanges = buildBlogSettingsTemplateChangesPreview(sampleTemplate, {
  blog: { name: "Different" },
  settings: DEFAULT_BLOG_SETTINGS,
});

const baseHandlers = {
  onOpenExportModal: vi.fn(),
  onCloseExportModal: vi.fn(),
  onOpenImportModal: vi.fn(),
  onCloseImportModal: vi.fn(),
  onImportTextareaChange: vi.fn(),
  onReviewImport: vi.fn(),
  onApplyImport: vi.fn(),
};

function makeProps(
  overrides: Partial<BlogSettingsImportExportProps> = {},
): BlogSettingsImportExportProps {
  return {
    exportTemplateJson: sampleJson,
    exportModalOpen: false,
    importModalOpen: false,
    importTextareaValue: "",
    importState: {
      phase: "idle",
    } satisfies BlogSettingsImportExportImportState,
    ...baseHandlers,
    ...overrides,
  };
}

describe("BlogSettingsImportExport — buttons", () => {
  it("renders the Export and Import buttons", () => {
    render(<BlogSettingsImportExport {...makeProps()} />);
    expect(
      screen.getByRole("button", { name: "Export settings JSON" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import settings JSON" }),
    ).toBeInTheDocument();
  });

  it("calls onOpenExportModal when the Export button is clicked", () => {
    const onOpenExportModal = vi.fn();
    render(<BlogSettingsImportExport {...makeProps({ onOpenExportModal })} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Export settings JSON" }),
    );
    expect(onOpenExportModal).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenImportModal when the Import button is clicked", () => {
    const onOpenImportModal = vi.fn();
    render(<BlogSettingsImportExport {...makeProps({ onOpenImportModal })} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Import settings JSON" }),
    );
    expect(onOpenImportModal).toHaveBeenCalledTimes(1);
  });
});

describe("BlogSettingsImportExport — export modal", () => {
  it("shows the JSON in a read-only textarea when open", () => {
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    const ta = screen.getByLabelText(
      /Exported template JSON/,
    ) as HTMLTextAreaElement;
    expect(ta.value).toContain('"kind"');
    expect(ta).toHaveAttribute("readonly");
  });

  it("shows the safety copy that secrets are excluded", () => {
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    expect(
      screen.getByText(
        /Safe to share with AI\. Does not include WordPress credentials or secrets\./,
      ),
    ).toBeInTheDocument();
  });

  it("renders the AI prompt / guide textarea with safety rules + enum values", () => {
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    const ta = screen.getByLabelText(/Prompt for AI/) as HTMLTextAreaElement;
    // The new guide opens with the Task line and embeds the rules
    // + enum reference (no JSON appendix — that lives in the
    // dedicated export textarea + the copy-prompt-and-JSON button).
    expect(ta.value).toMatch(/SynthPress blog settings template/);
    expect(ta.value).toMatch(/Return valid JSON only/i);
    expect(ta.value).toMatch(/Keep `kind` exactly/);
    expect(ta.value).toMatch(/Do NOT add WordPress credentials/i);
    expect(ta.value).toMatch(/`elementary`/);
    expect(ta.value).toMatch(/`pexels`/);
    expect(ta.value).not.toContain('"kind"'); // no embedded JSON here
  });

  it("substitutes the supplied AI prompt topic into the guide", () => {
    render(
      <BlogSettingsImportExport
        {...makeProps({
          exportModalOpen: true,
          aiPromptTopic: "AI productivity",
        })}
      />,
    );
    const ta = screen.getByLabelText(/Prompt for AI/) as HTMLTextAreaElement;
    expect(ta.value).toMatch(/for a blog about AI productivity/);
  });

  it("renders the helper copy that the guide carries enum + safety info", () => {
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    expect(
      screen.getByText(
        /Use this when asking ChatGPT or Claude to adapt settings/i,
      ),
    ).toBeInTheDocument();
  });

  it("copies the raw JSON when Copy JSON is clicked (unchanged behavior)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledWith(sampleJson);
    // The button label flips to a confirmation state.
    expect(screen.getByRole("button", { name: /Copied!/ })).toBeInTheDocument();
  });

  it("reverts the Copy JSON label back to 'Copy JSON' after the 1.5s confirmation timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      render(
        <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
      // Flush the awaited writeText + the resulting setState.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        screen.getByRole("button", { name: /Copied!/ }),
      ).toBeInTheDocument();
      // Advance past the 1500ms timeout — the label should flip back.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(
        screen.getByRole("button", { name: "Copy JSON" }),
      ).toBeInTheDocument();
      // And the "Copied!" label is gone.
      expect(
        screen.queryByRole("button", { name: /Copied!/ }),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a Copy AI prompt + JSON button", () => {
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    expect(
      screen.getByRole("button", { name: "Copy AI prompt + JSON" }),
    ).toBeInTheDocument();
  });

  it("copies the AI guide concatenated with the JSON when Copy AI prompt + JSON is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <BlogSettingsImportExport
        {...makeProps({
          exportModalOpen: true,
          aiPromptTopic: "indie hackers",
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy AI prompt + JSON" }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0][0] as string;
    // Guide markdown + JSON appendix, separated by the heading.
    expect(written).toMatch(/SynthPress blog settings template/);
    expect(written).toMatch(/Return valid JSON only/i);
    expect(written).toMatch(/for a blog about indie hackers/);
    expect(written).toMatch(/## Template JSON/);
    expect(written).toContain(sampleJson);
  });

  it("reverts the Copy AI prompt + JSON label back after the 1.5s confirmation timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      render(
        <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Copy AI prompt + JSON" }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        screen.getByRole("button", { name: /Copied!/ }),
      ).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(
        screen.getByRole("button", { name: "Copy AI prompt + JSON" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Copied!/ }),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("JSON-only copy output stays equal to the raw exported JSON (no guide leakage)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <BlogSettingsImportExport
        {...makeProps({
          exportModalOpen: true,
          aiPromptTopic: "AI productivity",
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await new Promise((r) => setTimeout(r, 0));
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toBe(sampleJson);
    // None of the guide markdown ever leaks into the JSON copy.
    expect(written).not.toMatch(/SynthPress blog settings template/);
    expect(written).not.toMatch(/## Template JSON/);
  });

  it("shows a clipboard error when navigator.clipboard rejects (Copy JSON)", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("nope")) },
      configurable: true,
    });
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(
      screen.getByText(/Could not copy to clipboard/i),
    ).toBeInTheDocument();
  });

  it("shows a clipboard error when navigator.clipboard rejects (Copy AI prompt + JSON)", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("nope")) },
      configurable: true,
    });
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy AI prompt + JSON" }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(
      screen.getByText(/Could not copy to clipboard/i),
    ).toBeInTheDocument();
  });
});

describe("BlogSettingsImportExport — download + textarea focus", () => {
  it("downloads the exported JSON as blog-settings-template.json when the Download JSON button is clicked", () => {
    // Stub Blob / URL.createObjectURL / revokeObjectURL — jsdom has
    // partial support, and we need to assert the right anchor is
    // created with the right filename + that the object URL is
    // revoked at the end.
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL =
      createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL =
      revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    // Capture the anchor element handleDownload programmatically
    // clicks — we listen on the parent (document.body) so we don't
    // have to spy on every appendChild.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");

    try {
      render(
        <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0]![0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("application/json");

      expect(clickSpy).toHaveBeenCalledTimes(1);
      const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe("blog-settings-template.json");
      expect(anchor.href).toContain("blob:fake-url");

      // Object URL is cleaned up after the click — leaking it would
      // hold onto the blob until the page unloads.
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("selects the JSON textarea contents on focus so the user can copy with one keystroke", () => {
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    const textarea = screen.getByLabelText(
      "Exported template JSON",
    ) as HTMLTextAreaElement;
    const selectSpy = vi.spyOn(textarea, "select");
    fireEvent.focus(textarea);
    expect(selectSpy).toHaveBeenCalled();
  });

  it("selects the AI prompt textarea contents on focus", () => {
    render(
      <BlogSettingsImportExport {...makeProps({ exportModalOpen: true })} />,
    );
    const textarea = screen.getByLabelText(
      /Prompt for AI/i,
    ) as HTMLTextAreaElement;
    const selectSpy = vi.spyOn(textarea, "select");
    fireEvent.focus(textarea);
    expect(selectSpy).toHaveBeenCalled();
  });
});

describe("BlogSettingsImportExport — import modal idle state", () => {
  it("shows the paste textarea", () => {
    render(
      <BlogSettingsImportExport {...makeProps({ importModalOpen: true })} />,
    );
    expect(screen.getByLabelText(/Paste template JSON/)).toBeInTheDocument();
  });

  it("calls onImportTextareaChange when typing", () => {
    const onImportTextareaChange = vi.fn();
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          onImportTextareaChange,
        })}
      />,
    );
    const ta = screen.getByLabelText(/Paste template JSON/);
    fireEvent.change(ta, { target: { value: '{ "kind": "x" }' } });
    expect(onImportTextareaChange).toHaveBeenCalledWith('{ "kind": "x" }');
  });

  it("invokes onReviewImport when the Review button is clicked", () => {
    const onReviewImport = vi.fn();
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importTextareaValue: sampleJson,
          onReviewImport,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(onReviewImport).toHaveBeenCalledTimes(1);
  });
});

describe("BlogSettingsImportExport — import modal error state", () => {
  it("renders the error message from importState", () => {
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importTextareaValue: "{ broken",
          importState: {
            phase: "error",
            errorMessage: "Could not parse JSON.",
          },
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not parse JSON.",
    );
  });
});

describe("BlogSettingsImportExport — import modal review state", () => {
  function renderReviewing(
    overrides: Partial<BlogSettingsImportExportProps> = {},
  ) {
    return render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importTextareaValue: sampleJson,
          importState: {
            phase: "reviewing",
            preview: {
              template: sampleTemplate,
              changes: sampleChanges,
              warnings: ["Ignored unknown top-level fields: foo."],
            },
          },
          ...overrides,
        })}
      />,
    );
  }

  it("shows the kind / schemaVersion / exportedAt callout", () => {
    renderReviewing();
    expect(screen.getByText(/schemaVersion 1/i)).toBeInTheDocument();
    // The kind string also appears inside the export textarea, so a
    // permissive "at least one match" check keeps the test focused on
    // what matters: the badge area's callout.
    expect(
      screen.getAllByText(/synthpress\.blogSettingsTemplate/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/exported 2026-05-20T18:00:00\.000Z/),
    ).toBeInTheDocument();
  });

  it("shows the safety copy that autopilot will not be auto-enabled", () => {
    renderReviewing();
    expect(
      screen.getByText(
        /Imported settings do not automatically turn on autopilot/i,
      ),
    ).toBeInTheDocument();
  });

  it("shows the safety copy that WordPress credentials are never imported", () => {
    renderReviewing();
    expect(
      screen.getByText(/WordPress credentials are never imported/i),
    ).toBeInTheDocument();
  });

  it("renders the warnings list when warnings are present", () => {
    renderReviewing();
    expect(
      screen.getByText(/Ignored unknown top-level fields: foo\./),
    ).toBeInTheDocument();
  });

  it("renders the blog identity preview when template includes one + an opt-in checkbox", () => {
    renderReviewing();
    expect(
      screen.getByText(/Blog identity \(in template\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("Indie")).toBeInTheDocument(); // name
    expect(
      screen.getByLabelText(
        /Also overwrite this blog's name \/ description \/ niche/i,
      ),
    ).toBeInTheDocument();
  });

  it("omits the entire 'Blog identity (in template)' section when the template has no blog block", () => {
    // Branch coverage for the outer `template.blog ? ... : null`
    // — settings-only templates (no identity) should render the
    // settings sections + safety panel, but NOT the identity card
    // or its opt-in checkbox.
    const settingsOnlyTemplate = buildBlogSettingsTemplate({
      // pruneBlogIdentity will drop this entirely because every
      // field is empty → template.blog === undefined.
      blog: {},
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: "2026-05-20T18:00:00.000Z",
    });
    const changes = buildBlogSettingsTemplateChangesPreview(
      settingsOnlyTemplate,
      { blog: { name: "Different" }, settings: DEFAULT_BLOG_SETTINGS },
    );
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importState: {
            phase: "reviewing",
            preview: {
              template: settingsOnlyTemplate,
              changes,
              warnings: [],
            },
          },
        })}
      />,
    );
    expect(
      screen.queryByText(/Blog identity \(in template\)/i),
    ).not.toBeInTheDocument();
    // And the per-blog opt-in checkbox shouldn't render either.
    expect(
      screen.queryByLabelText(
        /Also overwrite this blog's name \/ description \/ niche/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("omits the 'exported' date span when the template has no exportedAt", () => {
    // Templates serialized by older clients may omit `exportedAt`.
    const undatedTemplate = {
      ...sampleTemplate,
      exportedAt: undefined,
    };
    const changes = buildBlogSettingsTemplateChangesPreview(undatedTemplate, {
      blog: { name: "Different" },
      settings: DEFAULT_BLOG_SETTINGS,
    });
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importState: {
            phase: "reviewing",
            preview: { template: undatedTemplate, changes, warnings: [] },
          },
        })}
      />,
    );
    expect(screen.queryByText(/^· exported /)).not.toBeInTheDocument();
  });

  it("renders only the Pairs for the fields the template carries (description-only blog block)", () => {
    // Mirror of the name-only test but with description present
    // and name absent — exercises the FALSE branch of
    // `template.blog.name !== undefined`.
    const descOnlyTemplate = buildBlogSettingsTemplate({
      blog: { description: "Stories." },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: "2026-05-20T18:00:00.000Z",
    });
    const changes = buildBlogSettingsTemplateChangesPreview(descOnlyTemplate, {
      blog: { name: "Different" },
      settings: DEFAULT_BLOG_SETTINGS,
    });
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importState: {
            phase: "reviewing",
            preview: { template: descOnlyTemplate, changes, warnings: [] },
          },
        })}
      />,
    );
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Stories.")).toBeInTheDocument();
    // Name Pair shouldn't render because template.blog.name is undefined.
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
  });

  it("only renders identity Pairs for fields the template actually carries", () => {
    // Template has `blog: { name }` only — the description / niche /
    // keywords pairs must be omitted, not rendered with `(empty)`.
    const nameOnlyTemplate = buildBlogSettingsTemplate({
      blog: { name: "Indie" },
      settings: DEFAULT_BLOG_SETTINGS,
      exportedAt: "2026-05-20T18:00:00.000Z",
    });
    const changes = buildBlogSettingsTemplateChangesPreview(nameOnlyTemplate, {
      blog: { name: "Different" },
      settings: DEFAULT_BLOG_SETTINGS,
    });
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importState: {
            phase: "reviewing",
            preview: { template: nameOnlyTemplate, changes, warnings: [] },
          },
        })}
      />,
    );
    expect(screen.getByText("Indie")).toBeInTheDocument();
    // The Pair label nodes for these are absent because the template
    // doesn't carry them.
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(screen.queryByText("Niche")).not.toBeInTheDocument();
    expect(screen.queryByText("Keywords")).not.toBeInTheDocument();
  });

  it("renders an '(empty)' placeholder inside the Pair when a field travels in the template with an empty-string value", () => {
    // Defensive: pruneBlogIdentity normally drops empties, so an
    // empty-string value reaching the preview only happens with a
    // hand-edited template. Confirm the Pair falls back to "(empty)"
    // rather than rendering a bare label with nothing next to it.
    const handEdited = {
      ...sampleTemplate,
      blog: { name: "Indie", description: "" },
    };
    const changes = buildBlogSettingsTemplateChangesPreview(handEdited, {
      blog: { name: "Different" },
      settings: DEFAULT_BLOG_SETTINGS,
    });
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importState: {
            phase: "reviewing",
            preview: { template: handEdited, changes, warnings: [] },
          },
        })}
      />,
    );
    expect(screen.getByText("(empty)")).toBeInTheDocument();
  });

  it("renders the include-automation checkbox checked by default", () => {
    renderReviewing();
    const checkbox = screen.getByLabelText(
      /Include automation cadence/i,
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("calls onApplyImport with the chosen include flags", () => {
    const onApplyImport = vi.fn();
    renderReviewing({ onApplyImport });
    fireEvent.click(
      screen.getByLabelText(
        /Also overwrite this blog's name \/ description \/ niche/i,
      ),
    );
    fireEvent.click(screen.getByLabelText(/Include automation cadence/i));
    fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));
    expect(onApplyImport).toHaveBeenCalledWith({
      includeBlogIdentity: true,
      includeAutomation: false,
    });
  });

  it("lists the settings sections that will change as badges", () => {
    const changesWithSections = buildBlogSettingsTemplateChangesPreview(
      sampleTemplate,
      {
        blog: {},
        settings: {
          ...DEFAULT_BLOG_SETTINGS,
          identity: {
            ...DEFAULT_BLOG_SETTINGS.identity,
            audience: "Founders",
          },
          seo: { ...DEFAULT_BLOG_SETTINGS.seo, defaultArticleLength: 2400 },
        },
      },
    );
    renderReviewing({
      importState: {
        phase: "reviewing",
        preview: {
          template: sampleTemplate,
          changes: changesWithSections,
          warnings: [],
        },
      },
    });
    expect(screen.getByText("identity")).toBeInTheDocument();
    expect(screen.getByText("seo")).toBeInTheDocument();
  });

  it("renders a 'no changes' note when the template equals the destination settings", () => {
    const noChanges = buildBlogSettingsTemplateChangesPreview(sampleTemplate, {
      blog: {},
      settings: DEFAULT_BLOG_SETTINGS,
    });
    renderReviewing({
      importState: {
        phase: "reviewing",
        preview: {
          template: sampleTemplate,
          changes: noChanges,
          warnings: [],
        },
      },
    });
    expect(
      screen.getByText(
        /None — the template matches the destination blog's current settings/,
      ),
    ).toBeInTheDocument();
  });
});

describe("BlogSettingsImportExport — applying state", () => {
  it("disables Cancel and shows an Applying button", () => {
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importTextareaValue: sampleJson,
          importState: {
            phase: "applying",
            preview: {
              template: sampleTemplate,
              changes: sampleChanges,
              warnings: [],
            },
          },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Applying/ })).toBeDisabled();
  });
});

describe("BlogSettingsImportExport — applied state", () => {
  it("renders a success message and the autopilot reminder", () => {
    render(
      <BlogSettingsImportExport
        {...makeProps({
          importModalOpen: true,
          importTextareaValue: sampleJson,
          importState: {
            phase: "applied",
            appliedWarnings: ["Some warning."],
          },
        })}
      />,
    );
    expect(
      screen.getByText("Settings imported successfully."),
    ).toBeInTheDocument();
    expect(screen.getByText("Some warning.")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Imported settings do not automatically turn on autopilot/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
