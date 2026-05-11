import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Right-anchored slide-over panel built on the native `<dialog>`
 * element (same primitive {@link "../Modal/Modal"} uses), so we get
 * Escape-to-close + focus trap + backdrop for free.
 *
 * Differs from `Modal` in three ways:
 *   1. Anchored to the right edge of the viewport with full height.
 *   2. Wider sizes (`md`/`lg`/`xl`) — drawers are for "details about
 *      a thing" and need room for tabular data, not modal forms.
 *   3. Mobile (<sm): collapses to bottom sheet (full width, capped
 *      height, slide-up). Same component, responsive class.
 *
 * The header / body / footer slots mirror Modal so caller code can
 * swap one for the other without a refactor.
 */

const widthStyles = {
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
} as const;

export type DrawerWidth = keyof typeof widthStyles;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Max width on `sm+` viewports. Mobile is always full-width. Default `lg`. */
  width?: DrawerWidth;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "lg",
  className,
}: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open) {
      dialog?.showModal();
    } else {
      dialog?.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        // Browser fires `cancel` on Escape. Without preventDefault the
        // dialog auto-closes AND we'd call onClose, doubling state.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Dialogs propagate clicks from inside content too; only the
        // dialog element itself is the backdrop.
        if (e.target === dialogRef.current) onClose();
      }}
      data-testid="drawer"
      className={cn(
        // Mobile: bottom sheet, full width, anchored to the bottom of
        // the viewport. Desktop: full-height column anchored right.
        "m-0 mt-auto w-full max-h-[90vh] rounded-t-[var(--sp-radius-xl)] border border-border bg-surface p-0 shadow-[var(--sp-shadow-lg)] backdrop:bg-black/50",
        "sm:ml-auto sm:mt-0 sm:h-screen sm:max-h-screen sm:rounded-none sm:rounded-l-[var(--sp-radius-xl)]",
        widthStyles[width],
        className,
      )}
    >
      <div className="flex h-full max-h-[90vh] flex-col sm:max-h-screen">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-[var(--sp-radius-md)] p-2 text-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-3 border-t border-border px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
