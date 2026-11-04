# AI assistant and RAG — MIS LMS 2.0

## Goals and non-goals

The assistant helps learners and teaching staff understand **authorized institutional
material**: course guides, academic policy, reading lists and approved knowledge
documents. In the default configuration it is a deterministic, extractive mock that
returns cited sentences. It is not an official records system and does not generate
transcripts, results or regulations.

Non-goals:

- changing grades, publishing results, deleting records or changing permissions,
- replacing the departmental office or official transcript,
- ingesting unrestricted PDFs, images or OCR content,
- calling an external model before an administrator explicitly configures and enables
  one.

## Feature flag

The assistant is disabled by default in `.env.example` and in the API config:

```env
AI_ENABLED=false
AI_PROVIDER=mock
AI_FALLBACK_TO_MOCK=true
```

- `GET /ai/status` is always available to authenticated users and reports the flag,
  provider, model and read-only tools.
- `POST /ai/ask` and `/ai/ask/stream` return 403 while disabled.
- The web navigation only shows the Assistant link when `/ai/status` reports
  `enabled: true`. The `/assistant` page also explains the disabled state.
- The AI panel and tools are not on the critical path; disabling AI leaves the rest of
  the LMS fully functional.

## Provider abstraction

`apps/api/src/modules/ai/providers.js` defines one interface:

- `chat({ system, question, context, history, maxTokens, temperature })`
- `streamChat(...)`
- `embed(texts)`
- metadata: `name`, `model`, `embeddingModel`, `configured`

Implementations:

1. **mock** (default) — no network, deterministic sentence extraction, hash embeddings
   and a local cosine index. This is what the evaluation harness uses.
2. **openai-compatible** — talks to `${AI_BASE_URL}/chat/completions` and
   `${AI_BASE_URL}/embeddings` with `AI_API_KEY`. The key never leaves the server.
   Provider failures are mapped to safe `ProviderError` codes; the mock fallback is
   used only when `AI_FALLBACK_TO_MOCK=true`.

## RAG pipeline

1. **Knowledge documents** are created by teaching staff or administrators with a
   visibility scope: `INSTITUTION`, `PROGRAM`, `COURSE`, `FACULTY`, `ALUMNI` or
   `ADMIN`, optionally a course/programme and an explicit role allowlist.
2. On approval, `ingestDocument` splits the content into overlapping chunks
   (`AI_CHUNK_SIZE=900`, `AI_CHUNK_OVERLAP=120`), creates embeddings, stores token
   counts and metadata, and writes a checksum.
3. Retrieval calls `authorizedDocuments(user)` first. Filtering happens in the
   database query plus an `allowedRoles` post-filter. Draft documents are never
   retrieved.
4. Candidate chunks are scored with a portable combination of cosine similarity,
   keyword coverage and title similarity. This is intentionally small and works in
   SQLite and PostgreSQL without pgvector.
5. The provider receives only authorized context, is told to treat it as data, and is
   required to cite sources as `[1]`, `[2]`, etc.
6. `ensureCitations` adds a source list if the provider omitted markers;
   `buildCitations` validates that cited markers map to real sources.
7. Usage is recorded in `AiUsage` with provider, model, token counts, latency, status
   and cost. Users can submit feedback against the returned `usageId`.

## Access controls

| Knowledge visibility | Who can retrieve it |
| --- | --- |
| `INSTITUTION` | Any authenticated user unless an `allowedRoles` list narrows it |
| `PROGRAM` | Users enrolled/teaching in that programme, or verified alumni in it |
| `COURSE` | Enrolled or teaching users for that course |
| `FACULTY` | Teaching roles |
| `ALUMNI` | Alumni |
| `ADMIN` | Administrators |

Only approved documents are indexed. Faculty can create course/faculty knowledge;
institution-wide, programme-wide and admin-only knowledge requires administrator
approval. Admin-only material never appears in search or assistant retrieval for
students.

## Read-only tools

`apps/api/src/modules/ai/tools.js` exposes a small allowlist such as:

- `my_courses` — the caller's enrolled courses,
- `academic_progress` — advisory credits and GPA,
- `my_teaching` — the caller's teaching assignments.

Tools are read-only by construction. There is no write tool. Calls to `/ai/tools/:name`
enforce the caller's role and return `{ tool, readOnly: true, result }`. The evaluation
suite asserts that asking for progress does not change grade counts.

## Guardrails

- Prompt-injection patterns (`ignore previous instructions`, `reveal the system
  prompt`, jailbreak phrasing and similar) are blocked before retrieval and recorded
  with status `BLOCKED`.
- The system prompt forbids inventing grades, regulations, deadlines, announcements
  or records, and forbids claiming to have changed data.
- Retrieved text is treated as data, not instructions.
- Answers are labelled advisory in the UI and API.
- Daily request and cost budgets are enforced per user before each request.
- AI routes are rate-limited separately from the global API limit.
- Idempotency keys prevent duplicate usage charges and duplicate answers.
- Streaming responses use server-sent events and the same retrieval/guardrail path.

## Evaluation harness

Run:

```bash
npm run ai:eval
```

The harness:

- refuses `NODE_ENV=production` and non-eval/test databases,
- creates a disposable `prisma/eval.db`, applies the schema and seeds fixtures,
- adds three access-control fixtures (admin-only, faculty-only and a role allowlist),
- runs 12 cases covering assessment weights, prerequisites, passing marks,
  attendance, grading scale, reading-list retrieval, prompt injection, admin-only
  denial, faculty visibility denial/allowed and role-allowlist denial/allowed,
- checks groundedness, citation integrity, source titles, forbidden leaks and required
  terms,
- prints per-case results and exits non-zero below the 90% threshold.

Use `AI_EVAL_SKIP_SETUP=1 npm run ai:eval` to reuse an existing eval/test database.
The dataset lives in `apps/api/src/modules/ai/eval-dataset.json`; add cases before
changing prompts or retrieval.

## Usage and feedback

- `GET /ai/usage/me` returns the caller's recent usage.
- `POST /ai/feedback` accepts `usageId`, `helpful`, an optional `rating` and comment;
  only the usage owner can submit feedback.
- Administrators can inspect knowledge and trigger `POST /ai/knowledge/reindex`.
- Usage rows are the basis for budget enforcement and quality review.

## Known limitations

- The default mock is extractive, not generative. It selects cited sentences from
  authorized chunks and cannot reason across documents like a large model.
- Hash embeddings are portable and deterministic but less semantic than a trained
  embedding model.
- pgvector and approximate nearest-neighbour retrieval are deferred until the corpus
  justifies the operational cost.
- PDF/OCR ingestion, conversation memory beyond the last six messages, and a streaming
  frontend are not implemented.
- External providers have not been evaluated with real institutional data; a data
  protection review is required before enabling one.
- The assistant is not a substitute for official departmental advice.
