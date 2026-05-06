import type { Metadata } from "next";
import { getAuthUserOncePerResponse } from "@/lib/supabase/server";
import { LandingLayout } from "@/components/templates/LandingLayout";
import { Footer } from "@/components/organisms/Footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy — SynthPress",
  description: "How SynthPress collects, uses, and protects your information.",
};

export default async function PrivacyPolicyPage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  return (
    <LandingLayout user={user ? { email: user.email ?? "" } : null}>
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <div className="border-b border-border pb-8">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Legal</span>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Privacy Policy
            </h1>
            <p className="mt-4 text-sm text-muted">Last updated: May 5, 2026</p>
          </div>

          <div className="mt-12 space-y-12 text-base leading-relaxed text-muted">
            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">1. Introduction</h2>
              <p>
                This Privacy Policy describes how SynthPress (&ldquo;SynthPress,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;)
                collects, uses, and shares information when you use our website, products, and services (together,
                the &ldquo;Service&rdquo;). By using the Service, you agree to the collection and use of information
                in accordance with this policy.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">2. Information we collect</h2>
              <p>
                We collect information you provide directly, information collected automatically, and information
                from third parties.
              </p>
              <ul className="mt-4 ml-6 list-disc space-y-2">
                <li>
                  <strong className="text-foreground">Account information:</strong> name, email address, and
                  authentication identifiers when you sign up.
                </li>
                <li>
                  <strong className="text-foreground">Connected sites:</strong> URLs and credentials (encrypted at
                  rest) for the WordPress sites you connect to SynthPress.
                </li>
                <li>
                  <strong className="text-foreground">Generated content:</strong> the prompts you submit and the
                  articles, images, and metadata produced on your behalf.
                </li>
                <li>
                  <strong className="text-foreground">Usage data:</strong> pages viewed, features used, and generation
                  logs to operate and improve the Service.
                </li>
                <li>
                  <strong className="text-foreground">Billing information:</strong> processed by our payment provider
                  (Stripe). We do not store full payment card details.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">3. How we use information</h2>
              <p>We use the information we collect to:</p>
              <ul className="mt-4 ml-6 list-disc space-y-2">
                <li>Provide, maintain, and improve the Service.</li>
                <li>Process payments, manage subscriptions, and deliver receipts.</li>
                <li>Communicate with you about product updates, security alerts, and support requests.</li>
                <li>Detect, prevent, and address fraud, abuse, and security incidents.</li>
                <li>Comply with legal obligations and enforce our Terms of Service.</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">4. Information sharing</h2>
              <p>
                We do not sell your personal information. We share information only with the following categories of
                recipients, and only as necessary:
              </p>
              <ul className="mt-4 ml-6 list-disc space-y-2">
                <li>
                  <strong className="text-foreground">Service providers</strong> who help us operate the Service —
                  including hosting (Vercel, Supabase), payment processing (Stripe), and AI model providers (OpenAI,
                  Anthropic) for content generation.
                </li>
                <li>
                  <strong className="text-foreground">Legal authorities</strong> when required by law or to respond to
                  valid legal process.
                </li>
                <li>
                  <strong className="text-foreground">Business transfers</strong> in connection with a merger,
                  acquisition, or sale of assets, in which case we will notify you in advance.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">5. Data retention</h2>
              <p>
                We retain your information for as long as your account is active or as needed to provide the Service.
                You can request deletion of your account at any time, after which we will delete or anonymize your
                personal information within 30 days, except where retention is required by law.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">6. Your rights</h2>
              <p>
                Depending on where you live, you may have the right to access, correct, delete, or export the personal
                information we hold about you, and to object to or restrict certain processing. To exercise these
                rights, email us at{" "}
                <a
                  href="mailto:privacy@synthpress.app"
                  className="font-medium text-brand-blue transition-colors hover:text-brand-indigo"
                >
                  privacy@synthpress.app
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">7. Cookies and tracking</h2>
              <p>
                We use cookies and similar technologies to keep you signed in, remember your preferences, and measure
                product usage. You can disable cookies in your browser settings, but parts of the Service may not
                function correctly without them.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">8. Security</h2>
              <p>
                We use industry-standard safeguards — including encryption in transit and at rest, access controls,
                and regular security reviews — to protect your information. No method of transmission or storage is
                100% secure, but we work hard to minimize risk.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">9. International transfers</h2>
              <p>
                We are based in the United States and may transfer, store, and process your information in countries
                other than your own. We rely on appropriate safeguards (such as Standard Contractual Clauses) to
                protect personal information transferred internationally.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">10. Children&apos;s privacy</h2>
              <p>
                The Service is not directed to children under 13, and we do not knowingly collect personal information
                from them. If you believe a child has provided us with personal information, please contact us so we
                can delete it.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">11. Changes to this policy</h2>
              <p>
                We may update this Privacy Policy from time to time. If we make material changes, we will notify you
                by email or through the Service before the changes take effect. The &ldquo;Last updated&rdquo; date at
                the top of this page reflects the most recent revision.
              </p>
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold text-foreground">12. Contact us</h2>
              <p>
                If you have questions about this Privacy Policy or our practices, email us at{" "}
                <a
                  href="mailto:privacy@synthpress.app"
                  className="font-medium text-brand-blue transition-colors hover:text-brand-indigo"
                >
                  privacy@synthpress.app
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
