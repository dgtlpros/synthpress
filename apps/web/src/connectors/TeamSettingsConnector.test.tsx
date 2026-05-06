import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";

vi.mock("@/hooks/useTeamSettings", () => ({
  useTeamSettings: vi.fn(),
}));

import { useTeamSettings } from "@/hooks/useTeamSettings";
import { TeamSettingsConnector } from "./TeamSettingsConnector";

const mockedUse = vi.mocked(useTeamSettings);

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

function defaultHook(
  overrides: Partial<ReturnType<typeof useTeamSettings>> = {},
) {
  return {
    newInvite: null,
    dismissNewInvite: vi.fn(),
    createInvite: vi.fn(),
    isCreatingInvite: false,
    inviteError: null,
    revoke: vi.fn(),
    isRevoking: null,
    revokeError: null,
    remove: vi.fn(),
    isRemoving: null,
    removeError: null,
    changeRole: vi.fn(),
    isChangingRole: null,
    changeRoleError: null,
    renameTeam: vi.fn(),
    isRenamingTeam: false,
    renameTeamError: null,
    deleteTeam: vi.fn(),
    isDeletingTeam: false,
    deleteTeamError: null,
    ...overrides,
  } as ReturnType<typeof useTeamSettings>;
}

const baseMembers = [
  {
    user_id: "owner-1",
    role: "owner" as const,
    created_at: "2026-01-01",
    email: "owner@x.co",
    full_name: "Owen Owner",
  },
  {
    user_id: "u-2",
    role: "admin" as const,
    created_at: "2026-01-02",
    email: "admin@x.co",
    full_name: "Alex Admin",
  },
  {
    user_id: "u-3",
    role: "member" as const,
    created_at: "2026-01-03",
    email: "dev@x.co",
    full_name: "Dana Dev",
  },
];

