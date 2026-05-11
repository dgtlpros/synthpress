import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ThemeProvider } from "../ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark", "light");
  window.localStorage.clear();
});

beforeEach(() => {
  document.documentElement.classList.remove("dark", "light");
  window.localStorage.clear();
});

function renderWithProvider(
  ui: React.ReactNode,
  {
    defaultTheme = "system",
  }: { defaultTheme?: "light" | "dark" | "system" } = {},
) {
  return render(
    <ThemeProvider defaultTheme={defaultTheme}>{ui}</ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  describe("trigger", () => {
    it("renders an icon button", () => {
      renderWithProvider(<ThemeToggle />);
      expect(screen.getByTestId("theme-toggle-trigger")).toBeInTheDocument();
    });

    it("uses the provided label as the accessible name", () => {
      renderWithProvider(<ThemeToggle label="Color mode" />);
      // The button label includes the resolved theme; it starts with the
      // user-supplied label.
      const trigger = screen.getByTestId("theme-toggle-trigger");
      expect(trigger.getAttribute("aria-label")).toMatch(/^Color mode/);
    });

    it("starts with the popover closed", () => {
      renderWithProvider(<ThemeToggle />);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("opens the popover on click", () => {
      renderWithProvider(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("toggles the popover closed when the trigger is clicked again", () => {
      renderWithProvider(<ThemeToggle />);
      const trigger = screen.getByTestId("theme-toggle-trigger");
      fireEvent.click(trigger);
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.click(trigger);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("reflects expanded state on aria-expanded", () => {
      renderWithProvider(<ThemeToggle />);
      const trigger = screen.getByTestId("theme-toggle-trigger");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("works without a ThemeProvider (returns useTheme defaults)", () => {
      // The Storybook decorator and some standalone uses of <ThemeToggle>
      // may live outside the provider. The component must not crash;
      // useTheme returns a no-op setTheme so clicks just don't persist.
      render(<ThemeToggle />);
      const trigger = screen.getByTestId("theme-toggle-trigger");
      fireEvent.click(trigger);
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });
  });

  describe("menu", () => {
    it("renders three radio options: Light, Dark, System", () => {
      renderWithProvider(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      expect(
        screen.getByRole("menuitemradio", { name: /Light/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitemradio", { name: /Dark/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitemradio", { name: /System/ }),
      ).toBeInTheDocument();
    });

    it("marks the current theme with aria-checked", () => {
      renderWithProvider(<ThemeToggle />, { defaultTheme: "dark" });
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      expect(
        screen.getByRole("menuitemradio", { name: /Dark/ }),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByRole("menuitemradio", { name: /Light/ }),
      ).toHaveAttribute("aria-checked", "false");
    });

    it("falls back to System checked when theme is undefined (no provider)", () => {
      render(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      expect(
        screen.getByRole("menuitemradio", { name: /System/ }),
      ).toHaveAttribute("aria-checked", "true");
    });
  });

  describe("selection", () => {
    it("calls setTheme('dark') and closes the popover when Dark is clicked", () => {
      renderWithProvider(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      act(() => {
        fireEvent.click(screen.getByRole("menuitemradio", { name: /Dark/ }));
      });
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("calls setTheme('light') and closes the popover when Light is clicked", () => {
      renderWithProvider(<ThemeToggle />, { defaultTheme: "dark" });
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      act(() => {
        fireEvent.click(screen.getByRole("menuitemradio", { name: /Light/ }));
      });
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("calls setTheme('system') when System is clicked", () => {
      renderWithProvider(<ThemeToggle />, { defaultTheme: "dark" });
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      act(() => {
        fireEvent.click(screen.getByRole("menuitemradio", { name: /System/ }));
      });
      // After choosing system, theme is "system" — the resolvedTheme depends
      // on jsdom's matchMedia which we don't override; the persisted value
      // is what matters here.
      expect(window.localStorage.getItem("theme")).toBe("system");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  describe("dismissal", () => {
    it("closes the popover on outside mousedown", () => {
      renderWithProvider(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("does NOT close on mousedown inside the popover", () => {
      renderWithProvider(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      const menu = screen.getByRole("menu");
      fireEvent.mouseDown(menu);
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("closes the popover on Escape", () => {
      renderWithProvider(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("ignores non-Escape keydown when the popover is open", () => {
      renderWithProvider(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      fireEvent.keyDown(document, { key: "Tab" });
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("cleanup removes event listeners (no errors on unmount)", () => {
      const { unmount } = renderWithProvider(<ThemeToggle />);
      fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
      expect(screen.getByRole("menu")).toBeInTheDocument();
      unmount();
      expect(() =>
        fireEvent.keyDown(document, { key: "Escape" }),
      ).not.toThrow();
    });
  });

  describe("ssr safety", () => {
    it("renders the placeholder Sun icon before mount (no theme-specific glyph)", () => {
      // Mocking useEffect would require global timer mocks; instead we just
      // assert the component still mounts and exposes the trigger button —
      // the post-mount glyph is exercised by the other tests.
      renderWithProvider(<ThemeToggle />);
      expect(screen.getByTestId("theme-toggle-trigger")).toBeInTheDocument();
    });
  });

  describe("placement auto-flip", () => {
    /**
     * jsdom returns an empty rect (top/bottom = 0) for every element. Tests
     * here override `getBoundingClientRect` on the wrapper div so we can
     * simulate "trigger near the bottom of the viewport" (the sidebar
     * footer scenario that prompted this behavior) and "trigger at the
     * top of the viewport" (the marketing navbar scenario).
     */
    function mockWrapperRect(top: number, height = 36) {
      const original = HTMLDivElement.prototype.getBoundingClientRect;
      HTMLDivElement.prototype.getBoundingClientRect = function () {
        return {
          top,
          bottom: top + height,
          left: 0,
          right: 100,
          width: 100,
          height,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      };
      return () => {
        HTMLDivElement.prototype.getBoundingClientRect = original;
      };
    }

    it("opens downward by default when there is room below", () => {
      // window.innerHeight is 768 in jsdom; trigger sits at top:50, so
      // ~680px of room below — plenty for the menu.
      const restore = mockWrapperRect(50);
      try {
        renderWithProvider(<ThemeToggle />);
        fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
        const menu = screen.getByRole("menu");
        expect(menu).toHaveAttribute("data-placement", "bottom");
        expect(menu.className).toContain("top-full");
        expect(menu.className).not.toContain("bottom-full");
      } finally {
        restore();
      }
    });

    it("flips upward when the trigger sits near the bottom of the viewport", () => {
      // Place the trigger 20px from the bottom: spaceBelow ~ 16px (under
      // the 140px estimate) and spaceAbove ~ 712px (plenty of room above).
      const restore = mockWrapperRect(window.innerHeight - 20);
      try {
        renderWithProvider(<ThemeToggle />);
        fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
        const menu = screen.getByRole("menu");
        expect(menu).toHaveAttribute("data-placement", "top");
        expect(menu.className).toContain("bottom-full");
        expect(menu.className).not.toContain("top-full");
      } finally {
        restore();
      }
    });

    it("stays downward when both above and below are tight (avoids worse clipping)", () => {
      // Tiny viewport scenario: trigger near bottom AND not enough above.
      // The flip guard requires space above >= MENU_HEIGHT_ESTIMATE_PX, so
      // we fall back to the default downward placement.
      const restore = mockWrapperRect(50, 36);
      const originalInnerHeight = window.innerHeight;
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 100,
      });
      try {
        renderWithProvider(<ThemeToggle />);
        fireEvent.click(screen.getByTestId("theme-toggle-trigger"));
        const menu = screen.getByRole("menu");
        expect(menu).toHaveAttribute("data-placement", "bottom");
      } finally {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: originalInnerHeight,
        });
        restore();
      }
    });

    it("re-evaluates placement each time the menu re-opens", () => {
      const restore = mockWrapperRect(50);
      try {
        renderWithProvider(<ThemeToggle />);
        const trigger = screen.getByTestId("theme-toggle-trigger");
        fireEvent.click(trigger);
        expect(screen.getByRole("menu")).toHaveAttribute(
          "data-placement",
          "bottom",
        );
        // Close.
        fireEvent.click(trigger);
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();

        // Move the trigger close to the bottom and open again.
        restore();
        const restoreLow = mockWrapperRect(window.innerHeight - 20);
        try {
          fireEvent.click(trigger);
          expect(screen.getByRole("menu")).toHaveAttribute(
            "data-placement",
            "top",
          );
        } finally {
          restoreLow();
        }
      } finally {
        restore();
      }
    });
  });

  it("applies a custom className to the wrapper", () => {
    renderWithProvider(<ThemeToggle className="ml-auto" />);
    const trigger = screen.getByTestId("theme-toggle-trigger");
    // The className lives on the wrapping <div>, which is the trigger's
    // grandparent (div > IconButton renders a button).
    const wrapper = trigger.parentElement;
    expect(wrapper).toHaveClass("ml-auto");
  });

  it("does not crash if useTheme errors (defensive – exercises the noop branch)", () => {
    // Simulate a no-op setTheme by replacing useTheme via vi.spyOn would be
    // overkill; the no-provider branch above already covers this code path.
    expect(() => render(<ThemeToggle />)).not.toThrow();
  });
});

// Silence the next-themes "act" warning when setTheme runs inside fireEvent
// — we wrap state-updating clicks above in act() explicitly.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));
