"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/atoms/IconButton";
import {
  DashboardSidebar,
  type SidebarNavItem,
} from "@/components/molecules/DashboardSidebar";

export interface MobileNavConnectorProps {
  navItems: SidebarNavItem[];
  email?: string | null;
  className?: string;
}

export function MobileNavConnector({
  navItems,
  email,
  className,
}: MobileNavConnectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  return (
    <div className={className}>
      <IconButton
        label={isOpen ? "Close menu" : "Open menu"}
        variant="ghost"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="mobile-nav-drawer"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </IconButton>

      {/* Backdrop */}
      <div
        data-testid="mobile-nav-backdrop"
        onClick={() => setIsOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <DashboardSidebar
          navItems={navItems}
          email={email}
          onItemClick={() => setIsOpen(false)}
          className="h-full shadow-[var(--sp-shadow-lg)]"
        />
      </div>
    </div>
  );
}
