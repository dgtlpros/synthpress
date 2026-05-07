import { Badge } from "@/components/atoms/Badge";
import { Card } from "@/components/atoms/Card";

export interface ComingSoonPanelProps {
  title: string;
  description: string;
  bullets?: string[];
  className?: string;
}

export function ComingSoonPanel({
  title,
  description,
  bullets,
  className,
}: ComingSoonPanelProps) {
  return (
    <Card className={className}>
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <Badge variant="brand">Coming soon</Badge>
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        <p className="max-w-xl text-sm text-muted">{description}</p>
        {bullets && bullets.length ? (
          <ul className="mt-2 flex flex-col gap-2 text-sm text-muted">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-brand-blue"
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
