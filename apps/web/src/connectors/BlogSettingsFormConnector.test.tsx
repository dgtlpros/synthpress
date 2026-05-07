import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_BLOG_SETTINGS } from "@/lib/blog-settings";
import type { BlogSettingsTabsValue } from "@/components/organisms/BlogSettingsTabs";

const { refreshMock, updateBlogMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  updateBlogMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("@/actions/workspace", () => ({
  updateBlog: updateBlogMock,
}));

import { BlogSettingsFormConnector } from "./BlogSettingsFormConnector";

afterEach(() => {
  cleanup();
  refreshMock.mockReset();
  updateBlogMock.mockReset();
});

const initial: BlogSettingsTabsValue = {
  general: {
    name: "Indie",
    description: "Built in public.",
    niche: "indie",
    keywordsText: "ai",
    aiPromptTemplate: "",
  },
  cadence: { isActive: true, articlesPerDay: 1, scheduleCron: "0 9 * * *" },
  settings: DEFAULT_BLOG_SETTINGS,
};

describe("BlogSettingsFormConnector", () => {
  it("forwards the initial value to BlogSettingsTabs", () => {
    render(
      <BlogSettingsFormConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialValue={initial}
      />,
    );
    expect(screen.getByLabelText(/Blog name/)).toHaveValue("Indie");
  });

  it("calls updateBlog when the form is dirty and saved", async () => {
    updateBlogMock.mockResolvedValue({ data: null, error: null });
    render(
      <BlogSettingsFormConnector
        teamId="t1"
        projectId="pr1"
        blogId="b1"
        initialValue={initial}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Blog name/), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(updateBlogMock).toHaveBeenCalledWith("t1", "pr1", "b1", {
      name: "Renamed",
    });
  });
});
