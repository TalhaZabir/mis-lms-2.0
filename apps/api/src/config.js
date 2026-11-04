const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function float(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

const INSECURE_JWT_SECRETS = new Set([
  'mis-du-dev-secret-change-me',
  'dev-only-change-me-before-production-32-chars-minimum',
  'test-only-secret-please-change-0123456789abcdef',
  'eval-only-secret-please-change-0123456789abcdef',
]);

const jwtSecret = process.env.JWT_SECRET || 'mis-du-dev-secret-change-me';
if (isProduction && (INSECURE_JWT_SECRETS.has(jwtSecret) || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be a random value of at least 32 characters in production');
}

const corsOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isProduction && (!process.env.CORS_ORIGINS || corsOrigins.includes('*'))) {
  throw new Error('CORS_ORIGINS must list explicit production origins (never *)');
}

const trustProxyRaw = process.env.TRUST_PROXY;
const trustProxy = trustProxyRaw === undefined
  ? (isProduction ? 1 : false)
  : (trustProxyRaw === 'true' ? true : (trustProxyRaw === 'false' ? false : int(trustProxyRaw, false)));

const aiEnabled = bool(process.env.AI_ENABLED, false);

module.exports = {
  version: '2.0.0',
  env: NODE_ENV,
  isProduction,
  isTest,
  port: int(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES || '7d',
  },
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 168),
  corsOrigins,
  trustProxy,
  jsonLimit: process.env.JSON_LIMIT || '2mb',
  allowPublicRegistration: bool(process.env.ALLOW_PUBLIC_REGISTRATION, false),
  rateLimit: {
    windowMs: int(process.env.RATE_WINDOW_MS, 60000),
    max: int(process.env.RATE_MAX, 300),
    authWindowMs: int(process.env.AUTH_RATE_WINDOW_MS, 15 * 60 * 1000),
    authMax: int(process.env.AUTH_RATE_MAX, 10),
    aiMax: int(process.env.AI_RATE_MAX, 20),
  },
  features: {
    search: bool(process.env.FEATURES_SEARCH, true),
    ai: aiEnabled,
    workers: bool(process.env.WORKERS_INLINE, !isTest),
    events: bool(process.env.EVENTS_INLINE, !isTest),
    realtime: bool(process.env.FEATURES_REALTIME, true),
  },
  worker: {
    intervalMs: int(process.env.WORKER_INTERVAL_MS, 5000),
    batchSize: int(process.env.WORKER_BATCH_SIZE, 20),
  },
  ai: {
    enabled: aiEnabled,
    provider: process.env.AI_PROVIDER || 'mock',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'mock-1',
    embeddingModel: process.env.AI_EMBEDDING_MODEL || 'hash-384',
    embeddingDim: int(process.env.AI_EMBEDDING_DIM, 384),
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 20000),
    maxInputChars: int(process.env.AI_MAX_INPUT_CHARS, 8000),
    maxOutputTokens: int(process.env.AI_MAX_OUTPUT_TOKENS, 700),
    temperature: float(process.env.AI_TEMPERATURE, 0.2),
    dailyBudgetUsd: float(process.env.AI_DAILY_BUDGET_USD, 1),
    dailyRequests: int(process.env.AI_DAILY_REQUESTS, 100),
    fallbackToMock: bool(process.env.AI_FALLBACK_TO_MOCK, true),
    costPer1kPrompt: float(process.env.AI_COST_PER_1K_PROMPT, 0),
    costPer1kCompletion: float(process.env.AI_COST_PER_1K_COMPLETION, 0),
    chunkSize: int(process.env.AI_CHUNK_SIZE, 900),
    chunkOverlap: int(process.env.AI_CHUNK_OVERLAP, 120),
    retrievalLimit: int(process.env.AI_RETRIEVAL_LIMIT, 6),
    candidateLimit: int(process.env.AI_CANDIDATE_LIMIT, 600),
  },
};
