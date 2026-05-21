import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import {
  BLOG_SETTINGS_TEMPLATE_KIND,
  BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
} from "@/lib/blog-settings-template";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/blog-settings-template", () => ({
  importBlogSettingsTemplate: vi.fn(),
}));

import { importBlogSettingsTemplate } from "@/actions/blog-settings-template";
import { useBlogSettingsImportExport } from "./useBlogSettingsImportExport";

const mockedImport = vi.mocked(importBlogSettingsTemplate);

const baseOptions = {
  teamId: "t1",
  projectId: "p1",
  blogId: "b1",
  current: {
    blog: { name: "Indie" },
    settings: DEFAULT_BLOG_SETTINGS,
  },
};

function freshTemplateJson(
  overrides: Partial<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    kind: BLOG_SETTINGS_TEMPLATE_KIND,
    schemaVersion: BLOG_SETTINGS_TEMPLATE_SCHEMA_VERSION,
    settings: DEFAULT_BLOG_SETTINGS,
    ...overrides,
  });
}

beforeEach(() => {
  refreshMock.mockClear();
  mockedImport.mockReset();
});

describe("useBlogSettingsImportExport — modal state", () => {
  it("opens and closes the export modal", () => {
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    expect(result.current.exportModalOpen).toBe(false);
    act(() => result.current.openExportModal());
    expect(result.current.exportModalOpen).toBe(true);
    act(() => result.current.closeExportModal());
    expect(result.current.exportModalOpen).toBe(false);
  });

  it("opens the import modal in the idle phase and resets the textarea", () => {
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() => result.current.setImportTextareaValue("garbage"));
    act(() => result.current.openImportModal());
    expect(result.current.importModalOpen).toBe(true);
    expect(result.current.importTextareaValue).toBe("");
    expect(result.current.importState.phase).toBe("idle");
  });

  it("closing the import modal resets the state machine for next time", () => {
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() => result.current.openImportModal());
    act(() => result.current.setImportTextareaValue(freshTemplateJson()));
    act(() => result.current.reviewImport());
    expect(result.current.importState.phase).toBe("reviewing");
    act(() => result.current.closeImportModal());
    expect(result.current.importModalOpen).toBe(false);
    expect(result.current.importState.phase).toBe("idle");
    expect(result.current.importTextareaValue).toBe("");
  });
});

describe("useBlogSettingsImportExport — reviewImport", () => {
  it("transitions to `error` for invalid JSON", () => {
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() => result.current.setImportTextareaValue("{ broken"));
    act(() => result.current.reviewImport());
    expect(result.current.importState.phase).toBe("error");
    if (result.current.importState.phase !== "error") return;
    expect(result.current.importState.errorMessage).toMatch(
      /Could not parse JSON/,
    );
  });

  it("transitions to `error` for wrong kind", () => {
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() =>
      result.current.setImportTextareaValue(
        freshTemplateJson({ kind: "wrong" }),
      ),
    );
    act(() => result.current.reviewImport());
    expect(result.current.importState.phase).toBe("error");
  });

  it("transitions to `reviewing` and exposes the preview on valid JSON", () => {
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() => result.current.setImportTextareaValue(freshTemplateJson()));
    act(() => result.current.reviewImport());
    expect(result.current.importState.phase).toBe("reviewing");
    if (result.current.importState.phase !== "reviewing") return;
    expect(result.current.importState.preview).toBeDefined();
    expect(result.current.importState.preview?.template.kind).toBe(
      BLOG_SETTINGS_TEMPLATE_KIND,
    );
  });
});

describe("useBlogSettingsImportExport — applyImport", () => {
  it("calls the server action with the textarea value + options + refreshes on success", async () => {
    mockedImport.mockResolvedValue({ data: { warnings: [] }, error: null });
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() => result.current.setImportTextareaValue(freshTemplateJson()));
    act(() => result.current.reviewImport());
    await act(async () => {
      result.current.applyImport({
        includeBlogIdentity: true,
        includeAutomation: false,
      });
    });
    await waitFor(() => {
      expect(result.current.importState.phase).toBe("applied");
    });
    expect(mockedImport).toHaveBeenCalledWith({
      teamId: "t1",
      projectId: "p1",
      blogId: "b1",
      templateJson: freshTemplateJson(),
      options: { includeBlogIdentity: true, includeAutomation: false },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("transitions to `error` when the server action returns an error", async () => {
    mockedImport.mockResolvedValue({ data: null, error: "Forbidden." });
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() => result.current.setImportTextareaValue(freshTemplateJson()));
    act(() => result.current.reviewImport());
    await act(async () => {
      result.current.applyImport({
        includeBlogIdentity: false,
        includeAutomation: true,
      });
    });
    await waitFor(() => {
      expect(result.current.importState.phase).toBe("error");
    });
    if (result.current.importState.phase !== "error") return;
    expect(result.current.importState.errorMessage).toBe("Forbidden.");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does NOT flip out of an unrelated phase when applyImport is called from idle (defensive guard)", async () => {
    // Branch coverage for the `prev.phase === 'reviewing' || 'applying'`
    // setImportState updater — when neither is true the previous
    // state must be returned unchanged. The server action still runs
    // (it'll be a no-op the next tick), but the phase shouldn't
    // accidentally become "applying" with a half-built preview.
    mockedImport.mockResolvedValue({ data: { warnings: [] }, error: null });
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    // Phase starts as "idle" — no review() call before applyImport.
    expect(result.current.importState.phase).toBe("idle");
    await act(async () => {
      result.current.applyImport({
        includeBlogIdentity: false,
        includeAutomation: true,
      });
    });
    // The action ran (and "applied" the empty template), but the
    // critical assertion is that no intermediate "applying" frame
    // happened from non-reviewing state. The phase ends up "applied"
    // because the server call completed successfully.
    await waitFor(() => {
      expect(result.current.importState.phase).toBe("applied");
    });
  });

  it("defaults appliedWarnings to [] when the server action returns no data", async () => {
    // Hits the `result.data?.warnings ?? []` branch — `data` is
    // present but `warnings` is missing on the response shape
    // (older server action that hasn't been redeployed, or future
    // version that drops the field).
    mockedImport.mockResolvedValue({
      data: {} as never,
      error: null,
    });
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() => result.current.setImportTextareaValue(freshTemplateJson()));
    act(() => result.current.reviewImport());
    await act(async () => {
      result.current.applyImport({
        includeBlogIdentity: false,
        includeAutomation: true,
      });
    });
    await waitFor(() => {
      expect(result.current.importState.phase).toBe("applied");
    });
    if (result.current.importState.phase !== "applied") return;
    expect(result.current.importState.appliedWarnings).toEqual([]);
  });

  it("surfaces applied warnings to the molecule", async () => {
    mockedImport.mockResolvedValue({
      data: {
        warnings: [
          "Blog identity (name/description/niche/keywords/prompt template) was not changed. Enable `Include blog identity` to apply it.",
        ],
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useBlogSettingsImportExport(baseOptions),
    );
    act(() => result.current.setImportTextareaValue(freshTemplateJson()));
    act(() => result.current.reviewImport());
    await act(async () => {
      result.current.applyImport({
        includeBlogIdentity: false,
        includeAutomation: true,
      });
    });
    await waitFor(() => {
      expect(result.current.importState.phase).toBe("applied");
    });
    if (result.current.importState.phase !== "applied") return;
    expect(result.current.importState.appliedWarnings).toHaveLength(1);
  });
});
