# ADR 0001 — Modular monolith, not microservices

Status: Accepted

## Context
The platform is a small departmental LMS with one web app, one API, one database
and a free-tier hosting budget. Existing transactions span enrollments, grades,
submissions and notifications. There is one engineering team.

## Decision
Keep a single deployable Express API organised into domain modules with explicit
boundaries. Extract a service only when an independently scalable workload appears
(for example, large-scale document processing or a dedicated AI gateway).

## Consequences
- Transactions and authorization remain simple.
- Local development and free-tier deployment remain cheap.
- Module boundaries must be enforced by review and tests; otherwise the monolith
  becomes a tangle.
- Future extraction is possible because modules do not import each other's routes.
