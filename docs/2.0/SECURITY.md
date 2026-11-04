# Security policy and model — MIS LMS 2.0

## Scope

This repository (`TalhaZabir/mis-lms-2.0`) is an independent 2.0 evolution. It is not
the production repository and no production Render service, Neon database, environment
variable or record is modified by the work in this repository.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability. Use GitHub's
private security advisory flow for `TalhaZabir/mis-lms-2.0`, or contact the repository
owner privately with:

- affected endpoint or screen,
- reproduction steps,
- expected vs actual behavior,
- impact and any suggested fix.

Do not access other users' data, run destructive tests against deployed systems, or
publish details before a fix is available. This is a university project without a
24/7 security team; good-faith reports will be acknowledged as soon as possible.

## Supported versions

| Version | Status |
| --- | --- |
| 2.0.x | Active development |
| 1.x (original repository) | Preserved, not modified here |

## Authentication and sessions

- Login issues a JWT containing only `sub` (user id) and `sid` (session id).
- Every authenticated request verifies the token **and** loads the matching
  server-side `Session` row. Sessions can be revoked immediately.
- Session rows store user agent, IP, creation, expiry and revocation timestamps.
- `POST /auth/logout` revokes the current session. Users can list and revoke other
  sessions.
- Failed logins use a dummy bcrypt hash so timing does not reveal whether an email
  exists.
- Public registration is disabled by default. Accounts are created by administrators.
- Passwords require at least 10 characters with a letter and a number, and are hashed
  with bcrypt (cost 10 in the demo seed).

## Authorization

Authorization is enforced server-side in `apps/api/src/core/access.js`.

- Roles: `SUPER_ADMIN`, `ADMIN_STAFF`, `FACULTY`, `TA`, `STUDENT`, `ALUMNI`,
  `MODERATOR`.
- Offering-scoped access is checked for content, grades, attendance, quizzes,
  analytics and knowledge.
- Post visibility (`MIS_PUBLIC`, `PROGRAM`, `BATCH`, `ALUMNI_CIRCLE`) and knowledge
  visibility (`INSTITUTION`, `PROGRAM`, `COURSE`, `FACULTY`, `ALUMNI`, `ADMIN`) are
  filtered in the database query, not only in the UI.
- The frontend hides links it knows are unavailable, but the API is the enforcement
  point. Direct URL access must fail safely.
- Administrators cannot be created by non-administrators; role escalation is blocked
  for faculty and students.
- Only administrators can send manual notifications or approve institution-wide,
  programme-wide or admin-only knowledge.

## Input, transport and abuse controls

- Zod schemas validate bodies and query strings. Unknown fields are rejected where
  `.strict()` is used.
- JSON and URL-encoded bodies are limited to `JSON_LIMIT` (default `2mb`).
- Helmet supplies baseline security headers. CORS uses an explicit allowlist in
  production; the API refuses to start if `CORS_ORIGINS` is missing or `*`.
  `CORS_ORIGINS=*` remains a development convenience only.
- Resource URLs accept only `http(s)` without embedded credentials. Private,
  loopback, link-local and similar hosts are rejected before any link check.
- Global, authentication and AI-specific rate limits are applied. The implementation
  is in-process, so limits are per API instance.
- `Idempotency-Key` is scoped to a user and request hash; mismatched reuse returns 409.
- Audit logs record sensitive mutations with redacted metadata; tokens, passwords,
  secrets and hashes are not written to logs.
- The logger redacts sensitive keys and truncates oversized values.

## AI-specific controls

- `AI_ENABLED=false` by default. The assistant is unavailable until an administrator
  explicitly enables it.
- Retrieval only considers documents the caller is authorized to see, including
  programme, course, role allowlists and admin-only scopes.
- AI tools are read-only and exposed through an explicit allowlist. There is no tool
  that can write a grade, publish results, delete records or change privileges.
- Prompt-injection patterns are blocked before retrieval. Retrieved text is treated as
  data, never as instructions.
- Answers are extractive and citation-backed in the default mock provider. The UI and
  API label advisory answers and never present them as official records.
- Daily request and budget caps are enforced per user. Provider failures use a local
  mock fallback only when `AI_FALLBACK_TO_MOCK=true`.
- Provider API keys stay server-side in environment variables and are never returned
  to the browser.
- See [AI.md](./AI.md) for the full model and evaluation harness.

## Secrets and data handling

- Never commit `.env`, database files, provider keys or generated production schemas.
- Use a random `JWT_SECRET` of at least 32 characters. Production startup refuses
  known development, example, test and evaluation secrets, and anything shorter than
  32 characters.
- Set `CORS_ORIGINS` to exact production origins.
- Set `METRICS_TOKEN` in production; `/metrics` is otherwise unavailable outside
  development.
- Use a least-privilege database user. Back up before any schema change.
- Do not run the demo seed against production; it creates demo accounts and data.
- Logs contain request ids, routes, status, duration and user ids. Avoid adding PII or
  secrets to log messages.

## Known limitations and risk register

These are deliberate 2.0 scope decisions, not hidden guarantees:

1. **Bearer token in `localStorage`.** The existing client stores the token in browser
   storage, which is exposed to XSS. The server enforces authorization, but a strict
   CSP and a move to secure, HTTP-only cookies are future work. Helmet's CSP is
   currently disabled for compatibility with the existing Next.js app.
2. **No MFA, passkeys, OIDC or SSO.** These are deferred.
3. **In-process rate limiting and metrics.** Multiple API instances do not share
   counters. A shared store (for example Redis) is future work.
4. **No automated dependency-audit gate.** Dependabot is configured, but
   `npm audit` currently reports a high-severity advisory in the Next.js 14 dependency
   tree. A planned major framework migration is required; do not run
   `npm audit fix --force` without a visual and functional review.
5. **SQLite in development.** Production uses PostgreSQL. SQLite is not a production
   concurrency or backup story.
6. **AI provider not evaluated against a real external model.** The default mock is
   deterministic and local. Any external provider must be evaluated for data
   protection, latency, cost and output quality before enabling.
7. **PDF/OCR ingestion is not implemented.** Only pasted text/Markdown knowledge is
   indexed.
8. **No independent penetration test.** Treat this as a hardened student project, not
   a certified university records system.

## Production checklist

- [ ] Confirm the deployment is the 2.0 repository, not the original production repo.
- [ ] Set a strong `JWT_SECRET`, exact `CORS_ORIGINS`, `METRICS_TOKEN` and production
      `DATABASE_URL`.
- [ ] Keep `ALLOW_PUBLIC_REGISTRATION=false`.
- [ ] Keep `AI_ENABLED=false` until a provider and data-processing review are complete.
- [ ] Run schema changes manually after a backup; never let startup commands push or
      seed automatically.
- [ ] Verify `/health`, `/ready`, login, logout, revocation and `/metrics` access.
- [ ] Confirm CI has no deploy step and no production secrets.
- [ ] Review audit logs and notification fan-out after the first real term.
- [ ] Keep the original production site and Render services untouched unless the owner
      explicitly plans a separate migration.
