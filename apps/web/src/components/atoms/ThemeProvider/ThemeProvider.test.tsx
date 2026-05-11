import { render, screen, cleanup, act } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { useTheme } from "next-themes";
import { ThemeProvider } from "./ThemeProvider";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.removeAttribute("style");
  window.localStorage.clear();
});

beforeEach(() => {
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.removeAttribute("style");
  window.localStorage.clear();
});

function ThemeReporter() {
  // Exposes the next-themes API so the test can assert that the wrapping
  // <ThemeProvider> actually mounted a working context (not the silent
  // default that next-themes returns when there's no provider).
  const { theme, resolvedTheme, themes, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme ?? "undefined"}</span>
      <span data-testid="resolved-theme">{resolvedTheme ?? "undefined"}</span>
      <span data-testid="themes-count">{themes.length}</span>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        data-testid="set-dark"
      >
        dark
      </button>
      <button
        type="button"
        onClick={() => setTheme("light")}
        data-testid="set-light"
      >
        light
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("renders children without crashing", () => {
    render(
      <ThemeProvider>
        <p>Hello</p>
      </ThemeProvider>,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("provides next-themes context to descendants", () => {
    render(
      <ThemeProvider>
        <ThemeReporter />
      </ThemeProvider>,
    );
    // The {light, dark, system} default theme list is registered by
    // next-themes when `enableSystem` is on (it adds "system").
    expect(Number(screen.getByTestId("themes-count").textContent)).toBe(3);
  });

  it("defaults to 'system' so first-time visitors follow OS preference", () => {
    render(
      <ThemeProvider>
        <ThemeReporter />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("system");
  });

  it("respects a custom defaultTheme prop", () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeReporter />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("applies the dark class on <html> when setTheme('dark') is called", () => {
    render(
      <ThemeProvider>
        <ThemeReporter />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId("set-dark").click();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the dark class on <html> when setTheme('light') is called", () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeReporter />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId("set-light").click();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("persists the chosen theme to localStorage so it survives reload", () => {
    render(
      <ThemeProvider>
        <ThemeReporter />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId("set-dark").click();
    });
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("accepts disableTransitionOnChange={false} without crashing", () => {
    render(
      <ThemeProvider disableTransitionOnChange={false}>
        <p>OK</p>
      </ThemeProvider>,
    );
    expect(screen.getByText("OK")).toBeInTheDocument();
  });
});
