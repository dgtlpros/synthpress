import NextLink from "next/link";
import { Modal } from "@/components/atoms/Modal";
import { cn } from "@/lib/cn";

export interface CreateAppChoiceModalProps {
  open: boolean;
  onClose: () => void;
  /** Where to continue when the user picks Blog (e.g. team blogs page with create form). */
  blogSetupHref: string;
  onAfterChooseBlog?: () => void;
  className?: string;
}

export function CreateAppChoiceModal({
  open,
  onClose,
  blogSetupHref,
  onAfterChooseBlog,
  className,
}: CreateAppChoiceModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create app"
      description="Choose an app to add to this project. More app types will appear here over time."
      maxWidth="md"
      className={className}
    >
      <ul className="space-y-2" role="listbox" aria-label="App types">
        <li>
          <NextLink
            href={blogSetupHref}
            role="option"
            className={cn(
              "flex cursor-pointer flex-col rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 text-left shadow-sm transition-colors hover:border-border-hover hover:bg-surface-hover",
            )}
            onClick={() => onAfterChooseBlog?.()}
          >
            <span className="text-sm font-semibold text-foreground">Blog</span>
            <span className="mt-1 text-xs text-muted">
              WordPress connection, multiple sites per project, and AI-assisted publishing.
            </span>
          </NextLink>
        </li>
      </ul>
    </Modal>
  );
}
