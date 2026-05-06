import { cn } from "@/lib/cn";
import { Button } from "@/components/atoms/Button";

export interface ProjectPageHeaderProps {
  projectName: string;
  teamName: string;
  descriptionPreview?: string | null;
  onOpenSettings: () => void;
  className?: string;
}

export function ProjectPageHeader({
  projectName,
  teamName,
  descriptionPreview,
  onOpenSettings,
  className,
}: ProjectPageHeaderProps) {
  const preview = descriptionPreview?.trim() ?? "";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--sp-radius-xl)] border border-border bg-surface px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">{projectName}</h1>
        <p className="mt-0.5 text-xs text-muted">
          Team <span className="text-foreground/90">{teamName}</span>
        </p>
        {preview ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted" title={preview}>
            {preview}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">No description yet.</p>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0 cursor-pointer self-start sm:self-center"
        onClick={onOpenSettings}
      >
        Project settings
      </Button>
    </div>
  );
}
