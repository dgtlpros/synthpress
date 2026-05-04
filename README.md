# SynthPress

Monorepo for the SynthPress platform — AI-powered content generation and publishing across a network of WordPress sites syndicated to MSN.

```
SynthPress Dashboard (Next.js)
  │  generates AI articles, uploads images, publishes via REST API
  ▼
WordPress on Kinsta (20 sites)
  │  auto-syndicates via MSN-compliant RSS feed
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

The Next.js application that powers the entire content pipeline. Generates AI articles, manages WordPress site connections, uploads featured images, and publishes across the network from a single dashboard.

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
| [Publishing API Spec](docs/PUBLISHING-API-SPEC.md) | Exactly how SynthPress publishes to WordPress — every API call, content rules, image handling, and what WordPress automates |
| [Dashboard Build Spec](docs/SYNTHPRESS-DASHBOARD-SPEC.md) | Full spec for the Next.js dashboard — data model, routes, AI pipeline, and MVP scope |
| [Kinsta Setup Playbook](docs/KINSTA-SETUP-PLAYBOOK.md) | Step-by-step guide to build the golden template WordPress site on Kinsta and clone it across the network |
| [WordPress Content](wordpress/wp-content/README.md) | What lives in the `wp-content` boilerplate — themes, plugins, mu-plugins |

---

## How It Works

The platform has two halves that work together:

**SynthPress Dashboard (Next.js)** — The content engine. Connects to every WordPress site via REST API, generates AI articles with configurable prompts per niche, uploads featured images, and publishes on a per-project schedule. This is what we build and maintain in `apps/web/`.

**WordPress sites (Kinsta)** — 20 identical WordPress installs, each targeting a different niche. Once the dashboard publishes a post, the WordPress side handles everything else automatically: MSN syndication meta, feed generation, SEO, and cache purging.

```
SynthPress Dashboard                    WordPress Site (Kinsta)
┌──────────────────┐                    ┌──────────────────────────────┐
│ Generate article │                    │ auto-enable-msn mu-plugin   │
│ Upload image     │───POST /media───▶  │  └─ set syndication meta     │
│ Publish post     │───POST /posts───▶  │ featured-image-requirement   │
│ Track status     │                    │  └─ block publish w/o image │
└──────────────────┘                    │ msn-syndication-2 plugin    │
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
