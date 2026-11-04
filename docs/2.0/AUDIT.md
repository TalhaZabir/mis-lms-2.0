# MIS LMS 2.0 — Phase One Feature & Architecture Audit

Status: baseline audit completed before any 2.0 code changes.
Scope: `TalhaZabir/mis-lms-du` at commit `4e81064`, preserved in the independent
`TalhaZabir/mis-lms-2.0` repository. The original repository, Render services and
production database were not modified.

## 1. Verified stack

| Layer | Actual implementation |
| --- | --- |
| Web | Next.js 14.2.35 App Router, React 18.3.1, plain CSS (`apps/web/app/globals.css`) |
| API | Express 4.22.x, CommonJS, Socket.io 4.7.x (`apps/api/src/index.js`) |
| Data | Prisma 5.22, SQLite in development, generated PostgreSQL schema in production |
| Auth | JWT bearer tokens in `localStorage`, bcrypt password hashes (`apps/api/src/auth.js`) |
| RBAC | Static role arrays on the server and mirrored in `apps/web/lib/roles.js` |
| Jobs | None; one HTTP link check runs inline |
| Tests | None |
| Docs | README, `docs/RENDER.md`, `docs/DEPLOY.md` |
| Deployment | Render web + API + external Neon Postgres (already provisioned; untouched) |

Verification performed:

- Read every API route and every web page/component.
- Read the complete Prisma schema and seed.
- Confirmed the production build and runtime before the fork (`next build`, `/health`,
  `/auth/login`, CORS preflight, web bundle containing the API URL).
- Confirmed the working tree was clean and history preserved before creating the fork.

## 2. Feature inventory

### 2.1 Fully implemented (working, but not necessarily secure)

| Capability | Evidence | Notes |
| --- | --- | --- |
| Login / JWT / roles | `routes/auth.js`, `auth.js` | Seven roles; demo users seeded |
| Academic structure CRUD | `routes/academic.js` | Programs, batches, terms, courses, offerings |
| Enrollment management | `routes/academic.js` | Admin/faculty create/delete |
| Course content | `routes/faculty.js` | Modules, lessons (video/PDF/slide/link) |
| Assignments & submissions | `routes/faculty.js`, `routes/student.js` | Due-date gate, grading, feedback field |
| Quiz/question bank | `routes/faculty.js`, `routes/student.js` | Attempt windows; no auto-grading |
| Attendance | `routes/faculty.js`, `routes/student.js` | Sessions, QR token, bulk mark, percentage |
| Gradebook | `routes/faculty.js`, `routes/student.js` | Weighted items, lock flag, letter grades |
| Live classes | `routes/faculty.js` | Join/recording links, announcement on create |
| Social feed | `routes/social.js` | Posts, likes, comments, saves, reports |
| Alumni directory & mentorship | `routes/social.js` | Verification, opt-in, request workflow |
| Chat | `routes/social.js`, Socket.io | Conversation persistence + polling UI |
| Resource corner | `routes/resources.js` | Suggest → queue → verify, votes, bookmarks, broken links |
| Notifications | `routes/resources.js` | DB rows + Socket.io emit; no delivery pipeline |
| Moderation | `routes/social.js` | Reports, hide, warn/mute/ban actions |
| Admin user roles | `routes/academic.js` | Role change + activation |
| PWA shell | `public/manifest.json` | Manifest only; no service worker |

### 2.2 Implemented but requiring improvement

| Capability | Gap |
| --- | --- |
| Feed visibility | `BATCH` is not actually scoped to a batch; `PROGRAM` is not scoped to a program; clients can override `visibility` in the query string |
| Mentorship status | Either party can set any status, including `ACCEPTED` |
| Resources | `new URL()` accepts `javascript:` URLs; private-network URLs are not blocked; `report-broken` is open to any user |
| Gradebook | Weight/percentage semantics are ambiguous; no audit trail; lock is not enforced on writes |
| Attendance | No session ownership check; no QR validation endpoint; per-record writes without a transaction |
| Quizzes | No question-to-quiz relationship; answers are free-form JSON; no auto-grading or attempt limits |
| Notifications | Only resource events create rows; no assignment/grade/mentorship events; no dedupe |
| Search | `contains` filters only; no unified search, ranking, typo tolerance or permission-aware index |
| Analytics | No course/program analytics beyond per-student results |
| Chat | Polling every 4 s; no socket authentication; sender identity is trusted from the client |
| Accessibility | Focus styles exist; no skip link, labels are inconsistent, tabs lack ARIA semantics |
| Offline | PWA manifest only, no service worker/IndexedDB/queue |

