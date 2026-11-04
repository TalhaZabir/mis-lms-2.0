const { ZodError } = require('zod');
const { logger } = require('./logger');
const config = require('../config');

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
  }
}

const errors = {
  badRequest: (message = 'Invalid request', details) => new AppError(400, 'BAD_REQUEST', message, details),
  unauthenticated: (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message = 'Resource already exists', details) => new AppError(409, 'CONFLICT', message, details),
  tooMany: (message = 'Too many requests — slow down') => new AppError(429, 'RATE_LIMITED', message),
  unavailable: (message = 'Service temporarily unavailable') => new AppError(503, 'UNAVAILABLE', message),
  internal: (message = 'Internal error') => new AppError(500, 'INTERNAL_ERROR', message),
};

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Not found: ${req.method} ${req.path}`));
}

function mapPrismaError(error) {
  if (!error || typeof error.code !== 'string') return null;
  if (error.code === 'P2002') {
    const fields = error.meta?.target;
    return new AppError(409, 'CONFLICT', 'A record with these values already exists', fields ? { fields } : undefined);
  }
  if (error.code === 'P2025') return new AppError(404, 'NOT_FOUND', 'Record not found');
  if (error.code === 'P2003') return new AppError(400, 'INVALID_REFERENCE', 'Referenced record does not exist');
  if (error.code === 'P2014') return new AppError(409, 'RELATION_CONFLICT', 'This change would break a required relationship');
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  let err = error;
  if (error instanceof ZodError) {
    err = new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })));
  } else if (!(error instanceof AppError)) {
    if (error.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400)) {
      err = new AppError(400, 'VALIDATION_ERROR', 'Malformed JSON body');
    } else if (error.type === 'entity.too.large') {
      err = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    } else {
      err = mapPrismaError(error) || error;
    }
  }

  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) {
    logger.error('unhandled_error', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl?.split('?')[0],
      userId: req.user?.id,
      error: logger.serializeError(err),
    });
  }

  const body = {
    error: status >= 500 && config.isProduction ? 'Internal error' : (err.message || 'Internal error'),
    code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
    requestId: req.id,
  };
  if (err.details && status < 500) body.details = err.details;
  if (!config.isProduction && status >= 500 && err.stack) body.stack = err.stack;
  res.status(status).json(body);
}

module.exports = { AppError, errors, asyncHandler, notFoundHandler, errorHandler };
