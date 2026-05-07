import { ComingSoonPanel } from "@/components/molecules/ComingSoonPanel";

export const dynamic = "force-dynamic";

export default function BlogQueuePage() {
  return (
    <ComingSoonPanel
      title="Queue"
      description="Track everything autopilot is doing — upcoming generations, drafts waiting on review, posts scheduled to publish, and any failed jobs you need to look at."
      bullets={[
        "Upcoming generated posts",
        "Posts waiting for review",
        "Posts scheduled to publish",
        "Failed generation and publishing jobs",
      ]}
    />
  );
}