### 2.3 Partially implemented / stub capabilities

| Capability | Reality |
| --- | --- |
| Question bank UI | API can create banks/questions, UI only creates an empty bank |
| Quiz UI | Student must paste a quiz ID and raw answers JSON |
| Assignment submission | Student must paste an assignment ID; no file upload, only text/URL |
| Calendar | Routine list only; no ICS, exam calendar or sync |
| Portfolio | Data model absent |
| Research/projects/competitions | Data model absent |
| AI | Absent |
| Interoperability (LTI/QTI/Caliper/Edu-API/CLR) | Absent |
| Collaborative documents | Absent |
| MFA/passkeys/SSO | Absent |
| Observability | Console request line only; no IDs, metrics, traces or AI usage tracking |

### 2.4 Missing capabilities

- Centralized validation and typed API contracts / OpenAPI.
- Consistent error envelope, pagination, filtering, idempotency.
- Transactional event publication, background jobs, retries, dead-letter handling.
- Resource-level authorization (offering/course ownership) across teaching endpoints.
- Session/device management and immediate revocation.
- Audit logging for privileged mutations.
- Full-text/hybrid search with permission-aware results.
- AI service abstraction, RAG, citations, evaluations, cost tracking.
- Academic progress/degree audit, prerequisites, transcript GPA, ICS calendar.
- File storage/upload pipeline, malware scanning, signed URLs.
- Automated tests, CI, SBOM, dependency/security scanning.
- Observability: request IDs, structured logs, metrics, tracing, SLOs.

## 3. Security findings (verified in source)

Severity reflects exploitability and impact in the current code.

### Critical

1. **Privilege escalation at registration** — `POST /auth/register` accepts
   `role` from the request body (`routes/auth.js:8-15`). Anyone can create a
   `SUPER_ADMIN`.
2. **Gradebook and question-bank exposure** — `GET /offerings/:oid/gradebook`
   and `GET /banks` require only a valid login (`routes/faculty.js:72,123`).
   Any student can read every grade, student identity and answer key.
3. **Teaching mutations lack offering ownership checks** — module/lesson/
   assignment/quiz/attendance/grade endpoints allow any `FACULTY`/`TA` to modify
   any offering (`routes/faculty.js`). A TA can delete another course's content.
4. **Socket identity spoofing** — the socket handler trusts `senderId` supplied by
   the client and the `join` event accepts any room (`src/index.js:77-90`).
   Knowing a member ID and conversation ID is enough to post as that user.
5. **Stored link injection** — resource URLs are validated only with `new URL()`,
   which accepts `javascript:` and `data:` schemes (`routes/resources.js:29`).
   The URL is rendered directly in an `href` (`app/resources/page.js:70`).

### High

6. **Stale role trust** — JWT embeds `role` and is trusted for 7 days
   (`auth.js:8,18`); deactivation and role changes do not invalidate tokens.
7. **IDOR on enrollments/notifications/comments** — `GET /enrollments?userId=`
   exposes any student's enrollments; `PUT /notifications/:id/read` has no
   ownership check; `GET /posts/:id/comments` ignores post visibility.
8. **Moderator overreach** — a `MODERATOR` can ban any user, including
   `SUPER_ADMIN` (`routes/social.js:161-163`).
9. **Admin role escalation** — `ADMIN_STAFF` can grant `SUPER_ADMIN` and can
   demote other super admins (`routes/academic.js:78-85`).
10. **Mentorship state tampering** — either participant can set `ACCEPTED` or any
    other status (`routes/social.js:106-110`).
