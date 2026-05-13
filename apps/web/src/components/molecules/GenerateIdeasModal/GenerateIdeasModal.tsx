import { useEffect, useRef } from "react";
import { Button } from "@/components/atoms/Button";
import { Label } from "@/components/atoms/Label";
import { Modal } from "@/components/atoms/Modal";
import { Textarea } from "@/components/atoms/Textarea";

/**
 * Manual "Generate ideas" modal. Dumb / presentational — the
 * connector owns the brief state, the loading flag, the error
 * message, and the submit handler. We deliberately keep the form to a
 * single optional field (see the `docs/au-automation.md` direction)
 * so the v1 UX matches the autopilot future where there's no human
 * brief at all.
 */
export interface GenerateIdeasModalProps {
  open: boolean;
  onClose: () => void;
  brief: string;
  onBriefChange: (value: string) => void;
  onSubmit: () => void;
  /** How many ideas the batch will produce; shown in the CTA copy. */
  count: number;
  /** Synth-token cost shown next to the CTA. Optional so tests + Storybook can omit it. */
  creditsCost?: number;
  pending?: boolean;
  errorMessage?: string | null;
  className?: string;
}

const MAX_BRIEF = 2000;

export function GenerateIdeasModal({
  open,
  onClose,
  brief,
  onBriefChange,
  onSubmit,
  count,
  creditsCost,
  pending = false,
  errorMessage = null,
  className,
}: GenerateIdeasModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      // Slight delay lets <dialog> finish its open transition before focus
      // so the cursor doesn't bounce.
      /* v8 ignore next 4 -- the timer callback + cleanup don't run inside
         vitest's synchronous renders; we'd need fake timers + manual
         flushes which adds noise without exercising real behavior */
      const id = window.setTimeout(() => textareaRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Generate ${count} article ideas`}
      description="Optionally seed the AI with a topic or angle. Leave blank to let it pick on-strategy topics from your blog's settings. Generation runs in the background — this modal closes as soon as the job is queued."
      maxWidth="md"
      className={className}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) onSubmit();
        }}
      >
        <div>
          <Label htmlFor="generate-ideas-brief">
            Topic or brief{" "}
            <span className="font-normal text-muted">(optional)</span>
          </Label>
          <Textarea
            ref={textareaRef}
            id="generate-ideas-brief"
            value={brief}
            disabled={pending}
            maxLength={MAX_BRIEF}
            placeholder='e.g. "How to onboard new SaaS customers in week one"'
            onChange={(e) => onBriefChange(e.target.value)}
            className="mt-1 min-h-[120px]"
          />
          <p className="mt-1 text-xs text-muted">
            {brief.length}/{MAX_BRIEF}
          </p>
        </div>

        {errorMessage ? (
          <p className="text-sm text-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {creditsCost !== undefined ? (
            <p className="text-xs text-muted">
              This will use{" "}
              <span className="font-semibold text-foreground">
                {creditsCost} synth {creditsCost === 1 ? "token" : "tokens"}
              </span>
              .
            </p>
          ) : (
            <span />
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              {pending ? "Queueing…" : "Generate ideas"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
