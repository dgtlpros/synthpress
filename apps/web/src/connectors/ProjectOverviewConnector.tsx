"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { deleteProject, updateProjectSettings } from "@/actions/workspace";
import type { BlogListRow } from "@/services/workspace-service";
import { Button } from "@/components/atoms/Button";
import { DeleteConfirmModal } from "@/components/atoms/DeleteConfirmModal";
import { CreateAppChoiceModal } from "@/components/molecules/CreateAppChoiceModal";
import { EditProjectSettingsModal } from "@/components/molecules/EditProjectSettingsModal";
import {
  ProjectInstalledAppList,
  type ProjectInstalledAppListItem,
} from "@/components/molecules/ProjectInstalledAppList";
import { ProjectPageHeader } from "@/components/molecules/ProjectPageHeader";
import { roleCan, type TeamRole } from "@/lib/team-roles";

export interface ProjectOverviewConnectorProps {
  teamId: string;
  projectId: string;
  teamName: string;
  projectName: string;
  projectDescription: string;
  blogs: BlogListRow[];
  currentUserRole: TeamRole;
}

export function ProjectOverviewConnector({
  teamId,
  projectId,
  teamName,
  projectName,
  projectDescription,
  blogs,
  currentUserRole,
}: ProjectOverviewConnectorProps) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(projectName);
  const [descDraft, setDescDraft] = useState(projectDescription);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const canDelete = roleCan(currentUserRole, "delete_project");

  useEffect(() => {
    if (!settingsOpen) {
      setNameDraft(projectName);
      setDescDraft(projectDescription);
    }
  }, [projectName, projectDescription, settingsOpen]);

  const blogBase = `/teams/${teamId}/projects/${projectId}/blogs`;

  const appItems: ProjectInstalledAppListItem[] = useMemo(
    () =>
      blogs.map((b) => ({
        id: b.id,
        href: `${blogBase}/${b.id}`,
        appKindLabel: "Blog",
        title: b.name,
        subtitle: b.wp_url,
        isActive: b.is_active,
        meta: `${b.articles_per_day} article(s) per day${b.niche?.trim() ? ` · ${b.niche.trim()}` : ""}`,
      })),
    [blogs, blogBase],
  );

  function openSettings() {
    setNameDraft(projectName);
    setDescDraft(projectDescription);
    setError(null);
    setSettingsOpen(true);
  }

  function saveSettings() {
    setError(null);
    startTransition(async () => {
      const result = await updateProjectSettings(teamId, projectId, {
        name: nameDraft,
        description: descDraft,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSettingsOpen(false);
      router.refresh();
    });
  }

  function handleDeleteProject() {
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteProject(teamId, projectId);
      if (result.error) {
        setDeleteError(result.error);
        setDeleteOpen(false);
        return;
      }
      router.push(`/teams/${teamId}/projects`);
    });
  }

  return (
    <>
      <ProjectPageHeader
        projectName={projectName}
        teamName={teamName}
        descriptionPreview={projectDescription}
        onOpenSettings={openSettings}
      />

      {deleteError ? (
        <p className="text-sm text-error" role="alert">
          {deleteError}
        </p>
      ) : null}

      <section aria-labelledby="apps-heading" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="apps-heading" className="text-base font-semibold text-foreground">
              Installed apps
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              Each row is one installed app instance (for example, one Blog per WordPress site). Open a row
              for that app&apos;s settings.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 self-start sm:self-auto">
            {canDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="cursor-pointer text-error hover:bg-error/10 border border-error/30"
                loading={isDeleting}
                onClick={() => setDeleteOpen(true)}
              >
                Delete project
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="cursor-pointer"
              onClick={() => setCreateOpen(true)}
            >
              Create app
            </Button>
          </div>
        </div>
        <ProjectInstalledAppList items={appItems} />
      </section>

      <EditProjectSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectName={nameDraft}
        description={descDraft}
        onProjectNameChange={setNameDraft}
        onDescriptionChange={setDescDraft}
        errorMessage={error}
        pending={pending}
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" loading={pending} onClick={saveSettings}>
              Save
            </Button>
          </>
        }
      />

      <CreateAppChoiceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        blogSetupHref={blogBase}
        onAfterChooseBlog={() => setCreateOpen(false)}
      />

      <DeleteConfirmModal
        open={deleteOpen}
        entityKind="project"
        requiredPhrase={projectName}
        loading={isDeleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDeleteProject}
      />
    </>
  );
}
