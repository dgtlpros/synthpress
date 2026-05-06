import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useAcceptInvite", () => ({
  useAcceptInvite: vi.fn(),
}));

import { useAcceptInvite } from "@/hooks/useAcceptInvite";
import { AcceptInviteConnector } from "./AcceptInviteConnector";

const mockedUse = vi.mocked(useAcceptInvite);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function defaultHook(overrides: Partial<ReturnType<typeof useAcceptInvite>> = {}) {
  return {
    accept: vi.fn(),
    isAccepting: false,
    error: null,
    ok: false,
    ...overrides,
  } as ReturnType<typeof useAcceptInvite>;
}

describe("AcceptInviteConnector", () => {
  it("renders 'Join {team}' button by default", () => {
    mockedUse.mockReturnValue(defaultHook());
    render(<AcceptInviteConnector rawToken="tok" teamId="t1" teamName="Acme" />);
    expect(screen.getByRole("button", { name: /join acme/i })).toBeEnabled();
  });

  it("calls accept on click", () => {
    const hook = defaultHook();
    mockedUse.mockReturnValue(hook);
    render(<AcceptInviteConnector rawToken="tok" teamId="t1" teamName="Acme" />);
    fireEvent.click(screen.getByRole("button"));
    expect(hook.accept).toHaveBeenCalledTimes(1);
  });

  it("shows loading state when accepting", () => {
    mockedUse.mockReturnValue(defaultHook({ isAccepting: true }));
    render(<AcceptInviteConnector rawToken="tok" teamId="t1" teamName="Acme" />);
    expect(screen.getByRole("button", { name: /join acme/i })).toBeDisabled();
  });

  it("shows 'Joined' once ok", () => {
    mockedUse.mockReturnValue(defaultHook({ ok: true }));
    render(<AcceptInviteConnector rawToken="tok" teamId="t1" teamName="Acme" />);
    expect(screen.getByRole("button", { name: /joined/i })).toBeDisabled();
  });

  it("translates known error codes to friendly copy", async () => {
    mockedUse.mockReturnValue(defaultHook({ error: "expired" }));
    render(<AcceptInviteConnector rawToken="tok" teamId="t1" teamName="Acme" />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/expired/i),
    );
  });

  it("falls back to raw error string for unknown code", () => {
    mockedUse.mockReturnValue(defaultHook({ error: "weird-server-err" }));
    render(<AcceptInviteConnector rawToken="tok" teamId="t1" teamName="Acme" />);
    expect(screen.getByRole("alert").textContent).toBe("weird-server-err");
  });
});
