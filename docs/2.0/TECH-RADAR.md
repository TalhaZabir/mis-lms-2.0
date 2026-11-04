# MIS LMS 2.0 — Technology radar

Last reviewed: 2026-11-05. Versions must be re-checked against official releases and
security advisories before every upgrade.

## Adopt

| Technology | Version | Why |
| --- | --- | --- |
| Node.js | 20 LTS (`.node-version`) | Already deployed; supported by the stack |
| Next.js | 14.2.35 | Existing UI; no redesign; upgrade path tracked separately |
| React | 18.3.1 | Compatible with Next 14 |
| Express | 4.22.x | Existing API; stable |
| Prisma | 5.22.x | Existing ORM and schema source of truth |
| SQLite / PostgreSQL 16 | current | Dev parity + managed production database |
| Zod | 3.25.x | Runtime contracts, small footprint |
| Helmet | 8.3.x | Standard security headers |
| express-rate-limit | 8.7.x | Maintained throttling with proxy support |
| bcryptjs | 2.4.x | Existing password hashing |
| jsonwebtoken | 9.x | Existing token transport |
| Node test runner | Node 20 | Zero extra test framework |
| GitHub Actions | current | CI without deployment |

## Trial

| Technology | Why | Guardrail |
| --- | --- | --- |
| pgvector | Native vector search at larger corpus sizes | Benchmark before migration; production-only schema |
| OpenTelemetry | Vendor-neutral traces/metrics | Add behind an exporter flag; no hard dependency now |
| Yjs | CRDT collaboration for shared research notes | Only for explicit collaborative documents |
| WebAuthn/passkeys | Stronger authentication | Needs recovery and device-management design |
| IndexedDB + service worker | Offline reads for low-bandwidth users | Never cache grades/tokens insecurely |
| S3-compatible storage | Assignments and resource files | Signed URLs, scanning, quotas |
| Playwright | End-to-end/browser accessibility tests | Separate CI job; no deployment |

## Hold

| Technology | Reason |
| --- | --- |
| Microservices | Unjustified operational cost at this scale |
| Separate vector database | Duplicates PostgreSQL; adds a vendor and cost |
| Kafka/Redis Streams | Overkill for departmental event volume; DB outbox first |
| Full LTI/QTI suite | No counterpart or certification harness yet |
| Automatic major upgrades | Next 16/React 19 migration needs a dedicated test cycle |
| Client-side AI calls | Leaks credentials and bypasses cost/audit controls |
| CRDT for every text field | Complexity without collaboration value |

## Upgrade policy

1. Read the official changelog and security advisories.
2. Pin exact compatible versions; update the lockfile in an isolated commit.
3. Run schema validation, unit/integration tests, the production build and AI evals.
4. Record breaking changes and rollback steps in the PR.
