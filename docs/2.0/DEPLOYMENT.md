# Deployment guide — MIS LMS 2.0

## Important scope

This repository is an independent 2.0 fork. Nothing in this guide should be run
against the original production Render services or Neon database. No deployment or
production migration was performed while building 2.0.

The original production site remains:

- web: `https://mis-lms-web.onrender.com`
- API: `https://mis-lms-api.onrender.com`

Do not point a new service at the existing production database, and do not connect the
2.0 repository to the existing Render services unless the owner explicitly decides to
migrate.

## Local setup

```bash
npm install
copy .env.example .env        # Windows
# cp .env.example .env       # macOS/Linux
npx prisma generate --schema=prisma/schema.prisma
npm run db:push
npm run db:seed
npm run dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`
- Readiness: `http://localhost:4000/ready`
- OpenAPI: `http://localhost:4000/openapi.json`

Demo logins use password `mis123`:

- `chairman@mis.du.ac.bd` (SUPER_ADMIN)
- `faculty@mis.du.ac.bd` (FACULTY)
- `student@mis.du.ac.bd` (STUDENT)
- `alumni@mis.du.ac.bd` (ALUMNI)

## Quality gates

```bash
npm test                       # resets prisma/test.db, seeds, runs Node tests
npm run ai:eval                # disposable eval.db, deterministic mock provider
npm run build --workspace=apps/web
```

`npm test` refuses to run unless `DATABASE_URL` ends in `test.db`. The AI evaluation
refuses production and non-eval/test databases unless `AI_EVAL_SKIP_SETUP=1` is used
with an existing eval/test database.

## Database strategy

### Development

- SQLite by default: `DATABASE_URL="file:./dev.db"`.
- `npm run db:push` applies the schema.
- `npm run db:seed` creates demo data, including three approved knowledge documents.
- `prisma/schema.postgres.prisma` is generated locally by
  `npm run db:schema:postgres` and is gitignored.

### Production

Use PostgreSQL and a deliberate migration process:

1. Back up the database and verify the restore path.
2. Generate the PostgreSQL schema:
   `npm run db:schema:postgres`.
3. Review the diff. Prefer a versioned migration workflow (Prisma Migrate) for a real
   institutional deployment.
4. Apply the migration in a maintenance window.
5. Never run `db:seed` against production.
6. Never make schema push or seed part of the API start command.

The root `render.yaml` is a separate 2.0 blueprint with `autoDeployTrigger: off`. It
does not push the schema or seed on startup, and it uses distinct service names
(`mis-lms-2-api` / `mis-lms-2-web`). It is not applied by CI. Do not apply it while the
original production services exist unless the owner explicitly approves a separate 2.0
deployment.

## Environment variables

The full safe-default list is in `.env.example`. Minimum production changes:

| Variable | Production guidance |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string with TLS |
| `JWT_SECRET` | Random, at least 32 characters; never the dev default |
| `CORS_ORIGINS` | Exact web origin(s); never `*` |
| `TRUST_PROXY` | `1` behind a single reverse proxy, otherwise tuned |
| `METRICS_TOKEN` | Long random value; restrict `/metrics` at the edge too |
| `ALLOW_PUBLIC_REGISTRATION` | `false` |
| `WORKERS_INLINE` / `EVENTS_INLINE` | `true` for one process, or both `false` with a standalone worker |
| `AI_ENABLED` | `false` until reviewed |
| `AI_API_KEY` | Server-side secret only, when an external provider is approved |

The API refuses to start in production with a known example/test JWT secret, a secret
shorter than 32 characters, or a missing/`*` `CORS_ORIGINS` value.

## Background work

By default the API runs the outbox dispatcher and DB-backed job queue inline:

```env
WORKERS_INLINE=true
EVENTS_INLINE=true
```

For a separate worker process:

```env
WORKERS_INLINE=false
EVENTS_INLINE=false
```

```bash
npm run start:worker
```

Run one worker deployment per database. Jobs use dedupe keys, attempts, backoff and a
`FAILED` state. Maintenance jobs cover expired sessions, idempotency keys, old outbox
rows and resource link checks. The AI reindex job is opt-in.

## Render example (not active)

`docs/2.0/render.example.yaml` and the root `render.yaml` are **not active
deployments**. Both use `autoDeployTrigger: off` and neither pushes schema nor seeds on
startup. The root blueprint uses separate 2.0 service names; do not apply it while the
original production services exist unless the owner explicitly approves a separate 2.0
deployment and a separate database.

CI never deploys. `.github/workflows/ci.yml` has read-only repository permissions and
no Render hook, SSH, registry or secret-based deploy step. The 2.0 blueprints also set
`autoDeployTrigger: off`, and the original production services remain under the
original repository. Never connect the 2.0 repository to the original services.

## Observability

- Structured JSON logs with request ids and redacted sensitive fields.
- `GET /metrics` exposes counters and histograms in Prometheus text format.
- `GET /health` is a liveness probe; `GET /ready` checks database connectivity.
- Audit logs cover login-sensitive and mutation paths.
- Metrics are in-process; multi-instance aggregation is future work.

## AI deployment

1. Keep the assistant disabled by default.
2. To use the local mock, set `AI_ENABLED=true`, `AI_PROVIDER=mock`.
3. To use an OpenAI-compatible provider, set `AI_PROVIDER=openai-compatible`,
   `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_EMBEDDING_MODEL` and a reviewed
   daily budget.
4. Approve knowledge documents through the API/UI; institution, programme and
   admin-only approvals are administrator-only.
5. Run `npm run ai:eval` and review failing cases before enabling for users.
6. Confirm the provider's data-retention and cross-border transfer terms before
   sending institutional content.

## Rollback

- Application: deploy the previous image/commit.
- Database: restore the verified backup or apply the documented down migration.
- Sessions: revoke all sessions by rotating `JWT_SECRET` as a last resort, then
  investigate audit logs.
- AI: set `AI_ENABLED=false`; the assistant fails closed and the rest of the LMS keeps
  working.
- Jobs: stop the worker/API, inspect `Job` and `OutboxEvent` rows, then retry after the
  root cause is fixed.

## Pre-deployment checklist

- [ ] Separate 2.0 services and database, with no shared production credentials.
- [ ] Backups and restore tested.
- [ ] `JWT_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY`, `METRICS_TOKEN` set.
- [ ] Public registration disabled.
- [ ] AI disabled or explicitly approved with a budget.
- [ ] `/health`, `/ready`, login/logout/session revocation and search verified.
- [ ] `npm test`, `npm run ai:eval` and the web build pass.
- [ ] CI confirmed to have no deployment step.
- [ ] Original production site and Render services untouched.
