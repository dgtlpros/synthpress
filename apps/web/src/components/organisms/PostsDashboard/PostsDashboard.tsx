"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { Input } from "@/components/atoms/Input";
import {
  POST_STATUSES,
  PostStatusBadge,
  type PostStatus,
  getPostStatusLabel,
} from "@/components/atoms/PostStatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/atoms/Table";
import { Tabs, TabsList, TabsTrigger } from "@/components/atoms/Tabs";
import { StatCard } from "@/components/molecules/StatCard";

export interface PostsDashboardPost {
  id: string;
  title: string;
  status: PostStatus;
  /** Short summary, populated by AI generation; fallback to authorPersona for manual drafts. */
  excerpt: string | null;
  targetKeyword: string | null;
  authorPersona: string | null;
  wordCount: number | null;
  /** Model id (e.g. `claude-sonnet-4-6`) — set for AI-generated articles. */
  generatedByModel: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  destinationLabel: string | null;
}

export interface PostsDashboardProps {
  posts: PostsDashboardPost[];
  /** Loading state for the create-post mutation. */
  isCreating?: boolean;
  onCreatePost: (input: { title: string }) => void;
  /**
   * URL of the blog's Ideas tab. Surfaced from the empty state's primary
   * CTA so users without posts land on the canonical AI-first flow.
   */
  ideasHref?: string;
  onPostClick?: (postId: string) => void;
  className?: string;
}

type FilterValue = "all" | PostStatus;

// `ready` (legacy) and `ready_for_review` (current) collapse to a single
// editorial filter — clicking "Ready for review" finds posts in either
// underlying enum value.
const READY_STATUSES: readonly PostStatus[] = ["ready", "ready_for_review"];

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "generating", label: "Generating" },
  { value: "ready_for_review", label: "Ready for review" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Failed" },
  { value: "archived", label: "Archived" },
];

