# ADR 0004 — Portable RAG first, pgvector later

Status: Accepted

## Context
Local development and tests use SQLite; production uses PostgreSQL. Requiring
pgvector would break SQLite parity and add a production-only schema. The initial
knowledge corpus is small (departmental courses and approved resources).

## Decision
Store chunk embeddings as JSON arrays and rank with cosine similarity in the API
process, combined with keyword scoring and metadata filters. Provide provider
adapters so embeddings can come from an OpenAI-compatible endpoint or a deterministic
local mock. Document and benchmark a pgvector + HNSW upgrade for corpora above
5,000 chunks.

## Consequences
- Identical behaviour in SQLite and PostgreSQL.
- No production-only migration is required in this project.
- In-process scoring is adequate for a small corpus but must be replaced before it
  becomes a bottleneck.
- Embedding storage is larger than a native vector column; acceptable at this scale.
