const crypto = require('crypto');
const prisma = require('../db');
const { errors } = require('./errors');
const { logger } = require('./logger');

const TTL_MS = 24 * 60 * 60 * 1000;

function hashRequest(req) {
  return crypto
    .createHash('sha256')
    .update(`${req.method}|${req.baseUrl || ''}${req.path}|${JSON.stringify(req.body || {})}`)
    .digest('hex');
}

function idempotency() {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];
    if (!key) return next();
    if (!req.user) return next(errors.unauthenticated());
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      return next(errors.badRequest('Idempotency-Key must be 8–128 characters'));
    }

    const requestHash = hashRequest(req);
    try {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { userId_key: { userId: req.user.id, key } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return next(errors.conflict('This Idempotency-Key was already used with a different request'));
        }
        res.setHeader('Idempotent-Replayed', 'true');
        try {
          return res.status(existing.statusCode).json(JSON.parse(existing.response));
        } catch {
          await prisma.idempotencyKey.delete({ where: { id: existing.id } }).catch(() => {});
        }
      }
    } catch (error) {
      return next(error);
    }

    const originalJson = res.json.bind(res);
    let captured = false;
    res.json = (body) => {
      if (captured || res.statusCode >= 500) return originalJson(body);
      captured = true;
      prisma.idempotencyKey.create({
        data: {
          userId: req.user.id,
          key,
          requestHash,
          method: req.method,
          path: `${req.baseUrl || ''}${req.path}`,
          statusCode: res.statusCode,
          response: JSON.stringify(body),
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      }).catch((error) => {
        if (error.code !== 'P2002') logger.warn('idempotency_save_failed', { error: logger.serializeError(error) });
      }).finally(() => originalJson(body));
      return res;
    };
    next();
  };
}

async function cleanupExpiredIdempotencyKeys() {
  return prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

module.exports = { idempotency, cleanupExpiredIdempotencyKeys };
