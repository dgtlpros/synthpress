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

export function WorkspaceSidebar({ teams, email, onItemClick, className }: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const activeTeamId = activeTeamIdFromPath(pathname);
  const activeProjectId = activeProjectIdFromPath(pathname);

  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const teamPickerRef = useRef<HTMLLIElement>(null);

  const dashboardActive = pathname === "/dashboard" || pathname === "/";
  const accountActive = pathname?.startsWith("/account") ?? false;
  const teamsRootActive = pathname === "/teams";

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [teams],
  );

  const activeTeam = useMemo(
    () => (activeTeamId ? sortedTeams.find((t) => t.id === activeTeamId) ?? null : null),
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
      if (e.key === "Escape") setTeamPickerOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [teamPickerOpen]);

  function closePickerAndMaybeNotify() {
    setTeamPickerOpen(false);
  }

  function pickTeam() {
    closePickerAndMaybeNotify();
    onItemClick?.();
  }

  return (
    <aside
      className={cn(
        "flex w-64 flex-col border-r border-border bg-surface",
        className,
      )}
      aria-label="Primary navigation"
    >
      <div className="flex h-16 items-center border-b border-border px-6">
        <NextLink
          href="/"
          className="flex items-center"
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
        <nav className="flex-1 space-y-6 p-4" aria-label="Workspace">
          <div>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Workspace
            </p>
            <ul className="space-y-0.5">
              <li>
                <NextLink
                  href="/dashboard"
                  onClick={onItemClick}
                  className={cn(
                    "flex items-center gap-2 rounded-[var(--sp-radius-lg)] px-3 py-2 text-sm font-medium transition-colors",
                    dashboardActive
                      ? "border-l-2 border-transparent bg-surface-active bg-gradient-to-r from-brand-blue/12 to-transparent pl-[10px] text-foreground"
                      : "border-l-2 border-transparent pl-[10px] text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                  aria-current={dashboardActive ? "page" : undefined}
                >
                  Dashboard
                </NextLink>
              </li>
            </ul>
          </div>

          <div>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Teams
            </p>
            <ul className="space-y-2">
              <li>
                <NextLink
                  href="/teams"
                  onClick={onItemClick}
                  className={cn(
                    "flex items-center gap-2 rounded-[var(--sp-radius-lg)] px-3 py-2 text-sm font-medium transition-colors",
                    teamsRootActive
                      ? "border-l-2 border-transparent bg-surface-active bg-gradient-to-r from-brand-blue/12 to-transparent pl-[10px] text-foreground"
                      : "border-l-2 border-transparent pl-[10px] text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                  aria-current={teamsRootActive ? "page" : undefined}
                >
                  Teams
                </NextLink>
              </li>

              {sortedTeams.length > 0 ? (
                <li className="relative" ref={teamPickerRef}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[var(--sp-radius-lg)] border border-border bg-surface px-2 py-2 text-left text-sm font-medium text-foreground shadow-sm transition-colors hover:border-border-hover hover:bg-surface-hover",
                      activeTeam && !teamsRootActive && "ring-1 ring-border-hover/80",
                    )}
                    aria-label="Choose or switch team"
                    aria-expanded={teamPickerOpen}
                    aria-haspopup="listbox"
                    aria-controls="workspace-team-picker"
                    onClick={() => setTeamPickerOpen((o) => !o)}
                  >
                    <Avatar
                      fallback={teamInitial(activeTeam?.name ?? "Team")}
                      size="sm"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {activeTeam ? activeTeam.name : "Select a team"}
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      className={cn("h-4 w-4 shrink-0 text-muted transition-transform", teamPickerOpen && "rotate-180")}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {teamPickerOpen ? (
                    <div
                      id="workspace-team-picker"
                      role="listbox"
                      aria-label="Switch team"
                      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-[var(--sp-radius-lg)] border border-border bg-surface py-1 shadow-[var(--sp-shadow-lg)]"
                    >
                      {sortedTeams.map((team) => {
                        const selected = team.id === activeTeamId;
                        return (
                          <NextLink
                            key={team.id}
                            href={`/teams/${team.id}/projects`}
                            role="option"
                            aria-selected={selected}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                              selected
                                ? "bg-surface-active font-medium text-foreground"
                                : "text-muted hover:bg-surface-hover hover:text-foreground",
                            )}
                            onClick={pickTeam}
                          >
                            <Avatar fallback={teamInitial(team.name)} size="sm" className="shrink-0" />
                            <span className="truncate">{team.name}</span>
                          </NextLink>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              ) : (
                <li className="px-1 text-xs text-muted">No teams yet — create one from Teams.</li>
              )}

              {activeTeam ? (
                <li>
                  <p className="mb-1.5 mt-3 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Projects in this team
                  </p>
                  <ul className="space-y-0.5 border-l border-border pl-2" role="list">
                    {projectsForSidebar.length === 0 ? (
                      <li className="py-1 text-xs text-muted">No projects yet</li>
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
                                "block truncate rounded-[var(--sp-radius-md)] px-2 py-1.5 text-xs font-medium transition-colors",
                                projectActive
                                  ? "border-l-2 border-brand-blue bg-surface-active pl-[6px] text-foreground"
                                  : "border-l-2 border-transparent pl-[6px] text-muted hover:bg-surface-hover hover:text-foreground",
                              )}
                              aria-current={projectActive ? "page" : undefined}
                            >
                              {p.name}
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
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Account
            </p>
            <ul className="space-y-0.5">
              <li>
                <NextLink
                  href="/account"
                  onClick={onItemClick}
                  className={cn(
                    "flex items-center gap-2 rounded-[var(--sp-radius-lg)] px-3 py-2 text-sm font-medium transition-colors",
                    accountActive
                      ? "border-l-2 border-transparent bg-surface-active bg-gradient-to-r from-brand-blue/12 to-transparent pl-[10px] text-foreground"
                      : "border-l-2 border-transparent pl-[10px] text-muted hover:bg-surface-hover hover:text-foreground",
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
        <div className="border-t border-border px-6 py-4">
          <p className="truncate text-xs text-muted" title={email}>
            {email}
          </p>
        </div>
      ) : null}
    </aside>
  );
}
