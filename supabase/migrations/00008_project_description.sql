-- ============================================================================
-- Add a project description so the project homepage has copy to render.
-- ============================================================================

alter table public.projects
  add column description text not null default '';
