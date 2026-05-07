"use client";

import { WordPressConnectionForm } from "@/components/molecules/WordPressConnectionForm";
import { useWordPressConnection } from "@/hooks/useWordPressConnection";

export interface BlogConnectionsConnectorProps {
  teamId: string;
  projectId: string;
  blogId: string;
  initialUrl: string | null;
  initialUsername: string | null;
  hasStoredPassword: boolean;
}

export function BlogConnectionsConnector({
  teamId,
  projectId,
  blogId,
  initialUrl,
  initialUsername,
  hasStoredPassword,
}: BlogConnectionsConnectorProps) {
  const { connect, disconnect, isSaving, isDisconnecting, error } =
    useWordPressConnection({ teamId, projectId, blogId });

  return (
    <WordPressConnectionForm
      initialUrl={initialUrl}
      initialUsername={initialUsername}
      hasStoredPassword={hasStoredPassword}
      onSubmit={connect}
      onDisconnect={disconnect}
      isSaving={isSaving}
      isDisconnecting={isDisconnecting}
      error={error}
    />
  );
}
