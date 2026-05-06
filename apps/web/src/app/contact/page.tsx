import type { Metadata } from "next";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { LandingLayout } from "@/components/templates/LandingLayout";
import { Footer } from "@/components/organisms/Footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact — SynthPress",
  description: "Get in touch with the SynthPress team.",
};

const channels = [
  {
    name: "General inquiries",
    description: "Questions about the product, pricing, or partnerships.",
    href: "mailto:hello@synthpress.app",
    label: "hello@synthpress.app",
  },
  {
    name: "Customer support",
    description: "Need help with your account, integrations, or article generation?",
    href: "mailto:support@synthpress.app",
    label: "support@synthpress.app",
  },
  {
    name: "Press & media",
    description: "Working on a story or want a quote? We're happy to chat.",
    href: "mailto:press@synthpress.app",
    label: "press@synthpress.app",
  },
];

export default async function ContactPage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  return (
    <LandingLayout user={user ? { email: user.email ?? "" } : null}>
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-brand-blue">Contact</span>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Get in touch
          </h1>
          <p className="mt-4 text-lg text-muted">
            We read every message. Pick the channel that fits your question — we&apos;ll get back within one business day.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-3xl gap-6">
          {channels.map((c) => (
            <a
              key={c.name}
              href={c.href}
              className="group flex flex-col rounded-[var(--sp-radius-xl)] border border-border bg-surface p-8 shadow-[var(--sp-shadow-sm)] transition-all hover:border-border-hover hover:shadow-[var(--sp-shadow-md)] sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h3 className="text-lg font-semibold text-foreground">{c.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{c.description}</p>
              </div>
              <span className="mt-4 inline-flex items-center text-sm font-medium text-brand-blue transition-colors group-hover:text-brand-indigo sm:ml-6 sm:mt-0">
                {c.label}
                <span aria-hidden="true" className="ml-2 transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </span>
            </a>
          ))}
        </div>

        <div className="mx-auto mt-16 max-w-3xl rounded-[var(--sp-radius-xl)] border border-border bg-surface p-8 text-center shadow-[var(--sp-shadow-sm)]">
          <h2 className="text-xl font-semibold text-foreground">Already a customer?</h2>
          <p className="mt-2 text-sm text-muted">
            The fastest way to get help is from inside your dashboard — your account context is automatically attached
            so we can dig in right away.
          </p>
        </div>
      </section>
      <Footer />
    </LandingLayout>
  );
}
