const crypto = require('crypto');

function normalizeVector(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09ff\s.-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 20000);
}

/**
 * Deterministic local embedding. It is not a semantic model, but it provides a
 * stable, offline, zero-cost vector space for development, tests and the mock
 * provider. Production deployments should configure an embedding provider.
 */
function hashEmbedding(text, dim = 384) {
  const vector = new Float64Array(dim);
  const tokens = tokenize(text);
  if (!tokens.length) return Array.from(vector);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  for (const [token, count] of counts) {
    const digest = crypto.createHash('sha256').update(token).digest();
    const index = digest.readUInt32BE(0) % dim;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    const weight = 1 + Math.log(count);
    vector[index] += sign * weight;
    // Add a second projection to reduce collisions for short texts.
    const index2 = digest.readUInt32BE(5) % dim;
    vector[index2] += sign * weight * 0.5;
  }
  return normalizeVector(Array.from(vector));
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function chunkText(text, { size = 900, overlap = 120 } = {}) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const sentences = splitSentences(clean);
  const chunks = [];
  let buffer = '';
  for (const sentence of sentences) {
    if (sentence.length > size) {
      if (buffer) {
        chunks.push(buffer.trim());
        buffer = '';
      }
      for (let start = 0; start < sentence.length; start += size - overlap) {
        chunks.push(sentence.slice(start, start + size).trim());
      }
      continue;
    }
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (candidate.length > size) {
      if (buffer) chunks.push(buffer.trim());
      const tail = buffer.slice(Math.max(0, buffer.length - overlap));
      buffer = `${tail} ${sentence}`.trim();
    } else {
      buffer = candidate;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.filter((chunk) => chunk.length > 20).slice(0, 400);
}

function keywordScore(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const haystack = String(text || '').toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) hits += 1;
  }
  return hits / queryTokens.length;
}

function similarity(a, b) {
  const left = String(a || '').toLowerCase();
  const right = String(b || '').toLowerCase();
  if (!left || !right) return 0;
  if (left === right) return 1;
  const max = Math.max(left.length, right.length);
  if (Math.abs(left.length - right.length) / max > 0.6) return 0;
  const previous = new Array(right.length + 1).fill(0).map((_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let last = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temp = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        last + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      last = temp;
    }
  }
  return 1 - previous[right.length] / max;
}

module.exports = {
  hashEmbedding,
  cosine,
  estimateTokens,
  chunkText,
  keywordScore,
  tokenize,
  similarity,
  normalizeVector,
};
