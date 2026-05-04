import { cn } from "@/lib/cn";

export interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
  className?: string;
}

export function FeatureCard({ icon, title, description, className }: FeatureCardProps) {
  return (
    <div className={cn("rounded-[var(--sp-radius-xl)] border border-border bg-surface p-6 shadow-[var(--sp-shadow-sm)] transition-all hover:shadow-[var(--sp-shadow-md)] hover:border-border-hover", className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--sp-radius-lg)] bg-gradient-accent text-2xl">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}
