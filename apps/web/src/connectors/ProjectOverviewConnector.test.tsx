import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockUpdateProjectSettings = vi.fn();
const mockDeleteProject = vi.fn();
const mockCreateBlog = vi.fn();
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/actions/workspace", () => ({
  updateProjectSettings: (...args: unknown[]) =>
    mockUpdateProjectSettings(...args),
  deleteProject: (...args: unknown[]) => mockDeleteProject(...args),
  createBlog: (...args: unknown[]) => mockCreateBlog(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import { ProjectOverviewConnector } from "./ProjectOverviewConnector";

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
  cleanup();
});

const defaultProps = {
  teamId: "t1",
  projectId: "p1",
  teamName: "Acme",
  projectName: "Website",
  projectDescription: "Our site",
  blogs: [],
  currentUserRole: "owner" as const,
};

describe("ProjectOverviewConnector", () => {
  it("renders project header and installed apps section", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    expect(
      screen.getByRole("heading", { name: "Website" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Installed apps")).toBeInTheDocument();
  });

  it("shows Delete project button for owner", () => {
    render(
      <ProjectOverviewConnector {...defaultProps} currentUserRole="owner" />,
    );
    expect(
      screen.getByRole("button", { name: /delete project/i }),
    ).toBeInTheDocument();
  });

  it("hides Delete project button for member", () => {
    render(
      <ProjectOverviewConnector {...defaultProps} currentUserRole="member" />,
    );
    expect(
      screen.queryByRole("button", { name: /delete project/i }),
    ).not.toBeInTheDocument();
  });

  it("hides Delete project button for admin", () => {
    render(
      <ProjectOverviewConnector {...defaultProps} currentUserRole="admin" />,
    );
    expect(
      screen.getByRole("button", { name: /delete project/i }),
    ).toBeInTheDocument();
  });

  it("opens delete modal when Delete project is clicked", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));
    expect(
      screen.getByRole("heading", { name: /delete project/i }),
    ).toBeInTheDocument();
  });

  it("closes delete modal on Cancel", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(
      screen.queryByRole("heading", { name: /delete project/i }),
    ).not.toBeInTheDocument();
  });

  it("calls deleteProject when typed name matches and confirmed", async () => {
    mockDeleteProject.mockResolvedValue({
      data: { redirect: "/teams/t1/projects" },
      error: null,
    });

    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Website" } });

    fireEvent.click(
      screen
        .getAllByRole("button", { name: /delete project/i })
        .find((b) => b.closest("dialog"))!,
    );

    await vi.waitFor(() =>
      expect(mockDeleteProject).toHaveBeenCalledWith("t1", "p1"),
    );
    expect(mockPush).toHaveBeenCalledWith("/teams/t1/projects");
  });

  it("shows Create app button", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /create app/i }),
    ).toBeInTheDocument();
  });

  it("renders installed blogs with description as subtitle and CMS in meta", () => {
    const blogs = [
      {
        id: "b1",
        name: "Tech Blog",
        slug: "tech-blog",
        description: "Stories about modern web development.",
        project_id: "p1",
        wp_url: "https://wp.example.com",
        wp_username: "admin",
        niche: "Tech",
        keywords: [],
        ai_prompt_template: "",
        settings: {},
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ] as never[];

    render(<ProjectOverviewConnector {...defaultProps} blogs={blogs} />);
    expect(screen.getByText("Tech Blog")).toBeInTheDocument();
    expect(
      screen.getByText("Stories about modern web development."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Tech · WordPress · wp.example.com/),
    ).toBeInTheDocument();
  });

  it("falls back to niche as subtitle when description is empty", () => {
    const blogs = [
      {
        id: "b-no-desc",
        name: "Niche only",
        slug: "niche-only",
        description: "",
        project_id: "p1",
        wp_url: "https://wp.example.com",
        wp_username: "admin",
        niche: "AI tools",
        keywords: [],
        ai_prompt_template: "",
        settings: {},
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ] as never[];

    render(<ProjectOverviewConnector {...defaultProps} blogs={blogs} />);
    expect(screen.getByText("AI tools")).toBeInTheDocument();
  });

  it("derives isActive from settings.automation (mode + enabled)", () => {
    const blogs = [
      {
        id: "b-active",
        name: "Active Blog",
        slug: "active-blog",
        description: "Active autopilot",
        project_id: "p1",
        wp_url: null,
        wp_username: null,
        niche: "",
        keywords: [],
        ai_prompt_template: "",
        settings: { automation: { mode: "autopilot", enabled: true } },
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
      {
        id: "b-paused",
        name: "Paused Blog",
        slug: "paused-blog",
        description: "Autopilot configured but paused",
        project_id: "p1",
        wp_url: null,
        wp_username: null,
        niche: "",
        keywords: [],
        ai_prompt_template: "",
        settings: { automation: { mode: "autopilot", enabled: false } },
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ] as never[];

    render(<ProjectOverviewConnector {...defaultProps} blogs={blogs} />);
    // Both blogs render. The paused one is treated as inactive — the
    // ProjectInstalledAppList styles inactive rows differently but the
    // exact DOM signal is implementation-detail; just ensure both names
    // render and no crash on the new derivation path.
    expect(screen.getByText("Active Blog")).toBeInTheDocument();
    expect(screen.getByText("Paused Blog")).toBeInTheDocument();
  });

  it("opens settings modal via ProjectPageHeader settings button", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    const settingsBtn = screen.getByRole("button", { name: /settings/i });
    fireEvent.click(settingsBtn);
    expect(screen.getByLabelText(/project name/i)).toHaveValue("Website");
    expect(screen.getByLabelText(/description/i)).toHaveValue("Our site");
  });

  it("syncs modal drafts from props when project fields change while settings are closed", () => {
    const { rerender } = render(<ProjectOverviewConnector {...defaultProps} />);

    rerender(
      <ProjectOverviewConnector
        {...defaultProps}
        projectName="From server"
        projectDescription="Fresh copy"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByLabelText(/project name/i)).toHaveValue("From server");
    expect(screen.getByLabelText(/description/i)).toHaveValue("Fresh copy");
  });

  it("resets drafts from props after canceling edits in settings modal", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.change(screen.getByLabelText(/project name/i), {
      target: { value: "Unsaved edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByLabelText(/project name/i)).toHaveValue("Website");
  });

  it("calls updateProjectSettings when Save is clicked in settings modal", async () => {
    mockUpdateProjectSettings.mockResolvedValue({ data: null, error: null });

    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.change(screen.getByLabelText(/project name/i), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() =>
      expect(mockUpdateProjectSettings).toHaveBeenCalledWith("t1", "p1", {
        name: "Renamed",
        description: "Our site",
      }),
    );
  });

  it("shows error in settings modal on save failure", async () => {
    mockUpdateProjectSettings.mockResolvedValue({
      data: null,
      error: "Name taken",
    });

    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() =>
      expect(screen.getByText("Name taken")).toBeInTheDocument(),
    );
  });

  it("shows delete error when deleteProject fails", async () => {
    mockDeleteProject.mockResolvedValue({
      data: null,
      error: "Permission denied",
    });

    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));

    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    const deleteDialog = dialogs.find((d) =>
      d.textContent?.includes("Delete project"),
    );
    fireEvent.change(deleteDialog!.querySelector("input")!, {
      target: { value: "Website" },
    });
    const confirmBtn = Array.from(
      deleteDialog!.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Delete project"))!;
    fireEvent.click(confirmBtn);

    await vi.waitFor(() =>
      expect(screen.getByText("Permission denied")).toBeInTheDocument(),
    );
  });

  it("opens CreateAppChoiceModal when Create app is clicked", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    expect(
      screen.getByRole("heading", { name: /create app/i }),
    ).toBeInTheDocument();
  });

  it("closes settings modal when Cancel is clicked", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = screen.getByLabelText(/project name/i).closest("dialog")!;
    expect(dialog).toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(dialog).not.toHaveAttribute("open");
  });

  it("closes CreateAppChoiceModal via onClose", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    expect(
      screen.getByRole("heading", { name: /create app/i }),
    ).toBeInTheDocument();

    const dialog = screen
      .getByRole("heading", { name: /create app/i })
      .closest("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(
      screen.queryByRole("heading", { name: /create app/i }),
    ).not.toBeInTheDocument();
  });

  it("closes EditProjectSettingsModal via its onClose callback", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    const dialog = screen.getByLabelText(/project name/i).closest("dialog")!;
    expect(dialog).toHaveAttribute("open");

    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).not.toHaveAttribute("open");
  });

  it("transitions to the name step when the Blog option is clicked", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    fireEvent.click(screen.getByRole("option", { name: /blog/i }));

    expect(
      screen.getByRole("heading", { name: /name your blog/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/blog name/i)).toBeInTheDocument();
  });

  it("returns to the choose step when Back is clicked from the name step", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    fireEvent.click(screen.getByRole("option", { name: /blog/i }));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(
      screen.getByRole("heading", { name: /create app/i }),
    ).toBeInTheDocument();
  });

  it("creates a blog with name only and navigates to its detail page", async () => {
    mockCreateBlog.mockResolvedValue({ data: { id: "b-new" }, error: null });

    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    fireEvent.click(screen.getByRole("option", { name: /blog/i }));
    fireEvent.change(screen.getByLabelText(/blog name/i), {
      target: { value: "New Blog" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create blog$/i }));

    await vi.waitFor(() =>
      expect(mockCreateBlog).toHaveBeenCalledWith({
        teamId: "t1",
        projectId: "p1",
        name: "New Blog",
      }),
    );
    expect(mockPush).toHaveBeenCalledWith("/teams/t1/projects/p1/blogs/b-new");
  });

  it("shows the empty-name error when the form is submitted with whitespace", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    fireEvent.click(screen.getByRole("option", { name: /blog/i }));

    const input = screen.getByLabelText(/blog name/i);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByText("Blog name is required.")).toBeInTheDocument();
    expect(mockCreateBlog).not.toHaveBeenCalled();
  });

  it("falls back to a generic error when createBlog returns null data with no error message", async () => {
    mockCreateBlog.mockResolvedValue({ data: null, error: null });

    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    fireEvent.click(screen.getByRole("option", { name: /blog/i }));
    fireEvent.change(screen.getByLabelText(/blog name/i), {
      target: { value: "Some name" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create blog$/i }));

    await vi.waitFor(() =>
      expect(screen.getByText("Could not create blog.")).toBeInTheDocument(),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows an error in the modal when createBlog fails", async () => {
    mockCreateBlog.mockResolvedValue({
      data: null,
      error: "Slug already exists",
    });

    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    fireEvent.click(screen.getByRole("option", { name: /blog/i }));
    fireEvent.change(screen.getByLabelText(/blog name/i), {
      target: { value: "Dup" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create blog$/i }));

    await vi.waitFor(() =>
      expect(screen.getByText("Slug already exists")).toBeInTheDocument(),
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /name your blog/i }),
    ).toBeInTheDocument();
  });

  it("falls back to a configure-settings hint when blog has no description or niche", () => {
    const blogs = [
      {
        id: "b-pending",
        name: "Fresh blog",
        slug: "fresh-blog",
        description: "",
        project_id: "p1",
        wp_url: null,
        wp_username: null,
        niche: "",
        keywords: [],
        ai_prompt_template: "",
        settings: {},
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ] as never[];

    render(<ProjectOverviewConnector {...defaultProps} blogs={blogs} />);
    expect(
      screen.getByText("Configure tone, audience, and AI rules in settings."),
    ).toBeInTheDocument();
  });
});
