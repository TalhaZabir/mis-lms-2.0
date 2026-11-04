const express = require('express');
const prisma = require('../db');
const { auth, requireRoles } = require('../auth');
const router = express.Router();
router.use(auth());

const CURATORS = ['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY'];

// Browse: verified by default; curators can pass ?all=1; filter ?category=&q=&courseId=
router.get('/resources', async (req, res) => {
  const { category, q, courseId, all } = req.query;
  const canSeeAll = CURATORS.includes(req.user.role) && all === '1';
  const where = {
    ...(canSeeAll ? {} : { isVerified: true }),
    ...(category ? { category } : {}),
    ...(courseId ? { courseId } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }, { tags: { contains: q } }] } : {}),
  };
  const rows = await prisma.resource.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 200,
    include: { addedBy: { select: { id: true, name: true, role: true } }, _count: { select: { votes: true } } }
  }).catch(() => prisma.resource.findMany({ take: 200 }));
  res.json(rows);
});

// Suggest (any logged user; creates UNVERIFIED + notifies curators via notification rows)
router.post('/resources/suggest', async (req, res) => {
  const { title, url, category, description, tags, forProgram, courseId } = req.body;
  if (!title || !url) return res.status(400).json({ error: 'title,url required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  const dup = await prisma.resource.findFirst({ where: { url } });
  if (dup) return res.status(400).json({ error: 'Duplicate URL exists: ' + dup.id });
  const row = await prisma.resource.create({ data: { title, url, category: category || 'COURSE_MAT', description, tags, forProgram, courseId, addedById: req.user.id, isVerified: false } });
  // notify curators (faculty/admin) – best effort
  const curators = await prisma.user.findMany({ where: { role: { in: CURATORS } }, select: { id: true }, take: 20 }).catch(() => []);
  if (curators.length) {
    await prisma.notification.createMany({ data: curators.map(c => ({ userId: c.id, title: 'New resource suggestion', body: `${title} by ${req.user.id}`, link: '/resources' })) }).catch(() => {});
  }
  res.json(row);
});

// Direct verified create (curators)
router.post('/resources', requireRoles(...CURATORS), async (req, res) => {
  try { res.json(await prisma.resource.create({ data: { ...req.body, addedById: req.user.id, isVerified: true } })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Verify queue + action (faculty-curated: suggest -> staff triage -> faculty verify)
router.get('/resources/queue', requireRoles(...CURATORS), async (req, res) => {
  res.json(await prisma.resource.findMany({ where: { isVerified: false, brokenFlag: false }, orderBy: { createdAt: 'asc' }, take: 100 }));
});
router.put('/resources/:id/verify', requireRoles(...CURATORS), async (req, res) => {
  const approve = req.body.approve !== false;
  const row = await prisma.resource.update({ where: { id: req.params.id }, data: { isVerified: approve } });
  // notify suggester on approval
  await prisma.notification.create({ data: { userId: row.addedById, title: approve ? 'Your resource was verified ✅' : 'Resource not approved', body: row.title, link: '/resources' } }).catch(() => {});
  try { global.__mis_io?.emit('notification', { userId: row.addedById, title: 'Resource verified', id: row.id }); } catch {}
  res.json(row);
});
router.delete('/resources/:id', requireRoles(...CURATORS), async (req, res) => {
  await prisma.resource.delete({ where: { id: req.params.id } }); res.json({ ok: true });
});

// Upvote / bookmark toggles
router.post('/resources/:id/vote', async (req, res) => {
  const resourceId = req.params.id, userId = req.user.id;
  const ex = await prisma.resourceVote.findUnique({ where: { resourceId_userId: { resourceId, userId } } }).catch(() => null);
  if (ex) { await prisma.resourceVote.delete({ where: { resourceId_userId: { resourceId, userId } } }); return res.json({ voted: false }); }
  await prisma.resourceVote.create({ data: { resourceId, userId } }); res.json({ voted: true });
});
router.post('/resources/:id/bookmark', async (req, res) => {
  const resourceId = req.params.id, userId = req.user.id;
  const ex = await prisma.resourceBookmark.findUnique({ where: { resourceId_userId: { resourceId, userId } } }).catch(() => null);
  if (ex) { await prisma.resourceBookmark.delete({ where: { resourceId_userId: { resourceId, userId } } }); return res.json({ saved: false }); }
  await prisma.resourceBookmark.create({ data: { resourceId, userId } }); res.json({ saved: true });
});
router.get('/me/bookmarks', async (req, res) => {
  const rows = await prisma.resourceBookmark.findMany({ where: { userId: req.user.id }, include: { resource: true }, take: 200 });
  res.json(rows.map(b => b.resource));
});
router.post('/resources/:id/report-broken', async (req, res) => {
  res.json(await prisma.resource.update({ where: { id: req.params.id }, data: { brokenFlag: true } }));
});

// Weekly link checker (cron hits this; curators manual too)
router.post('/resources/check-links', requireRoles(...CURATORS), async (req, res) => {
  const rows = await prisma.resource.findMany({ where: { isVerified: true, brokenFlag: false }, take: 100 });
  let broken = 0;
  for (const r of rows.slice(0, 20)) { // cap 20/run
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
      const resp = await fetch(r.url, { method: 'HEAD', signal: ctl.signal });
      clearTimeout(t);
      if (resp.status >= 400) { await prisma.resource.update({ where: { id: r.id }, data: { brokenFlag: true } }); broken++; }
    } catch { await prisma.resource.update({ where: { id: r.id }, data: { brokenFlag: true } }); broken++; }
  }
  res.json({ checked: Math.min(rows.length, 20), markedBroken: broken });
});

// ---------- Unified notifications ----------
router.get('/me/notifications', async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }));
});
router.put('/notifications/:id/read', async (req, res) => {
  res.json(await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } }));
});
router.post('/notifications', requireRoles(...CURATORS), async (req, res) => {
  const { userIds, title, body, link } = req.body;
  if (!title || !userIds?.length) return res.status(400).json({ error: 'title + userIds[] required' });
  res.json(await prisma.notification.createMany({ data: userIds.map(userId => ({ userId, title, body, link })) }));
});

module.exports = router;
