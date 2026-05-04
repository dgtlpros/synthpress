# SynthPress

Monorepo for the SynthPress platform — AI-powered content generation and publishing across a network of WordPress sites syndicated to MSN.

```
Confleko / SynthPress Dashboard (AI)
  │
  ▼
WordPress on Kinsta (20 sites)
  │
  ▼
MSN Partner Hub → MSN.com / Edge / Bing
```

---

## Repository Structure

```
synthpress/
├── apps/
│   └── web/                 # SynthPress Dashboard (Next.js)
├── wordpress/
│   └── wp-content/          # WordPress content boilerplate (source of truth)
│       ├── themes/
│       ├── plugins/
│       └── mu-plugins/
├── packages/                # Shared packages (future)
└── docs/                    # Documentation
```

### [`apps/web/`](apps/web/) — SynthPress Dashboard

The Next.js application that replaces Confleko as the AI content engine. Generates articles, manages WordPress connections, and publishes to the site network from a single dashboard.

- **Stack**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Run locally**: `pnpm dev` from the repo root

### [`wordpress/wp-content/`](wordpress/wp-content/) — WordPress Content Boilerplate

The canonical `wp-content` directory shared across all 20 WordPress sites on Kinsta. Contains custom plugins, mu-plugins, and theme configurations that every site in the network needs. Copy this into any new Kinsta site to bring it up to spec.

### [`packages/`](packages/) — Shared Packages

Reserved for shared code across the monorepo (UI components, utility libraries, TypeScript configs, etc.).

---

## Documentation

| Doc | What it covers |
|---|---|
| [Dashboard Build Spec](docs/SYNTHPRESS-DASHBOARD-SPEC.md) | Full spec for the Next.js dashboard — data model, routes, AI pipeline, WordPress REST API integration, and MVP scope |
| [Kinsta Setup Playbook](docs/KINSTA-SETUP-PLAYBOOK.md) | Step-by-step guide to build the golden template WordPress site on Kinsta and clone it across the network |
| [WordPress Content](wordpress/wp-content/README.md) | What lives in the `wp-content` boilerplate — themes, plugins, mu-plugins |

---

## How It Works

The platform has two halves that work together:

**WordPress sites (Kinsta)** — 20 identical WordPress installs, each targeting a different niche. They handle publishing, MSN syndication, image rehosting, SEO, and feed generation automatically via plugins and mu-plugins.

**SynthPress Dashboard (Next.js)** — The content engine. Connects to every WordPress site via REST API, generates AI articles, uploads featured images, and publishes on a per-project schedule.

```
SynthPress Dashboard                    WordPress Site (Kinsta)
┌──────────────────┐                    ┌──────────────────────────────┐
│ Generate article │                    │ confleko-2 plugin            │
│ Generate image   │───POST /media───▶  │  └─ rehost images locally   │
│ Publish post     │───POST /posts───▶  │ auto-enable-msn mu-plugin   │
│ Track status     │                    │  └─ set syndication meta     │
└──────────────────┘                    │ featured-image-requirement   │
                                        │  └─ block publish w/o image │
                                        │ msn-syndication-2 plugin    │
                                        │  └─ /feed/msn:article       │
                                        └──────────────┬───────────────┘
                                                       │
                                                       ▼
                                                MSN Partner Hub
                                            (auto-publish to MSN)
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+

### Install dependencies

```bash
pnpm install
```

### Development

```bash
pnpm dev        # Start the Next.js dev server
pnpm build      # Production build
pnpm lint       # Run ESLint across all workspaces
```

---

## Monorepo Tooling

| Tool | Purpose |
|---|---|
| [pnpm](https://pnpm.io/) | Package manager with workspace support |
| [Turborepo](https://turbo.build/) | Build orchestration, caching, task running |

Tasks are defined in [`turbo.json`](turbo.json) and run across all workspaces from the repo root.
