const crypto = require('crypto');
const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || (config.isProduction ? LEVELS.info : LEVELS.debug);
const SENSITIVE = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|credential)/i;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    if (value instanceof Error) return serializeError(value);
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE.test(key) ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: config.isProduction ? undefined : error.stack,
  };
}

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: 'mis-lms-api',
    msg: message,
    ...redact(meta || {}),
  };
  const line = config.isProduction || config.isTest ? JSON.stringify(entry) : `${entry.ts} ${level.toUpperCase()} ${message} ${JSON.stringify(redact(meta || {}))}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const logger = {
  debug: (message, meta) => emit('debug', message, meta),
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
  child: (bindings) => ({
    debug: (message, meta) => emit('debug', message, { ...bindings, ...(meta || {}) }),
    info: (message, meta) => emit('info', message, { ...bindings, ...(meta || {}) }),
    warn: (message, meta) => emit('warn', message, { ...bindings, ...(meta || {}) }),
    error: (message, meta) => emit('error', message, { ...bindings, ...(meta || {}) }),
  }),
  redact,
  serializeError,
};

function requestContext() {
  return (req, res, next) => {
    req.id = req.headers['x-request-id'] && String(req.headers['x-request-id']).length < 100
      ? String(req.headers['x-request-id'])
      : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('request', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl?.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: req.user?.id,
        ip: req.ip,
      });
    });
    next();
  };
}

module.exports = { logger, requestContext };
