"use client";

import { useActiveTeamJobs } from "@/hooks/useActiveTeamJobs";
import { ActiveJobsTray } from "@/components/organisms/ActiveJobsTray";

/**
 * Glue: polls article_jobs through {@link useActiveTeamJobs} and
 * forwards the resulting list to the dumb {@link ActiveJobsTray}
 * organism. Mounted once in the dashboard layout — there's only ever
 * one instance of the floating tray on screen.
 */
export function ActiveJobsTrayConnector() {
  const { jobs, activeCount, dismiss } = useActiveTeamJobs();

  return (
    <ActiveJobsTray jobs={jobs} activeCount={activeCount} onDismiss={dismiss} />
  );
}
