# MIS LMS 2.0 — Architecture

## 1. Style: modular monolith

The application remains one deployable API and one web app. Domains are separated
inside the monolith by folder, router, schema and service boundaries:

```
apps/api/src/
  config.js
  core/                 # cross-cutting infrastructure only
    errors.js
    logger.js
    validate.js
    access.js
    audit.js
    events.js
    jobs.js
    idempotency.js
    rate-limit.js
    urls.js
    metrics.js
    realtime.js
  modules/
    identity/           # auth, sessions, users
    academic/           # programs, batches, terms, courses, offerings, enrollments
    learning/           # content, assignments, quizzes, attendance, grades, live
    community/          # feed, alumni, mentorship, chat, moderation
    resources/          # resource catalogue, notifications
    search/             # unified discovery
    ai/                 # providers, RAG, assistant, evaluations
    analytics/          # academic analytics and calendar/progress
  worker.js             # standalone background worker (optional)
  index.js              # app composition + HTTP/socket server
```

Dependency rule: modules may depend on `core` and on exported services of other
modules, but never on another module's route handlers. `core` never imports a
module. This keeps boundaries enforceable by review and tests.

Why not microservices: the workload, team size and deployment budget do not
justify network boundaries. A modular monolith preserves transactions and keeps
free-tier operations simple. Extraction is justified only when a workload (for
example AI ingestion or document conversion) needs independent scaling.

## 2. Identity and access

- JWT contains `sub` (user id) and `sid` (session id), never an authoritative role.
- `Session` rows are stored server-side with user agent, IP, expiry and revocation.
- Every authenticated request loads the session and user, so deactivation and role
  changes take effect immediately.
- Login creates a session; logout revokes it; password change revokes all sessions.
- `POST /auth/sessions/:id/revoke` and `GET /auth/sessions` support device management.
- Passwords use bcrypt; public registration is disabled by default and always
  creates a `STUDENT` when enabled. Admins create other roles.
- Login is throttled per IP + normalized email. Responses do not reveal whether an
  email exists.
- Authorization is centralized in `core/access.js`:
  - Role capability checks (RBAC).
  - Offering-scoped checks (faculty assignment, enrollment).
  - Resource visibility (program/batch/author/moderator).
  - Grade lock and privileged-action rules.
- Consequential actions write `AuditLog` rows with actor, request id, IP and before/
  after metadata. Grades, role changes, moderation and resource verification are
  audited.

## 3. API conventions

- Base paths remain unchanged for compatibility. The same routers are also mounted
  under `/v1`.
- JSON errors keep the existing `error` string field for the current UI, plus
  `code`, `requestId` and optional `details`:
  ```json
  { "error": "Not enrolled in offering", "code": "FORBIDDEN", "requestId": "..." }
  ```
- All bodies and query strings are validated with Zod. Unknown fields are rejected
  for privileged mutations to prevent mass assignment.
- Pagination uses `?limit=` (1–100) and `?offset=`; responses remain arrays for
  compatibility, with `X-Total-Count` when a count is available.
- `Idempotency-Key` is supported on sensitive POST/PUT endpoints. Keys are scoped
  to the user + method + path, stored with a request hash and replay the original
  response.
- OpenAPI is served at `/openapi.json`; `docs/API.md` documents the contract.
- Rate limits: global per IP; stricter limits for auth and AI; AI also has per-user
  daily budget guards.

## 4. Events and background jobs

A transactional outbox avoids lost side effects:

1. The request writes its business row and an `OutboxEvent` in the same transaction.
2. The dispatcher claims pending events (`FOR UPDATE SKIP LOCKED` on PostgreSQL;
   a guarded update on SQLite) and runs idempotent handlers.
3. Handlers create notifications, enqueue AI indexing, record analytics, and emit
   real-time events. Failures retry with exponential backoff and become `FAILED`
   (dead letter) after the maximum attempts.

Events implemented: `UserCreated`, `EnrollmentCreated`, `AssignmentPublished`,
`SubmissionReceived`, `SubmissionGraded`, `GradePublished`, `ResourceSuggested`,
`ResourceApproved`, `MentorshipRequested`, `MentorshipAccepted`, `PostCreated`.

The DB-backed `Job` queue handles long or retryable work: resource link checks,
knowledge ingestion, notification fan-out and future report/certificate generation.
`WORKERS_INLINE=true` runs the dispatcher in the API process for small deployments;
`npm run worker` runs a dedicated process when needed. Jobs are uniqueness-guarded
with a `dedupeKey` and are safe to retry.

