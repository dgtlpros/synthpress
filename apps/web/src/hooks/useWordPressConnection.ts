"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBlog } from "@/actions/workspace";

export interface UseWordPressConnectionOptions {
  teamId: string;
  projectId: string;
  blogId: string;
}

export interface UseWordPressConnectionResult {
  connect: (input: {
    wpUrl: string;
    wpUsername: string;
    wpAppPassword: string;
  }) => void;
  disconnect: () => void;
  isSaving: boolean;
  isDisconnecting: boolean;
  error: string | null;
}

export function useWordPressConnection({
  teamId,
  projectId,
  blogId,
}: UseWordPressConnectionOptions): UseWordPressConnectionResult {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [isDisconnecting, startDisconnect] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    (input: { wpUrl: string; wpUsername: string; wpAppPassword: string }) => {
      setError(null);
      startSave(async () => {
        const result = await updateBlog(teamId, projectId, blogId, {
          connection: {
            wpUrl: input.wpUrl,
            wpUsername: input.wpUsername,
            // Empty string is the protocol for "preserve existing password".
            wpAppPassword: input.wpAppPassword,
          },
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      });
    },
    [router, teamId, projectId, blogId],
  );

  const disconnect = useCallback(() => {
    setError(null);
    startDisconnect(async () => {
      const result = await updateBlog(teamId, projectId, blogId, {
        connection: {
          wpUrl: null,
          wpUsername: null,
          wpAppPassword: null,
        },
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }, [router, teamId, projectId, blogId]);

  return { connect, disconnect, isSaving, isDisconnecting, error };
}
