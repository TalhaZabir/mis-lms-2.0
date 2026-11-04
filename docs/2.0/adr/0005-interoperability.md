# ADR 0005 — Defer interoperability standards until a real counterpart exists

Status: Accepted

## Context
LTI 1.3, QTI, Caliper, Edu-API and CLR are substantial specifications that require
an external tool, assessment exchange partner, identity provider or registrar
integration to test honestly. Implementing them without a counterpart would produce
unverifiable code and a false compliance claim.

## Decision
Do not implement these standards in the first 2.0 milestone. Document the gap,
required configuration and verification plan. Prioritise LTI 1.3 and QTI only when
the department identifies a concrete tool or question-bank exchange requirement.

## Consequences
- Engineering effort stays focused on daily academic workflows.
- No unverified compliance claims.
- A future integration will need a dedicated test harness and partner.
