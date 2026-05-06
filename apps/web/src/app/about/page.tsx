import type { Metadata } from "next";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { LandingLayout } from "@/components/templates/LandingLayout";
import { Footer } from "@/components/organisms/Footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About — SynthPress",
  description:
    "We make AI-powered publishing accessible to every WordPress operator — from solo bloggers to networks of 1,000+ sites.",
};

const values = [
  {
    title: "Quality over quantity",
    description:
      "We tune our prompts and models to produce articles humans actually want to read — not the soulless filler most auto-publishers churn out.",
  },
  {
    title: "Built for operators",
    description:
      "We obsess about the workflows that matter when you're running 10, 100, or 1,000 sites. Bulk operations, network-wide settings, zero-friction onboarding.",
  },
  {
    title: "Honest pricing",
    description:
      "Transparent token-based billing. No surprise overages, no aggressive upsells. Tokens roll over and top-ups never expire.",
  },
];

const stats = [
  { value: "10k+", label: "Articles published" },
  { value: "500+", label: "WordPress sites connected" },
  { value: "1.2M+", label: "Synth tokens spent" },
];

export default async function AboutPage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  return (
    <LandingLayout user={user ? { email: user.email ?? "" } : null}>
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-brand-blue">
            About SynthPress
          </span>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Publishing on autopilot,{" "}
            <span className="text-gradient-accent">without the slop</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            SynthPress was built by operators who got tired of stitching
            together a half-dozen tools to keep their WordPress networks alive.
            We bundle generation, publishing, and syndication into one place —
            with the quality bar set at &ldquo;humans actually want to read
            this.&rdquo;
          </p>
        </div>

        <div className="mx-auto mt-20 grid max-w-5xl gap-8 sm:grid-cols-3">
          {values.map((v) => (
            <div
              key={v.title}
              className="rounded-[var(--sp-radius-xl)] border border-border bg-surface p-8 shadow-[var(--sp-shadow-sm)]"
            >
              <h3 className="text-lg font-semibold text-foreground">
                {v.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {v.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-24 max-w-5xl">
          <div className="rounded-[var(--sp-radius-xl)] bg-gradient-accent p-[1px] shadow-[var(--sp-shadow-md)]">
            <div className="grid gap-8 rounded-[calc(var(--sp-radius-xl)-1px)] bg-surface p-10 sm:grid-cols-3">
              {stats.map((s) => (
                <div key={s.label} className="text-center">
                  <div className="text-3xl font-bold text-gradient-accent sm:text-4xl">
                    {s.value}
                  </div>
                  <div className="mt-2 text-sm text-muted">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-24 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">
            Our story
          </h2>
          <div className="mt-6 space-y-5 text-base leading-relaxed text-muted">
            <p>
              We started SynthPress in late 2025 after spending years running
              content sites the hard way — managing writers, juggling editorial
              calendars, and watching margins shrink as AI-generated competitors
              flooded the search results.
            </p>
            <p>
              Most of the &ldquo;AI publishing&rdquo; tools we tried fell into
              two camps: thin wrappers that produced embarrassing copy, or
              enterprise platforms with onboarding flows that took weeks.
              Neither worked for the way we actually publish.
            </p>
            <p>
              So we built the thing we wanted: a single product that handles
              generation, publishing, and syndication with care taken at every
              step — and pricing that doesn&apos;t punish you for using it.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </LandingLayout>
  );
}
