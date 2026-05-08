import { cn } from "@/lib/cn";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { IdeaCard, type IdeaCardIdea } from "@/components/molecules/IdeaCard";

/**
 * Dumb organism that renders the Ideas tab. Owns no state — the
 * connector decides when to open the modal, which idea is mid-update,
 * and which one (if any) errored.
 *
 * Layout: header with stats + "Generate ideas" CTA, then a 2-column
 * grid of {@link IdeaCard}s, with a friendly empty state when there's
 * nothing yet.
 */
export interface IdeasListProps {
  ideas: IdeaCardIdea[];
  /** Triggers the Generate Ideas modal (owned by the connector). */
  onGenerateClick: () => void;
  /** Loading flag for the generate button. */
  isGenerating?: boolean;
  /** Per-idea Approve handler. Omit to hide approve actions across the list. */
  onApproveIdea?: (ideaId: string) => void;
  /** Per-idea Reject handler. Omit to hide reject actions across the list. */
  onRejectIdea?: (ideaId: string) => void;
  /** Per-idea Generate Article handler. Only renders for approved ideas. */
  onGenerateArticleFromIdea?: (ideaId: string) => void;
  /** Idea id of the in-flight per-card action, or null when idle. */
  pendingIdeaId?: string | null;
  /**
   * Which action is in flight on `pendingIdeaId`, or null when idle.
   * `"approved" | "rejected"` come from the approve/reject hook;
   * `"generating"` comes from the generate-article hook.
   */
  pendingIdeaAction?: "approved" | "rejected" | "generating" | null;
  /** Idea id whose last per-card action errored, or null. */
  errorIdeaId?: string | null;
  /** Last error message paired with `errorIdeaId`. */
  errorMessage?: string | null;
  /** Optional row click — the ideas detail page isn't built yet, so we can leave this off. */
  onIdeaClick?: (ideaId: string) => void;
  className?: string;
}

export function IdeasList({
  ideas,
  onGenerateClick,
  isGenerating,
  onApproveIdea,
  onRejectIdea,
  onGenerateArticleFromIdea,
  pendingIdeaId = null,
  pendingIdeaAction = null,
  errorIdeaId = null,
  errorMessage = null,
  onIdeaClick,
  className,
}: IdeasListProps) {
  return (
    <div className={cn("space-y-6", className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Article ideas
          </h2>
          <p className="text-sm text-muted">
            Brainstormed topics waiting to become articles. Approve the ones you
            like and convert them into drafts.
          </p>
        </div>
        {ideas.length > 0 ? (
          <Button size="md" onClick={onGenerateClick} loading={isGenerating}>
            Generate ideas
          </Button>
        ) : null}
      </header>

      {ideas.length === 0 ? (
        <EmptyState
          onGenerateClick={onGenerateClick}
          isGenerating={isGenerating}
        />
      ) : (
        <ul
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Article ideas"
        >
          {ideas.map((idea) => {
            // Compute the per-card "is this card busy / is another card
            // busy" hint here so IdeaCard stays stateless.
            const pendingAction =
              pendingIdeaId === null
                ? null
                : pendingIdeaId === idea.id
                  ? pendingIdeaAction
                  : "other";
            const cardError = errorIdeaId === idea.id ? errorMessage : null;

            return (
              <li key={idea.id}>
                {onIdeaClick ? (
                  <button
                    type="button"
                    onClick={() => onIdeaClick(idea.id)}
                    className="block w-full cursor-pointer rounded-[var(--sp-radius-xl)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                  >
                    <IdeaCard idea={idea} />
                  </button>
                ) : (
                  <IdeaCard
                    idea={idea}
                    onApprove={onApproveIdea}
                    onReject={onRejectIdea}
                    onGenerate={onGenerateArticleFromIdea}
                    pendingAction={pendingAction}
                    errorMessage={cardError}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface EmptyStateProps {
  onGenerateClick: () => void;
  isGenerating?: boolean;
}

function EmptyState({ onGenerateClick, isGenerating }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="rounded-[var(--sp-radius-full)] bg-gradient-accent p-3 text-white shadow-md">
        <BulbIcon />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold text-foreground">No ideas yet</p>
        <p className="max-w-md text-sm text-muted">
          Generate a batch of fresh article topics tailored to your blog&apos;s
          audience, tone, and content goals.
        </p>
      </div>
      <Button size="md" onClick={onGenerateClick} loading={isGenerating}>
        Generate ideas
      </Button>
      <p className="text-xs text-muted">
        Tip: review and tune your blog&apos;s{" "}
        <span className="font-medium text-foreground">Settings</span> first for
        sharper output.
      </p>
    </Card>
  );
}

function BulbIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c1 .8 1.5 1.7 1.5 2.8V18h5v-.5c0-1.1.5-2 1.5-2.8A7 7 0 0 0 12 2z" />
    </svg>
  );
}
