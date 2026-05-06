import { cn } from "@/lib/cn";
import { FeatureCard } from "@/components/molecules/FeatureCard";

const features = [
  {
    icon: "✍️",
    title: "AI Article Generation",
    description:
      "GPT-powered long-form content with proper heading structure and SEO optimization.",
  },
  {
    icon: "🌐",
    title: "Multi-Site Management",
    description:
      "Manage up to 20 WordPress sites from one dashboard with per-site configurations.",
  },
  {
    icon: "🚀",
    title: "Auto-Publishing",
    description:
      "Schedule and auto-publish articles on a per-site cadence. Set it and forget it.",
  },
  {
    icon: "📡",
    title: "MSN Syndication",
    description:
      "Auto-syndicate published content to MSN Partner Hub for massive extra reach.",
  },
  {
    icon: "🖼️",
    title: "Image Generation",
    description:
      "AI-generated featured images, uploaded and optimized automatically for every article.",
  },
  {
    icon: "📊",
    title: "SEO Optimized",
    description:
      "Clean HTML, proper schema markup, and meta descriptions generated out of the box.",
  },
];

export interface FeaturesProps {
  className?: string;
}

export function Features({ className }: FeaturesProps) {
  return (
    <section id="features" className={cn("px-6 py-24", className)}>
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything You Need to{" "}
            <span className="text-gradient-accent">Automate Content</span>
          </h2>
          <p className="mt-4 text-lg text-muted">
            Publish SEO-optimized articles on autopilot across your entire
            WordPress network.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
