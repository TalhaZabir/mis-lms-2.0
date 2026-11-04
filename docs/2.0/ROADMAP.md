# MIS LMS 2.0 roadmap

Status reflects the independent `mis-lms-2.0` repository. Nothing here is a promise of a
production deployment; the original site and Render services remain untouched.

## Priority 0 — Protection and foundation

- [x] Independent repository with preserved original commits; `origin` is the 2.0
      repository and the original is an upstream with pushes disabled.
- [x] Verified audit of the original codebase, schema and behavior.
- [x] Modular monolith architecture and technology radar.
- [x] ADRs for the modular monolith, sessions, transactional outbox/jobs, portable RAG
      and interoperability scope.
- [x] Safe defaults: public registration off, AI off, workers inline, feature flags.
- [x] Local schema, seed data and smoke-tested API.

## Priority 1 — Security and identity

- [x] Server-side revocable sessions; JWTs carry only `sub` and `sid`.
- [x] Logout, session listing and per-session revocation.
- [x] Centralized RBAC/ABAC and offering scoping.
- [x] IDOR fixes for enrollments, conversations, notifications, gradebooks,
      attendance and content writes.
- [x] Zod validation, body limits, Helmet headers, CORS allowlist, request ids.
- [x] Rate limits for global, auth and AI routes.
- [x] Safe URL validation and SSRF checks for resource link checks.
- [x] Audit logging with redaction.
- [x] Idempotency keys for sensitive/repeated operations.
- [x] Role-escalation guards and administrator-only notifications/knowledge approval.

## Priority 2 — Academic and learning core

- [x] Programmes, batches, terms, courses, offerings and enrollments retained.
- [x] Advisory degree progress, GPA, credit completion and prerequisite checks.
- [x] Personal iCalendar feed.
- [x] Quiz attempt limits, required credits and prerequisite fields.
- [x] Offering locks and grade publication behavior.
- [x] Learner progress and calendar entry points inside the existing Learn screen.

## Priority 3 — Community and resources

- [x] Permission-aware feed, post visibility and moderation.
- [x] Alumni directory, mentorship and conversation membership checks.
- [x] Resource suggestions, duplicate checks, curator queue and link checks.
- [x] Notification fan-out with deduplication and unread counts.
- [x] Realtime chat identity enforcement and room authorization.

## Priority 4 — Search and analytics

- [x] Global permission-aware search across courses, resources, people, posts and
      knowledge.
- [x] Search suggestions, facets, latency logging and result ranking.
- [x] Administrator overview and offering analytics.
- [x] Learner analytics endpoint.
- [x] Search and notification UI added without changing the visual identity.

## Priority 5 — AI assistant

- [x] Provider abstraction with local mock and OpenAI-compatible adapter.
- [x] Portable chunking, hash embeddings and cosine retrieval.
- [x] Authorization-first retrieval with citations and access checks.
- [x] Read-only tools; no mutation path.
- [x] Prompt-injection guardrail, budgets, usage and feedback.
- [x] Disabled by default behind `AI_ENABLED`.
- [x] Deterministic evaluation dataset and harness (12 cases, 90% threshold).
- [x] Feature-flagged assistant page with citations and feedback.

## Priority 6 — Quality, operations and documentation

- [x] Backend test suites for security, AI, realtime and safe defaults.
- [x] Test harness that refuses non-test databases.
- [x] GitHub Actions CI with read-only permissions and no deploy step.
- [x] Dependabot for npm and GitHub Actions.
- [x] API, security, deployment, AI and roadmap documentation.
- [x] `.env.example`, non-active Render example and README updates.
- [x] Web production build.

## Next — planned but not implemented

These are ordered candidates, not current features:

1. **Database migrations:** move production workflows to reviewed Prisma migrations
   with backup/restore drills.
2. **Session transport:** secure HTTP-only cookies and a stricter Content Security
   Policy, with a careful migration from the existing localStorage client.
3. **Identity hardening:** MFA/TOTP, passkeys/WebAuthn or OIDC/SSO for university
   accounts.
4. **Observability:** export metrics to a shared backend, distributed rate limiting and
   alerting for job backlog, failed events and AI budget exhaustion.
5. **Accessibility and frontend tests:** keyboard and screen-reader audit, Playwright
   smoke tests and component tests for search, notifications and the assistant.
6. **Search scale:** PostgreSQL full-text search or pgvector once the corpus and query
   volume justify it; keep authorization filtering first.
7. **Academic depth:** official result publication workflow, transcript verification,
   programme-specific credit rules and advisor approvals.
8. **Interoperability:** LTI, QTI, Caliper, Edu-API and CLR/Open Badges were deliberately
   deferred; evaluate only with a concrete departmental integration partner.
9. **Content ingestion:** PDF/OCR pipeline with malware scanning, retention rules and
   administrator approval.
10. **Mobile/PWA polish:** offline-safe views and low-bandwidth optimizations beyond the
    current responsive layout.

## Explicitly deferred

- CRDT collaborative editing.
- Passkeys/MFA/OIDC in this iteration.
- LTI/QTI/Caliper/Edu-API/CLR certification.
- PDF/OCR ingestion.
- Competitions and a research hub.
- Deploying or migrating the original production services.

## Guardrails for future work

- Keep risky features disabled by default and behind explicit flags.
- Never allow an AI agent to write grades, publish results, delete records or change
  privileges.
- Preserve the existing fonts, colours, typography, branding, navigation, layouts and
  responsive behavior; add only functional UI.
- Keep CI read-only and free of deployment steps.
- Audit any new integration against authorization, data protection and cost.
