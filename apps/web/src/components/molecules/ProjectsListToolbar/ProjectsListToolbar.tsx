import { cn } from "@/lib/cn";
import { Input } from "@/components/atoms/Input";
import { Label } from "@/components/atoms/Label";
import { Select } from "@/components/atoms/Select";

export type ProjectsSortKey = "name-asc" | "name-desc" | "newest";

export interface ProjectsListToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortKey: ProjectsSortKey;
  onSortChange: (value: ProjectsSortKey) => void;
  className?: string;
}

const sortOptions: { value: ProjectsSortKey; label: string }[] = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "newest", label: "Newest first" },
];

export function ProjectsListToolbar({
  searchQuery,
  onSearchChange,
  sortKey,
  onSortChange,
  className,
}: ProjectsListToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--sp-radius-lg)] border border-border bg-surface px-4 py-3 shadow-sm sm:flex-row sm:items-end sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <Label htmlFor="projects-search" className="text-xs text-muted">
          Filter by name
        </Label>
        <Input
          id="projects-search"
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects…"
          className="mt-1.5"
          autoComplete="off"
        />
      </div>
      <div className="w-full sm:w-48">
        <Label htmlFor="projects-sort" className="text-xs text-muted">
          Sort
        </Label>
        <Select
          id="projects-sort"
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as ProjectsSortKey)}
          className="mt-1.5"
          options={sortOptions.map((o) => ({ value: o.value, label: o.label }))}
        />
      </div>
    </div>
  );
}
