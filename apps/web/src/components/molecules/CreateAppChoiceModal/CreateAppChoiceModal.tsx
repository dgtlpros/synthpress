import { useEffect, useRef } from "react";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { Modal } from "@/components/atoms/Modal";
import { cn } from "@/lib/cn";

/**
 * "Create app" flow.
 *
 * Step 1 ("choose") — user picks the app kind. Today the only option is Blog;
 * future kinds (Newsletter, Doc site, etc.) slot into this list.
 *
 * Step 2 ("name") — name-only form. We deliberately do NOT collect WordPress
 * connection details here so creating a blog is friction-free; users wire the
 * blog up to a WP site afterward from the blog's own settings page.
 */
export type CreateAppChoiceModalStep = "choose" | "name";

export interface CreateAppChoiceModalProps {
  open: boolean;
  onClose: () => void;
  step: CreateAppChoiceModalStep;
  onChooseBlog: () => void;
  onBack: () => void;
  blogName: string;
  onBlogNameChange: (name: string) => void;
  onCreateBlog: () => void;
  pending?: boolean;
  errorMessage?: string | null;
  className?: string;
}

export function CreateAppChoiceModal({
  open,
  onClose,
  step,
  onChooseBlog,
  onBack,
  blogName,
  onBlogNameChange,
  onCreateBlog,
  pending = false,
  errorMessage = null,
  className,
}: CreateAppChoiceModalProps) {
  const isChoose = step === "choose";
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && step === "name") {
      inputRef.current?.focus();
    }
  }, [open, step]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isChoose ? "Create app" : "Name your blog"}
      description={
        isChoose
          ? "Choose an app to add to this project. More app types will appear here over time."
          : "Just a name to start — you can connect a WordPress site later from the blog's settings."
      }
      maxWidth="md"
      className={className}
    >
      {isChoose ? (
        <ul className="space-y-2" role="listbox" aria-label="App types">
          <li>
            <button
              type="button"
              role="option"
              aria-selected="false"
              onClick={onChooseBlog}
              className={cn(
                "flex w-full cursor-pointer flex-col rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 text-left shadow-sm transition-colors hover:border-border-hover hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
              )}
            >
              <span className="text-sm font-semibold text-foreground">
                Blog
              </span>
              <span className="mt-1 text-xs text-muted">
                Start with just a name. Connect a WordPress site whenever
                you&apos;re ready.
              </span>
            </button>
          </li>
        </ul>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) onCreateBlog();
          }}
        >
          <div>
            <label
              htmlFor="create-app-blog-name"
              className="mb-1 block text-xs font-medium text-muted"
            >
              Blog name
            </label>
            <Input
              ref={inputRef}
              id="create-app-blog-name"
              name="name"
              type="text"
              required
              autoComplete="off"
              placeholder="Main site"
              value={blogName}
              disabled={pending}
              onChange={(e) => onBlogNameChange(e.target.value)}
            />
          </div>

          {errorMessage ? (
            <p className="text-sm text-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={onBack}
            >
              Back
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={pending}
              disabled={!blogName.trim()}
            >
              Create blog
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
