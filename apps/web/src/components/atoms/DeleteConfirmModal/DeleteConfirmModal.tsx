import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface DeleteConfirmModalProps {
  open: boolean;
  /** "team" | "project" | "blog app" — used in copy ("This will permanently delete this {entityKind}") */
  entityKind: string;
  /** The user must type this exactly before the Delete button enables. */
  requiredPhrase: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  className?: string;
}

export function DeleteConfirmModal({
  open,
  entityKind,
  requiredPhrase,
  onConfirm,
  onCancel,
  loading = false,
  className,
}: DeleteConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [inputValue, setInputValue] = useState("");
  const confirmed = inputValue === requiredPhrase;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open) {
      dialog?.showModal();
      void Promise.resolve().then(() => {
        setInputValue("");
      });
    } else {
      dialog?.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={onCancel}
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--sp-radius-xl)] border border-border bg-surface p-0 shadow-[var(--sp-shadow-lg)] backdrop:bg-black/50",
        className,
      )}
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold text-foreground">
          Delete {entityKind}
        </h2>
        <p className="mt-2 text-sm text-muted">
          This will permanently delete this {entityKind} and all associated
          data. This action cannot be undone.
        </p>
        <p className="mt-4 text-sm text-muted">
          Type{" "}
          <span className="font-mono font-semibold text-foreground">
            {requiredPhrase}
          </span>{" "}
          to confirm.
        </p>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={loading}
          placeholder={requiredPhrase}
          aria-label={`Type ${requiredPhrase} to confirm deletion`}
          autoComplete="off"
          className={cn(
            "mt-2 h-10 w-full rounded-[var(--sp-radius-lg)] border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error",
            loading && "opacity-50 cursor-not-allowed",
          )}
        />
      </div>
      <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50 disabled:pointer-events-none"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!confirmed || loading}
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-[var(--sp-radius-lg)] bg-error px-4 text-sm font-medium text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
        >
          {loading ? "Deleting…" : `Delete ${entityKind}`}
        </button>
      </div>
    </dialog>
  );
}
