const express = require('express');
const prisma = require('../../db');
const { requireAuth } = require('../../core/auth');
const { asyncHandler } = require('../../core/errors');
const { z, validateQuery } = require('../../core/validate');
const { getUserAudience, isModerator, isAdmin } = require('../../core/access');
const { authorizedDocuments } = require('../ai/rag');
const { similarity } = require('../ai/embeddings');
const { inc, observe } = require('../../core/metrics');
const { logger } = require('../../core/logger');

const router = express.Router();
router.use(requireAuth);

const TYPES = ['course', 'resource', 'people', 'post', 'knowledge'];

const searchQuery = z.object({
  q: z.string().trim().min(2, 'Enter at least two characters').max(120),
  types: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).passthrough();

function scoreText(query, title, body = '') {
  const normalized = query.toLowerCase().trim();
  const haystackTitle = String(title || '').toLowerCase();
  const haystackBody = String(body || '').toLowerCase();
  let score = 0;
  if (haystackTitle === normalized) score += 1;
  else if (haystackTitle.startsWith(normalized)) score += 0.85;
  else if (haystackTitle.includes(normalized)) score += 0.7;
  if (haystackBody.includes(normalized)) score += 0.4;
  const titleSimilarity = similarity(normalized, haystackTitle);
  if (titleSimilarity > 0.45) score += titleSimilarity * 0.35;
  return Math.min(1, Math.round(score * 1000) / 1000);
}

async function postVisibilityWhere(user) {
  if (isModerator(user)) return { isHidden: false };
  const audience = await getUserAudience(user.id);
  const or = [{ visibility: 'MIS_PUBLIC' }, { authorId: user.id }];
  if (user.role === 'ALUMNI') or.push({ visibility: 'ALUMNI_CIRCLE' });
  if (audience.programIds.length) or.push({ visibility: 'PROGRAM', programId: { in: audience.programIds } });
  if (audience.batchIds.length) or.push({ visibility: 'BATCH', batchId: { in: audience.batchIds } });
  return { isHidden: false, OR: or };
}

router.get('/search', validateQuery(searchQuery), asyncHandler(async (req, res) => {
  const started = Date.now();
  const query = req.query.q.replace(/\s+/g, ' ').trim();
  const requested = (req.query.types || '')
    .split(',')
    .map((type) => type.trim().toLowerCase())
    .filter((type) => TYPES.includes(type));
  const types = requested.length ? requested : TYPES;
  const limit = req.query.limit || 30;

  const [courses, resources, people, posts, knowledgeDocs] = await Promise.all([
    types.includes('course')
      ? prisma.course.findMany({
        where: {
          OR: [
            { code: { contains: query } },
            { title: { contains: query } },
            { description: { contains: query } },
          ],
        },
        include: { program: { select: { code: true, name: true } } },
        take: 20,
      })
      : [],
    types.includes('resource')
      ? prisma.resource.findMany({
        where: {
          isVerified: true,
          brokenFlag: false,
          OR: [
            { title: { contains: query } },
            { description: { contains: query } },
            { tags: { contains: query } },
          ],
        },
        include: { course: { select: { code: true } }, addedBy: { select: { name: true } } },
        take: 20,
      })
      : [],
    types.includes('people')
      ? prisma.user.findMany({
        where: {
          isActive: true,
          ...(isAdmin(req.user)
            ? { OR: [{ name: { contains: query } }, { email: { contains: query } }] }
            : { name: { contains: query } }),
        },
        select: { id: true, name: true, role: true },
        take: 15,
      })
      : [],
    types.includes('post')
      ? prisma.socialPost.findMany({
        where: { ...(await postVisibilityWhere(req.user)), body: { contains: query } },
        include: { author: { select: { id: true, name: true, role: true } }, _count: { select: { likes: true, comments: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
      : [],
    types.includes('knowledge') ? authorizedDocuments(req.user) : [],
  ]);

  const results = [];
  for (const course of courses) {
    results.push({
      type: 'course',
      id: course.id,
      title: `${course.code} — ${course.title}`,
      subtitle: course.program?.name || 'Course',
      url: '/learn',
      score: scoreText(query, `${course.code} ${course.title}`, course.description || ''),
      meta: { code: course.code, credits: course.credits },
    });
  }
  for (const resource of resources) {
    results.push({
      type: 'resource',
      id: resource.id,
      title: resource.title,
      subtitle: `${resource.category}${resource.course?.code ? ` · ${resource.course.code}` : ''}`,
      url: '/resources',
      score: scoreText(query, resource.title, `${resource.description || ''} ${resource.tags || ''}`),
      meta: { url: resource.url, category: resource.category },
    });
  }
  for (const person of people) {
    results.push({
      type: 'people',
      id: person.id,
      title: person.name,
      subtitle: person.role,
      url: '/connect',
      score: scoreText(query, person.name, person.role),
      meta: { role: person.role },
    });
  }
  for (const post of posts) {
    results.push({
      type: 'post',
      id: post.id,
      title: post.body.slice(0, 120),
      subtitle: `${post.author?.name || 'Unknown'} · ${post.visibility}`,
      url: '/connect',
      score: scoreText(query, post.body.slice(0, 200), post.body) * 0.9,
      snippet: post.body.slice(0, 220),
      meta: { visibility: post.visibility, author: post.author?.name },
    });
  }

  let knowledgeSnippets = new Map();
  if (knowledgeDocs.length) {
    const matches = knowledgeDocs.filter((doc) => scoreText(query, doc.title) > 0);
    const docIds = knowledgeDocs.map((doc) => doc.id);
    if (docIds.length) {
      const chunks = await prisma.knowledgeChunk.findMany({
        where: { documentId: { in: docIds }, text: { contains: query } },
        select: { documentId: true, text: true },
        take: 40,
      });
      for (const chunk of chunks) {
        if (!knowledgeSnippets.has(chunk.documentId)) knowledgeSnippets.set(chunk.documentId, chunk.text.slice(0, 220));
      }
    }
    for (const doc of knowledgeDocs) {
      const snippet = knowledgeSnippets.get(doc.id) || '';
      const score = scoreText(query, doc.title, snippet);
      if (score <= 0) continue;
      results.push({
        type: 'knowledge',
        id: doc.id,
        title: doc.title,
        subtitle: `${doc.kind} · ${doc.visibility}`,
        url: '/assistant',
        score,
        snippet,
        meta: { kind: doc.kind, visibility: doc.visibility, courseId: doc.courseId },
      });
    }
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const limited = results.slice(0, limit);
  const facets = {};
  for (const result of results) facets[result.type] = (facets[result.type] || 0) + 1;
  const suggestions = [...new Set(results.slice(0, 8).map((result) => result.title))].slice(0, 5);
  const tookMs = Date.now() - started;

  prisma.searchLog.create({
    data: {
      query: query.slice(0, 120),
      types: types.join(','),
      resultCount: results.length,
      latencyMs: tookMs,
    },
  }).catch((error) => logger.warn('search_log_failed', { error: logger.serializeError(error) }));
  inc('mis_search_requests_total', { status: 'ok' });
  observe('mis_search_latency_ms', {}, tookMs);

  res.json({ query, types, results: limited, facets, suggestions, total: results.length, tookMs });
}));

router.get('/search/suggest', validateQuery(z.object({
  q: z.string().trim().min(2).max(120),
}).passthrough()), asyncHandler(async (req, res) => {
  const query = req.query.q.replace(/\s+/g, ' ').trim();
  const [courses, resources] = await Promise.all([
    prisma.course.findMany({
      where: { OR: [{ code: { contains: query } }, { title: { contains: query } }] },
      select: { code: true, title: true },
      take: 5,
    }),
    prisma.resource.findMany({
      where: { isVerified: true, title: { contains: query } },
      select: { title: true },
      take: 5,
    }),
  ]);
  res.json({
    suggestions: [
      ...courses.map((course) => ({ label: `${course.code} — ${course.title}`, type: 'course' })),
      ...resources.map((resource) => ({ label: resource.title, type: 'resource' })),
    ].slice(0, 8),
  });
}));

module.exports = router;
