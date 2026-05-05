import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { LandingLayout } from "@/components/templates/LandingLayout";
import { Footer } from "@/components/organisms/Footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog — SynthPress",
  description: "Notes on AI publishing, SEO, and running content networks at scale.",
};

const placeholders = [
  {
    category: "Coming soon",
    title: "Why we built SynthPress",
    description:
      "The story behind the product, and why every existing AI publishing tool felt half-finished.",
  },
  {
    category: "Coming soon",
    title: "Prompt engineering for SEO",
    description:
      "How we tune generation prompts to consistently produce articles that rank — without keyword stuffing.",
  },
  {
    category: "Coming soon",
    title: "Network-wide publishing patterns",
    description:
      "Workflows we've seen work for operators running 100+ WordPress sites without losing their minds.",
  },
];

export default async function BlogPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <LandingLayout user={user ? { email: user.email ?? "" } : null}>
      <section className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-blue">SynthPress Blog</span>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Notes from the team
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
              Deep dives on AI publishing, SEO, and running content networks at scale. New posts dropping soon — in
              the meantime, here&apos;s what&apos;s on our writing list.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            {placeholders.map((p) => (
              <article
                key={p.title}
                className="flex flex-col rounded-[var(--sp-radius-xl)] border border-border bg-surface p-8 shadow-[var(--sp-shadow-sm)]"
              >
                <span className="inline-flex w-fit rounded-[var(--sp-radius-full)] bg-surface-hover px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-blue">
                  {p.category}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{p.description}</p>
              </article>
            ))}
          </div>

          <div className="mx-auto mt-20 max-w-2xl rounded-[var(--sp-radius-xl)] border border-border bg-surface p-8 text-center shadow-[var(--sp-shadow-sm)]">
            <h2 className="text-xl font-semibold text-foreground">Want a heads-up when we publish?</h2>
            <p className="mt-2 text-sm text-muted">
              Drop us a line at{" "}
              <a
                href="mailto:hello@synthpress.app"
                className="font-medium text-brand-blue transition-colors hover:text-brand-indigo"
              >
                hello@synthpress.app
              </a>{" "}
              and we&apos;ll add you to the early-readers list.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </LandingLayout>
  );
}
