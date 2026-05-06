"use client";

import { useMemo, useState } from "react";
import type { ProjectRow } from "@/services/workspace-service";
import { ProjectsList } from "@/components/molecules/ProjectsList";
import {
  ProjectsListToolbar,
  type ProjectsSortKey,
} from "@/components/molecules/ProjectsListToolbar";

export interface TeamProjectsListConnectorProps {
  teamId: string;
  projects: Pick<ProjectRow, "id" | "name" | "created_at">[];
}

export function TeamProjectsListConnector({
  teamId,
  projects,
}: TeamProjectsListConnectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<ProjectsSortKey>("name-asc");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = projects.map((p) => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
    }));
    if (q) {
      rows = rows.filter((p) => p.name.toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => {
      if (sortKey === "name-asc") {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      if (sortKey === "name-desc") {
        return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    return rows.map(({ id, name }) => ({ id, name }));
  }, [projects, searchQuery, sortKey]);

  return (
    <div>
      <ProjectsListToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortKey={sortKey}
        onSortChange={setSortKey}
      />
      <ProjectsList teamId={teamId} projects={filtered} className="mt-4" />
    </div>
  );
}
