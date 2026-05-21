"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { Input } from "@/components/atoms/Input";
import { Select } from "@/components/atoms/Select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/atoms/Tabs";
import { IdeaCard, type IdeaCardIdea } from "@/components/molecules/IdeaCard";

/**
 * Ideas backlog dashboard. Owns:
 *
 *   * Tabs across the four backlog buckets (Needs review / Approved /
 *     Used / Archived). Counts come from the prop data so the badges
 *     stay accurate without an extra Supabase query.
 *   * A filter bar with search + article-type dropdown. Both filters
 *     apply across every tab (so the user can search for "auth" and
 *     immediately see how many results live in each bucket).
 *   * Per-tab empty states with copy tailored to each bucket.
 *
 * The connector still owns mutations + the modal — the organism is
 * purely a layout + filter shell. Action handlers (Approve, Reject,
 * Generate, Archive, Unarchive) pass straight through to {@link IdeaCard}.
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
  /** Per-idea Archive handler. */
  onArchiveIdea?: (ideaId: string) => void;
  /** Per-idea Unarchive handler — only renders for archived ideas. */
  onUnarchiveIdea?: (ideaId: string) => void;
  /** Idea id of the in-flight per-card action, or null when idle. */
  pendingIdeaId?: string | null;
  /**
   * Which action is in flight on `pendingIdeaId`, or null when idle.
   * Approve/Reject come from useIdeaActions; Generate from the
   * generate-article hook; Archive/Unarchive from useIdeaActions.
   */
  pendingIdeaAction?:
    | "approved"
    | "rejected"
    | "generating"
    | "archiving"
    | "unarchiving"
    | null;
  /** Idea id whose last per-card action errored, or null. */
  errorIdeaId?: string | null;
  /** Last error message paired with `errorIdeaId`. */
  errorMessage?: string | null;
  className?: string;
}

type IdeaBucket = "needs_review" | "approved" | "used" | "archived";

const BUCKETS: ReadonlyArray<{ value: IdeaBucket; label: string }> = [
  { value: "needs_review", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "used", label: "Used" },
  { value: "archived", label: "Archived" },
];

/**
 * Maps a single idea to its dashboard bucket. Archive wins over
 * lifecycle (an archived `approved` idea lives in Archived, not
 * Approved) so the active backlog tabs stay clean.
 */
export function bucketForIdea(idea: IdeaCardIdea): IdeaBucket {
  if (idea.isArchived) return "archived";
  if (idea.status === "converted_to_article") return "used";
  if (idea.status === "approved") return "approved";
  if (idea.status === "generated") return "needs_review";
  // `rejected` ideas are lifecycle-dead-end but not archived — file
  // them under Needs review so the user can either revive them
  // (Approve flips to approved) or archive them to hide for good.
  // Folding rejected into needs_review keeps the dashboard at four
  // tabs without inventing a Rejected tab nobody asked for.
  return "needs_review";
}

const ARTICLE_TYPE_LABELS: Record<string, string> = {
  how_to: "How-to",
  listicle: "Listicle",
  comparison: "Comparison",
  review: "Review",
  news: "News",
  opinion: "Opinion",
  tutorial: "Tutorial",
  case_study: "Case study",
};

function formatArticleTypeOption(type: string): string {
  return ARTICLE_TYPE_LABELS[type] ?? type;
}

