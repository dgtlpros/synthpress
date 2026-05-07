import { notFound, redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { BlogConnectionsConnector } from "@/connectors/BlogConnectionsConnector";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { Badge } from "@/components/atoms/Badge";

export const dynamic = "force-dynamic";

const FUTURE_INTEGRATIONS = [
  {
    name: "Webflow",
    description: "Push posts to your Webflow CMS collection.",
  },
  {
    name: "Ghost",
    description: "Publish drafts directly to Ghost.",
  },
  {
    name: "Shopify",
    description: "Publish to Shopify's blog.",
  },
  {
    name: "Medium",
    description: "Cross-post to Medium.",
  },
];

export default async function BlogConnectionsPage({
  params,
}: {
  params: Promise<{ teamId: string; projectId: string; blogId: string }>;
}) {
  const { teamId, projectId, blogId } = await params;

  const {
    data: { user },
  } = await getAuthUserOncePerResponse();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const { data: blog } = await supabase
    .from("blogs")
    .select("id, wp_url, wp_username, wp_app_password")
    .eq("id", blogId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!blog) notFound();

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          Publishing destinations
        </h2>
        <p className="text-sm text-muted">
          Connect a CMS to publish drafts directly. Connections are optional —
          you can keep generating posts here and copy them anywhere.
        </p>
      </section>

      <BlogConnectionsConnector
        teamId={teamId}
        projectId={projectId}
        blogId={blogId}
        initialUrl={blog.wp_url}
        initialUsername={blog.wp_username}
        hasStoredPassword={Boolean(blog.wp_app_password)}
      />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Coming soon
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FUTURE_INTEGRATIONS.map((i) => (
            <Card key={i.name} variant="default">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{i.name}</CardTitle>
                  <Badge size="sm" variant="default">
                    Soon
                  </Badge>
                </div>
                <CardDescription>{i.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted">
                  We&apos;ll let you know when this lands.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