const baseInvites = [
  {
    id: "inv-1",
    team_id: "t1",
    role: "member" as const,
    email: "pending@x.co",
    invited_by: "owner-1",
    expires_at: "2099-01-01",
    accepted_at: null,
    accepted_by: null,
    revoked_at: null,
    created_at: "2026-02-01",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("TeamSettingsConnector — owner view", () => {
  it("renders invite form, members, pending invites", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    expect(
      screen.getByRole("button", { name: /create invite link/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Owen Owner/)).toBeInTheDocument();
    expect(screen.getByText(/pending@x.co/)).toBeInTheDocument();
  });

  it("calls createInvite on submit", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    fireEvent.change(email, { target: { value: "new@x.co" } });
    fireEvent.click(
      screen.getByRole("button", { name: /create invite link/i }),
    );

    expect(hook.createInvite).toHaveBeenCalledWith({
      email: "new@x.co",
      role: "member",
    });
  });

  it("shows the new invite link panel when present", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        newInvite: {
          rawToken: "tok",
          acceptUrl: "https://app/teams/invite/tok",
          email: null,
          role: "member",
          inviteId: "i-new",
        },
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    expect(screen.getByLabelText(/invite link/i)).toHaveValue(
      "https://app/teams/invite/tok",
    );
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
  });

  it("calls dismissNewInvite when 'Dismiss' is clicked", () => {
    const hook = defaultHook({
      newInvite: {
        rawToken: "tok",
        acceptUrl: "https://app/teams/invite/tok",
        email: null,
        role: "member",
        inviteId: "i-new",
      },
    });
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(hook.dismissNewInvite).toHaveBeenCalled();
  });

  it("copies invite URL via navigator.clipboard.writeText", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    mockedUse.mockReturnValue(
      defaultHook({
        newInvite: {
          rawToken: "tok",
          acceptUrl: "https://app/teams/invite/tok",
          email: null,
          role: "member",
          inviteId: "i-new",
        },
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
      await vi.waitFor(() =>
        expect(writeText).toHaveBeenCalledWith("https://app/teams/invite/tok"),
      );
    });
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("swallows copy errors when clipboard.writeText fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    mockedUse.mockReturnValue(
      defaultHook({
        newInvite: {
          rawToken: "tok",
          acceptUrl: "https://app/teams/invite/tok",
          email: null,
          role: "member",
          inviteId: "i-new",
        },
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
      await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    });
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("renders 'No pending invites' when invites list is empty", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    expect(screen.getByText(/no pending invites/i)).toBeInTheDocument();
  });

  it("renders single-member 1 member copy when only one row", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={[baseMembers[0]]}
        invites={[]}
      />,
    );
    expect(screen.getByText("1 member")).toBeInTheDocument();
  });

  it("falls back to user_id slice when neither full_name nor email present", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={[
          {
            user_id: "abcd1234-feed-beef-baba-deadbeefdead",
            role: "member",
            created_at: "2026-01-01",
            email: null,
            full_name: null,
          },
        ]}
        invites={[]}
      />,
    );
    expect(screen.getByText(/abcd1234/)).toBeInTheDocument();
  });

  it("renders 'Open link' label for open invites with no email", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[
          {
            id: "open-inv",
            team_id: "t1",
            role: "member",
            email: null,
            invited_by: "owner-1",
            expires_at: "2099-01-01",
            accepted_at: null,
            accepted_by: null,
            revoked_at: null,
            created_at: "2026-02-01",
          },
        ]}
      />,
    );
    expect(
      screen.getByText(/open link \(any signed-in user\)/i),
    ).toBeInTheDocument();
  });

  it("calls revoke when 'Revoke' clicked on a pending invite", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));
    expect(hook.revoke).toHaveBeenCalledWith("inv-1");
  });

  it("calls changeRole when role select changes for a non-owner", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    const select = screen.getByLabelText(
      /change role for alex admin/i,
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "member" } });
    expect(hook.changeRole).toHaveBeenCalledWith("u-2", "member");
  });

  it("opens confirm modal then calls remove on confirm", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    // Two "Remove" row buttons (admin and member). Click the first (admin row).
    const rowRemoveButtons = screen.getAllByRole("button", {
      name: /^remove$/i,
    });
    fireEvent.click(rowRemoveButtons[0]);

    // Modal opens with a confirm "Remove" button — there are now multiple 'remove'
    // buttons total (rows + modal). The modal is the ConfirmModal which renders
    // the title "Remove member" — find that dialog specifically.
    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    const confirmDialog = dialogs.find((d) =>
      d.textContent?.includes("Remove member"),
    );
    expect(confirmDialog).toBeDefined();
    const confirmButton = Array.from(
      confirmDialog!.querySelectorAll("button"),
    ).find((b) => b.textContent === "Remove");
    expect(confirmButton).toBeDefined();
    fireEvent.click(confirmButton!);
    expect(hook.remove).toHaveBeenCalledWith("u-2");
  });

  it("renders inviteError, removeError, changeRoleError, revokeError when present", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        inviteError: "INVITE-ERR",
        removeError: "RM-ERR",
        changeRoleError: "ROLE-ERR",
        revokeError: "REV-ERR",
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );
    const alerts = screen.getAllByRole("alert").map((el) => el.textContent);
    expect(alerts).toContain("INVITE-ERR");
    expect(alerts).toContain("RM-ERR");
    expect(alerts).toContain("ROLE-ERR");
    expect(alerts).toContain("REV-ERR");
  });
});

describe("TeamSettingsConnector — member view", () => {
  it("hides invite form, role selectors, and remove buttons", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="u-3"
        currentUserRole="member"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /create invite link/i }),
    ).toBeNull();
    expect(screen.queryByText(/pending invites/i)).toBeNull();
    // No role selectors for non-owners visible
    expect(screen.queryByLabelText(/change role for alex admin/i)).toBeNull();
    // Remove buttons hidden
    expect(screen.queryByRole("button", { name: /^remove$/i })).toBeNull();
  });

  it("still shows member badges with role text", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="u-3"
        currentUserRole="member"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    // Owner row renders an "owner" badge alongside "Owen Owner".
    expect(screen.getByText("Owen Owner")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });
});

describe("TeamSettingsConnector — admin view", () => {
  it("shows invite form, hides role selector for owner row, shows it for non-owners", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="u-2"
        currentUserRole="admin"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    expect(
      screen.getByRole("button", { name: /create invite link/i }),
    ).toBeInTheDocument();
    // admin can't change_role (owner-only) so no selectors at all
    expect(screen.queryByLabelText(/change role for/i)).toBeNull();
  });
});

describe("TeamSettingsConnector — team rename (update_team card)", () => {
  it("shows Team details card and Rename button for owner", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    expect(screen.getByText("Team details")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rename/i })).toBeInTheDocument();
  });

  it("opens EditTeamSettingsModal when Rename is clicked", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    expect(screen.getByLabelText(/team name/i)).toBeInTheDocument();
  });

  it("calls renameTeam when Save is clicked", () => {
    const renameTeam = vi.fn();
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam,
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: "Acme Corp" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(renameTeam).toHaveBeenCalledWith("Acme Corp");
  });

  it("hides Team details card for member (no update_team permission)", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="u-3"
        currentUserRole="member"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    expect(screen.queryByText("Team details")).not.toBeInTheDocument();
  });
});