11. **Grade lock bypass / missing audit** — bulk grade writes ignore
    `Offering.isLocked` and never write `AuditLog`.
12. **Public registration enabled by default** with no email verification or
    domain restriction.

### Medium

13. In-memory rate limiter trusts `x-forwarded-for` directly and never prunes
    buckets (`src/index.js:31-44`); trivial IP spoofing/bypass and memory growth.
14. Prisma error messages are returned to clients (`e.message` in many routes),
    leaking schema details.
15. No input validation or unknown-field rejection; Prisma `create({data:req.body})`
    allows mass assignment of fields such as `isVerified`, `isLocked`.
16. No password policy, login throttling per identity, account lockout or MFA.
17. Bearer token stored in `localStorage`; no CSP; XSS impact is elevated.
18. No audit trail for privileged actions despite an unused `AuditLog` model.
19. CORS with `credentials: true` and wildcard reflection when `CORS_ORIGINS=*`.
20. No secure file-upload pipeline; `fileUrl` is arbitrary text.

## 4. Performance and reliability weaknesses

- Missing indexes on foreign keys and common filters (Postgres does not index FKs
  automatically). Lists use `take: 200/500` without pagination.
- Sequential Prisma writes in attendance bulk mark and grade bulk operations;
  no transaction, so partial writes are possible.
- `GET /feed` falls back to an unfiltered query on any include error, which can
  expose hidden/unauthorized posts.
- Rate limiter memory is unbounded.
- No background processing; link checking runs in the request path (up to 20 × 6 s).
- No retries, idempotency or dead-letter handling for side effects.
- Notifications are synchronous best-effort writes; failures are swallowed.
- Socket.io chat and REST messages duplicate persistence paths.
- No structured logs, request IDs, metrics or traces.
- No graceful shutdown; Prisma disconnect and socket drain are not handled.

## 5. Integration and evolution opportunities

| Area | Recommendation | Priority |
| --- | --- | --- |
| API contracts | Zod validation + OpenAPI + `/v1` aliases | P0 |
| Identity | DB-backed sessions, revocation, login throttling, later MFA/passkeys/OIDC | P0 |
| Authorization | Central policy service; offering-scoped checks; grade audit | P0 |
| Events/jobs | Transactional outbox + DB-backed queue + inline/standalone worker | P1 |
| Search | Unified permission-aware search; typo tolerance; facets; pgvector later | P1 |
| AI | Provider abstraction, RAG, citations, evaluations, cost tracking, feature flag | P1 |
| Academic | Progress/degree audit, prerequisites, transcript GPA, ICS calendar | P1 |
| Observability | JSON logs, request IDs, metrics; OTel export later | P1 |
| Interoperability | LTI 1.3 / QTI / Caliper / Edu-API / CLR gap analysis before implementation | P2 |
| Collaboration | Yjs only for explicitly collaborative documents | P3 |
| Offline | Service worker + IndexedDB for non-sensitive read caches and queued submissions | P3 |
| Projects/competitions | New domain with team, milestone, submission, judging models | P2 |
| File storage | S3-compatible object store + signed URLs + scanning | P2 |

## 6. Baseline decisions for 2.0

- Keep the existing Next.js/Express/Prisma stack; do not replace it without
  measured evidence.
- Keep SQLite for local/test parity and PostgreSQL for production.
- Preserve the current visual identity and navigation. Add only functional UI
  (search, notifications, assistant when enabled).
- Put risky functionality behind environment feature flags, disabled by default.
- Never push to `upstream`; its push URL is disabled locally.
- Never call Render or touch the production database in this project.

## 7. Deferred work (explicitly not claimed as complete)

CRDT collaborative editing, offline writes, passkeys/MFA/OIDC, LTI/QTI/Caliper/
Edu-API/CLR certification, PDF/OCR ingestion, vector indexes in pgvector,
competition management, research hub, and full project/portfolio modules are
documented in the roadmap but are not part of the first 2.0 implementation
milestone. Each requires separate design, dependencies and validation.
