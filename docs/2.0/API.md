# MIS LMS 2.0 API

The API is an Express modular monolith. Every domain module exposes routes under a
single router. The canonical prefix is `/v1`; the original unversioned paths remain
available as a migration shim for the existing web client.

- OpenAPI document: `GET /openapi.json`
- Canonical base path: `/v1`
- Backward-compatible base path: `/`
- Content type: `application/json` (except `GET /me/calendar.ics`)

## Authentication

1. `POST /auth/login` with `{ "email": "...", "password": "..." }`.
2. Store the returned bearer token and send `Authorization: Bearer <token>`.
3. Tokens contain only `sub` and `sid`. The server checks a revocable `Session` row
   on every authenticated request.
4. `POST /auth/logout` revokes the current session. `GET /auth/sessions` lists the
   user's active sessions; `POST /auth/sessions/:id/revoke` revokes one.

Public registration is disabled by default (`ALLOW_PUBLIC_REGISTRATION=false`).
Users are created by administrators.

## Error envelope

```json
{
  "error": "Human-readable message",
  "code": "VALIDATION_ERROR",
  "requestId": "8f1c…",
  "details": {}
}
```

- `requestId` is also returned in the `X-Request-Id` response header.
- Do not parse error messages. Branch on `code` and HTTP status.
- Validation errors use HTTP 400 and `VALIDATION_ERROR`.

## Common headers

| Header | Purpose |
| --- | --- |
| `Authorization: Bearer <token>` | Authenticated request |
| `Idempotency-Key: <8–128 chars>` | Replays one response for one user/request body for 24 hours |
| `X-Request-Id` | Client correlation id; echoed back |
| `X-Metrics-Token` | Access `/metrics` in production when `METRICS_TOKEN` is set |

Rate-limit headers are returned as `RateLimit-Limit`, `RateLimit-Remaining` and
`RateLimit-Reset`. Authenticated idempotent replays return `Idempotent-Replayed: true`.

Pagination is `?limit=50&offset=0` (or `page` where the module supports it). Limits
are capped server-side.

## System

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/health` | public | Liveness, version, uptime |
| GET | `/ready` | public | Database readiness; 503 when unavailable |
| GET | `/metrics` | restricted | Prometheus-style text; public only in development when no token is set |
| GET | `/openapi.json` | public | This contract |
| GET | `/v1/health`, `/v1/ready` | public | Versioned aliases |

## Identity and users

| Method | Path | Access |
| --- | --- | --- |
| POST | `/auth/login` | public, rate-limited |
| POST | `/auth/register` | disabled by default |
| GET | `/auth/me` | authenticated |
| POST | `/auth/logout` | authenticated |
| GET | `/auth/sessions` | authenticated |
| POST | `/auth/sessions/:id/revoke` | authenticated |
| PUT | `/auth/password` | authenticated |
| GET | `/users` | administrators |
| PUT | `/users/:id` | administrators, with role-escalation guards |

## Academic structure

Programs, batches, terms, courses, offerings and enrollments:

| Method | Path | Access |
| --- | --- | --- |
| GET | `/programs` | authenticated |
| POST/PUT/DELETE | `/programs`, `/programs/:id` | administrators |
| GET | `/batches`, `/terms`, `/courses`, `/offerings` | authenticated |
| POST/PUT/DELETE | corresponding resources | administrators/faculty as scoped |
| GET | `/enrollments?offeringId=` | self, teacher of the offering, or administrator |
| POST | `/enrollments` | teaching staff for students; administrators for any role |
| DELETE | `/enrollments/:id` | administrators/offering managers |

Students can read their own degree progress and calendar:

- `GET /me/progress` — advisory credits, GPA, completed/in-progress courses and
  missing prerequisites, derived only from locked offerings and recorded grades.
- `GET /me/calendar.ics` — personal iCalendar feed of assignments, quizzes and live
  classes.

## Learning

- Teaching: `GET /teach/offerings`, modules, lessons, assignments, question banks,
  quizzes, attendance sessions, gradebook, grade items, bulk grades, lock/unlock and
  live classes.
- Students: `GET /me/courses`, `GET /offerings/:oid/learn`, `POST /submissions`,
  `GET /me/submissions`, `POST /quizzes/:qid/attempt`, `GET /me/attempts`,
  `GET /offerings/:oid/attendance/me`, `GET /me/routine`, `GET /me/results`,
  `GET /me/transcript`.

Content writes are scoped to the offering's assigned faculty or administrators.
Grade changes respect offering locks. Question banks are staff-only.

## Community

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/feed` | Visibility-aware: MIS public, programme, batch, alumni circle |
| POST | `/posts` | Post creation with visibility validation |
| POST | `/posts/:id/like`, `/comments`, `/save`, `/report` | Engagement |
| GET | `/directory/alumni` | Verified alumni directory |
| POST | `/alumni/verify/:userId` | Administrators |
| POST/GET/PUT | `/mentorship/requests` | Scoped to mentee/mentor |
| GET/POST | `/me/conversations`, `/conversations/:id/messages` | Membership enforced |
| GET/POST | `/moderate/reports`, `/moderate/action` | Moderators/administrators |

