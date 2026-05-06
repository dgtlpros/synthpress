import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockUpdateProjectSettings = vi.fn();
const mockDeleteProject = vi.fn();
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/actions/workspace", () => ({
  updateProjectSettings: (...args: unknown[]) =>
    mockUpdateProjectSettings(...args),
  deleteProject: (...args: unknown[]) => mockDeleteProject(...args),
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

  it("renders installed blogs as list items", () => {
    const blogs = [
      {
        id: "b1",
        name: "Tech Blog",
        slug: "tech-blog",
        project_id: "p1",
        wp_url: "https://wp.example.com",
        wp_username: "admin",
        is_active: true,
        articles_per_day: 2,
        niche: "Tech",
        keywords: [],
        ai_prompt_template: "",
        schedule_cron: "0 9 * * *",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ] as never[];

    render(<ProjectOverviewConnector {...defaultProps} blogs={blogs} />);
    expect(screen.getByText("Tech Blog")).toBeInTheDocument();
    expect(
      screen.getByText(/2 article\(s\) per day · Tech/),
    ).toBeInTheDocument();
  });

  it("omits niche from meta when blog niche is empty/whitespace", () => {
    const blogs = [
      {
        id: "b-empty",
        name: "No Niche Blog",
        slug: "no-niche",
        project_id: "p1",
        wp_url: "https://wp.example.com",
        wp_username: "admin",
        is_active: true,
        articles_per_day: 1,
        niche: "   ",
        keywords: [],
        ai_prompt_template: "",
        schedule_cron: "0 9 * * *",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
      {
        id: "b-null",
        name: "Null Niche Blog",
        slug: "null-niche",
        project_id: "p1",
        wp_url: "https://wp.example.com",
        wp_username: "admin",
        is_active: false,
        articles_per_day: 3,
        niche: null,
        keywords: [],
        ai_prompt_template: "",
        schedule_cron: "0 9 * * *",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ] as never[];

    render(<ProjectOverviewConnector {...defaultProps} blogs={blogs} />);
    expect(screen.getByText("1 article(s) per day")).toBeInTheDocument();
    expect(screen.getByText("3 article(s) per day")).toBeInTheDocument();
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

  it("closes CreateAppChoiceModal via onAfterChooseBlog when Blog is chosen", () => {
    render(<ProjectOverviewConnector {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /create app/i }));
    expect(
      screen.getByRole("heading", { name: /create app/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /blog/i }));
    expect(
      screen.queryByRole("heading", { name: /create app/i }),
    ).not.toBeInTheDocument();
  });
});
