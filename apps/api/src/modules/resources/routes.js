const express = require('express');
const prisma = require('../../db');
const { requireAuth } = require('../../core/auth');
const { errors, asyncHandler } = require('../../core/errors');
const { z, validateBody, validateQuery, paginationFrom } = require('../../core/validate');
const { audit } = require('../../core/audit');
const { publishEvent } = require('../../core/events');
const { enqueueJob } = require('../../core/jobs');
const { assertHttpUrl, isPrivateHostname } = require('../../core/urls');
const { notifyUsers } = require('../../core/notify');
const { CURATOR_ROLES, ADMIN_ROLES, canViewResource, isAdmin } = require('../../core/access');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['COURSE_MAT', 'TOOLS', 'RESEARCH', 'CAREER', 'SCHOLARSHIP', 'EXAM'];

const resourceSchema = z.object({
  title: z.string().trim().min(2).max(200),
  url: z.string().trim().max(2000),
  category: z.enum(CATEGORIES).optional(),
  description: z.string().trim().max(5000).optional(),
  tags: z.string().trim().max(1000).optional(),
  forProgram: z.string().trim().max(80).optional(),
  courseId: z.string().trim().max(64).optional(),
  content: z.string().trim().max(100000).optional(),
}).strict();

const verifySchema = z.object({ approve: z.boolean().optional() }).strict();
const notificationSchema = z.object({
  userIds: z.array(z.string().trim().min(1).max(64)).min(1).max(500),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(1000).optional(),
  link: z.string().trim().max(500).optional(),
}).strict();

function checkPublicUrl(value) {
  const normalized = assertHttpUrl(value);
  const parsed = new URL(normalized);
  if (isPrivateHostname(parsed.hostname)) {
    throw errors.badRequest('Private, local and metadata hostnames are not allowed as resources');
  }
  return normalized;
}

async function assertResourceVisible(user, resourceId) {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource) throw errors.notFound('Resource not found');
  if (!canViewResource(user, resource)) throw errors.forbidden('This resource is not visible to you');
  return resource;
}

router.get('/resources', validateQuery(z.object({
  category: z.enum(CATEGORIES).optional(),
  q: z.string().trim().max(120).optional(),
  courseId: z.string().trim().max(64).optional(),
  all: z.enum(['0', '1']).optional(),
}).passthrough()), asyncHandler(async (req, res) => {
  const canSeeAll = CURATOR_ROLES.includes(req.user.role) && req.query.all === '1';
  const where = {
    ...(canSeeAll ? {} : { isVerified: true }),
    ...(req.query.category ? { category: req.query.category } : {}),
    ...(req.query.courseId ? { courseId: req.query.courseId } : {}),
    ...(req.query.q ? {
      OR: [
        { title: { contains: req.query.q } },
        { description: { contains: req.query.q } },
        { tags: { contains: req.query.q } },
      ],
    } : {}),
  };
  const { take, skip } = paginationFrom(req, 100);
  const rows = await prisma.resource.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    skip,
    include: {
      addedBy: { select: { id: true, name: true, role: true } },
      course: { select: { code: true, title: true } },
      _count: { select: { votes: true, bookmarks: true } },
    },
  });
  res.json(rows);
}));

router.post('/resources/suggest', validateBody(resourceSchema), asyncHandler(async (req, res) => {
  const url = checkPublicUrl(req.body.url);
  const duplicate = await prisma.resource.findFirst({ where: { url } });
  if (duplicate) throw errors.conflict('A resource with this URL already exists', { resourceId: duplicate.id });
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.resource.create({
      data: {
        title: req.body.title,
        url,
        category: req.body.category || 'COURSE_MAT',
        description: req.body.description || null,
        tags: req.body.tags || null,
        forProgram: req.body.forProgram || null,
        courseId: req.body.courseId || null,
        addedById: req.user.id,
        isVerified: false,
      },
    });
    await publishEvent(tx, 'ResourceSuggested', {
      resourceId: created.id,
      title: created.title,
      addedById: created.addedById,
    });
    return created;
  });
  await audit(req, 'resource.suggest', { targetType: 'Resource', targetId: row.id, after: { title: row.title } });
  res.status(201).json(row);
}));

router.post('/resources', validateBody(resourceSchema), asyncHandler(async (req, res) => {
  if (!CURATOR_ROLES.includes(req.user.role)) throw errors.forbidden('Only curators can publish resources directly');
  const url = checkPublicUrl(req.body.url);
  const duplicate = await prisma.resource.findFirst({ where: { url } });
  if (duplicate) throw errors.conflict('A resource with this URL already exists', { resourceId: duplicate.id });
  const row = await prisma.resource.create({
    data: {
      ...req.body,
      url,
      category: req.body.category || 'COURSE_MAT',
      addedById: req.user.id,
      isVerified: true,
    },
  });
  await audit(req, 'resource.create', { targetType: 'Resource', targetId: row.id, after: { title: row.title, url: row.url } });
  res.status(201).json(row);
}));

router.get('/resources/queue', asyncHandler(async (req, res) => {
  if (!CURATOR_ROLES.includes(req.user.role)) throw errors.forbidden('Curator access required');
  const rows = await prisma.resource.findMany({
    where: { isVerified: false, brokenFlag: false },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: { addedBy: { select: { id: true, name: true, role: true } }, course: { select: { code: true } } },
  });
  res.json(rows);
}));

