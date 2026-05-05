import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/actions/billing", () => ({
  createBillingPortal: vi.fn(),
}));

import { createBillingPortal } from "@/actions/billing";
import { useBillingActions } from "./useBillingActions";

const mockedPortal = vi.mocked(createBillingPortal);

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

describe("useBillingActions", () => {
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
      expect(result.current.portalError).toBe("Could not open the billing portal."),
    );
  });

  it("clears prior errors when openPortal is invoked again", async () => {
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
