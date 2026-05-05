import NextLink from "next/link";
import { cn } from "@/lib/cn";

export interface HeroProps {
  className?: string;
}

export function Hero({ className }: HeroProps) {
  return (
    <section className={cn("relative overflow-hidden px-6 py-24 sm:py-32", className)}>
      <div className="mx-auto max-w-6xl text-center">
        <div className="mx-auto mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/synthpress-logo-icon.svg" alt="SynthPress mascot" className="h-32 w-auto drop-shadow-lg sm:h-40" />
        </div>

        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
          AI-Powered Blog Publishing{" "}
          <span className="text-gradient-accent">on Autopilot</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
          Generate, publish, and syndicate SEO-optimized articles across your WordPress network. Set it and check in when you want.
        </p>

        <div className="mt-10 flex items-center justify-center gap-4">
          <NextLink
            href="/signup"
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-[var(--sp-radius-lg)] bg-gradient-accent px-6 text-base font-medium text-white shadow-md transition-all hover:brightness-110 hover:shadow-lg"
          >
            Get Started
          </NextLink>
          <a
            href="#how-it-works"
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-[var(--sp-radius-lg)] border border-border bg-surface px-6 text-base font-medium text-foreground shadow-sm transition-all hover:bg-surface-hover"
          >
            See How It Works
          </a>
        </div>
      </div>
    </section>
  );
}
