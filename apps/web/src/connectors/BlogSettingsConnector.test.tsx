import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockRenameBlog = vi.fn();
const mockDeleteBlog = vi.fn();
let hookOverrides: Record<string, unknown> = {};

vi.mock("@/hooks/useBlogSettings", () => ({
  useBlogSettings: () => ({
    renameBlog: mockRenameBlog,
    isRenamingBlog: false,
    renameError: null,
    deleteBlog: mockDeleteBlog,
    isDeletingBlog: false,
    deleteError: null,
    ...hookOverrides,
  }),
}));

import { BlogSettingsConnector } from "./BlogSettingsConnector";

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

afterEach(() => {
  vi.clearAllMocks();
  hookOverrides = {};
  cleanup();
});

describe("BlogSettingsConnector", () => {
  it("renders blog name and control buttons", () => {
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Tech Blog"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Tech Blog" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rename/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete blog app/i }),
    ).toBeInTheDocument();
  });

  it("shows rename input when Rename is clicked", () => {
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Tech Blog"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect(screen.getByRole("textbox", { name: /blog name/i })).toHaveValue(
      "Tech Blog",
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("calls renameBlog when Save is clicked", () => {
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Tech Blog"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /blog name/i });
    fireEvent.change(input, { target: { value: "New Blog Name" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mockRenameBlog).toHaveBeenCalledWith("New Blog Name");
  });

  it("hides rename input when Cancel is clicked", () => {
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Tech Blog"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(
      screen.queryByRole("textbox", { name: /blog name/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Tech Blog" }),
    ).toBeInTheDocument();
  });

  it("opens DeleteConfirmModal when Delete blog app is clicked", () => {
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Tech Blog"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete blog app/i }));
    expect(
      screen.getByRole("heading", { name: /delete blog app/i }),
    ).toBeInTheDocument();
  });

  it("calls deleteBlog when typed name matches and confirmed", () => {
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Tech Blog"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete blog app/i }));

    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    const deleteDialog = dialogs.find((d) =>
      d.textContent?.includes("Delete blog app"),
    );
    expect(deleteDialog).toBeDefined();

    const input = deleteDialog!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "Tech Blog" } });

    const confirmBtn = Array.from(
      deleteDialog!.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Delete blog app"))!;
    fireEvent.click(confirmBtn);
    expect(mockDeleteBlog).toHaveBeenCalledOnce();
  });

  it("shows renameError when present", () => {
    hookOverrides = { renameError: "Name too short" };
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="X"
      />,
    );
    expect(screen.getByText("Name too short")).toBeInTheDocument();
  });

  it("shows deleteError when present", () => {
    hookOverrides = { deleteError: "Cannot delete" };
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="X"
      />,
    );
    expect(screen.getByText("Cannot delete")).toBeInTheDocument();
  });

  it("closes DeleteConfirmModal when Cancel is clicked inside it", () => {
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Tech Blog"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete blog app/i }));
    expect(
      screen.getByRole("heading", { name: /delete blog app/i }),
    ).toBeInTheDocument();

    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    const deleteDialog = dialogs.find((d) =>
      d.textContent?.includes("Delete blog app"),
    );
    const cancelBtn = Array.from(deleteDialog!.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    )!;
    fireEvent.click(cancelBtn);
    expect(
      screen.queryByRole("heading", { name: /delete blog app/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps rename input open when renameError is set (branch at handleRename)", () => {
    hookOverrides = { renameError: "Name taken" };
    render(
      <BlogSettingsConnector
        teamId="t1"
        projectId="p1"
        blogId="b1"
        blogName="Tech Blog"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mockRenameBlog).toHaveBeenCalled();
    expect(
      screen.getByRole("textbox", { name: /blog name/i }),
    ).toBeInTheDocument();
  });
});