Realtime chat uses Socket.io with authenticated connections. The server ignores any
client-supplied sender id and uses the session user.

## Resources and notifications

| Method | Path | Access |
| --- | --- | --- |
| GET | `/resources` | authenticated; verified resources only |
| POST | `/resources/suggest` | authenticated; duplicate and unsafe-URL checks |
| POST | `/resources` | curators (faculty/administrators) |
| GET | `/resources/queue` | curators |
| PUT | `/resources/:id/verify` | curators |
| POST | `/resources/:id/vote`, `/bookmark`, `/report-broken` | authenticated |
| GET | `/me/bookmarks` | authenticated |
| POST | `/resources/check-links` | curators |
| GET | `/me/notifications` | own notifications |
| GET | `/me/notifications/unread-count` | own unread count |
| PUT | `/notifications/:id/read`, `/notifications/read-all` | own notifications |
| POST | `/notifications` | administrators |

## Search

`GET /search?q=database&types=course,resource,people,post,knowledge&limit=30`

Returns ranked, permission-aware results:

```json
{
  "query": "database",
  "types": ["course", "resource", "people", "post", "knowledge"],
  "results": [
    {
      "type": "course",
      "id": "…",
      "title": "MIS-352 — Database Management",
      "subtitle": "BBA in Management Information Systems",
      "url": "/learn",
      "score": 0.97,
      "meta": { "code": "MIS-352", "credits": 3 }
    }
  ],
  "facets": { "course": 1, "resource": 2 },
  "suggestions": ["MIS-352 — Database Management"],
  "total": 3,
  "tookMs": 11
}
```

`GET /search/suggest?q=...` returns lightweight query suggestions. Search requires at
least two characters and never returns admin-only knowledge, hidden posts or resources
the user cannot see.

## Analytics

| Method | Path | Access |
| --- | --- | --- |
| GET | `/analytics/overview` | administrators |
| GET | `/analytics/offerings/:oid` | assigned faculty or administrators |
| GET | `/me/analytics` | authenticated learner |

Analytics are aggregate and advisory. They do not reveal individual grades to users
who cannot already see them.

## Assistant and knowledge

AI is disabled by default (`AI_ENABLED=false`).

| Method | Path | Access |
| --- | --- | --- |
| GET | `/ai/status` | authenticated; exposes enabled flag and read-only tools |
| POST | `/ai/ask` | authenticated when enabled; rate-limited and idempotent |
| POST | `/ai/ask/stream` | authenticated when enabled; server-sent events |
| POST | `/ai/feedback` | owner of the usage row |
| GET | `/ai/usage/me` | own usage |
| GET | `/ai/knowledge` | visibility-scoped |
| GET | `/ai/knowledge/:id` | visibility-scoped |
| POST/PUT/DELETE | `/ai/knowledge…` | teaching staff within visibility rules; administrators for institution/programme/admin scopes |
| PUT | `/ai/knowledge/:id/status` | approval rules; institution/programme/admin approval is administrator-only |
| POST | `/ai/knowledge/reindex` | administrators |
| GET | `/ai/tools` | list tools available to the caller |
| POST | `/ai/tools/:name` | read-only tools only |
| GET | `/ai/evaluations` | administrators |

Answers include `grounded`, `citations`, `sources`, `provider`, `model` and `usageId`.
The assistant can never change grades, publish results, delete records or change
permissions. See [AI.md](./AI.md).

## Versioning and compatibility

- `/v1` is canonical for new clients.
- Unversioned routes are kept temporarily for the existing single-page client.
- Breaking changes require a new prefix; additive fields are allowed within `v1`.
- The OpenAPI document is the source of truth for new client work.