function countBy(posts: PostsDashboardPost[]): Record<PostStatus, number> {
  // Pre-seed every status to 0 so the read-then-write below never widens
  // to undefined.
  const counts: Record<PostStatus, number> = {
    draft: 0,
    generating: 0,
    ready: 0,
    ready_for_review: 0,
    scheduled: 0,
    publishing: 0,
    published: 0,
    failed: 0,
    archived: 0,
  };
  for (const p of posts) {
    counts[p.status] = counts[p.status] + 1;
  }
  return counts;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 14 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function absoluteTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PostsDashboard({
  posts,
  isCreating,
  onCreatePost,
  ideasHref,
  onPostClick,
  className,
}: PostsDashboardProps) {
  const [filter, setFilter] = useState<FilterValue>("all");
  const [search, setSearch] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const counts = useMemo(() => countBy(posts), [posts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if (filter !== "all") {
        // "Ready for review" is a virtual filter that matches both the
        // legacy `ready` and the canonical `ready_for_review` enum values.
        if (filter === "ready_for_review") {
          if (!READY_STATUSES.includes(p.status)) return false;
        } else if (p.status !== filter) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [p.title, p.targetKeyword ?? "", p.authorPersona ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [posts, filter, search]);

  const total = posts.length;

  function handleCreate() {
    // The button is disabled while createTitle.trim() is empty, so we don't
    // need to defend against empty titles here.
    onCreatePost({ title: createTitle.trim() });
    setCreateTitle("");
    setCreateOpen(false);
  }

  return (
    <div className={cn("space-y-6", className)}>
      <section
        aria-label="Post stats"
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
      >
        <StatCard label="Total posts" value={total} />
        <StatCard
          label="Drafts"
          value={counts.draft + counts.generating}
          hint={
            counts.generating > 0
              ? `${counts.generating} generating`
              : undefined
          }
        />
        <StatCard
          label="Ready / Scheduled"
          value={counts.ready + counts.ready_for_review + counts.scheduled}
          tone="brand"
          hint={
            counts.scheduled > 0 ? `${counts.scheduled} scheduled` : undefined
          }
        />
        <StatCard label="Published" value={counts.published} tone="success" />
        <StatCard
          label="Failed"
          value={counts.failed}
          tone={counts.failed > 0 ? "error" : "default"}
        />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as FilterValue)}
          className="min-w-0"
        >
          <TabsList ariaLabel="Filter posts by status">
            {FILTERS.map((f) => {
              const count =
                f.value === "all"
                  ? total
                  : f.value === "ready_for_review"
                    ? counts.ready + counts.ready_for_review
                    : (counts as Record<string, number>)[f.value];
              return (
                <TabsTrigger
                  key={f.value}
                  value={f.value}
                  count={count}
                  disabled={f.value !== "all" && count === 0}
                >
                  {f.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Input
            type="search"
            placeholder="Search posts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-56"
            aria-label="Search posts"
          />
        </div>
      </div>

      {createOpen ? (
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="new-post-title"
              className="text-sm font-medium text-foreground"
            >
              New post title
            </label>
            <Input
              id="new-post-title"
              autoFocus
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="e.g. The complete guide to AI blogging"
              disabled={isCreating}
              className="mt-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              disabled={isCreating}
              onClick={() => {
                setCreateOpen(false);
                setCreateTitle("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="md"
              loading={isCreating}
              disabled={!createTitle.trim()}
              onClick={handleCreate}
            >
              Create draft
            </Button>
          </div>
        </Card>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          ideasHref={ideasHref}
        />
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm font-medium text-foreground">
            No posts match the current filter.
          </p>
          <p className="text-sm text-muted">
            Try clearing the search or switching to &ldquo;All&rdquo;.
          </p>
        </Card>
      ) : (
        <PostsTable posts={filtered} onPostClick={onPostClick} />
      )}

      {!createOpen && posts.length > 0 ? (
        <div className="flex items-center justify-end gap-2">
          {ideasHref ? (
            <Link
              href={ideasHref}
              className="inline-flex h-10 items-center justify-center rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              Generate from an idea
            </Link>
          ) : null}
          <Button size="md" onClick={() => setCreateOpen(true)}>
            New post
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface PostsTableProps {
  posts: PostsDashboardPost[];
  onPostClick?: (postId: string) => void;
}

function PostsTable({ posts, onPostClick }: PostsTableProps) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Title</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Topic / keyword</TableHeaderCell>
          <TableHeaderCell className="hidden md:table-cell">
            Words
          </TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Destination
          </TableHeaderCell>
          <TableHeaderCell>Scheduled</TableHeaderCell>
          <TableHeaderCell>Updated</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {posts.map((p) => (
          <TableRow
            key={p.id}
            interactive={Boolean(onPostClick)}
            onClick={onPostClick ? () => onPostClick(p.id) : undefined}
            tabIndex={onPostClick ? 0 : undefined}
            onKeyDown={
              onPostClick
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPostClick(p.id);
                    }
                  }
                : undefined
            }
          >
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span
                  className="line-clamp-1 max-w-[28rem] font-medium text-foreground"
                  title={p.title || "Untitled"}
                >
                  {p.title || "Untitled"}
                </span>
                {p.excerpt ? (
                  <span
                    className="line-clamp-1 max-w-[28rem] text-xs text-muted"
                    title={p.excerpt}
                  >
                    {p.excerpt}
                  </span>
                ) : null}
                {p.authorPersona || p.generatedByModel ? (
                  <span className="text-xs text-muted">
                    {[
                      p.authorPersona && `By ${p.authorPersona}`,
                      p.generatedByModel && `via ${p.generatedByModel}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <PostStatusBadge status={p.status} size="sm" />
            </TableCell>
            <TableCell>
              {p.targetKeyword ? (
                <Badge variant="default" size="sm">
                  {p.targetKeyword}
                </Badge>
              ) : (
                <span className="text-xs text-muted">—</span>
              )}
            </TableCell>
            <TableCell className="hidden md:table-cell text-sm text-muted">
              {p.wordCount ? p.wordCount.toLocaleString() : "—"}
            </TableCell>
            <TableCell className="hidden lg:table-cell text-sm text-muted">
              {p.destinationLabel ?? (
                <span className="text-xs italic">No destination</span>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted">
              {absoluteTime(p.scheduledAt)}
            </TableCell>
            <TableCell className="text-sm text-muted">
              {relativeTime(p.updatedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface EmptyStateProps {
  onCreate: () => void;
  /** When provided, the empty state shows a primary "Go to Ideas" CTA. */
  ideasHref?: string;
}

function EmptyState({ onCreate, ideasHref }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="rounded-[var(--sp-radius-full)] bg-gradient-accent p-3 text-white shadow-md">
        <DocumentIcon />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold text-foreground">No posts yet</p>
        <p className="max-w-md text-sm text-muted">
          Generate ideas, approve one, then generate an article draft. Posts you
          publish will land here for review and editing.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {ideasHref ? (
          <Link
            href={ideasHref}
            className="inline-flex h-10 items-center justify-center rounded-[var(--sp-radius-lg)] bg-gradient-accent px-4 text-sm font-medium text-white shadow-md transition-all duration-150 hover:shadow-lg hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            Go to Ideas
          </Link>
        ) : null}
        <Button variant="secondary" size="md" onClick={onCreate}>
          New post
        </Button>
      </div>
      <p className="text-xs text-muted">
        Tip: configure tone, audience, and SEO defaults under{" "}
        <span className="font-medium text-foreground">Settings</span> first.
      </p>
    </Card>
  );
}

function DocumentIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

export { getPostStatusLabel, POST_STATUSES };
