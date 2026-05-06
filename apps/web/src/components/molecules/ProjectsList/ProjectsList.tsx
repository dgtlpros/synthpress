import NextLink from "next/link";
import { cn } from "@/lib/cn";

export interface ProjectsListProject {
  id: string;
  name: string;
}

export interface ProjectsListProps {
  teamId: string;
  projects: ProjectsListProject[];
  className?: string;
}

export function ProjectsList({
  teamId,
  projects,
  className,
}: ProjectsListProps) {
  if (projects.length === 0) {
    return (
      <p
        className={cn(
          "rounded-[var(--sp-radius-lg)] border border-dashed border-border px-4 py-6 text-center text-sm text-muted",
          className,
        )}
      >
        No projects match your filter.
      </p>
    );
  }

  return (
    <ul className={cn("space-y-2", className)} role="list">
      {projects.map((project) => (
        <li key={project.id}>
          <NextLink
            href={`/teams/${teamId}/projects/${project.id}`}
            className="flex cursor-pointer items-center justify-between rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-surface-hover"
          >
            <span className="truncate">{project.name}</span>
            <span className="shrink-0 text-muted">Open →</span>
          </NextLink>
        </li>
      ))}
    </ul>
  );
}
