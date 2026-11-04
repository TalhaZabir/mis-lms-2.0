const express = require('express');
const prisma = require('../../db');
const config = require('../../config');
const { requireAuth } = require('../../core/auth');
const { errors, asyncHandler } = require('../../core/errors');
const { z, validateBody, validateQuery, paginationFrom } = require('../../core/validate');
const { RateLimiter } = require('../../core/rate-limit');
const { idempotency } = require('../../core/idempotency');
const { audit } = require('../../core/audit');
const { TEACH_ROLES, ADMIN_ROLES, isAdmin, assertCanManageKnowledge } = require('../../core/access');
const {
  SYSTEM_PROMPT,
  screenQuestion,
  retrieve,
  answerQuestion,
  ingestDocument,
  reindexAll,
  recordUsage,
  assertWithinBudget,
  buildCitations,
  ensureCitations,
} = require('./rag');
const { getProvider, fallbackProvider, logProviderFailure } = require('./providers');
const { listTools, executeTool } = require('./tools');
const { estimateTokens } = require('./embeddings');

const router = express.Router();
router.use(requireAuth);

const aiLimiter = new RateLimiter({
  name: 'ai',
  windowMs: 60_000,
  max: config.rateLimit.aiMax,
  keyGenerator: (req) => req.user?.id || req.ip || 'anonymous',
  message: 'Too many assistant requests — please wait a moment.',
});

const HISTORY = z.array(z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().max(4000),
})).max(6).optional();

const askSchema = z.object({
  question: z.string().trim().min(3, 'Ask a slightly longer question').max(2000),
  courseId: z.string().trim().max(64).optional(),
  history: HISTORY,
}).strict();

const feedbackSchema = z.object({
  usageId: z.string().trim().max(64).optional(),
  helpful: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(1000).optional(),
}).strict();

const ROLES = ['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY', 'TA', 'STUDENT', 'ALUMNI', 'MODERATOR'];
const VISIBILITIES = ['INSTITUTION', 'PROGRAM', 'COURSE', 'FACULTY', 'ADMIN', 'ALUMNI'];
const KINDS = ['RESOURCE', 'LESSON', 'POLICY', 'GUIDE', 'SYLLABUS', 'RESEARCH'];
const STATUSES = ['DRAFT', 'APPROVED', 'ARCHIVED'];

const knowledgeSchema = z.object({
  title: z.string().trim().min(3).max(200),
  content: z.string().trim().min(20).max(200_000),
  kind: z.enum(KINDS).default('GUIDE'),
  visibility: z.enum(VISIBILITIES).default('INSTITUTION'),
  sourceUrl: z.string().trim().url().max(2000).optional(),
  courseId: z.string().trim().max(64).optional(),
  offeringId: z.string().trim().max(64).optional(),
  programCode: z.string().trim().max(40).optional(),
  allowedRoles: z.array(z.enum(ROLES)).max(7).optional(),
}).strict();

const knowledgeUpdateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  content: z.string().trim().min(20).max(200_000).optional(),
  kind: z.enum(KINDS).optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  sourceUrl: z.string().trim().url().max(2000).optional(),
  courseId: z.string().trim().max(64).optional(),
  offeringId: z.string().trim().max(64).optional(),
  programCode: z.string().trim().max(40).optional(),
  allowedRoles: z.array(z.enum(ROLES)).max(7).optional(),
}).strict();

const knowledgeQuery = z.object({
  status: z.enum(STATUSES).optional(),
  courseId: z.string().trim().max(64).optional(),
  q: z.string().trim().max(120).optional(),
}).passthrough();

function assertVisibilityAllowed(user, visibility) {
  if (!visibility || isAdmin(user)) return;
  if (!['COURSE', 'FACULTY'].includes(visibility)) {
    throw errors.forbidden('Only administrators can publish institution-wide, programme-wide or admin-only knowledge');
  }
}

async function assertCanAttachCourse(user, courseId) {
  if (!courseId) return;
  if (isAdmin(user)) return;
  if (!['FACULTY', 'TA'].includes(user.role)) throw errors.forbidden('Only teaching staff can attach a course');
  const offering = await prisma.offering.findFirst({
    where: { courseId, faculty: { some: { userId: user.id } } },
    select: { id: true },
  });
  if (!offering) throw errors.forbidden('You do not teach this course');
}

async function assertVisibleDocument(user, document) {
  if (isAdmin(user) || document.ownerId === user.id) return;
  const allowed = document.allowedRoles ? JSON.parse(document.allowedRoles || '[]') : [];
  if (allowed.length && !allowed.includes(user.role)) throw errors.forbidden('You cannot manage this document');
  await assertCanManageKnowledge(user, document);
}

