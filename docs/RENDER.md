# Deploy on Render

This repo runs on Render as two free Node web services backed by a free Neon
Postgres database.

| Resource | Name | URL |
| --- | --- | --- |
| Web (Next.js) | `mis-lms-web` | https://mis-lms-web.onrender.com |
| API (Express + Socket.io) | `mis-lms-api` | https://mis-lms-api.onrender.com |
| Postgres | Neon project `mislms` | direct connection string only |

The Render services run in the **Oregon** region. The Neon project is in
**AWS us-west-2 (Oregon)** as well.

## How it works

- `render.yaml` is a Render Blueprint that defines the two web services.
  The database is external (Neon), so `DATABASE_URL` is a secret that must be
  supplied when the Blueprint is applied.
- The API uses `prisma/schema.postgres.prisma`, which is generated from
  `prisma/schema.prisma` by `scripts/make-postgres-schema.js` at build/deploy time.
  Keep `prisma/schema.prisma` as the single source of truth for the database schema.
- On every API boot, `npm run render:start` runs:
  1. `prisma db push` against Postgres (keeps the schema in sync),
  2. `prisma/seed.js` (idempotent demo users/programs),
  3. the Express server on Render's `$PORT`.
- The web service gets `NEXT_PUBLIC_API` at build time. The API gets
  `CORS_ORIGINS` from the web service URL.

Use Neon's **direct** (non-pooled) connection string for `DATABASE_URL`, e.g.
`postgresql://user:password@ep-xxx.us-west-2.aws.neon.tech/mislms?sslmode=require`.
The `-pooler` host is intended for serverless clients and is not needed for a
long-running Render web service; `prisma db push` also prefers a direct connection.

## Current deployment (already provisioned)

1. Neon project `mislms` (Postgres 16, `aws-us-west-2`), database `mislms`,
   role `mis`. Schema pushed and demo data seeded.
2. Render API service `mis-lms-api`:
   - Build: `npm ci && npm run db:schema:postgres && npx prisma generate --schema=prisma/schema.postgres.prisma`
   - Start: `npm run render:start`
   - Health check: `/health`
   - Env: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGINS`
3. Render web service `mis-lms-web`:
   - Build: `npm ci && npm run build --workspace=apps/web`
   - Start: `npm run start --workspace=apps/web`
   - Health check: `/`
   - Env: `NEXT_PUBLIC_API=https://mis-lms-api.onrender.com`

## Redeploying from scratch (Blueprint)

1. Push this repo to GitHub.
2. In the Render Dashboard, choose **New → Blueprint** and select this repo.
3. When prompted, paste the Neon direct connection string for `DATABASE_URL`.
4. Apply `render.yaml`. Render creates the API and web service.
5. Wait for both deploys to finish. The first API boot creates and seeds the database.

If you create the services manually instead, set these variables:

| Service | Variable | Value |
| --- | --- | --- |
| API | `DATABASE_URL` | Neon direct connection string |
| API | `JWT_SECRET` | Any long random string |
| API | `NODE_ENV` | `production` |
| API | `CORS_ORIGINS` | `https://mis-lms-web.onrender.com` (comma-separate multiple origins) |
| Web | `NEXT_PUBLIC_API` | `https://mis-lms-api.onrender.com` |

`NEXT_PUBLIC_API` is baked in at build time. After changing it, redeploy the web service.

## Demo logins

All demo accounts use password `mis123`:

- `chairman@mis.du.ac.bd` (super admin)
- `faculty@mis.du.ac.bd`
- `student@mis.du.ac.bd`
- `alumni@mis.du.ac.bd`

## Free plan caveats

- Render web services **spin down after 15 minutes idle** and take about a
  minute to wake up. The first request after idle may be slow.
- Neon free tier auto-suspends idle compute and wakes on the next connection.
  It has no expiry date, but storage/compute limits apply.
- The API's in-memory rate limiter resets on each restart.
- Free Render builds and deploys can take several minutes.

## Updating

Push to `main`. Render redeploys automatically when the repo is connected
through the Render GitHub app; otherwise trigger a manual deploy:

```bash
render deploys create srv-dblp9tjbc2fs73a1am9g --wait   # API
render deploys create srv-dblp9v8u01pc73977dug --wait   # web
```

If you change `prisma/schema.prisma`, no extra step is needed: the API build
regenerates the Postgres schema and `db push` applies it on boot.

## Useful commands

```bash
# Validate the Blueprint locally
render blueprints validate render.yaml

# List the services in the active workspace
render services

# Stream API logs
render logs srv-dblp9tjbc2fs73a1am9g

# Query the Neon database with the Neon CLI
neonctl connection-string mislms
```

## Troubleshooting

- **API boot fails on `prisma db push`:** check `DATABASE_URL` is the direct
  Neon URL, includes `sslmode=require`, and the Neon project is awake.
- **Web shows network errors:** confirm `NEXT_PUBLIC_API` was set before the
  last web build, then redeploy the web service.
- **CORS errors:** set the API's `CORS_ORIGINS` to the exact web origin
  (scheme + host, no trailing slash) and redeploy the API.
