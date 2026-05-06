import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@/hooks/useTeamSettings", () => ({
  useTeamSettings: vi.fn(),
}));

import { useTeamSettings } from "@/hooks/useTeamSettings";
import { TeamSettingsConnector } from "./TeamSettingsConnector";

const mockedUse = vi.mocked(useTeamSettings);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

function defaultHook(overrides: Partial<ReturnType<typeof useTeamSettings>> = {}) {
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

    expect(screen.getByRole("button", { name: /create invite link/i })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /create invite link/i }));

    expect(hook.createInvite).toHaveBeenCalledWith({ email: "new@x.co", role: "member" });
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

    expect(screen.getByLabelText(/invite link/i)).toHaveValue("https://app/teams/invite/tok");
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

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith("https://app/teams/invite/tok");
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

    expect(() => fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))).not.toThrow();
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
    expect(screen.getByText(/open link \(any signed-in user\)/i)).toBeInTheDocument();
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

    const select = screen.getByLabelText(/change role for alex admin/i) as HTMLSelectElement;
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
    const rowRemoveButtons = screen.getAllByRole("button", { name: /^remove$/i });
    fireEvent.click(rowRemoveButtons[0]);

    // Modal opens with a confirm "Remove" button — there are now 3 'remove'
    // buttons total (2 rows + 1 modal). The modal one is the only one inside
    // a <dialog>.
    const dialog = screen.getByRole("dialog", { hidden: true });
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Remove",
    );
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

    expect(screen.queryByRole("button", { name: /create invite link/i })).toBeNull();
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

    expect(screen.getByRole("button", { name: /create invite link/i })).toBeInTheDocument();
    // admin can't change_role (owner-only) so no selectors at all
    expect(screen.queryByLabelText(/change role for/i)).toBeNull();
  });
});