router.put('/resources/:id/verify', validateBody(verifySchema), asyncHandler(async (req, res) => {
  if (!CURATOR_ROLES.includes(req.user.role)) throw errors.forbidden('Curator access required');
  const before = await prisma.resource.findUnique({ where: { id: req.params.id } });
  if (!before) throw errors.notFound('Resource not found');
  const approve = req.body.approve !== false;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.resource.update({ where: { id: before.id }, data: { isVerified: approve } });
    await publishEvent(tx, 'ResourceApproved', {
      resourceId: updated.id,
      title: updated.title,
      addedById: updated.addedById,
      approved: approve,
      reviewedBy: req.user.id,
    });
    return updated;
  });
  await audit(req, 'resource.review', {
    targetType: 'Resource',
    targetId: row.id,
    before: { isVerified: before.isVerified },
    after: { isVerified: row.isVerified },
  });
  res.json(row);
}));

router.delete('/resources/:id', asyncHandler(async (req, res) => {
  if (!CURATOR_ROLES.includes(req.user.role)) throw errors.forbidden('Curator access required');
  const row = await prisma.resource.delete({ where: { id: req.params.id } });
  await audit(req, 'resource.delete', { targetType: 'Resource', targetId: row.id, before: { title: row.title, url: row.url } });
  res.json({ ok: true });
}));

router.post('/resources/:id/vote', asyncHandler(async (req, res) => {
  const resource = await assertResourceVisible(req.user, req.params.id);
  const existing = await prisma.resourceVote.findUnique({
    where: { resourceId_userId: { resourceId: resource.id, userId: req.user.id } },
  });
  if (existing) {
    await prisma.resourceVote.delete({ where: { resourceId_userId: { resourceId: resource.id, userId: req.user.id } } });
    return res.json({ voted: false });
  }
  await prisma.resourceVote.create({ data: { resourceId: resource.id, userId: req.user.id } });
  res.json({ voted: true });
}));

router.post('/resources/:id/bookmark', asyncHandler(async (req, res) => {
  const resource = await assertResourceVisible(req.user, req.params.id);
  const existing = await prisma.resourceBookmark.findUnique({
    where: { resourceId_userId: { resourceId: resource.id, userId: req.user.id } },
  });
  if (existing) {
    await prisma.resourceBookmark.delete({ where: { resourceId_userId: { resourceId: resource.id, userId: req.user.id } } });
    return res.json({ saved: false });
  }
  await prisma.resourceBookmark.create({ data: { resourceId: resource.id, userId: req.user.id } });
  res.json({ saved: true });
}));

router.get('/me/bookmarks', asyncHandler(async (req, res) => {
  const rows = await prisma.resourceBookmark.findMany({
    where: { userId: req.user.id },
    include: { resource: { include: { course: { select: { code: true, title: true } } } } },
    take: 200,
  });
  res.json(rows.map((row) => row.resource));
}));

router.post('/resources/:id/report-broken', asyncHandler(async (req, res) => {
  const resource = await assertResourceVisible(req.user, req.params.id);
  const row = await prisma.resource.update({ where: { id: resource.id }, data: { brokenFlag: true } });
  await audit(req, 'resource.broken_report', { targetType: 'Resource', targetId: row.id });
  res.json(row);
}));

router.post('/resources/check-links', asyncHandler(async (req, res) => {
  if (!CURATOR_ROLES.includes(req.user.role)) throw errors.forbidden('Curator access required');
  const job = await enqueueJob('resource.check-links', { requestedBy: req.user.id }, {
    dedupeKey: `resource-check:${new Date().toISOString().slice(0, 10)}`,
    maxAttempts: 3,
  });
  res.json({ queued: true, jobId: job?.id || null });
}));

router.get('/me/notifications', validateQuery(z.object({ unread: z.enum(['0', '1']).optional() }).passthrough()), asyncHandler(async (req, res) => {
  const { take, skip } = paginationFrom(req, 50);
  const rows = await prisma.notification.findMany({
    where: {
      userId: req.user.id,
      ...(req.query.unread === '1' ? { isRead: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  });
  res.json(rows);
}));

router.get('/me/notifications/unread-count', asyncHandler(async (req, res) => {
  const count = await prisma.notification.count({ where: { userId: req.user.id, isRead: false } });
  res.json({ count });
}));

router.put('/notifications/:id/read', asyncHandler(async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification) throw errors.notFound('Notification not found');
  if (notification.userId !== req.user.id && !isAdmin(req.user)) throw errors.forbidden('You can only update your own notifications');
  const row = await prisma.notification.update({
    where: { id: notification.id },
    data: { isRead: true, readAt: new Date() },
  });
  res.json(row);
}));

router.put('/notifications/read-all', asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  res.json({ ok: true, updated: result.count });
}));

router.post('/notifications', validateBody(notificationSchema), asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) throw errors.forbidden('Administrator access required to send notifications');
  const rows = await notifyUsers(req.body.userIds, {
    title: req.body.title,
    body: req.body.body,
    link: req.body.link,
    dedupeKey: `manual:${req.id}`,
  });
  await audit(req, 'notification.send', { meta: { recipients: rows.length } });
  res.status(201).json({ ok: true, sent: rows.length });
}));

module.exports = router;
