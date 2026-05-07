import { ComingSoonPanel } from "@/components/molecules/ComingSoonPanel";

export const dynamic = "force-dynamic";

export default function BlogAnalyticsPage() {
  return (
    <ComingSoonPanel
      title="Analytics"
      description="See how your AI-generated content is performing across destinations — pageviews, time on page, conversions, and SEO ranking trends."
      bullets={[
        "Pageviews and engagement per post",
        "Search rankings for target keywords",
        "Conversion attribution",
        "Per-persona performance",
      ]}
    />
  );
}
