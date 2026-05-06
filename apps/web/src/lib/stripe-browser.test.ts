import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(),
}));

import { loadStripe } from "@stripe/stripe-js";
import {
  getStripeBrowser,
  resetStripeBrowserForTesting,
} from "./stripe-browser";

const mockedLoad = vi.mocked(loadStripe);
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  resetStripeBrowserForTesting();
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_x";
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("getStripeBrowser", () => {
  it("loads Stripe.js with the publishable key", () => {
    mockedLoad.mockReturnValue(Promise.resolve({} as never));
    getStripeBrowser();
    expect(mockedLoad).toHaveBeenCalledWith("pk_test_x");
  });

  it("memoizes across calls", () => {
    mockedLoad.mockReturnValue(Promise.resolve({} as never));
    const a = getStripeBrowser();
    const b = getStripeBrowser();
    expect(a).toBe(b);
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it("throws when NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing", () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    expect(() => getStripeBrowser()).toThrow(
      /Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/,
    );
  });
});
