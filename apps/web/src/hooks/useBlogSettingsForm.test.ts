import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import type { BlogSettingsTabsValue } from "@/components/organisms/BlogSettingsTabs";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/workspace", () => ({
  updateBlog: vi.fn(),
}));

import { updateBlog } from "@/actions/workspace";
import { useBlogSettingsForm } from "./useBlogSettingsForm";

const mockedUpdate = vi.mocked(updateBlog);

const initial: BlogSettingsTabsValue = {
  general: {
    name: "Indie",
    description: "About indie things.",
    niche: "indie",
    keywordsText: "ai, dev",
    aiPromptTemplate: "",
  },
  settings: DEFAULT_BLOG_SETTINGS,
};

beforeEach(() => {
  refreshMock.mockClear();
  mockedUpdate.mockReset();
});

describe("useBlogSettingsForm", () => {
  it("does not call updateBlog when nothing changed", async () => {
    const { result } = renderHook(() =>
      useBlogSettingsForm({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        initialValue: initial,
      }),
    );
    act(() => {
      result.current.save(initial);
    });
    await waitFor(() => {
      expect(result.current.saveSuccess).toBe(true);
    });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("sends only the fields that changed (general)", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() =>
      useBlogSettingsForm({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        initialValue: initial,
      }),
    );

    const next: BlogSettingsTabsValue = {
      ...initial,
      general: { ...initial.general, name: "Renamed" },
    };

    act(() => {
      result.current.save(next);
    });

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", {
        name: "Renamed",
      });
    });
  });

  it("parses keywords from comma/newline-separated text", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() =>
      useBlogSettingsForm({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        initialValue: initial,
      }),
    );

    const next: BlogSettingsTabsValue = {
      ...initial,
      general: { ...initial.general, keywordsText: "  ai \n  ml , growth ," },
    };

    act(() => {
      result.current.save(next);
    });

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("t1", "p1", "b1", {
        keywords: ["ai", "ml", "growth"],
      });
    });
  });

  it("sends only the changed jsonb sections", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() =>
      useBlogSettingsForm({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        initialValue: initial,
      }),
    );

    const next: BlogSettingsTabsValue = {
      ...initial,
      settings: {
        ...initial.settings,
        identity: { ...initial.settings.identity, audience: "Founders" },
      },
    };

    act(() => {
      result.current.save(next);
    });

    await waitFor(() => {
      const call = mockedUpdate.mock.calls[0]?.[3];
      expect(call?.settings?.identity?.audience).toBe("Founders");
      expect(call?.settings?.seo).toBeUndefined();
    });
  });

  it("surfaces an error from the server action", async () => {
    mockedUpdate.mockResolvedValue({
      data: null,
      error: "Forbidden.",
    });
    const { result } = renderHook(() =>
      useBlogSettingsForm({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        initialValue: initial,
      }),
    );

    act(() => {
      result.current.save({
        ...initial,
        general: { ...initial.general, name: "Renamed" },
      });
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Forbidden.");
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("includes every general field that changed", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() =>
      useBlogSettingsForm({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        initialValue: initial,
      }),
    );

    act(() => {
      result.current.save({
        ...initial,
        general: {
          name: initial.general.name,
          description: "New desc",
          niche: "New niche",
          keywordsText: initial.general.keywordsText,
          aiPromptTemplate: "{{NEW}}",
        },
      });
    });

    await waitFor(() => {
      const payload = mockedUpdate.mock.calls[0]?.[3];
      expect(payload).toBeDefined();
      expect(payload).toMatchObject({
        description: "New desc",
        niche: "New niche",
        aiPromptTemplate: "{{NEW}}",
      });
      expect(payload?.keywords).toBeUndefined();
    });
  });

  it("ships automation settings as a settings.automation patch", async () => {
    mockedUpdate.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() =>
      useBlogSettingsForm({
        teamId: "t1",
        projectId: "p1",
        blogId: "b1",
        initialValue: initial,
      }),
    );

    act(() => {
      result.current.save({
        ...initial,
        settings: {
          ...initial.settings,
          automation: {
            ...initial.settings.automation,
            enabled: true,
            mode: "autopilot",
            generatePerWeek: 14,
            backlogThreshold: 25,
            dailyTokenBudget: 500,
          },
        },
      });
    });

    await waitFor(() => {
      const payload = mockedUpdate.mock.calls[0]?.[3];
      expect(payload?.settings?.automation).toMatchObject({
        enabled: true,
        mode: "autopilot",
        generatePerWeek: 14,
        backlogThreshold: 25,
        dailyTokenBudget: 500,
      });
    });
  });
});
