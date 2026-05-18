"use client";

import { useState } from "react";
import { Badge } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { ConfirmModal } from "@/components/atoms/ConfirmModal";
import { cn } from "@/lib/cn";

/**
 * Manual WordPress publishing panel rendered on the article detail
 * page. Pure presentational — the parent (a connector) wires up
 * state via {@link useWordPressPublish}.
 *
 * v1.1 states the panel can be in:
 *   1. Not connected → button disabled, "Connect WordPress" link.
 *   2. No body → button disabled, hint to add Markdown content.
 *   3. Connected, not yet sent → "Send to WordPress Draft" enabled.
 *   4. Already sent as draft → "Update WordPress Draft" + "Publish
 *      Live to WordPress" buttons. The latter is gated by a
 *      {@link ConfirmModal} since it makes the post publicly
 *      visible.
 *   5. Published live (local article.status === "published") → green
 *      "Published" block with a "View WordPress post" link and an
 *      "Update WordPress Post" button (also confirmation-gated for
 *      symmetry).
 *   6. Remote draft missing → friendly error block + "Clear
 *      WordPress Link" button. Triggered when the parent passes
 *      `errorIsRemoteMissing` (the hook flips this for the
 *      `wp_post_not_found` error code).
 *
 * Loading is per-action: `isSending` / `isUpdating` / `isPublishing`
 * / `isClearing`. Only one is true at a time — when any is set the
 * other action buttons are disabled too so the user can't fire two
 * conflicting writes.
 */

/**
 * Local article status the panel reads to decide between the
 * "draft sent" and "published live" blocks. Mirrors `PostStatus`
 * from `@/components/atoms/PostStatusBadge` so the type lines up
 * with what the article detail page already passes around. Defined
 * locally so this molecule has no dependency on a sibling atom.
 */
export type WordPressArticleLocalStatus =
  | "draft"
  | "generating"
  | "ready"
  | "ready_for_review"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "archived";

export interface WordPressPublishCardProps {
  /** True iff the blog has all three WP credential fields stored. */
  hasConnection: boolean;
  /**
   * True iff the article has a non-empty Markdown body. We treat
   * "no body" as a soft block on publishing — the API would also
   * refuse, but disabling the button is friendlier.
   */
  hasBody: boolean;
  /**
   * Existing WP post id pulled from `articles.wp_post_id`. Non-null
   * means the article has been sent at least once; the panel flips
   * into the "Already sent" or "Published live" block.
   */
  wpPostId: number | null;
  /** Existing WP post URL. May be null even when `wpPostId` is set. */
  wpPostUrl: string | null;
  /**
   * Local article status. We use this to decide between the
   * "Already sent as draft" block (`!== "published"`) and the
   * "Published live" block (`=== "published"`).
   */
  articleStatus: WordPressArticleLocalStatus;
  /**
   * Where to send the user when they click "Connect WordPress" —
   * typically `${blogBase}/connections`.
   */
  connectionsHref: string;

  /** Triggered when the user clicks "Send to WordPress Draft". */
  onSend?: () => void;
  /** Triggered when the user clicks "Update WordPress Draft". */
  onUpdateDraft?: () => void;
  /**
   * Triggered when the user *confirms* the publish-live modal. The
   * card owns the modal, so the parent only sees the post-confirm
   * call.
   */
  onPublishLive?: () => void;
  /**
   * Triggered when the user clicks "Clear WordPress Link" in the
   * remote-draft-missing block.
   */
  onClearLink?: () => void;

  isSending?: boolean;
  isUpdating?: boolean;
  isPublishing?: boolean;
  isClearing?: boolean;

  /** Friendly error message; renders in an alert region under the body. */
  errorMessage?: string | null;
  /**
   * True iff the most recent error was `wp_post_not_found` — the
   * card switches into the remote-draft-missing block and surfaces
   * the "Clear WordPress Link" button.
   */
  errorIsRemoteMissing?: boolean;

  /**
   * Newly created post id for the *current* click. When set we
   * render a green "Draft created" success block. Different from
   * `wpPostId` because the latter is the persisted state — this
   * one is the just-now ack so the success doesn't disappear before
   * the page revalidate finishes.
   */
  justSentPostId?: number | null;
  /** Newly created post URL for the *current* click. */
  justSentPostUrl?: string | null;

  /**
   * Article-level featured image URL. Drives a small status line on
   * the card so users see ahead of time whether the next sync will
   * upload an image. Empty / null means "no featured image" and the
   * status line is hidden entirely.
   */
  featuredImageUrl?: string | null;
  /**
   * WordPress attachment id cached on the article (`articles.wp_featured_media_id`).
   * When set, the card flips the featured-image status line to
   * "Featured image uploaded to WordPress" — the next sync reuses
   * the existing attachment rather than re-uploading.
   */
  wpFeaturedMediaId?: number | null;
  className?: string;
}

