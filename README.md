# MIS LMS – Dept. of MIS, University of Dhaka

This repository is **MIS LMS 2.0**, an independent evolution of the original
departmental LMS:

- **2.0 repository:** https://github.com/TalhaZabir/mis-lms-2.0
- **Original repository:** https://github.com/TalhaZabir/mis-lms-du (preserved)
- **Original production:** `mis-lms-web.onrender.com` / `mis-lms-api.onrender.com`

The original production site, Render services, Neon database and records are **not
modified or deployed by this repository**. The existing visual identity — fonts,
colours, typography, branding, logo, navigation, layouts, component styles and
responsive behaviour — is preserved. Changes add only functional UI.

## 2.0 highlights

- Hardened sessions: server-side revocable sessions, logout, session listing and
  per-session revocation.
- Centralized RBAC/ABAC with offering scoping, IDOR fixes and role-escalation guards.
- API-first contracts, `/v1` aliases, OpenAPI at `/openapi.json`, request ids,
  consistent error envelopes and idempotency keys.
- Transactional outbox events, notification fan-out with deduplication and a DB-backed
  job queue with retries/backoff and an optional standalone worker.
- Permission-aware global search across courses, resources, people, posts and approved
  knowledge, plus facets and suggestions.
- Administrator/offering analytics and advisory learner degree progress, GPA,
  prerequisites and an iCalendar feed.
- Optional, read-only AI assistant with provider abstraction, authorization-first RAG,
  citations, guardrails, budgets, usage, feedback and a deterministic evaluation
  harness.
- Notification bell and feature-flagged assistant link/search added to the existing
  navigation.
- Security, AI, realtime and safe-default tests; CI with no deployment step;
  Dependabot; deployment and security documentation.

## Quick start

```bash
npm install
copy .env.example .env      # Windows; cp on macOS/Linux
npx prisma generate --schema=prisma/schema.prisma
npm run db:push
npm run db:seed
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:4000
- Health: http://localhost:4000/health
- OpenAPI: http://localhost:4000/openapi.json

Demo logins use password `mis123`:

| Role | Email |
| --- | --- |
| Chairman / super admin | `chairman@mis.du.ac.bd` |
| Faculty | `faculty@mis.du.ac.bd` |
| Student | `student@mis.du.ac.bd` |
| Alumni | `alumni@mis.du.ac.bd` |

## Scripts

```bash
npm run dev                 # API + web
npm test                    # reset prisma/test.db, seed, run API tests
npm run ai:eval             # disposable eval.db, mock provider, 12 cases
npm run build               # production web build
npm run db:push             # apply Prisma schema (development)
npm run db:seed             # demo data (never against production)
npm run start:api
npm run start:worker        # optional standalone worker
npm run db:schema:postgres  # generate the gitignored Postgres schema
```

## Safe defaults

- `ALLOW_PUBLIC_REGISTRATION=false`
- `AI_ENABLED=false`; the assistant is disabled until explicitly enabled.
- AI tools are read-only and cannot change grades, publish results, delete records or
  change permissions.
- `WORKERS_INLINE=true` and `EVENTS_INLINE=true` for a single process.
- Production requires a strong `JWT_SECRET`, exact `CORS_ORIGINS` and a
  `METRICS_TOKEN`.

## Documentation

- [Audit of the original codebase](docs/2.0/AUDIT.md)
- [Architecture](docs/2.0/ARCHITECTURE.md)
- [Technology radar](docs/2.0/TECH-RADAR.md)
- [API contract](docs/2.0/API.md)
- [Security model](docs/2.0/SECURITY.md)
- [Deployment guide](docs/2.0/DEPLOYMENT.md)
- [AI and RAG](docs/2.0/AI.md)
- [Roadmap](docs/2.0/ROADMAP.md)
- [ADRs](docs/2.0/adr)
- [Non-active Render example](docs/2.0/render.example.yaml)

## Architecture at a glance

Modular monolith:

- `apps/web` — Next.js 14 App Router client.
- `apps/api/src/core` — config, auth, access control, validation, errors, logging,
  metrics, events, jobs, idempotency, notifications, realtime, audit and URL safety.
- `apps/api/src/modules` — identity, academic, learning, community, resources, search,
  analytics and AI.
- `prisma/schema.prisma` — source of truth for SQLite development and the generated
  PostgreSQL schema.
- `prisma/seed.js` — demo data and approved knowledge corpus.
- `apps/api/test` — security, AI, realtime and safe-default suites.

The original 1.0 build remains useful as historical context: monorepo foundation,
faculty tools, student portal, MIS Connect and Resource Corner. Those features are
preserved and hardened rather than replaced.

## CI and deployment

`.github/workflows/ci.yml` runs tests, the AI evaluation and the web build with
read-only repository permissions. It contains **no deploy, Render, SSH or registry
step** and cannot trigger a production deployment.

`docs/2.0/render.example.yaml` is intentionally not named `render.yaml` and uses
`autoDeployTrigger: off`. Do not apply it to the original production services or reuse
the production database. See [docs/2.0/DEPLOYMENT.md](docs/2.0/DEPLOYMENT.md) for the
manual, backup-first migration path.

## Original 1.0 scope (preserved)

The original five-part build covered:

1. Foundation: monorepo, schema, auth/RBAC, academic structure, admin UI/API, seed.
2. Faculty tools: modules/lessons, assignments, grading, banks/quizzes, attendance,
   gradebook, live classes.
3. Student portal: courses, learn view, submissions, attempts, attendance, routine,
   results.
4. MIS Connect: feed, moderation, alumni directory, mentorship, chat.
5. Resource Corner: suggestions, curator queue, voting/bookmarks, notifications, PWA,
   Docker support.

Roles remain: `SUPER_ADMIN`, `ADMIN_STAFF`, `FACULTY`, `TA`, `STUDENT`, `ALUMNI`,
`MODERATOR`. The UI hides unavailable sections; the API enforces the same rules.

## Known limitation

`npm audit` currently reports a high-severity advisory in the Next.js 14 dependency
tree. A major framework upgrade needs a planned visual and functional review; do not
run `npm audit fix --force` blindly. See the security document for the current risk
register.
