import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./ui-store";

beforeEach(() => {
  useUIStore.setState({ sidebarOpen: true, theme: "light" });
});

describe("useUIStore", () => {
  it("has correct initial state", () => {
    const state = useUIStore.getState();
    expect(state.sidebarOpen).toBe(true);
    expect(state.theme).toBe("light");
  });

  it("toggles sidebar", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("sets sidebar open state directly", () => {
    useUIStore.getState().setSidebarOpen(false);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().setSidebarOpen(true);
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("sets theme", () => {
    useUIStore.getState().setTheme("dark");
    expect(useUIStore.getState().theme).toBe("dark");
    useUIStore.getState().setTheme("light");
    expect(useUIStore.getState().theme).toBe("light");
  });

  it("toggles theme", () => {
    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe("dark");
    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe("light");
  });
});