export function IdeasList({
  ideas,
  onGenerateClick,
  isGenerating,
  onApproveIdea,
  onRejectIdea,
  onGenerateArticleFromIdea,
  onArchiveIdea,
  onUnarchiveIdea,
  pendingIdeaId = null,
  pendingIdeaAction = null,
  errorIdeaId = null,
  errorMessage = null,
  className,
}: IdeasListProps) {
  const [search, setSearch] = useState("");
  const [articleTypeFilter, setArticleTypeFilter] = useState<string>("all");

  // Article-type dropdown options: dynamically built from the data so
  // a blog that doesn't have any "comparison" ideas yet doesn't show
  // the option. Stable insertion order across renders by sorting by
  // label. `Select` expects `{value, label}[]` and we always lead with
  // an "All" sentinel so the user can clear the filter.
  const articleTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const idea of ideas) {
      if (idea.articleType) seen.add(idea.articleType);
    }
    const typed = Array.from(seen)
      .sort((a, b) =>
        formatArticleTypeOption(a).localeCompare(formatArticleTypeOption(b)),
      )
      .map((value) => ({ value, label: formatArticleTypeOption(value) }));
    return [{ value: "all", label: "All article types" }, ...typed];
  }, [ideas]);

  // Apply search + type filters globally (across all tabs) so the
  // bucket badges accurately reflect what's reachable in each tab
  // for the current filter state.
  const filteredIdeas = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (
        articleTypeFilter !== "all" &&
        (idea.articleType ?? "") !== articleTypeFilter
      ) {
        return false;
      }
      if (needle.length === 0) return true;
      const haystack = [
        idea.title,
        idea.targetKeyword ?? "",
        idea.executiveSummary ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [ideas, search, articleTypeFilter]);

  // Per-bucket counts (post-filter). Mutating a single counts map is
  // cheaper than running .filter() per bucket; for v1 traffic this is
  // a nano-optimization, but keeps the render loop O(n) instead of
  // O(n * buckets).
  const bucketed = useMemo(() => {
    const map: Record<IdeaBucket, IdeaCardIdea[]> = {
      needs_review: [],
      approved: [],
      used: [],
      archived: [],
    };
    for (const idea of filteredIdeas) {
      map[bucketForIdea(idea)].push(idea);
    }
    return map;
  }, [filteredIdeas]);

  // Total counts (pre-filter) for the header summary — gives the user
  // a sense of the underlying backlog even when the filter narrows
  // the visible set.
  const totalCounts = useMemo(() => {
    const map: Record<IdeaBucket, number> = {
      needs_review: 0,
      approved: 0,
      used: 0,
      archived: 0,
    };
    for (const idea of ideas) {
      map[bucketForIdea(idea)] += 1;
    }
    return map;
  }, [ideas]);

  const [activeBucket, setActiveBucket] = useState<IdeaBucket>("needs_review");

  // Global empty state — fires only when there's nothing AT ALL in
  // the underlying data. Filter-empty state is per-tab (below).
  if (ideas.length === 0) {
    return (
      <div className={cn("space-y-6", className)}>
        <Header
          counts={totalCounts}
          onGenerateClick={onGenerateClick}
          isGenerating={isGenerating}
          hideCounts
        />
        <GlobalEmptyState
          onGenerateClick={onGenerateClick}
          isGenerating={isGenerating}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      <Header
        counts={totalCounts}
        onGenerateClick={onGenerateClick}
        isGenerating={isGenerating}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder="Search ideas by title, keyword, or summary"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search ideas"
          className="sm:max-w-sm"
        />
        <Select
          aria-label="Filter by article type"
          value={articleTypeFilter}
          onChange={(e) => setArticleTypeFilter(e.target.value)}
          options={articleTypeOptions}
          className="sm:w-48"
        />
      </div>

      <Tabs
        value={activeBucket}
        onValueChange={(next) => setActiveBucket(next as IdeaBucket)}
      >
        <TabsList ariaLabel="Idea backlog buckets">
          {BUCKETS.map((bucket) => (
            <TabsTrigger
              key={bucket.value}
              value={bucket.value}
              count={bucketed[bucket.value].length}
            >
              {bucket.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {BUCKETS.map((bucket) => (
          <TabsContent key={bucket.value} value={bucket.value} className="pt-2">
            <IdeasBucketPanel
              bucket={bucket.value}
              ideas={bucketed[bucket.value]}
              hasUnfilteredIdeas={totalCounts[bucket.value] > 0}
              filterIsActive={
                search.trim().length > 0 || articleTypeFilter !== "all"
              }
              onGenerateClick={onGenerateClick}
              isGenerating={isGenerating}
              onApproveIdea={onApproveIdea}
              onRejectIdea={onRejectIdea}
              onGenerateArticleFromIdea={onGenerateArticleFromIdea}
              onArchiveIdea={onArchiveIdea}
              onUnarchiveIdea={onUnarchiveIdea}
              pendingIdeaId={pendingIdeaId}
              pendingIdeaAction={pendingIdeaAction}
              errorIdeaId={errorIdeaId}
              errorMessage={errorMessage}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

interface HeaderProps {
  counts: Record<IdeaBucket, number>;
  onGenerateClick: () => void;
  isGenerating?: boolean;
  hideCounts?: boolean;
}

function Header({
  counts,
  onGenerateClick,
  isGenerating,
  hideCounts,
}: HeaderProps) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          Idea backlog
        </h2>
        <p className="text-sm text-muted">
          Review, approve, and convert ideas into articles. Archived ideas are
          hidden from autopilot and the active backlog count.
        </p>
        {!hideCounts ? (
          <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
            <CountStat label="Needs review" count={counts.needs_review} />
            <CountStat label="Approved" count={counts.approved} />
            <CountStat label="In progress" count={counts.used} />
            <CountStat label="Archived" count={counts.archived} />
          </dl>
        ) : null}
      </div>
      <Button size="md" onClick={onGenerateClick} loading={isGenerating}>
        Generate ideas
      </Button>
    </header>
  );
}

function CountStat({ label, count }: { label: string; count: number }) {
  return (
    <div className="inline-flex items-center gap-1">
      <dt className="font-medium text-foreground">{count}</dt>
      <dd>{label}</dd>
    </div>
  );
}

interface IdeasBucketPanelProps {
  bucket: IdeaBucket;
  ideas: IdeaCardIdea[];
  /** True when the bucket has ideas in the underlying (pre-filter) data. */
  hasUnfilteredIdeas: boolean;
  /** True when search or article-type filter is narrowing results. */
  filterIsActive: boolean;
  onGenerateClick: () => void;
  isGenerating?: boolean;
  onApproveIdea?: (ideaId: string) => void;
  onRejectIdea?: (ideaId: string) => void;
  onGenerateArticleFromIdea?: (ideaId: string) => void;
  onArchiveIdea?: (ideaId: string) => void;
  onUnarchiveIdea?: (ideaId: string) => void;
  pendingIdeaId: string | null;
  pendingIdeaAction:
    | "approved"
    | "rejected"
    | "generating"
    | "archiving"
    | "unarchiving"
    | null;
  errorIdeaId: string | null;
  errorMessage: string | null;
}

function IdeasBucketPanel({
  bucket,
  ideas,
  hasUnfilteredIdeas,
  filterIsActive,
  onGenerateClick,
  isGenerating,
  onApproveIdea,
  onRejectIdea,
  onGenerateArticleFromIdea,
  onArchiveIdea,
  onUnarchiveIdea,
  pendingIdeaId,
  pendingIdeaAction,
  errorIdeaId,
  errorMessage,
}: IdeasBucketPanelProps) {
  if (ideas.length === 0) {
    return (
      <BucketEmptyState
        bucket={bucket}
        hasUnfilteredIdeas={hasUnfilteredIdeas}
        filterIsActive={filterIsActive}
        onGenerateClick={onGenerateClick}
        isGenerating={isGenerating}
      />
    );
  }

  return (
    <ul
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      aria-label={`Article ideas — ${bucket.replace("_", " ")}`}
    >
      {ideas.map((idea) => {
        const pendingAction =
          pendingIdeaId === null
            ? null
            : pendingIdeaId === idea.id
              ? pendingIdeaAction
              : "other";
        const cardError = errorIdeaId === idea.id ? errorMessage : null;
        return (
          <li key={idea.id}>
            <IdeaCard
              idea={idea}
              onApprove={onApproveIdea}
              onReject={onRejectIdea}
              onGenerate={onGenerateArticleFromIdea}
              onArchive={onArchiveIdea}
              onUnarchive={onUnarchiveIdea}
              pendingAction={pendingAction}
              errorMessage={cardError}
            />
          </li>
        );
      })}
    </ul>
  );
}

interface GlobalEmptyStateProps {
  onGenerateClick: () => void;
  isGenerating?: boolean;
}

function GlobalEmptyState({
  onGenerateClick,
  isGenerating,
}: GlobalEmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="rounded-[var(--sp-radius-full)] bg-gradient-accent p-3 text-white shadow-md">
        <BulbIcon />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold text-foreground">
          Generate ideas to start building this blog&apos;s content backlog.
        </p>
        <p className="max-w-md text-sm text-muted">
          Approve the ones you like, archive the duds, and turn the winners into
          articles when you&apos;re ready.
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

interface BucketEmptyStateProps {
  bucket: IdeaBucket;
  hasUnfilteredIdeas: boolean;
  filterIsActive: boolean;
  onGenerateClick: () => void;
  isGenerating?: boolean;
}

function BucketEmptyState({
  bucket,
  hasUnfilteredIdeas,
  filterIsActive,
  onGenerateClick,
  isGenerating,
}: BucketEmptyStateProps) {
  // Filtered-out within a bucket gets its own line — the user can
  // tell their search didn't match anything in this tab, rather than
  // staring at the regular "no approved ideas yet" copy.
  if (filterIsActive && hasUnfilteredIdeas) {
    return (
      <Card className="flex flex-col items-center gap-2 py-12 text-center">
        <p className="text-sm font-medium text-foreground">
          No ideas match your filters in this tab.
        </p>
        <p className="text-xs text-muted">
          Try clearing the search or article-type filter.
        </p>
      </Card>
    );
  }

  // Each bucket has a title + body line; CTA is opt-in (Needs review
  // and Approved get a "Generate ideas" button; Used / Archived
  // don't, because the user lands in those tabs to review history).
  const copy: Record<
    IdeaBucket,
    { title: string; body: string; cta?: boolean }
  > = {
    needs_review: {
      title: "No ideas need review right now.",
      body: "Generate a batch to refill your backlog.",
      cta: true,
    },
    approved: {
      title: "No approved ideas yet.",
      body: "Generate ideas or approve ideas to build your backlog.",
      cta: true,
    },
    used: {
      title: "No converted ideas yet.",
      body: "Approve and generate an article from an idea to see it here.",
    },
    archived: {
      title: "No archived ideas.",
      body: "Archive ideas you don\u2019t want autopilot to use; they\u2019ll appear here.",
    },
  };

  const entry = copy[bucket];
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{entry.title}</p>
      <p className="max-w-md text-xs text-muted">{entry.body}</p>
      {entry.cta ? (
        <Button size="sm" onClick={onGenerateClick} loading={isGenerating}>
          Generate ideas
        </Button>
      ) : null}
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
