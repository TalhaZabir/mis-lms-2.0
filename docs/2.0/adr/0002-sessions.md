# ADR 0002 — Server-side sessions with short-lived bearer tokens

Status: Accepted

## Context
The original JWT embedded the role and was trusted for seven days. Deactivation and
role changes did not take effect until expiry, and there was no way to revoke a
device. Moving directly to httpOnly cookies would require CSRF handling and a
frontend auth rewrite.

## Decision
Keep the `Authorization: Bearer` transport (compatible with the existing web app),
but put only `sub` and `sid` in the token. Store a revocable `Session` row and load
the user on each request. Logout revokes the current session; password changes and
administrator actions can revoke all sessions. Access tokens are short-lived and
re-issued after login.

## Consequences
- Role changes and deactivation are immediate.
- Device/session management becomes possible.
- Each request performs a session/user lookup; this is acceptable at departmental
  scale and indexed by primary key.
- XSS remains a concern because tokens live in `localStorage`. A future ADR can move
  to httpOnly cookies plus CSRF tokens and a nonce-based CSP.
