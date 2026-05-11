"use client";

import { type ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * The theme that should apply on first render before the user's saved
   * preference is hydrated. Defaults to `"system"` so visitors who never
   * touch the toggle follow their OS setting.
   */
  defaultTheme?: "light" | "dark" | "system";
  /**
   * Disable theme transitions for the brief moment we toggle the class
   * on `<html>`. Without this every colour-transitioning class on the
   * page repaints at once and you get a perceptible "flash" of half-
   * faded colours. Default `true`.
   */
  disableTransitionOnChange?: boolean;
}

/**
 * App-level theme provider.
 *
 * Why next-themes
 *   * Sets the `dark` class on `<html>` BEFORE React hydrates by
 *     injecting a tiny inline `<script>` in the document head. This is
 *     why we don't get a flash of light theme on dark-preference users
 *     even though the rest of the app is server-rendered.
 *   * Owns the `localStorage` round-trip and cross-tab sync so we don't
 *     hand-roll storage events.
 *   * Talks via the `useTheme()` hook so the toggle component stays a
 *     dumb consumer (see `ThemeToggle`).
 *
 * Configuration choices for this app
 *   * `attribute="class"` — the `.dark` block in `globals.css` is keyed
 *     off a class, not `data-theme="…"`.
 *   * `enableSystem` — three-state UX (light / dark / system).
 *   * `defaultTheme="system"` — first-time visitors follow their OS so
 *     marketing pages don't flash bright on a dark-preference machine.
 *
 * The provider must mount inside the root `<html suppressHydrationWarning>`
 * (the SSR markup never has the class but the client script will add it
 * before paint, so React would otherwise warn about the mismatch).
 */
export function ThemeProvider({
  children,
  defaultTheme = "system",
  disableTransitionOnChange = true,
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem
      disableTransitionOnChange={disableTransitionOnChange}
    >
      {children}
    </NextThemesProvider>
  );
}
