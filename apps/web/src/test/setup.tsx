import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * jsdom does not implement `window.matchMedia`, but next-themes (and any
 * media-query-driven hook we add later) calls it on mount. We register a
 * permissive stub here so the API exists and behaves like a "light /
 * non-mobile / no-prefers-anything" environment by default. Tests that
 * care about a specific match can spy on `window.matchMedia` and return
 * a different `matches` value.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
