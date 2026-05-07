"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  createBlog,
  deleteProject,
  updateProjectSettings,
} from "@/actions/workspace";
import type { BlogListRow } from "@/services/workspace-service";
import { Button } from "@/components/atoms/Button";
import { DeleteConfirmModal } from "@/components/atoms/DeleteConfirmModal";
import {
  CreateAppChoiceModal,
  type CreateAppChoiceModalStep,
} from "@/components/molecules/CreateAppChoiceModal";
import { EditProjectSettingsModal } from "@/components/molecules/EditProjectSettingsModal";
import {
  ProjectInstalledAppList,
  type ProjectInstalledAppListItem,
} from "@/components/molecules/ProjectInstalledAppList";
import { ProjectPageHeader } from "@/components/molecules/ProjectPageHeader";
import { roleCan, type TeamRole } from "@/lib/team-roles";

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

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
  const [createStep, setCreateStep] =
    useState<CreateAppChoiceModalStep>("choose");
  const [blogNameDraft, setBlogNameDraft] = useState("");
  const [createBlogError, setCreateBlogError] = useState<string | null>(null);
  const [isCreatingBlog, startCreateBlogTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(projectName);
  const [descDraft, setDescDraft] = useState(projectDescription);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const canDelete = roleCan(currentUserRole, "delete_project");

  if (!settingsOpen) {
    if (nameDraft !== projectName || descDraft !== projectDescription) {
      setNameDraft(projectName);
      setDescDraft(projectDescription);
    }
  }

  const blogBase = `/teams/${teamId}/projects/${projectId}/blogs`;

  const appItems: ProjectInstalledAppListItem[] = useMemo(
    () =>
      blogs.map((b) => {
        const description = b.description?.trim();
        const niche = b.niche?.trim();
        const subtitle =
          description ||
          niche ||
          "Configure tone, audience, and AI rules in settings.";
        const metaParts: string[] = [];
        if (niche && description) metaParts.push(niche);
        if (b.wp_url) metaParts.push(`WordPress · ${stripScheme(b.wp_url)}`);
        return {
          id: b.id,
          href: `${blogBase}/${b.id}`,
          appKindLabel: "Blog",
          title: b.name,
          subtitle,
          isActive: b.is_active,
          meta: metaParts.length ? metaParts.join(" · ") : undefined,
        };
      }),
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

  function openCreateApp() {
    setCreateStep("choose");
    setBlogNameDraft("");
    setCreateBlogError(null);
    setCreateOpen(true);
  }

  function closeCreateApp() {
    setCreateOpen(false);
    setCreateStep("choose");
    setBlogNameDraft("");
    setCreateBlogError(null);
  }

  function handleCreateBlog() {
    const trimmed = blogNameDraft.trim();
    if (!trimmed) {
      setCreateBlogError("Blog name is required.");
      return;
    }
    setCreateBlogError(null);
    startCreateBlogTransition(async () => {
      const result = await createBlog({
        teamId,
        projectId,
        name: trimmed,
      });
      if (!result.data) {
        setCreateBlogError(result.error ?? "Could not create blog.");
        return;
      }
      closeCreateApp();
      router.push(`${blogBase}/${result.data.id}`);
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
            <h2
              id="apps-heading"
              className="text-base font-semibold text-foreground"
            >
              Installed apps
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              Each row is one installed app instance (for example, one Blog per
              WordPress site). Open a row for that app&apos;s settings.
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
              onClick={openCreateApp}
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => setSettingsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              loading={pending}
              onClick={saveSettings}
            >
              Save
            </Button>
          </>
        }
      />

      <CreateAppChoiceModal
        open={createOpen}
        onClose={closeCreateApp}
        step={createStep}
        onChooseBlog={() => setCreateStep("name")}
        onBack={() => {
          setCreateStep("choose");
          setCreateBlogError(null);
        }}
        blogName={blogNameDraft}
        onBlogNameChange={setBlogNameDraft}
        onCreateBlog={handleCreateBlog}
        pending={isCreatingBlog}
        errorMessage={createBlogError}
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