type Mode =
  | "not_connected"
  | "no_body"
  | "ready"
  | "draft_sent"
  | "published_live"
  | "remote_missing";

function pickMode(
  hasConnection: boolean,
  hasBody: boolean,
  wpPostId: number | null,
  articleStatus: WordPressArticleLocalStatus,
  errorIsRemoteMissing: boolean,
): Mode {
  if (errorIsRemoteMissing && wpPostId !== null) return "remote_missing";
  if (!hasConnection) return "not_connected";
  if (wpPostId !== null && articleStatus === "published") {
    return "published_live";
  }
  if (wpPostId !== null) return "draft_sent";
  if (!hasBody) return "no_body";
  return "ready";
}

function statusBadge(mode: Mode): {
  label: string;
  variant: "success" | "default" | "warning" | "error";
} {
  switch (mode) {
    case "published_live":
      return { label: "Published", variant: "success" };
    case "draft_sent":
      return { label: "Draft sent", variant: "success" };
    case "ready":
      return { label: "Connected", variant: "default" };
    case "no_body":
      return { label: "No body", variant: "warning" };
    case "not_connected":
      return { label: "Not connected", variant: "warning" };
    case "remote_missing":
      return { label: "Draft missing", variant: "error" };
  }
}

/**
 * Confirmation copy for the publish-live modal. We tailor it
 * depending on whether the article is already live (an "update"
 * republish) or going live for the first time. The first-time copy
 * matches the spec verbatim.
 */
function publishLiveModalCopy(isAlreadyLive: boolean): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  if (isAlreadyLive) {
    return {
      title: "Update the live WordPress post?",
      message:
        "Update the live WordPress post with your latest changes? Visitors will see the new version immediately.",
      confirmLabel: "Update live post",
    };
  }
  return {
    title: "Publish live on WordPress?",
    message:
      "Publish this article live on WordPress? This will make the post publicly visible.",
    confirmLabel: "Publish live",
  };
}

/**
 * Tiny status line shown under the main contextual copy when the
 * article has a featured image. Exists so the user knows ahead of
 * time whether the next sync will upload the image (no cached
 * `wp_featured_media_id`) or reuse what's already on WordPress.
 *
 * Returns null when there's no featured image so the card stays
 * compact for unillustrated posts.
 */
function featuredImageStatus(
  featuredImageUrl: string | null | undefined,
  wpFeaturedMediaId: number | null | undefined,
): { label: string; tone: "info" | "success" } | null {
  if (!featuredImageUrl) return null;
  if (wpFeaturedMediaId !== null && wpFeaturedMediaId !== undefined) {
    return {
      label: "Featured image uploaded to WordPress.",
      tone: "success",
    };
  }
  return {
    label: "Featured image will be uploaded to WordPress on the next sync.",
    tone: "info",
  };
}