## 5. Search and discovery

`GET /search` searches courses, verified resources, people, visible posts, and
authorized knowledge documents. The query passes through:

1. Validation and length limits.
2. Permission filters at the database query level (never post-filter only).
3. Weighted ranking: exact code/short title > title prefix > body occurrence >
   recency > type weight.
4. Optional trigram similarity fallback for short queries with few results.
5. Facet counts and suggestions.

An anonymized `SearchLog` row stores the normalized query, types, result count and
latency — never the user id. The retrieval layer is deliberately portable: SQLite
and PostgreSQL both work today. PostgreSQL full-text (`tsvector`) and pgvector are
documented upgrade paths, not silent assumptions.

## 6. AI infrastructure

All AI calls go through `modules/ai`:

- **Provider abstraction**: OpenAI-compatible chat/embeddings adapters plus a
  deterministic `mock` provider for tests, local demos and evaluation. Provider,
  base URL, model, timeout, token limits and budget come from configuration.
- **Credentials** stay server-side; model names are not hardcoded in routes.
- **RAG pipeline**: document registration → classification → chunking → embedding →
  hybrid retrieval (keyword + cosine) → metadata filtering → reranking → grounded
  prompt → answer with citations.
- **Access control**: chunks inherit document visibility (`INSTITUTION`, `PROGRAM`,
  `COURSE`, `FACULTY`, `ADMIN`) and are filtered against the caller's role and
  enrollments *before* ranking. A student cannot retrieve faculty-only notes.
- **Grounding**: institutional answers cite document/chunk ids and titles. The
  assistant separates “from institutional materials” from general model knowledge
  and refuses to invent grades, rules or official announcements.
- **Guardrails**: read-only tools only; tool allowlists per role; no grade changes,
  deletions, result publication or permission changes; prompt-injection screening;
  input/output limits; timeouts; per-user rate limits; audit rows for tool use.
- **Usage and evaluation**: `AiUsage` records provider, model, tokens, estimated
  cost, latency and status. `AiFeedback` stores explicit helpfulness ratings.
  `npm run ai:eval` runs a versioned benchmark and reports retrieval hit rate,
  citation presence, groundedness heuristics, latency and cost.
- **Feature flag**: `AI_ENABLED=false` by default. With no external key, the mock
  provider produces extractive, citation-backed answers for local testing.

Embeddings are stored as JSON arrays for SQLite/PostgreSQL parity. A `pgvector`
column and HNSW index are a documented production optimization once the knowledge
corpus exceeds the portable in-process ranking threshold (5,000 chunks).

## 7. Data model additions

`Session`, `OutboxEvent`, `Job`, `IdempotencyKey`, `AiUsage`, `AiFeedback`,
`KnowledgeDocument`, `KnowledgeChunk`, `SearchLog`, plus visibility fields on posts,
prerequisites on courses, required credits on programs, notification dedupe keys and
indexes on foreign keys and common filters.

All changes are additive. The production Neon database is not migrated during this
project; deployment instructions include a reviewed `prisma migrate`/`db push` step
for a future authorized release.

## 8. Observability and reliability

- JSON structured logs with request id, method, path, status, duration, user id
  (never passwords or tokens). Sensitive keys are redacted.
- `X-Request-Id` echoed to clients.
- `/metrics` exposes lightweight Prometheus text counters/histograms for requests,
  errors, job outcomes and AI latency; `/health` and `/ready` remain.
- Outbox/job retries with backoff and dead-letter states.
- Graceful shutdown closes HTTP, sockets, workers and Prisma.
- SLO targets (documented, not yet measured in production): API p95 < 500 ms for
  non-AI reads, error rate < 1%, login success availability 99.5%, AI p95 < 8 s.

## 9. Frontend changes

The visual system (navy/gold palette, Inter/system font, existing cards, tables,
tabs, nav) is unchanged. Minimal functional additions:

- Global search in the existing top bar.
- Notification bell with the existing notification API.
- A feature-flagged AI assistant entry (hidden unless enabled).
- Academic progress and calendar download inside the existing Learn area.

No page is redesigned. New UI reuses existing classes and responsive rules.

## 10. Deployment readiness (not executed)

`docs/2.0/DEPLOYMENT.md` specifies build/start commands, environment variables,
database migration, worker process, AI configuration, persistent storage, health
checks, backups and rollback. CI does not deploy. No Render service is created or
modified by this repository.
