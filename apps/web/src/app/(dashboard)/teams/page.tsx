import { redirect } from "next/navigation";
import {
  createClient,
  getAuthUserOncePerResponse,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listTeamsForUserWithMeta,
  teamListPlanLabel,
} from "@/services/team-list-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/atoms/Card";
import { TeamListItem } from "@/components/molecules/TeamListItem";
import { CreateTeamForm } from "./create-team-form";

export const dynamic = "force-dynamic";

function ownerLabel(entry: { isOwner: boolean; ownerName: string }): string {
  if (entry.isOwner) return "You";
  return `Owned by ${entry.ownerName}`;
}

export default async function TeamsPage() {
  const {
    data: { user },
  } = await getAuthUserOncePerResponse();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { owned, joined } = await listTeamsForUserWithMeta(
    user.id,
    supabase,
    admin,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Teams</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Teams group people together. Inside a team you create projects (each
          project is a workspace for features like AI blogs). The team
          owner&apos;s subscription powers everyone&apos;s features and
          member-triggered jobs spend the owner&apos;s tokens.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New team</CardTitle>
          <CardDescription>
            You can belong to multiple teams. You will be the owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateTeamForm />
        </CardContent>
      </Card>

      <section aria-labelledby="teams-owned-heading" className="space-y-4">
        <h2
          id="teams-owned-heading"
          className="text-lg font-semibold text-foreground"
        >
          Teams you own
          <span className="ml-2 text-sm font-normal text-muted">
            ({owned.length})
          </span>
        </h2>
        {owned.length === 0 ? (
          <p className="text-sm text-muted">
            Create a team above to get started.
          </p>
        ) : (
          <ul className="space-y-2" role="list">
            {owned.map((team) => (
              <li key={team.id}>
                <TeamListItem
                  href={`/teams/${team.id}/projects`}
                  name={team.name}
                  ownerLabel={ownerLabel(team)}
                  ownerAvatarUrl={team.ownerAvatarUrl}
                  ownerInitials={team.ownerInitials}
                  memberCount={team.memberCount}
                  projectCount={team.projectCount}
                  planDisplayName={teamListPlanLabel(team.planKey)}
                  planStatus={team.planStatus}
                  balance={team.balance}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="teams-joined-heading" className="space-y-4">
        <h2
          id="teams-joined-heading"
          className="text-lg font-semibold text-foreground"
        >
          Teams you joined
          <span className="ml-2 text-sm font-normal text-muted">
            ({joined.length})
          </span>
        </h2>
        {joined.length === 0 ? (
          <p className="text-sm text-muted">
            You haven&apos;t joined any teams yet. Ask a team owner to send you
            an invite.
          </p>
        ) : (
          <ul className="space-y-2" role="list">
            {joined.map((team) => (
              <li key={team.id}>
                <TeamListItem
                  href={`/teams/${team.id}/projects`}
                  name={team.name}
                  ownerLabel={ownerLabel(team)}
                  ownerAvatarUrl={team.ownerAvatarUrl}
                  ownerInitials={team.ownerInitials}
                  memberCount={team.memberCount}
                  projectCount={team.projectCount}
                  planDisplayName={teamListPlanLabel(team.planKey)}
                  planStatus={team.planStatus}
                  balance={team.balance}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
