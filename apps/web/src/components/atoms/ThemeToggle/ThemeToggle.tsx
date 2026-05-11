"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/atoms/IconButton";

/**
 * A small light / dark / system theme switcher.
 *
 * Why a popover menu instead of a single toggle
 *   * "System" is a real product option — visitors on a dark-preference
 *     OS expect the marketing pages to start dark. A binary toggle hides
 *     the system option behind a long-press / right-click that nobody
 *     finds, so we surface all three explicitly.
 *   * The trigger is a 36px IconButton (matches the sidebar / header
 *     icon row) and uses the same Sun / Moon / Monitor metaphor users
 *     recognise from VS Code, GitHub, and Vercel.
 *
 * Hydration safety
 *   * `next-themes` cannot know the resolved theme until it has
 *     mounted on the client (server has no access to localStorage or
 *     `prefers-color-scheme`). Until `mounted` flips true we render a
 *     placeholder icon that matches what the SSR markup would produce —
 *     no theme-specific glyph — so the markup hashes match and React
 *     doesn't warn about the `<html>` class mismatch.
 *
 * Behaviour
 *   * Click the trigger → the popover opens.
 *   * Click outside, press Escape, or pick an option → it closes.
 *   * The selected option is highlighted with a brand wash (matches the
 *     sidebar's active-row treatment so the visual language is shared).
 */

export interface ThemeToggleProps {
  className?: string;
  /**
   * Used for the popover container's `aria-label` and the IconButton's
   * accessible name. Defaults to "Theme" so the button reads as
   * "Theme menu" to assistive tech.
   */
  label?: string;
}

type ThemeOption = {
  value: "light" | "dark" | "system";
  label: string;
  icon: typeof SunIcon;
};

const themeOptions: ThemeOption[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

/**
 * Reports `true` once the component is hydrated on the client.
 *
 * Why `useSyncExternalStore` instead of `useEffect(() => setMounted(true))`
 *   * `useSyncExternalStore` is React's first-class API for "is this
 *     rendering on the client?" — the server snapshot returns `false`,
 *     the client snapshot returns `true`, and React swaps them during
 *     hydration without triggering an extra render.
 *   * The legacy effect-based version trips React 19's
 *     `react-hooks/set-state-in-effect` rule because the effect's only
 *     job is to call `setState` synchronously after mount.
 *   * The `subscribe` argument is a no-op because the value never
 *     changes after the first paint — there's nothing for React to
 *     re-subscribe to.
 */
const subscribeMounted = () => () => {};
const getMountedSnapshot = () => true;
/* v8 ignore next -- only invoked during SSR; jsdom always uses the client
   snapshot so this branch is unreachable in unit tests. */
const getServerMountedSnapshot = () => false;

function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeMounted,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
}

/**
 * Estimated rendered height of the popover (3 menu items × ~36px + ~12px
 * for padding/border). Used as a threshold when picking placement, NOT
 * for actual layout — the real menu still sizes to its content. A
 * loose-but-realistic estimate is good enough; we only need to know
 * "does the menu likely fit below the trigger or not?".
 */
const MENU_HEIGHT_ESTIMATE_PX = 140;

export function ThemeToggle({ className, label = "Theme" }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  /**
   * Where the popover anchors relative to the trigger. We default to
   * `"bottom"` (the conventional dropdown direction) and flip to `"top"`
   * when the trigger is close to the bottom of the viewport — which is
   * exactly the situation in the dashboard sidebar footer, where the
   * default placement would clip the menu off-screen. The decision is
   * made once when the user opens the menu (not on every render) so it
   * stays stable while open.
   */
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const mounted = useMounted();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleTriggerClick() {
    if (open) {
      setOpen(false);
      return;
    }
    const wrapper = containerRef.current;
    /* v8 ignore next -- the ref is always attached by the time a user can
       click the trigger; the null guard is a TypeScript-narrowing safety
       net only. */
    if (!wrapper) {
      setOpen(true);
      return;
    }
    const rect = wrapper.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // Only flip up when below is too tight AND above has room — keeps
    // the dropdown opening downward in the normal case (header / mid-
    // page placements) and only flips when there's a real clipping
    // risk (sidebar footer, sticky bottom bars, etc.).
    const shouldFlipUp =
      spaceBelow < MENU_HEIGHT_ESTIMATE_PX &&
      rect.top >= MENU_HEIGHT_ESTIMATE_PX;
    setPlacement(shouldFlipUp ? "top" : "bottom");
    setOpen(true);
  }

  /* v8 ignore start -- the `mounted === false` branch only fires during
     SSR / before hydration; jsdom always reports the client snapshot, so
     this fallback can't be exercised in the unit-test environment. The
     branch exists to avoid a React hydration mismatch when the server
     paints a Sun icon and `next-themes` later swaps the document class
     to dark. */
  const TriggerIcon = mounted
    ? resolvedTheme === "dark"
      ? MoonIcon
      : SunIcon
    : SunIcon;
  const buttonLabel = mounted ? `${label}: ${theme ?? "system"}` : label;
  /* v8 ignore stop */

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        label={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="theme-toggle-menu"
        onClick={handleTriggerClick}
        data-testid="theme-toggle-trigger"
      >
        <TriggerIcon className="h-4 w-4" />
      </IconButton>

      {open ? (
        <div
          id="theme-toggle-menu"
          role="menu"
          aria-label={label}
          data-placement={placement}
          className={cn(
            "absolute right-0 z-50 w-36 overflow-hidden rounded-[var(--sp-radius-lg)] border border-border/90 bg-popover text-popover-foreground shadow-[var(--sp-shadow-lg)] ring-1 ring-black/[0.03] dark:ring-white/[0.04]",
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isActive = (theme ?? "system") === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  setTheme(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "relative flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-gradient-to-r from-brand-indigo/[0.08] via-brand-blue/[0.05] to-transparent text-foreground"
                    : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-left">{option.label}</span>
                {isActive ? (
                  <CheckIcon
                    className="h-3.5 w-3.5 shrink-0 text-brand-blue"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