router.get('/ai/status', asyncHandler(async (req, res) => {
  const provider = getProvider();
  res.json({
    enabled: config.ai.enabled,
    provider: provider.name,
    model: provider.model,
    embeddingModel: provider.embeddingModel,
    configured: provider.configured,
    readOnlyTools: listTools(req.user),
    limits: {
      maxInputChars: config.ai.maxInputChars,
      maxOutputTokens: config.ai.maxOutputTokens,
      dailyRequests: config.ai.dailyRequests,
      dailyBudgetUsd: config.ai.dailyBudgetUsd,
    },
    notice: 'The assistant is read-only. It can never change grades, publish results, delete records or change permissions.',
  });
}));

router.post('/ai/ask', aiLimiter.middleware(), idempotency(), validateBody(askSchema), asyncHandler(async (req, res) => {
  if (!config.ai.enabled) throw errors.forbidden('The AI assistant is disabled on this deployment');
  const result = await answerQuestion(req.user, {
    question: req.body.question,
    courseId: req.body.courseId,
    history: req.body.history || [],
  });
  res.json(result);
}));

router.post('/ai/ask/stream', aiLimiter.middleware(), validateBody(askSchema), asyncHandler(async (req, res) => {
  if (!config.ai.enabled) throw errors.forbidden('The AI assistant is disabled on this deployment');
  await assertWithinBudget(req.user.id);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const started = Date.now();
  const question = req.body.question;
  if (screenQuestion(question)) {
    const answer = 'I cannot follow instructions that attempt to change my rules or reveal internal prompts. Please ask an academic question about authorized course materials.';
    send('sources', { sources: [] });
    send('delta', { text: answer });
    send('done', { citations: [], grounded: false, provider: 'guardrail', blocked: true });
    await recordUsage({
      userId: req.user.id,
      feature: 'assistant-stream',
      provider: 'guardrail',
      model: 'guardrail',
      usage: { promptTokens: estimateTokens(question), completionTokens: estimateTokens(answer) },
      latencyMs: Date.now() - started,
      status: 'BLOCKED',
    });
    res.end();
    return;
  }

  const retrieval = await retrieve(req.user, question, { courseId: req.body.courseId });
  send('sources', { sources: retrieval.sources.map(({ text, ...source }) => source) });

  let provider = getProvider();
  let status = 'OK';
  let answer = '';
  try {
    for await (const delta of provider.streamChat({
      system: SYSTEM_PROMPT,
      question,
      context: retrieval.sources,
      history: req.body.history || [],
      maxTokens: config.ai.maxOutputTokens,
    })) {
      if (closed) break;
      answer += delta;
      send('delta', { text: delta });
    }
  } catch (error) {
    if (!config.ai.fallbackToMock) {
      send('error', { error: 'The assistant provider is temporarily unavailable.' });
      res.end();
      return;
    }
    logProviderFailure(error);
    provider = fallbackProvider();
    status = 'FALLBACK';
    answer = '';
    send('notice', { message: 'Primary provider unavailable — using a local extractive response.' });
    for await (const delta of provider.streamChat({ system: SYSTEM_PROMPT, question, context: retrieval.sources })) {
      if (closed) break;
      answer += delta;
      send('delta', { text: delta });
    }
  }

  const withCitations = ensureCitations(answer.trim(), retrieval.sources);
  if (withCitations.length > answer.trim().length) {
    send('delta', { text: withCitations.slice(answer.trim().length) });
  }
  const citations = buildCitations(withCitations, retrieval.sources);
  send('done', {
    citations,
    grounded: retrieval.sources.length > 0 && citations.length > 0,
    provider: provider.name,
    model: provider.model,
    latencyMs: Date.now() - started,
    status,
  });
  await recordUsage({
    userId: req.user.id,
    feature: 'assistant-stream',
    provider: provider.name,
    model: provider.model,
    usage: {
      promptTokens: estimateTokens(question) + retrieval.sources.reduce((sum, source) => sum + estimateTokens(source.text), 0),
      completionTokens: estimateTokens(withCitations),
    },
    latencyMs: Date.now() - started,
    status,
  });
  res.end();
}));

router.post('/ai/feedback', validateBody(feedbackSchema), asyncHandler(async (req, res) => {
  let usageId = req.body.usageId || null;
  if (usageId) {
    const usage = await prisma.aiUsage.findUnique({ where: { id: usageId } });
    if (!usage || usage.userId !== req.user.id) throw errors.forbidden('You can only rate your own assistant responses');
  }
  const row = await prisma.aiFeedback.create({
    data: {
      usageId,
      userId: req.user.id,
      helpful: req.body.helpful ?? null,
      rating: req.body.rating ?? null,
      comment: req.body.comment || null,
    },
  });
  res.json({ ok: true, feedback: row });
}));

