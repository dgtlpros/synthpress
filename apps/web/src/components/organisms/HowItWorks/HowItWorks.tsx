const steps = [
  {
    number: "1",
    title: "Connect Your Site",
    description: "Add your WordPress URL and app password. One-time setup, takes 30 seconds.",
  },
  {
    number: "2",
    title: "Generate Content",
    description: "AI writes SEO-optimized articles tailored to your niche with featured images.",
  },
  {
    number: "3",
    title: "Auto-Publish",
    description: "Articles go live on your WordPress site and syndicate to MSN automatically.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            How It Works
          </h2>
          <p className="mt-4 text-lg text-muted">Three steps to fully automated content publishing.</p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="relative rounded-[var(--sp-radius-xl)] border border-border bg-surface p-8 shadow-[var(--sp-shadow-sm)] text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--sp-radius-full)] bg-gradient-accent text-lg font-bold text-white">
                {step.number}
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
