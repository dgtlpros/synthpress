import { cn } from "@/lib/cn";
import { ProjectInstalledAppRow } from "@/components/molecules/ProjectInstalledAppRow";

export interface ProjectInstalledAppListItem {
  id: string;
  href: string;
  appKindLabel: string;
  title: string;
  subtitle: string;
  isActive: boolean;
  meta?: string | null;
}

export interface ProjectInstalledAppListProps {
  items: ProjectInstalledAppListItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function ProjectInstalledAppList({
  items,
  emptyTitle = "No apps yet",
  emptyDescription = "Create a Blog app to connect WordPress and automation.",
  className,
}: ProjectInstalledAppListProps) {
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "rounded-[var(--sp-radius-lg)] border border-dashed border-border bg-surface/60 px-4 py-8 text-center",
          className,
        )}
      >
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="mt-1 text-sm text-muted">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <ul className={cn("space-y-2", className)} role="list">
      {items.map((item) => (
        <li key={item.id}>
          <ProjectInstalledAppRow
            href={item.href}
            appKindLabel={item.appKindLabel}
            title={item.title}
            subtitle={item.subtitle}
            isActive={item.isActive}
            meta={item.meta}
          />
        </li>
      ))}
    </ul>
  );
}