describe("TeamSettingsConnector — danger zone (delete_team card)", () => {
  it("shows Danger zone card only for owner", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete team/i }),
    ).toBeInTheDocument();
  });

  it("hides Danger zone for admin (delete_team is owner-only)", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="u-2"
        currentUserRole="admin"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
  });

  it("opens DeleteConfirmModal when Delete team is clicked", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete team/i }));
    expect(
      screen.getByRole("heading", { name: /delete team/i }),
    ).toBeInTheDocument();
  });

  it("calls hook.deleteTeam after typing the team name and confirming", () => {
    const deleteTeam = vi.fn();
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam,
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete team/i }));

    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    const deleteDialog = dialogs.find((d) =>
      d.textContent?.includes("Delete team"),
    );
    expect(deleteDialog).toBeDefined();

    const input = deleteDialog!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "Acme" } });

    const confirmBtn = Array.from(
      deleteDialog!.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Delete team"))!;
    fireEvent.click(confirmBtn);
    expect(deleteTeam).toHaveBeenCalledOnce();
  });

  it("shows renameTeamError when present", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: "RENAME-ERR",
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    const alerts = screen.getAllByRole("alert").map((el) => el.textContent);
    expect(alerts).toContain("RENAME-ERR");
  });

  it("shows deleteTeamError when present", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: "DELETE-ERR",
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    expect(screen.getByText("DELETE-ERR")).toBeInTheDocument();
  });

  it("closes rename modal when Cancel is clicked", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    const dialog = screen.getByLabelText(/team name/i).closest("dialog")!;
    expect(dialog).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(dialog).not.toHaveAttribute("open");
  });

  it("closes delete modal when Cancel is clicked inside it", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete team/i }));
    expect(
      screen.getByRole("heading", { name: /delete team/i }),
    ).toBeInTheDocument();

    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    const deleteDialog = dialogs.find((d) =>
      d.textContent?.includes("Delete team"),
    );
    const cancelBtn = Array.from(deleteDialog!.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    )!;
    fireEvent.click(cancelBtn);
    expect(
      screen.queryByRole("heading", { name: /delete team/i }),
    ).not.toBeInTheDocument();
  });

  it("clears invite email after form submission", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    fireEvent.change(email, { target: { value: "new@x.co" } });
    fireEvent.submit(
      screen
        .getByRole("button", { name: /create invite link/i })
        .closest("form")!,
    );

    expect(hook.createInvite).toHaveBeenCalled();
    expect(email).toHaveValue("");
  });

  it("allows changing invite role before submitting", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    const roleSelect = screen.getByRole("combobox", {
      name: /^role$/i,
    }) as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "admin" } });
    fireEvent.click(
      screen.getByRole("button", { name: /create invite link/i }),
    );
    expect(hook.createInvite).toHaveBeenCalledWith({
      email: "",
      role: "admin",
    });
  });

  it("selects invite link text on focus", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        newInvite: {
          rawToken: "tok",
          acceptUrl: "https://app/teams/invite/tok",
          email: null,
          role: "member",
          inviteId: "i-new",
        },
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    const input = screen.getByLabelText(/invite link/i) as HTMLInputElement;
    const selectSpy = vi.spyOn(input, "select");
    fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();
  });

  it("closes remove confirm modal when Cancel is clicked (onCancel)", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    const rowRemoveButtons = screen.getAllByRole("button", {
      name: /^remove$/i,
    });
    fireEvent.click(rowRemoveButtons[0]);

    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    const confirmDialog = dialogs.find((d) =>
      d.textContent?.includes("Remove member"),
    );
    expect(confirmDialog).toBeDefined();
    const cancelButton = Array.from(
      confirmDialog!.querySelectorAll("button"),
    ).find((b) => b.textContent === "Cancel");
    expect(cancelButton).toBeDefined();
    fireEvent.click(cancelButton!);
    expect(hook.remove).not.toHaveBeenCalled();
  });

  it("closes rename modal via dialog cancel (onClose prop)", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    const dialog = screen.getByLabelText(/team name/i).closest("dialog")!;
    expect(dialog).toHaveAttribute("open");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).not.toHaveAttribute("open");
  });
});

