import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/actions/team-invites", () => ({
  acceptInviteAction: vi.fn(),
}));

import { useRouter } from "next/navigation";
import { acceptInviteAction } from "@/actions/team-invites";
import { useAcceptInvite } from "./useAcceptInvite";

const mockedUseRouter = vi.mocked(useRouter);
const mockedAccept = vi.mocked(acceptInviteAction);

function makeRouter() {
  return { push: vi.fn(), refresh: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAcceptInvite", () => {
  it("starts not accepting and no error", () => {
    mockedUseRouter.mockReturnValue(makeRouter() as never);
    const { result } = renderHook(() =>
      useAcceptInvite({ rawToken: "tok", teamId: "t1" }),
    );

    expect(result.current.isAccepting).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.ok).toBe(false);
  });

  it("on success: navigates to team projects and sets ok", async () => {
    const router = makeRouter();
    mockedUseRouter.mockReturnValue(router as never);
    mockedAccept.mockResolvedValue({ teamId: "t1", role: "member", error: null });

    const { result } = renderHook(() =>
      useAcceptInvite({ rawToken: "tok", teamId: "t1" }),
    );

    await act(async () => {
      result.current.accept();
    });

    await waitFor(() => expect(result.current.ok).toBe(true));
    expect(router.push).toHaveBeenCalledWith("/teams/t1/projects");
    expect(router.refresh).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("respects redirectTo override", async () => {
    const router = makeRouter();
    mockedUseRouter.mockReturnValue(router as never);
    mockedAccept.mockResolvedValue({ teamId: "t1", role: "admin", error: null });

    const { result } = renderHook(() =>
      useAcceptInvite({ rawToken: "tok", teamId: "t1", redirectTo: "/dashboard" }),
    );

    await act(async () => {
      result.current.accept();
    });

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard"));
  });

  it("on failure: surfaces error and does not navigate", async () => {
    const router = makeRouter();
    mockedUseRouter.mockReturnValue(router as never);
    mockedAccept.mockResolvedValue({
      teamId: null,
      role: null,
      error: "expired",
    });

    const { result } = renderHook(() =>
      useAcceptInvite({ rawToken: "tok", teamId: "t1" }),
    );

    await act(async () => {
      result.current.accept();
    });

    await waitFor(() => expect(result.current.error).toBe("expired"));
    expect(router.push).not.toHaveBeenCalled();
    expect(result.current.ok).toBe(false);
  });
});
