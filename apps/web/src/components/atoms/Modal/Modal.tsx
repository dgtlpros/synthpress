import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

const maxWidthStyles = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
} as const;

export type ModalMaxWidth = keyof typeof maxWidthStyles;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: ModalMaxWidth;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = "lg",
  className,
}: ModalProps) {
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
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-[var(--sp-radius-xl)] border border-border bg-surface p-0 shadow-[var(--sp-shadow-lg)] backdrop:bg-black/50",
        maxWidthStyles[maxWidth],
        className,
      )}
    >
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      <div className="max-h-[min(70vh,32rem)] overflow-y-auto px-6 py-4">{children}</div>
      {footer ? <div className="flex flex-wrap justify-end gap-3 border-t border-border px-6 py-4">{footer}</div> : null}
    </dialog>
  );
}