router.get('/ai/usage/me', asyncHandler(async (req, res) => {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [rows, aggregate] = await Promise.all([
    prisma.aiUsage.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, feature: true, provider: true, model: true,
        promptTokens: true, completionTokens: true, totalTokens: true,
        costUsd: true, latencyMs: true, status: true, createdAt: true,
      },
    }),
    prisma.aiUsage.aggregate({
      where: { userId: req.user.id, createdAt: { gte: since } },
      _sum: { costUsd: true, totalTokens: true },
      _count: true,
    }),
  ]);
  res.json({
    recent: rows,
    today: {
      requests: aggregate._count,
      tokens: aggregate._sum.totalTokens || 0,
      costUsd: Math.round((aggregate._sum.costUsd || 0) * 10000) / 10000,
      dailyRequests: config.ai.dailyRequests,
      dailyBudgetUsd: config.ai.dailyBudgetUsd,
    },
  });
}));

router.get('/ai/knowledge', validateQuery(knowledgeQuery), asyncHandler(async (req, res) => {
  if (!TEACH_ROLES.includes(req.user.role)) throw errors.forbidden('Only teaching staff can manage knowledge documents');
  const { take, skip } = paginationFrom(req, 50);
  let where = {};
  if (!isAdmin(req.user)) {
    const taught = await prisma.offeringFaculty.findMany({ where: { userId: req.user.id }, select: { offering: { select: { courseId: true } } } });
    const courseIds = [...new Set(taught.map((row) => row.offering?.courseId).filter(Boolean))];
    where = { OR: [{ ownerId: req.user.id }, ...(courseIds.length ? [{ courseId: { in: courseIds } }] : [])] };
  }
  if (req.query.status) where.status = req.query.status;
  if (req.query.courseId) where.courseId = req.query.courseId;
  if (req.query.q) where.title = { contains: req.query.q };
  const rows = await prisma.knowledgeDocument.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
    skip,
    select: {
      id: true, title: true, kind: true, visibility: true, status: true,
      sourceUrl: true, courseId: true, programCode: true, version: true,
      createdAt: true, updatedAt: true,
      owner: { select: { id: true, name: true, role: true } },
      _count: { select: { chunks: true } },
    },
  });
  res.json(rows);
}));

router.get('/ai/knowledge/:id', asyncHandler(async (req, res) => {
  if (!TEACH_ROLES.includes(req.user.role)) throw errors.forbidden();
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: req.params.id },
    include: { owner: { select: { id: true, name: true, role: true } }, _count: { select: { chunks: true } } },
  });
  if (!doc) throw errors.notFound('Knowledge document not found');
  if (!isAdmin(req.user) && doc.ownerId !== req.user.id) {
    if (!doc.courseId) throw errors.forbidden('You cannot view this document');
    const teaches = await prisma.offeringFaculty.findFirst({
      where: { userId: req.user.id, offering: { courseId: doc.courseId } },
      select: { userId: true },
    });
    if (!teaches) throw errors.forbidden('You cannot view this document');
  }
  res.json(doc);
}));

router.post('/ai/knowledge', aiLimiter.middleware(), validateBody(knowledgeSchema), asyncHandler(async (req, res) => {
  if (!TEACH_ROLES.includes(req.user.role)) throw errors.forbidden('Only teaching staff can create knowledge documents');
  if (req.body.visibility === 'ADMIN' && !isAdmin(req.user)) throw errors.forbidden('Only administrators can create admin-only knowledge');
  assertVisibilityAllowed(req.user, req.body.visibility);
  await assertCanAttachCourse(req.user, req.body.courseId);
  if (req.body.offeringId) {
    const offering = await prisma.offering.findUnique({ where: { id: req.body.offeringId } });
    if (!offering) throw errors.notFound('Offering not found');
    if (!isAdmin(req.user)) {
      const teaches = await prisma.offeringFaculty.findFirst({ where: { offeringId: req.body.offeringId, userId: req.user.id } });
      if (!teaches) throw errors.forbidden('You do not teach this offering');
    }
  }
  const doc = await prisma.knowledgeDocument.create({
    data: {
      title: req.body.title,
      content: req.body.content,
      kind: req.body.kind,
      visibility: req.body.visibility,
      sourceUrl: req.body.sourceUrl || null,
      courseId: req.body.courseId || null,
      offeringId: req.body.offeringId || null,
      programCode: req.body.programCode || null,
      allowedRoles: req.body.allowedRoles ? JSON.stringify(req.body.allowedRoles) : null,
      ownerId: req.user.id,
      status: 'DRAFT',
    },
  });
  await audit(req, 'knowledge.create', { targetType: 'KnowledgeDocument', targetId: doc.id, after: { title: doc.title, visibility: doc.visibility } });
  res.status(201).json(doc);
}));

