import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

const variantStyles = {
  danger: "bg-error text-white hover:brightness-110",
  primary: "bg-gradient-accent text-white hover:brightness-110",
} as const;

export type ConfirmModalVariant = keyof typeof variantStyles;

export interface ConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmModalVariant;
  loading?: boolean;
  className?: string;
}

export function ConfirmModal({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  loading = false,
  className,
}: ConfirmModalProps) {
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
      onCancel={onCancel}
      className={cn(
        "m-auto max-w-sm rounded-[var(--sp-radius-xl)] border border-border bg-surface p-0 shadow-[var(--sp-shadow-lg)] backdrop:bg-black/50",
        className,
      )}
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted">{message}</p>
      </div>
      <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50 disabled:pointer-events-none"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={cn(
            "inline-flex h-9 cursor-pointer items-center justify-center rounded-[var(--sp-radius-lg)] px-4 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:pointer-events-none",
            variantStyles[variant],
          )}
        >
          {loading ? "Loading..." : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
