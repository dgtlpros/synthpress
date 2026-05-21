"use client";

import { WordPressConnectionForm } from "@/components/molecules/WordPressConnectionForm";
import { useWordPressConnection } from "@/hooks/useWordPressConnection";
import { useWordPressConnectionTest } from "@/hooks/useWordPressConnectionTest";

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
  const {
    test,
    isTesting,
    state: testState,
  } = useWordPressConnectionTest({ teamId, projectId, blogId });

  return (
    <WordPressConnectionForm
      initialUrl={initialUrl}
      initialUsername={initialUsername}
      hasStoredPassword={hasStoredPassword}
      onSubmit={connect}
      onDisconnect={disconnect}
      onTestConnection={test}
      isSaving={isSaving}
      isDisconnecting={isDisconnecting}
      isTesting={isTesting}
      testResult={testState.result}
      testActionError={testState.actionError}
      error={error}
    />
  );
}
