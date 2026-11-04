# Deploy on Render

This repo deploys to Render as two Node web services plus one Render Postgres database.

| Resource | Name | URL |
| --- | --- | --- |
| Web (Next.js) | `mis-lms-web` | https://mis-lms-web.onrender.com |
| API (Express + Socket.io) | `mis-lms-api` | https://mis-lms-api.onrender.com |
| Postgres | `mis-lms-db` | internal only |

## How it works

- `render.yaml` is a Render Blueprint that defines all three resources.
- The API uses `prisma/schema.postgres.prisma`, which is generated from
  `prisma/schema.prisma` by `scripts/make-postgres-schema.js` at build/deploy time.
  Keep `prisma/schema.prisma` as the single source of truth for the database schema.
- On every API boot, `npm run render:start` runs:
  1. `prisma db push` against Postgres (keeps the schema in sync),
  2. `prisma/seed.js` (idempotent demo users/programs),
  3. the Express server on Render's `$PORT`.
- The web service gets `NEXT_PUBLIC_API` from the API's `RENDER_EXTERNAL_URL`
  at build time. The API gets `CORS_ORIGINS` from the web service URL.

## One-time setup (Blueprint)

1. Push this repo to GitHub.
2. In the Render Dashboard, choose **New → Blueprint** and select this repo.
3. Apply `render.yaml`. Render creates the database, API, and web service.
4. Wait for both deploys to finish. The first API boot creates and seeds the database.

If you create the services manually instead, set these variables:

| Service | Variable | Value |
| --- | --- | --- |
| API | `DATABASE_URL` | Render Postgres internal connection string |
| API | `JWT_SECRET` | Any long random string |
| API | `NODE_ENV` | `production` |
| API | `CORS_ORIGINS` | `https://<web-service>.onrender.com` |
| Web | `NEXT_PUBLIC_API` | `https://<api-service>.onrender.com` |

`NEXT_PUBLIC_API` is baked in at build time. After changing it, redeploy the web service.

## Demo logins

All demo accounts use password `mis123`:

- `chairman@mis.du.ac.bd` (super admin)
- `faculty@mis.du.ac.bd`
- `student@mis.du.ac.bd`
- `alumni@mis.du.ac.bd`

## Free plan caveats

- Web services **spin down after 15 minutes idle** and take about a minute to wake up.
- Free Postgres **expires 30 days after creation** (14-day grace period to upgrade).
- The API's in-memory rate limiter resets on each restart.

Upgrade the database to a paid plan in the Render Dashboard if you need persistence
beyond the free window. The web/API services can stay free.

## Updating

Push to the connected branch and Render redeploys automatically (when the repo is
connected through the Render GitHub app). With a public repo URL, trigger a manual
deploy from the Render Dashboard or with `render deploys create <service>`.

If you change `prisma/schema.prisma`, no extra step is needed: the API build
regenerates the Postgres schema and `db push` applies it on boot.

## Useful commands

```bash
# Validate the Blueprint locally
render blueprints validate render.yaml

# Trigger a deploy and watch it
render deploys create <service-id> --wait

# Open psql against the Render database
render psql mis-lms-db
```
