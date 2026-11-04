# ADR 0003 — Transactional outbox and DB-backed jobs

Status: Accepted

## Context
Notifications, AI indexing and link checks were executed inline, best-effort and
without retries. Failures were silently swallowed. Redis is available in the Docker
stack but not in the free Render deployment.

## Decision
Use a transactional outbox table for domain events and a database-backed job queue
for background work. Run the dispatcher/worker inline by default (`WORKERS_INLINE`)
and provide a standalone `npm run worker` process for larger deployments. Use
`FOR UPDATE SKIP LOCKED` on PostgreSQL and a guarded claim on SQLite. Add retry,
backoff, idempotency keys and dead-letter status.

## Consequences
- Side effects survive request failures and process restarts.
- No new infrastructure is required on the free tier.
- The dispatcher adds a small polling load; intervals and batch sizes are configurable.
- A queue such as BullMQ/Redis can replace the DB queue later without changing
  event producers.
