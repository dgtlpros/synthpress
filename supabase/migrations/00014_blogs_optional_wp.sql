-- ============================================================================
-- Make WordPress connection fields on `blogs` optional.
--
-- A "Blog" app can now be created with just a name; users opt-in to wiring
-- up a WordPress site afterward from the blog's settings page. NULL on any
-- of these three columns means the blog is not yet connected to WordPress.
--
-- We intentionally keep the columns as the canonical home for credentials
-- (rather than splitting them into a sibling `wp_connections` table) since
-- the project-architecture rule prefers thin server actions over premature
-- normalization. A future migration can split if multiple connections per
-- blog is ever needed.
-- ============================================================================

alter table public.blogs
  alter column wp_url drop not null,
  alter column wp_username drop not null,
  alter column wp_app_password drop not null;