export function WordPressPublishCard({
  hasConnection,
  hasBody,
  wpPostId,
  wpPostUrl,
  articleStatus,
  connectionsHref,
  onSend,
  onUpdateDraft,
  onPublishLive,
  onClearLink,
  isSending = false,
  isUpdating = false,
  isPublishing = false,
  isClearing = false,
  errorMessage,
  errorIsRemoteMissing = false,
  justSentPostId,
  justSentPostUrl,
  featuredImageUrl,
  wpFeaturedMediaId,
  className,
}: WordPressPublishCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mode = pickMode(
    hasConnection,
    hasBody,
    wpPostId,
    articleStatus,
    errorIsRemoteMissing,
  );
  const badge = statusBadge(mode);
  const anyActionInFlight =
    isSending || isUpdating || isPublishing || isClearing;

  // "Show the draft-block link to the freshly returned URL when
  // present, fall back to the persisted one." Either may be null.
  const successUrl = justSentPostUrl ?? wpPostUrl;
  const successId = justSentPostId ?? wpPostId;

  const isAlreadyLive = mode === "published_live";
  const modalCopy = publishLiveModalCopy(isAlreadyLive);
  const featuredImage = featuredImageStatus(
    featuredImageUrl,
    wpFeaturedMediaId,
  );

  // The trigger button itself is disabled when anyActionInFlight,
  // so this handler doesn't need its own guard — disabling at the
  // button + via the modal's own loading state is enough.
  function handlePublishLiveClick() {
    setConfirmOpen(true);
  }

  function handleConfirmPublishLive() {
    setConfirmOpen(false);
    onPublishLive?.();
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>WordPress</CardTitle>
            <CardDescription>
              {isAlreadyLive
                ? "This article is published live on WordPress. You can push edits as updates."
                : "Send this article to your connected WordPress site as a draft, update an existing draft, or publish it live."}
            </CardDescription>
          </div>
          <Badge variant={badge.variant} size="sm">
            {badge.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {mode === "remote_missing" ? (
          <div
            className="rounded-[var(--sp-radius-md)] border border-error/40 bg-error/10 p-3 text-sm text-foreground"
            role="alert"
          >
            <p className="font-medium">WordPress post not found.</p>
            <p className="mt-1 text-xs text-muted">
              The WordPress draft (post #{wpPostId}) could not be found. It may
              have been deleted in WordPress. Clear the link below and send the
              article again as a new draft.
            </p>
          </div>
        ) : mode === "published_live" ? (
          <div
            className="rounded-[var(--sp-radius-md)] border border-success/40 bg-success/10 p-3 text-sm text-foreground"
            role="status"
          >
            <p className="font-medium">
              Published live on WordPress (post #{successId}).
            </p>
            <p className="mt-1 text-xs text-muted">
              Click <em>Update WordPress Post</em> after editing to push your
              changes to the live post.
            </p>
            {successUrl ? (
              <a
                href={successUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex text-sm text-brand-blue underline-offset-2 hover:underline"
              >
                View WordPress post →
              </a>
            ) : null}
          </div>
        ) : mode === "draft_sent" ? (
          <div
            className="rounded-[var(--sp-radius-md)] border border-success/40 bg-success/10 p-3 text-sm text-foreground"
            role="status"
          >
            <p className="font-medium">
              Draft created in WordPress (post #{successId}).
            </p>
            <p className="mt-1 text-xs text-muted">
              The article stays in{" "}
              <span className="font-mono">{articleStatus}</span> here. Click{" "}
              <em>Update WordPress Draft</em> to push edits, or{" "}
              <em>Publish Live to WordPress</em> when you&apos;re ready to go
              live.
            </p>
            {successUrl ? (
              <a
                href={successUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex text-sm text-brand-blue underline-offset-2 hover:underline"
              >
                View WordPress draft →
              </a>
            ) : null}
          </div>
        ) : mode === "not_connected" ? (
          <p className="text-sm text-muted">
            No WordPress site connected for this blog.{" "}
            <a
              href={connectionsHref}
              className="text-brand-blue underline-offset-2 hover:underline"
            >
              Connect WordPress
            </a>{" "}
            to enable publishing.
          </p>
        ) : mode === "no_body" ? (
          <p className="text-sm text-muted">
            This article has no Markdown content yet. Click <em>Edit</em> above
            to add a body, then come back here to send it.
          </p>
        ) : (
          <p className="text-sm text-muted">
            We&apos;ll convert the Markdown body to HTML, sanitize it, and
            create a draft post on your WordPress site.
          </p>
        )}

        {featuredImage ? (
          <p
            className={cn(
              "mt-3 rounded-[var(--sp-radius-md)] border p-2 text-xs",
              featuredImage.tone === "success"
                ? "border-success/30 bg-success/10 text-foreground"
                : "border-border bg-background text-muted",
            )}
            data-testid="wp-featured-image-status"
          >
            {featuredImage.label}
          </p>
        ) : null}

        {/* The remote-missing block is itself an alert; we only
            render the inline error region for non-remote-missing
            errors so we don't double up. */}
        {errorMessage && !errorIsRemoteMissing ? (
          <p
            className="mt-3 rounded-[var(--sp-radius-md)] border border-error/40 bg-error/10 p-2 text-sm text-error"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap justify-end gap-2">
        {mode === "remote_missing" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClearLink}
            disabled={anyActionInFlight}
            loading={isClearing}
          >
            Clear WordPress Link
          </Button>
        ) : mode === "published_live" ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handlePublishLiveClick}
            disabled={anyActionInFlight || !hasBody}
            loading={isPublishing}
          >
            Update WordPress Post
          </Button>
        ) : mode === "draft_sent" ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onUpdateDraft}
              disabled={anyActionInFlight || !hasBody}
              loading={isUpdating}
            >
              Update WordPress Draft
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handlePublishLiveClick}
              disabled={anyActionInFlight || !hasBody}
              loading={isPublishing}
            >
              Publish Live to WordPress
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSend}
            disabled={!hasConnection || !hasBody || anyActionInFlight}
            loading={isSending}
            aria-describedby={
              mode === "not_connected" || mode === "no_body"
                ? "wp-send-disabled-reason"
                : undefined
            }
          >
            Send to WordPress Draft
          </Button>
        )}
      </CardFooter>

      {mode === "not_connected" || mode === "no_body" ? (
        <p
          className="px-6 pb-4 text-xs text-muted"
          id="wp-send-disabled-reason"
        >
          {mode === "not_connected"
            ? "Connect a WordPress site from the Connections tab to enable publishing."
            : "Add some Markdown content to the article before sending it to WordPress."}
        </p>
      ) : null}

      <ConfirmModal
        open={confirmOpen}
        title={modalCopy.title}
        message={modalCopy.message}
        confirmLabel={modalCopy.confirmLabel}
        cancelLabel="Cancel"
        variant="primary"
        loading={isPublishing}
        onConfirm={handleConfirmPublishLive}
        onCancel={() => setConfirmOpen(false)}
      />
    </Card>
  );
}
