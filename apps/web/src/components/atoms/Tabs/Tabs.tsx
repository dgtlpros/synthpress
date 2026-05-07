"use client";

import {
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/cn";

interface TabsContextValue {
  value: string;
  setValue: (next: string) => void;
  baseId: string;
  orientation: "horizontal" | "vertical";
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be used inside <Tabs>`);
  }
  return ctx;
}

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (next: string) => void;
  orientation?: "horizontal" | "vertical";
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  className,
  children,
  ...props
}: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState<string>(defaultValue ?? "");
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : internal;

  const setValue = useCallback(
    (next: string) => {
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  const ctx = useMemo(
    () => ({ value, setValue, baseId, orientation }),
    [value, setValue, baseId, orientation],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div
        data-orientation={orientation}
        className={cn(
          orientation === "vertical" ? "flex gap-6" : "flex flex-col gap-4",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  ariaLabel?: string;
}

export function TabsList({
  ariaLabel,
  className,
  children,
  ...props
}: TabsListProps) {
  const { orientation } = useTabsContext("TabsList");

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      className={cn(
        orientation === "vertical"
          ? "flex w-56 shrink-0 flex-col gap-1"
          : "inline-flex items-center gap-1 overflow-x-auto border-b border-border",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends Omit<
  HTMLAttributes<HTMLButtonElement>,
  "type"
> {
  value: string;
  disabled?: boolean;
  icon?: ReactNode;
  count?: ReactNode;
}

export function TabsTrigger({
  value,
  disabled,
  icon,
  count,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  const ctx = useTabsContext("TabsTrigger");
  const isActive = ctx.value === value;
  const triggerId = `${ctx.baseId}-trigger-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // React mounts every TabsTrigger inside a TabsList, and the keydown
    // fired here means the focused trigger is enabled — so the parent
    // exists and `triggers` always contains at least the current button.
    const list = event.currentTarget.parentElement as HTMLElement;
    const triggers = Array.from(
      list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    const currentIndex = triggers.indexOf(event.currentTarget);
    const horizontalKeys =
      ctx.orientation === "horizontal"
        ? { next: "ArrowRight", prev: "ArrowLeft" }
        : { next: "ArrowDown", prev: "ArrowUp" };
    if (event.key === horizontalKeys.next) {
      event.preventDefault();
      const next = triggers[(currentIndex + 1) % triggers.length];
      next.focus();
      next.click();
    } else if (event.key === horizontalKeys.prev) {
      event.preventDefault();
      const prev =
        triggers[(currentIndex - 1 + triggers.length) % triggers.length];
      prev.focus();
      prev.click();
    } else if (event.key === "Home") {
      event.preventDefault();
      triggers[0].focus();
      triggers[0].click();
    } else if (event.key === "End") {
      event.preventDefault();
      triggers[triggers.length - 1].focus();
      triggers[triggers.length - 1].click();
    }
  }

  return (
    <button
      type="button"
      role="tab"
      id={triggerId}
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={() => !disabled && ctx.setValue(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
        ctx.orientation === "horizontal"
          ? "-mb-px border-b-2"
          : "rounded-[var(--sp-radius-md)] justify-start",
        ctx.orientation === "horizontal" && isActive
          ? "border-brand-blue text-foreground"
          : ctx.orientation === "horizontal"
            ? "border-transparent text-muted hover:text-foreground hover:border-border-hover"
            : "",
        ctx.orientation === "vertical" && isActive
          ? "bg-surface-hover text-foreground"
          : ctx.orientation === "vertical"
            ? "text-muted hover:bg-surface-hover hover:text-foreground"
            : "",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
      {...props}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
      {count !== undefined && count !== null ? (
        <span
          className={cn(
            "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-[var(--sp-radius-full)] px-1.5 text-[10px] font-semibold",
            isActive
              ? "bg-brand-blue/15 text-brand-blue"
              : "bg-surface-hover text-muted",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  forceMount?: boolean;
}

export function TabsContent({
  value,
  forceMount,
  className,
  children,
  ...props
}: TabsContentProps) {
  const ctx = useTabsContext("TabsContent");
  const isActive = ctx.value === value;
  const triggerId = `${ctx.baseId}-trigger-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;

  if (!isActive && !forceMount) return null;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={triggerId}
      hidden={!isActive}
      tabIndex={0}
      className={cn(isActive ? "flex-1" : "", className)}
      {...props}
    >
      {children}
    </div>
  );
}
