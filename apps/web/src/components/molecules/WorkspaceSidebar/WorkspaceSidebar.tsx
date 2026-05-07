"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/atoms/Avatar";

export interface WorkspaceSidebarProject {
  id: string;
  name: string;
  teamId: string;
}

export interface WorkspaceSidebarTeam {
  id: string;
  name: string;
  projects: WorkspaceSidebarProject[];
}

export interface WorkspaceSidebarProps {
  teams: WorkspaceSidebarTeam[];
  email?: string | null;
  onItemClick?: () => void;
  className?: string;
}

function teamInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  return t.charAt(0).toUpperCase();
}

function SettingsGearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function UsageBarsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 16V10" />
      <path d="M10 16V5" />
      <path d="M16 16v-8" />
      <path d="M3 17h14" />
    </svg>
  );
}

function activeTeamIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/teams\/([^/]+)/);
  return m?.[1] ?? null;
}

function activeProjectIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/teams\/[^/]+\/projects\/([^/]+)/);
  return m?.[1] ?? null;
}

/** Primary nav rows + nested project links — shared shape, hover, pointer, theme-aligned accents. */
const sidebarNavRow =
  "flex cursor-pointer items-center gap-2 rounded-[var(--sp-radius-lg)] px-2.5 py-2 text-sm font-medium transition-colors duration-150";

/** Active: light brand wash + slim inset gradient bar (matches marketing gradients, lighter than a full border). */
const sidebarNavActive =
  "relative text-foreground bg-gradient-to-r from-brand-indigo/[0.07] via-brand-blue/[0.05] to-transparent pl-3 before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-gradient-accent before:content-['']";

const sidebarNavInactive =
  "pl-3 text-muted hover:bg-surface-hover hover:text-foreground";

const sidebarSectionLabel =
  "mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted";

const sidebarSubsectionLabel =
  "mb-1.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted";

const sidebarListboxOption =
  "flex w-full cursor-pointer items-center gap-2 py-2 pl-3 pr-2.5 text-sm font-medium transition-colors duration-150";

