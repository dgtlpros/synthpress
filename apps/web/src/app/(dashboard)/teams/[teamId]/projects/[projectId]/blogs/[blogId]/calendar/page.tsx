import { ComingSoonPanel } from "@/components/molecules/ComingSoonPanel";

export const dynamic = "force-dynamic";

export default function BlogCalendarPage() {
  return (
    <ComingSoonPanel
      title="Calendar"
      description="Visualize your publishing cadence at a glance. Drag to reschedule posts, spot gaps, and balance your week."
      bullets={[
        "Month, week, and day views",
        "Drag-and-drop to reschedule",
        "Color-coded by status and destination",
        "Export to ICS",
      ]}
    />
  );
}