router.put('/ai/knowledge/:id', validateBody(knowledgeUpdateSchema), asyncHandler(async (req, res) => {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) throw errors.notFound('Knowledge document not found');
  await assertVisibleDocument(req.user, doc);
  if (req.body.visibility === 'ADMIN' && !isAdmin(req.user)) throw errors.forbidden('Only administrators can create admin-only knowledge');
  assertVisibilityAllowed(req.user, req.body.visibility);
  await assertCanAttachCourse(req.user, req.body.courseId);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });
    return tx.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        ...(req.body.title !== undefined ? { title: req.body.title } : {}),
        ...(req.body.content !== undefined ? { content: req.body.content } : {}),
        ...(req.body.kind !== undefined ? { kind: req.body.kind } : {}),
        ...(req.body.visibility !== undefined ? { visibility: req.body.visibility } : {}),
        ...(req.body.sourceUrl !== undefined ? { sourceUrl: req.body.sourceUrl || null } : {}),
        ...(req.body.courseId !== undefined ? { courseId: req.body.courseId || null } : {}),
        ...(req.body.offeringId !== undefined ? { offeringId: req.body.offeringId || null } : {}),
        ...(req.body.programCode !== undefined ? { programCode: req.body.programCode || null } : {}),
        ...(req.body.allowedRoles !== undefined ? { allowedRoles: req.body.allowedRoles ? JSON.stringify(req.body.allowedRoles) : null } : {}),
        version: { increment: 1 },
        status: 'DRAFT',
        checksum: null,
      },
    });
  });
  await audit(req, 'knowledge.update', { targetType: 'KnowledgeDocument', targetId: doc.id, before: { version: doc.version, status: doc.status }, after: { version: updated.version, status: updated.status } });
  res.json(updated);
}));

router.put('/ai/knowledge/:id/status', validateBody(z.object({ status: z.enum(STATUSES) }).strict()), asyncHandler(async (req, res) => {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) throw errors.notFound('Knowledge document not found');
  await assertVisibleDocument(req.user, doc);
  if (req.body.status === 'APPROVED') {
    if (!isAdmin(req.user) && ['INSTITUTION', 'PROGRAM', 'ADMIN'].includes(doc.visibility)) {
      throw errors.forbidden('Only administrators can approve institution-wide, programme-wide or admin-only knowledge');
    }
    await ingestDocument(doc.id);
  }
  const updated = await prisma.knowledgeDocument.update({
    where: { id: doc.id },
    data: { status: req.body.status },
    include: { _count: { select: { chunks: true } } },
  });
  await audit(req, 'knowledge.status', {
    targetType: 'KnowledgeDocument',
    targetId: doc.id,
    before: { status: doc.status },
    after: { status: updated.status, chunks: updated._count.chunks },
  });
  res.json(updated);
}));

router.delete('/ai/knowledge/:id', asyncHandler(async (req, res) => {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) throw errors.notFound('Knowledge document not found');
  await assertVisibleDocument(req.user, doc);
  await prisma.knowledgeDocument.delete({ where: { id: doc.id } });
  await audit(req, 'knowledge.delete', { targetType: 'KnowledgeDocument', targetId: doc.id, before: { title: doc.title } });
  res.json({ ok: true });
}));

router.post('/ai/knowledge/reindex', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can reindex the whole corpus');
  const results = await reindexAll();
  await audit(req, 'knowledge.reindex', { meta: { documents: results.length } });
  res.json({ ok: true, documents: results.length, chunks: results.reduce((sum, row) => sum + row.chunks, 0) });
}));

router.get('/ai/tools', asyncHandler(async (req, res) => {
  res.json({ readOnly: true, tools: listTools(req.user) });
}));

router.post('/ai/tools/:name', aiLimiter.middleware(), asyncHandler(async (req, res) => {
  if (!config.ai.enabled) throw errors.forbidden('The AI assistant is disabled on this deployment');
  const result = await executeTool(req.params.name, req.user, req.body || {});
  await audit(req, 'ai.tool', { targetType: 'AiTool', targetId: req.params.name, meta: { readOnly: true } });
  res.json(result);
}));

// Keep the reply contract stable for callers that only want to know the status.
router.get('/ai/evaluations', asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) throw errors.forbidden();
  const [total, feedback, lowRated] = await Promise.all([
    prisma.aiUsage.count(),
    prisma.aiFeedback.count(),
    prisma.aiFeedback.count({ where: { helpful: false } }),
  ]);
  res.json({
    usageRecords: total,
    feedbackRecords: feedback,
    negativeFeedback: lowRated,
    benchmark: 'Run `npm run ai:eval` against the versioned benchmark in apps/api/src/modules/ai/eval-dataset.json.',
  });
}));

module.exports = router;
