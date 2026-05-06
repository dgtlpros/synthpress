import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockRouterRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

vi.mock("@/actions/billing", () => ({
  createBillingPortal: vi.fn(),
  resumeSubscription: vi.fn(),
}));

import { createBillingPortal, resumeSubscription } from "@/actions/billing";
import { useBillingActions } from "./useBillingActions";

const mockedPortal = vi.mocked(createBillingPortal);
const mockedResume = vi.mocked(resumeSubscription);

const ORIGINAL_LOCATION = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...ORIGINAL_LOCATION, href: "http://localhost/" },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("useBillingActions — openPortal", () => {
  it("redirects to the returned portal url on success", async () => {
    mockedPortal.mockResolvedValue({ url: "https://billing.stripe.com/x" });
    const { result } = renderHook(() => useBillingActions());

    act(() => result.current.openPortal());

    await waitFor(() => {
      expect(window.location.href).toBe("https://billing.stripe.com/x");
    });
    expect(result.current.portalError).toBeNull();
  });

  it("surfaces server-action errors without redirecting", async () => {
    mockedPortal.mockResolvedValue({ error: "boom" });
    const { result } = renderHook(() => useBillingActions());

    act(() => result.current.openPortal());

    await waitFor(() => expect(result.current.portalError).toBe("boom"));
    expect(window.location.href).toBe("http://localhost/");
  });

  it("falls back to a generic error when neither url nor error is returned", async () => {
    mockedPortal.mockResolvedValue({});
    const { result } = renderHook(() => useBillingActions());

    act(() => result.current.openPortal());

    await waitFor(() =>
      expect(result.current.portalError).toBe(
        "Could not open the billing portal.",
      ),
    );
  });

  it("clears prior portal errors when openPortal is invoked again", async () => {
    mockedPortal.mockResolvedValueOnce({ error: "first" });
    const { result } = renderHook(() => useBillingActions());

    act(() => result.current.openPortal());
    await waitFor(() => expect(result.current.portalError).toBe("first"));

    mockedPortal.mockResolvedValueOnce({ url: "https://billing.stripe.com/y" });
    act(() => result.current.openPortal());

    await waitFor(() => {
      expect(result.current.portalError).toBeNull();
      expect(window.location.href).toBe("https://billing.stripe.com/y");
    });
  });
});

describe("useBillingActions — resume", () => {
  it("calls the server action and refreshes the route on success", async () => {
    mockedResume.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useBillingActions());

    act(() => result.current.resume());

    await waitFor(() => {
      expect(mockedResume).toHaveBeenCalledTimes(1);
      expect(result.current.resumeError).toBeNull();
      expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("does NOT refresh the route when the server action errors", async () => {
    mockedResume.mockResolvedValue({ error: "boom" });
    const { result } = renderHook(() => useBillingActions());

    act(() => result.current.resume());

    await waitFor(() => expect(result.current.resumeError).toBe("boom"));
    expect(mockRouterRefresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic error when neither ok nor error is returned", async () => {
    mockedResume.mockResolvedValue({});
    const { result } = renderHook(() => useBillingActions());

    act(() => result.current.resume());

    await waitFor(() =>
      expect(result.current.resumeError).toBe("Could not resume subscription."),
    );
  });

  it("clears prior resume errors on subsequent calls", async () => {
    mockedResume.mockResolvedValueOnce({ error: "first" });
    const { result } = renderHook(() => useBillingActions());

    act(() => result.current.resume());
    await waitFor(() => expect(result.current.resumeError).toBe("first"));

    mockedResume.mockResolvedValueOnce({ ok: true });
    act(() => result.current.resume());

    await waitFor(() => expect(result.current.resumeError).toBeNull());
  });
});
