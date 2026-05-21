"use client";

import { useState } from "react";
import {
  MANUAL_GENERATE_IDEAS_DEFAULT_COUNT,
  MANUAL_GENERATE_IDEAS_MAX_COUNT,
  MANUAL_GENERATE_IDEAS_MIN_COUNT,
} from "@/actions/article-generation";
import {
  GenerateIdeasModal,
  type GenerateIdeasModalProps,
} from "@/components/molecules/GenerateIdeasModal";
import {
  IdeasList,
  type IdeasListProps,
} from "@/components/organisms/IdeasList";
import { useGenerateArticleFromIdea } from "@/hooks/useGenerateArticleFromIdea";
import { useGenerateIdeas } from "@/hooks/useGenerateIdeas";
import { useIdeaActions } from "@/hooks/useIdeaActions";

export interface IdeasListConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  initialIdeas: IdeasListProps["ideas"];
  /**
   * Default batch size the modal opens with. The connector overrides
   * the prop's default for testing; in production the page passes
   * {@link MANUAL_GENERATE_IDEAS_DEFAULT_COUNT}.
   */
  defaultCount?: number;
  /** Synth-token cost shown next to the modal CTA. */
  creditsCost: number;
}

/**
 * Bridges the dumb {@link IdeasList} organism to the
 * {@link useGenerateIdeas} hook. Owns:
 *   - whether the modal is open
 *   - the brief textarea state
 *   - the count selector state
 * The hooks own:
 *   - the in-flight flag
 *   - the error message
 *   - calling the server action + refreshing
 */
export function IdeasListConnector({
  teamId,
  projectId,
  blogId,
  initialIdeas,
  defaultCount = MANUAL_GENERATE_IDEAS_DEFAULT_COUNT,
  creditsCost,
}: IdeasListConnectorProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState<number>(defaultCount);

  const { generate, isGenerating, generateError, resetError } =
    useGenerateIdeas({
      teamId,
      projectId,
      blogId,
      onSuccess: () => {
        setModalOpen(false);
        setBrief("");
        // Snap the count back to the connector default so the next
        // open isn't sticky on the last submission — most users will
        // want the same default again.
        setCount(defaultCount);
      },
    });

  const {
    approve,
    reject,
    archive,
    unarchive,
    pendingIdeaId: actionsPendingIdeaId,
    pendingAction: actionsPendingAction,
    errorIdeaId: actionsErrorIdeaId,
    errorMessage: actionsErrorMessage,
  } = useIdeaActions({ teamId, projectId, blogId });

  const {
    generate: generateArticle,
    pendingIdeaId: generationPendingIdeaId,
    errorIdeaId: generationErrorIdeaId,
    errorMessage: generationErrorMessage,
  } = useGenerateArticleFromIdea({ teamId, projectId, blogId });

  // Merge the two hooks' per-card pending state. Only one can be in
  // flight at a time across the page (single-action policy enforced
  // visually by `IdeaCard`'s `pendingAction`).
  const pendingIdeaId = actionsPendingIdeaId ?? generationPendingIdeaId;
  const pendingIdeaAction: IdeasListProps["pendingIdeaAction"] =
    actionsPendingIdeaId !== null
      ? actionsPendingAction
      : generationPendingIdeaId !== null
        ? "generating"
        : null;

  // Merge errors the same way — actions take precedence (the user just
  // clicked Approve/Reject/Archive/Unarchive) but generation errors fall
  // through.
  const errorIdeaId = actionsErrorIdeaId ?? generationErrorIdeaId;
  const errorMessage =
    actionsErrorIdeaId !== null ? actionsErrorMessage : generationErrorMessage;

  const handleClose: GenerateIdeasModalProps["onClose"] = () => {
    /* v8 ignore next 1 -- defensive: the Cancel button is disabled while
       generating, but the dialog can still close via Escape / backdrop click */
    if (isGenerating) return;
    setModalOpen(false);
    resetError();
  };

  return (
    <>
      <IdeasList
        ideas={initialIdeas}
        onGenerateClick={() => {
          resetError();
          setModalOpen(true);
        }}
        isGenerating={isGenerating}
        onApproveIdea={approve}
        onRejectIdea={reject}
        onGenerateArticleFromIdea={generateArticle}
        onArchiveIdea={archive}
        onUnarchiveIdea={unarchive}
        pendingIdeaId={pendingIdeaId}
        pendingIdeaAction={pendingIdeaAction}
        errorIdeaId={errorIdeaId}
        errorMessage={errorMessage}
      />
      <GenerateIdeasModal
        open={modalOpen}
        onClose={handleClose}
        brief={brief}
        onBriefChange={setBrief}
        count={count}
        onCountChange={setCount}
        minCount={MANUAL_GENERATE_IDEAS_MIN_COUNT}
        maxCount={MANUAL_GENERATE_IDEAS_MAX_COUNT}
        onSubmit={() => generate({ brief: brief || undefined, count })}
        creditsCost={creditsCost}
        pending={isGenerating}
        errorMessage={generateError}
      />
    </>
  );
}
