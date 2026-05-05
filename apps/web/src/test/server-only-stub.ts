// Aliased to `server-only` in vitest.config.ts. The real package throws when
// imported from a non-server context (which is the whole point — it's how
// Next.js fails the client build if a server module is ever bundled in).
// Tests don't go through Next.js bundling, so we substitute a no-op so the
// `import "server-only"` lines in services don't blow up Vitest.
export {};