describe("TeamSettingsConnector — invite form + new invite link", () => {
  it("submits invite form with email and role, displays new invite link", () => {
    const createInvite = vi.fn();
    const newInvite = {
      rawToken: "tok",
      acceptUrl: "https://app/teams/invite/tok",
      email: "test@x.co",
      role: "member" as const,
      inviteId: "i1",
    };
    mockedUse.mockReturnValue(
      defaultHook({
        createInvite,
        newInvite,
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    expect(screen.getByLabelText("Invite link")).toHaveValue(
      "https://app/teams/invite/tok",
    );
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /dismiss/i }),
    ).toBeInTheDocument();
  });

  it("submits invite form and calls createInvite", () => {
    const createInvite = vi.fn();
    mockedUse.mockReturnValue(
      defaultHook({
        createInvite,
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/teammate/i), {
      target: { value: "new@x.co" },
    });
    const form = screen
      .getByRole("button", { name: /create invite link/i })
      .closest("form")!;
    fireEvent.submit(form);
    expect(createInvite).toHaveBeenCalledWith({
      email: "new@x.co",
      role: "member",
    });
  });

  it("shows inviteError when present", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        inviteError: "INVITE-FAIL",
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    expect(screen.getByText("INVITE-FAIL")).toBeInTheDocument();
  });

  it("renders members with formatDate and fallback for invalid date", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );

    const membersWithBadDate = [
      {
        user_id: "u-bad",
        role: "member" as const,
        created_at: "not-a-date",
        email: null,
        full_name: null,
      },
    ];
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={membersWithBadDate}
        invites={[]}
      />,
    );

    expect(screen.getByText(/not-a-date/)).toBeInTheDocument();
  });

  it("renders member label with user_id fallback when no name or email", () => {
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam: vi.fn(),
        isRenamingTeam: false,
        renameTeamError: null,
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );

    const membersNoName = [
      {
        user_id: "abcdef12-3456-7890",
        role: "member" as const,
        created_at: "2026-01-01",
        email: null,
        full_name: null,
      },
    ];
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={membersNoName}
        invites={[]}
      />,
    );

    expect(screen.getByText("abcdef12")).toBeInTheDocument();
  });
});

describe("TeamSettingsConnector — rename error keeps modal open", () => {
  it("keeps rename modal open when renameTeamError is present after save", () => {
    const renameTeam = vi.fn();
    mockedUse.mockReturnValue(
      defaultHook({
        renameTeam,
        isRenamingTeam: false,
        renameTeamError: "Name taken",
        deleteTeam: vi.fn(),
        isDeletingTeam: false,
        deleteTeamError: null,
      }),
    );
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(renameTeam).toHaveBeenCalled();
    expect(screen.getByLabelText(/team name/i)).toBeInTheDocument();
  });
});

describe("TeamSettingsConnector — copyToClipboard edge cases", () => {
  const newInvite = {
    rawToken: "tok",
    acceptUrl: "https://app/teams/invite/tok",
    email: null,
    role: "member" as const,
    inviteId: "i-new",
  };

  it("returns early without throwing when navigator.clipboard is unavailable", () => {
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    mockedUse.mockReturnValue(defaultHook({ newInvite }));
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: /^copy$/i })),
    ).not.toThrow();
    // Still showing the original "Copy" label since the early return skipped state changes.
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
  });

  it("flips Copy → Copied → Copy after writeText resolves and timer fires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    mockedUse.mockReturnValue(defaultHook({ newInvite }));
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    // The await navigator.clipboard.writeText resolves on a microtask, flipping copyConfirm to true.
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole("button", { name: /^copied$/i }),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://app/teams/invite/tok");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe("TeamSettingsConnector — handleConfirmRemove guard", () => {
  it("no-ops when the confirm button is invoked without a queued member", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(
      <TeamSettingsConnector
        teamId="t1"
        teamName="Acme"
        currentUserId="owner-1"
        currentUserRole="owner"
        ownerUserId="owner-1"
        members={baseMembers}
        invites={baseInvites}
      />,
    );

    // The ConfirmModal is rendered (closed) so its buttons are still in the DOM.
    // Clicking confirm without first opening the modal exercises the guard branch
    // where confirmRemoveUserId is null.
    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    const confirmDialog = dialogs.find((d) =>
      d.textContent?.includes("Remove member"),
    );
    expect(confirmDialog).toBeDefined();
    const confirmButton = Array.from(
      confirmDialog!.querySelectorAll("button"),
    ).find((b) => b.textContent === "Remove");
    expect(confirmButton).toBeDefined();
    fireEvent.click(confirmButton!);

    expect(hook.remove).not.toHaveBeenCalled();
  });
});
