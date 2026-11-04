const { z } = require('zod');

const zId = z.string().trim().min(1).max(64);
const zEmail = z.string().trim().toLowerCase().email().max(254);
const zName = z.string().trim().min(1).max(120);
const zPassword = z.string().min(10).max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');
const zShortText = z.string().trim().max(500);
const zLongText = z.string().trim().min(1).max(20000);
const zDate = z.coerce.date();
const zUrl = z.string().trim().url().max(2000).refine((value) => {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, 'Only http(s) URLs without embedded credentials are allowed');

const zPagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).passthrough();

function validate(schema) {
  return (req, res, next) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body ?? {});
      if (schema.query) req.query = schema.query.parse(req.query ?? {});
      if (schema.params) req.params = schema.params.parse(req.params ?? {});
      next();
    } catch (error) {
      next(error);
    }
  };
}

function validateBody(schema) {
  return validate({ body: schema });
}

function validateQuery(schema) {
  return validate({ query: schema });
}

function paginationFrom(req, defaultLimit = 50) {
  const parsed = zPagination.safeParse(req.query || {});
  if (!parsed.success) return { take: defaultLimit, skip: 0, limit: defaultLimit, offset: 0 };
  return {
    take: parsed.data.limit,
    skip: parsed.data.offset,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  };
}

module.exports = {
  z,
  zId,
  zEmail,
  zName,
  zPassword,
  zShortText,
  zLongText,
  zDate,
  zUrl,
  zPagination,
  validate,
  validateBody,
  validateQuery,
  paginationFrom,
};
