const prisma = require('../db');
const { logger } = require('./logger');

function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitize);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (/(password|token|secret|hash)/i.test(key)) continue;
      out[key] = sanitize(val);
    }
    return out;
  }
  return value;
}

async function audit(req, action, { targetType, targetId, before, after, meta } = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action,
        ip: String(req.ip || '').slice(0, 100) || null,
        requestId: req.id || null,
        meta: JSON.stringify(sanitize({
          targetType,
          targetId,
          before,
          after,
          ...(meta || {}),
        })),
      },
    });
  } catch (error) {
    logger.error('audit_write_failed', { action, error: logger.serializeError(error) });
  }
}

module.exports = { audit, sanitize };