export function WorkspaceSidebar({
  teams,
  email,
  onItemClick,
  className,
}: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const activeTeamId = activeTeamIdFromPath(pathname);
  const activeProjectId = activeProjectIdFromPath(pathname);

  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const teamPickerRef = useRef<HTMLLIElement>(null);

  const dashboardActive = pathname === "/dashboard" || pathname === "/";
  const accountActive = pathname?.startsWith("/account") ?? false;
  const teamsRootActive = pathname === "/teams";

  const sortedTeams = useMemo(
    () =>
      [...teams].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [teams],
  );

  const activeTeam = useMemo(
    () =>
      activeTeamId
        ? (sortedTeams.find((t) => t.id === activeTeamId) ?? null)
        : null,
    [activeTeamId, sortedTeams],
  );

  const projectsForSidebar = activeTeam?.projects ?? [];

  useEffect(() => {
    if (!teamPickerOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const el = teamPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setTeamPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setTeamPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [teamPickerOpen]);

  function pickTeam() {
    setTeamPickerOpen(false);
    onItemClick?.();
  }

  function selectManageLink() {
    setTeamPickerOpen(false);
    onItemClick?.();
  }

  return (
    <aside
      className={cn(
        "flex w-64 flex-col border-r border-border bg-background",
        className,
      )}
      aria-label="Primary navigation"
    >
      <div className="flex h-16 items-center border-b border-border/80 bg-surface/90 px-5 backdrop-blur-sm">
        <NextLink
          href="/"
          className="flex cursor-pointer items-center"
          onClick={onItemClick}
          aria-label="Go to home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/synthpress-full-logo.svg"
            alt="SynthPress"
            className="h-11 w-auto"
          />
        </NextLink>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav
          className="flex-1 space-y-5 p-3 sm:p-4"
          aria-label="Main navigation"
        >
          <div>
            <p className={sidebarSectionLabel}>Workspace</p>
            <ul className="space-y-0.5">
              <li>
                <NextLink
                  href="/dashboard"
                  onClick={onItemClick}
                  className={cn(
                    sidebarNavRow,
                    dashboardActive ? sidebarNavActive : sidebarNavInactive,
                  )}
                  aria-current={dashboardActive ? "page" : undefined}
                >
                  Dashboard
                </NextLink>
              </li>
            </ul>
          </div>

          <div>
            <p className={sidebarSectionLabel}>Team</p>
            <ul className="space-y-1.5">
              <li>
                <NextLink
                  href="/teams"
                  onClick={onItemClick}
                  className={cn(
                    sidebarNavRow,
                    teamsRootActive ? sidebarNavActive : sidebarNavInactive,
                  )}
                  aria-current={teamsRootActive ? "page" : undefined}
                >
                  All teams
                </NextLink>
              </li>

              {sortedTeams.length > 0 ? (
                <li className="relative" ref={teamPickerRef}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[var(--sp-radius-lg)] border border-border/90 bg-surface px-2.5 py-2 text-left text-sm font-medium text-foreground shadow-[var(--sp-shadow-sm)] transition-all duration-150 hover:border-border-hover hover:bg-surface-hover hover:shadow-[var(--sp-shadow-md)]",
                      activeTeam &&
                        !teamsRootActive &&
                        "border-brand-blue/20 ring-1 ring-brand-blue/[0.08]",
                      teamPickerOpen &&
                        "border-brand-blue/25 ring-1 ring-brand-blue/10",
                    )}
                    aria-label="Choose or switch team"
                    aria-expanded={teamPickerOpen}
                    aria-haspopup="menu"
                    aria-controls="workspace-team-picker"
                    onClick={() => setTeamPickerOpen((o) => !o)}
                  >
                    <Avatar
                      fallback={teamInitial(activeTeam?.name ?? "Team")}
                      size="sm"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate normal-case tracking-normal">
                      {activeTeam ? activeTeam.name : "Select a team"}
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted transition-transform",
                        teamPickerOpen && "rotate-180",
                      )}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        d="M6 9l6 6 6-6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>

                  {teamPickerOpen ? (
                    <div
                      id="workspace-team-picker"
                      className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[var(--sp-radius-lg)] border border-border/90 bg-surface shadow-[var(--sp-shadow-lg)] ring-1 ring-black/[0.03] dark:ring-white/[0.04]"
                    >
                      <div
                        role="listbox"
                        aria-label="Switch team"
                        className="max-h-56 overflow-auto py-1"
                      >
                        <p
                          className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted"
                          aria-hidden="true"
                        >
                          Teams
                        </p>
                        {sortedTeams.map((team) => {
                          const selected = team.id === activeTeamId;
                          return (
                            <NextLink
                              key={team.id}
                              href={`/teams/${team.id}/projects`}
                              role="option"
                              aria-selected={selected}
                              className={cn(
                                sidebarListboxOption,
                                selected
                                  ? "relative bg-gradient-to-r from-brand-indigo/[0.06] to-transparent text-foreground before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-gradient-accent before:content-['']"
                                  : "text-muted hover:bg-surface-hover hover:text-foreground",
                              )}
                              onClick={pickTeam}
                            >
                              <Avatar
                                fallback={teamInitial(team.name)}
                                size="sm"
                                className="shrink-0"
                              />
                              <span className="truncate">{team.name}</span>
                            </NextLink>
                          );
                        })}
                      </div>

                      {activeTeam ? (
                        <div
                          role="group"
                          aria-label={`Manage ${activeTeam.name}`}
                          className="border-t border-border/70 py-1"
                        >
                          <p
                            className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted"
                            aria-hidden="true"
                          >
                            Manage{" "}
                            <span className="normal-case tracking-normal text-foreground/80">
                              {activeTeam.name}
                            </span>
                          </p>
                          <NextLink
                            href={`/teams/${activeTeam.id}/settings`}
                            onClick={selectManageLink}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-surface-hover hover:text-foreground"
                          >
                            <SettingsGearIcon className="h-4 w-4 shrink-0" />
                            <span>Settings</span>
                          </NextLink>
                          <NextLink
                            href={`/teams/${activeTeam.id}/usage`}
                            onClick={selectManageLink}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-surface-hover hover:text-foreground"
                          >
                            <UsageBarsIcon className="h-4 w-4 shrink-0" />
                            <span>Usage</span>
                          </NextLink>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ) : (
                <li className="px-2.5 py-2 text-sm text-muted">
                  No teams yet — create one from All teams.
                </li>
              )}

              {activeTeam ? (
                <li>
                  <p className={sidebarSubsectionLabel}>Projects</p>
                  <ul
                    className="ml-0.5 space-y-0.5 border-l border-brand-blue/[0.12] pl-2.5 dark:border-brand-blue/20"
                    role="list"
                  >
                    {projectsForSidebar.length === 0 ? (
                      <li className="px-2.5 py-2 text-sm text-muted">
                        No projects yet
                      </li>
                    ) : (
                      projectsForSidebar.map((p) => {
                        const href = `/teams/${activeTeam.id}/projects/${p.id}`;
                        const projectActive = activeProjectId === p.id;
                        return (
                          <li key={p.id}>
                            <NextLink
                              href={href}
                              onClick={onItemClick}
                              className={cn(
                                sidebarNavRow,
                                "min-w-0 truncate",
                                projectActive
                                  ? sidebarNavActive
                                  : sidebarNavInactive,
                              )}
                              aria-current={projectActive ? "page" : undefined}
                            >
                              <span className="min-w-0 truncate">{p.name}</span>
                            </NextLink>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </li>
              ) : null}
            </ul>
          </div>

          <div>
            <p className={sidebarSectionLabel}>Account</p>
            <ul className="space-y-0.5">
              <li>
                <NextLink
                  href="/account"
                  onClick={onItemClick}
                  className={cn(
                    sidebarNavRow,
                    accountActive ? sidebarNavActive : sidebarNavInactive,
                  )}
                  aria-current={accountActive ? "page" : undefined}
                >
                  Account
                </NextLink>
              </li>
            </ul>
          </div>
        </nav>
      </div>

      {email ? (
        <div className="border-t border-border/80 p-3">
          <div className="rounded-[var(--sp-radius-lg)] border border-border/70 bg-surface px-3 py-2.5 shadow-[var(--sp-shadow-sm)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Signed in
            </p>
            <p
              className="mt-1 truncate text-xs text-foreground/90"
              title={email}
            >
              {email}
            </p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
