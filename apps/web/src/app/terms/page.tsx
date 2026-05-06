import type { Metadata } from "next";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { LandingLayout } from "@/components/templates/LandingLayout";
import { Footer } from "@/components/organisms/Footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of Service — SynthPress",
  description: "The terms governing your use of SynthPress.",
};

export default async function TermsOfServicePage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  return (
    <LandingLayout user={user ? { email: user.email ?? "" } : null}>
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <div className="border-b border-border pb-8">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              Legal
            </span>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Terms of Service
            </h1>
            <p className="mt-4 text-sm text-muted">Last updated: May 5, 2026</p>
          </div>

          <div className="mt-12 space-y-12 text-base leading-relaxed text-muted">
            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                1. Acceptance of terms
              </h2>
              <p>
                These Terms of Service (&ldquo;Terms&rdquo;) govern your access
                to and use of SynthPress&apos;s website, products, and services
                (together, the &ldquo;Service&rdquo;). By creating an account or
                using the Service, you agree to be bound by these Terms. If you
                don&apos;t agree, don&apos;t use the Service.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                2. Description of service
              </h2>
              <p>
                SynthPress is an AI-powered content generation and publishing
                platform that helps you create, schedule, and distribute
                articles to WordPress sites and other connected destinations.
                Features and functionality may change over time as we improve
                the Service.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                3. Eligibility and accounts
              </h2>
              <p>
                You must be at least 18 years old (or the age of majority in
                your jurisdiction) to use the Service. You are responsible for
                keeping your account credentials confidential and for any
                activity that occurs under your account. Notify us immediately
                at{" "}
                <a
                  href="mailto:support@synthpress.app"
                  className="font-medium text-brand-blue transition-colors hover:text-brand-indigo"
                >
                  support@synthpress.app
                </a>{" "}
                if you suspect unauthorized access.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                4. Subscription, tokens, and billing
              </h2>
              <p>
                The Service is offered on a subscription basis with monthly
                synth token allowances. Top-up packs are also available as
                one-time purchases.
              </p>
              <ul className="mt-4 ml-6 list-disc space-y-2">
                <li>
                  Plan fees are billed in advance on a recurring basis. Top-up
                  packs are charged at the time of purchase.
                </li>
                <li>
                  Monthly tokens roll over month-to-month while your
                  subscription is active. Top-up tokens never expire.
                </li>
                <li>
                  All fees are non-refundable except where required by law. You
                  can cancel your subscription at any time and will retain
                  access until the end of the current billing period.
                </li>
                <li>
                  We may change pricing with at least 30 days&apos; notice.
                  Price changes apply to subsequent billing periods only.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                5. Acceptable use
              </h2>
              <p>You agree not to use the Service to:</p>
              <ul className="mt-4 ml-6 list-disc space-y-2">
                <li>
                  Generate or publish content that is unlawful, defamatory,
                  fraudulent, or infringing.
                </li>
                <li>
                  Produce content depicting minors in sexual contexts or
                  inciting violence against individuals or groups.
                </li>
                <li>
                  Impersonate any person or misrepresent your affiliation with
                  any entity.
                </li>
                <li>
                  Attempt to circumvent token limits, scrape the Service, or
                  reverse-engineer our systems.
                </li>
                <li>
                  Interfere with the Service&apos;s operation or other
                  users&apos; access to it.
                </li>
              </ul>
              <p className="mt-4">
                We may suspend or terminate accounts that violate this policy,
                with or without notice.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                6. User content and license
              </h2>
              <p>
                You retain all rights to the prompts you submit and the
                articles, images, and metadata generated on your behalf
                (&ldquo;User Content&rdquo;). By submitting prompts, you grant
                SynthPress a worldwide, non-exclusive, royalty-free license to
                host, process, and transmit User Content solely as needed to
                provide and improve the Service.
              </p>
              <p className="mt-4">
                You are responsible for the User Content you generate and
                publish. AI-generated content may contain inaccuracies or
                biases; you should review it before relying on or publishing it.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                7. Intellectual property
              </h2>
              <p>
                The Service, including its software, design, branding, and
                documentation, is owned by SynthPress and its licensors and is
                protected by intellectual property laws. We grant you a limited,
                non-exclusive, non-transferable license to use the Service in
                accordance with these Terms.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                8. Third-party services
              </h2>
              <p>
                The Service integrates with third-party providers (including
                Stripe for payments, Supabase for data storage, and AI model
                providers such as OpenAI and Anthropic for content generation).
                Your use of those integrations is subject to the respective
                providers&apos; terms and privacy policies.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                9. Disclaimer of warranties
              </h2>
              <p>
                The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
                available&rdquo; basis. To the fullest extent permitted by law,
                SynthPress disclaims all warranties, express or implied,
                including merchantability, fitness for a particular purpose, and
                non-infringement. We do not warrant that the Service will be
                uninterrupted, error-free, or that AI-generated content will be
                accurate or suitable for any particular purpose.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                10. Limitation of liability
              </h2>
              <p>
                To the fullest extent permitted by law, SynthPress and its
                officers, employees, and affiliates will not be liable for any
                indirect, incidental, special, consequential, or punitive
                damages, or any loss of profits, revenue, or data, arising out
                of or related to your use of the Service. Our total liability
                for any claim arising out of these Terms will not exceed the
                amount you paid us in the 12 months preceding the event giving
                rise to the claim.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                11. Indemnification
              </h2>
              <p>
                You agree to indemnify and hold SynthPress harmless from any
                claims, damages, liabilities, and expenses (including reasonable
                attorneys&apos; fees) arising out of your use of the Service,
                your User Content, or your violation of these Terms.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                12. Termination
              </h2>
              <p>
                You may terminate your account at any time by canceling your
                subscription and contacting us. We may suspend or terminate your
                access if you violate these Terms or if we discontinue the
                Service. Sections that by their nature should survive
                termination (such as payment obligations, IP, and liability
                limits) will remain in effect.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                13. Changes to these terms
              </h2>
              <p>
                We may update these Terms from time to time. If we make material
                changes, we will notify you by email or through the Service
                before the changes take effect. Continued use of the Service
                after changes take effect constitutes acceptance of the updated
                Terms.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                14. Governing law
              </h2>
              <p>
                These Terms are governed by the laws of the State of Delaware,
                United States, without regard to conflict-of-law principles. Any
                dispute arising out of these Terms will be resolved in the state
                or federal courts located in Delaware.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">
                15. Contact us
              </h2>
              <p>
                Questions about these Terms? Email us at{" "}
                <a
                  href="mailto:legal@synthpress.app"
                  className="font-medium text-brand-blue transition-colors hover:text-brand-indigo"
                >
                  legal@synthpress.app
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </section>
      <Footer />
    </LandingLayout>
  );
}
