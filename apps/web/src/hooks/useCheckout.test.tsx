import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/actions/billing", () => ({
  createSubscriptionCheckout: vi.fn(),
  createTopUpCheckout: vi.fn(),
}));

import { createSubscriptionCheckout, createTopUpCheckout } from "@/actions/billing";
import { useCheckout, type CheckoutTarget } from "./useCheckout";

const mockedSub = vi.mocked(createSubscriptionCheckout);
const mockedTop = vi.mocked(createTopUpCheckout);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCheckout", () => {
  it("loads a subscription client secret", async () => {
    mockedSub.mockResolvedValue({ clientSecret: "secret_sub" });
    const { result } = renderHook(() =>
      useCheckout({ kind: "subscription", planKey: "pro" }),
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.clientSecret).toBe("secret_sub");
    expect(result.current.error).toBeNull();
    expect(mockedSub).toHaveBeenCalledWith("pro");
  });

  it("loads a top-up client secret", async () => {
    mockedTop.mockResolvedValue({ clientSecret: "secret_top" });
    const { result } = renderHook(() =>
      useCheckout({ kind: "top_up", packKey: "pack_500" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.clientSecret).toBe("secret_top");
    expect(mockedTop).toHaveBeenCalledWith("pack_500");
  });

  it("surfaces server-action errors", async () => {
    mockedSub.mockResolvedValue({ error: "Unknown plan" });
    const { result } = renderHook(() =>
      useCheckout({ kind: "subscription", planKey: "ghost" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Unknown plan");
    expect(result.current.clientSecret).toBeNull();
  });

  it("falls back to a generic error when neither field is set", async () => {
    mockedSub.mockResolvedValue({});
    const { result } = renderHook(() =>
      useCheckout({ kind: "subscription", planKey: "pro" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Could not start checkout.");
  });

  it("handles thrown errors from the server action", async () => {
    mockedSub.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() =>
      useCheckout({ kind: "subscription", planKey: "pro" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("network");
  });

  it("falls back to a generic error for non-Error rejections", async () => {
    mockedSub.mockRejectedValue("oops");
    const { result } = renderHook(() =>
      useCheckout({ kind: "subscription", planKey: "pro" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Could not start checkout.");
  });

  it("re-fetches when target identity changes", async () => {
    mockedSub.mockResolvedValueOnce({ clientSecret: "first" });
    const initialTarget: CheckoutTarget = { kind: "subscription", planKey: "pro" };
    const { result, rerender } = renderHook(
      ({ target }: { target: CheckoutTarget }) => useCheckout(target),
      { initialProps: { target: initialTarget } },
    );
    await waitFor(() => expect(result.current.clientSecret).toBe("first"));

    mockedSub.mockResolvedValueOnce({ clientSecret: "second" });
    const nextTarget: CheckoutTarget = { kind: "subscription", planKey: "starter" };
    rerender({ target: nextTarget });

    await waitFor(() => expect(result.current.clientSecret).toBe("second"));
    expect(mockedSub).toHaveBeenCalledTimes(2);
  });

  it("ignores results that arrive after unmount", async () => {
    let resolveFn: ((value: { clientSecret: string }) => void) | undefined;
    mockedSub.mockReturnValue(new Promise((resolve) => {
      resolveFn = resolve;
    }) as never);

    const { result, unmount } = renderHook(() =>
      useCheckout({ kind: "subscription", planKey: "pro" }),
    );

    unmount();
    act(() => {
      resolveFn?.({ clientSecret: "ignored" });
    });

    expect(result.current.clientSecret).toBeNull();
  });
});
