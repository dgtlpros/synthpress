import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { Label } from "@/components/atoms/Label";
import { Modal } from "@/components/atoms/Modal";
import { Textarea } from "@/components/atoms/Textarea";
import { cn } from "@/lib/cn";

/**
 * Manual "Generate ideas" modal. Dumb / presentational — the
 * connector owns the brief state, the count, the loading flag, the
 * error message, and the submit handler.
 *
 * v2 adds a count selector so the user can pick how many ideas to
 * generate (3 / 5 / 10 / Custom). Defaults are seeded by the
 * connector via {@link GenerateIdeasModalProps.count}. Custom values
 * are validated against {@link GenerateIdeasModalProps.minCount} /
 * {@link GenerateIdeasModalProps.maxCount} (the server-side action
 * clamps the same way as a defense-in-depth check).
 */
export interface GenerateIdeasModalProps {
  open: boolean;
  onClose: () => void;
  brief: string;
  onBriefChange: (value: string) => void;
  /** Current count from the connector. The preset chips highlight the matching value. */
  count: number;
  /** Fired when the user picks a preset chip or edits the Custom input. */
  onCountChange: (value: number) => void;
  /** Fired with the trimmed brief + current count. */
  onSubmit: () => void;
  /** Synth-token cost shown next to the CTA. Optional so tests + Storybook can omit it. */
  creditsCost?: number;
  /** Allowed minimum (inclusive). Defaults to 1. */
  minCount?: number;
  /** Allowed maximum (inclusive). Defaults to 20. */
  maxCount?: number;
  pending?: boolean;
  errorMessage?: string | null;
  className?: string;
}

const MAX_BRIEF = 2000;

/**
 * Preset count chips offered above the Custom input. Kept short
 * (3 / 5 / 10) so the modal stays scannable; anything outside these
 * falls into Custom and reuses the same min/max validation.
 */
export const GENERATE_IDEAS_COUNT_PRESETS = [3, 5, 10] as const;

export function GenerateIdeasModal({
  open,
  onClose,
  brief,
  onBriefChange,
  count,
  onCountChange,
  onSubmit,
  creditsCost,
  minCount = 1,
  maxCount = 20,
  pending = false,
  errorMessage = null,
  className,
}: GenerateIdeasModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Local "custom" input mirrors `count` only when the active count
  // ISN'T one of the preset chips. Storing it separately lets the
  // user clear the field to edit it without losing the underlying
  // numeric prop. We seed lazily from the initial count.
  const isPreset = (GENERATE_IDEAS_COUNT_PRESETS as readonly number[]).includes(
    count,
  );
  const [customInput, setCustomInput] = useState<string>(
    isPreset ? "" : String(count),
  );
  // Toggle that decides whether the Custom input renders. Driven by
  // the user's preset-vs-custom choice, not by `count` directly —
  // sliding the count from outside (e.g. on open) shouldn't snap a
  // user who picked Custom back to a preset.
  const [customMode, setCustomMode] = useState<boolean>(!isPreset);

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

  function handlePresetClick(next: number) {
    setCustomMode(false);
    setCustomInput("");
    onCountChange(next);
  }

  function handleCustomToggle() {
    setCustomMode(true);
    // Seed the input from whatever the current count is so the user
    // doesn't lose their starting point when they click Custom.
    setCustomInput(String(count));
  }

  function handleCustomInputChange(value: string) {
    setCustomInput(value);
    // Empty string and partial typing (e.g. "-") leave the count as-is.
    // We don't fire onCountChange until we have a parseable, in-range
    // number — the connector should never see a NaN value.
    if (value.trim() === "") return;
    const parsed = Number.parseInt(value, 10);
    /* v8 ignore next 1 -- the <Input type="number"> rejects non-numeric
       strings at the browser layer; this defensive NaN guard mirrors
       handleCustomBlur and only protects against a type-attribute
       change in the markup. */
    if (Number.isNaN(parsed)) return;
    const clamped = Math.min(maxCount, Math.max(minCount, parsed));
    onCountChange(clamped);
  }

  function handleCustomBlur() {
    // On blur, snap the input back to the resolved (clamped) count so
    // the field can't show an invalid string after focus moves away.
    if (customInput.trim() === "") {
      setCustomInput(String(count));
      return;
    }
    const parsed = Number.parseInt(customInput, 10);
    /* v8 ignore next 4 -- the <Input type="number"> field rejects non-
       numeric strings at the browser layer (the change handler never
       receives them), so this defensive NaN branch is unreachable
       from the UI and only protects against a type-attribute change. */
    if (Number.isNaN(parsed)) {
      setCustomInput(String(count));
      return;
    }
    const clamped = Math.min(maxCount, Math.max(minCount, parsed));
    setCustomInput(String(clamped));
    if (clamped !== count) onCountChange(clamped);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate article ideas"
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
          <Label htmlFor="generate-ideas-count">How many ideas?</Label>
          <p className="mt-1 text-xs text-muted">
            Choose how many ideas to add to your backlog. Min {minCount}, max{" "}
            {maxCount}.
          </p>
          <div
            id="generate-ideas-count"
            role="radiogroup"
            aria-label="Number of ideas to generate"
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            {GENERATE_IDEAS_COUNT_PRESETS.map((preset) => {
              const isActive = !customMode && count === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  disabled={pending}
                  onClick={() => handlePresetClick(preset)}
                  className={cn(
                    "inline-flex h-9 min-w-[3rem] items-center justify-center rounded-[var(--sp-radius-md)] border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
                    isActive
                      ? "border-brand-blue bg-brand-blue/10 text-foreground"
                      : "border-border bg-surface text-muted hover:bg-surface-hover hover:text-foreground",
                    pending && "pointer-events-none opacity-50",
                  )}
                >
                  {preset}
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={customMode}
              disabled={pending}
              onClick={handleCustomToggle}
              className={cn(
                "inline-flex h-9 items-center justify-center rounded-[var(--sp-radius-md)] border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
                customMode
                  ? "border-brand-blue bg-brand-blue/10 text-foreground"
                  : "border-border bg-surface text-muted hover:bg-surface-hover hover:text-foreground",
                pending && "pointer-events-none opacity-50",
              )}
            >
              Custom
            </button>
            {customMode ? (
              <Input
                type="number"
                min={minCount}
                max={maxCount}
                step={1}
                inputMode="numeric"
                aria-label="Custom idea count"
                value={customInput}
                disabled={pending}
                onChange={(e) => handleCustomInputChange(e.target.value)}
                onBlur={handleCustomBlur}
                className="ml-1 h-9 w-20"
              />
            ) : null}
          </div>
        </div>

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
              </span>{" "}
              per call.
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
              {pending
                ? "Queueing…"
                : `Generate ${count} idea${count === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
