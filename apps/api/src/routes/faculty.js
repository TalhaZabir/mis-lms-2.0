const express = require('express');
const prisma = require('../db');
const { auth, requireRoles } = require('../auth');
const router = express.Router();
router.use(auth());

const TEACH = ['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY', 'TA'];
const asDate = (v) => (v ? new Date(v) : undefined);

// ---- My offerings (TEACH only — students use /me/courses) ----
router.get('/teach/offerings', requireRoles(...TEACH), async (req, res) => {
  const where = (req.user.role === 'FACULTY' && req.query.mine !== '0')
    ? { faculty: { some: { userId: req.user.id } } } : {};
  const rows = await prisma.offering.findMany({
    where, include: { course: true, term: true, _count: undefined }, take: 100, orderBy: { id: 'desc' }
  }).catch(() => prisma.offering.findMany({ take: 100 }));
  res.json(rows);
});

// ---- Modules + Lessons (course builder) ----
router.get('/offerings/:oid/modules', async (req, res) => {
  res.json(await prisma.module.findMany({ where: { offeringId: req.params.oid }, include: { lessons: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } }));
});
router.post('/modules', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.module.create({ data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/modules/:id', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.module.update({ where: { id: req.params.id }, data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/modules/:id', requireRoles(...TEACH), async (req, res) => {
  await prisma.module.delete({ where: { id: req.params.id } }); res.json({ ok: true });
});
router.post('/lessons', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.lesson.create({ data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/lessons/:id', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.lesson.update({ where: { id: req.params.id }, data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/lessons/:id', requireRoles(...TEACH), async (req, res) => {
  await prisma.lesson.delete({ where: { id: req.params.id } }); res.json({ ok: true });
});

// ---- Assignments + Submissions ----
router.get('/offerings/:oid/assignments', async (req, res) => {
  res.json(await prisma.assignment.findMany({ where: { offeringId: req.params.oid }, include: { submissions: true }, orderBy: { dueAt: 'asc' } }));
});
router.post('/assignments', requireRoles(...TEACH), async (req, res) => {
  try {
    const d = { ...req.body, dueAt: asDate(req.body.dueAt) || new Date() };
    res.json(await prisma.assignment.create({ data: d }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/assignments/:id', requireRoles(...TEACH), async (req, res) => {
  try {
    const d = { ...req.body }; if (d.dueAt) d.dueAt = asDate(d.dueAt);
    res.json(await prisma.assignment.update({ where: { id: req.params.id }, data: d }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/assignments/:id', requireRoles(...TEACH), async (req, res) => {
  await prisma.assignment.delete({ where: { id: req.params.id } }); res.json({ ok: true });
});
router.put('/submissions/:id/grade', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.submission.update({ where: { id: req.params.id }, data: { marks: req.body.marks, feedback: req.body.feedback } })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Question bank + Quizzes ----
router.get('/banks', async (req, res) => {
  res.json(await prisma.questionBank.findMany({ include: { questions: true }, take: 50 }));
});
router.post('/banks', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.questionBank.create({ data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/banks/:bid/questions', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.question.create({ data: { ...req.body, bankId: req.params.bid } })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/offerings/:oid/quizzes', async (req, res) => {
  res.json(await prisma.quiz.findMany({ where: { offeringId: req.params.oid }, include: { attempts: true } }));
});
router.post('/quizzes', requireRoles(...TEACH), async (req, res) => {
  try {
    const d = { ...req.body };
    if (d.startsAt) d.startsAt = asDate(d.startsAt); if (d.endsAt) d.endsAt = asDate(d.endsAt);
    res.json(await prisma.quiz.create({ data: d }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/quizzes/:id', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.quiz.update({ where: { id: req.params.id }, data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/quizzes/:id', requireRoles(...TEACH), async (req, res) => {
  await prisma.quiz.delete({ where: { id: req.params.id } }); res.json({ ok: true });
});

// ---- Attendance ----
router.get('/offerings/:oid/attendance', async (req, res) => {
  res.json(await prisma.attendanceSession.findMany({ where: { offeringId: req.params.oid }, include: { records: true }, orderBy: { date: 'desc' }, take: 100 }));
});
router.post('/offerings/:oid/attendance/sessions', requireRoles(...TEACH), async (req, res) => {
  const qrToken = Math.random().toString(36).slice(2, 8).toUpperCase();
  res.json(await prisma.attendanceSession.create({ data: { offeringId: req.params.oid, date: asDate(req.body.date) || new Date(), qrToken } }));
});
router.post('/attendance/sessions/:sid/mark', requireRoles(...TEACH), async (req, res) => {
  // body: { records: [{userId, status}] }
  const sid = req.params.sid;
  const out = [];
  for (const r of (req.body.records || [])) {
    out.push(await prisma.attendanceRecord.upsert({
      where: { sessionId_userId: { sessionId: sid, userId: r.userId } },
      update: { status: r.status }, create: { sessionId: sid, userId: r.userId, status: r.status || 'PRESENT' }
    }));
  }
  res.json(out);
});

// ---- Gradebook ----
router.get('/offerings/:oid/gradebook', async (req, res) => {
  const items = await prisma.gradeItem.findMany({ where: { offeringId: req.params.oid }, include: { grades: true } });
  const enrollments = await prisma.enrollment.findMany({ where: { offeringId: req.params.oid }, include: { user: { select: { id: true, name: true, email: true } } } });
  res.json({ items, enrollments });
});
router.post('/grade-items', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.gradeItem.create({ data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/grades/bulk', requireRoles(...TEACH), async (req, res) => {
  const { itemId, grades } = req.body; // [{userId, marks}]
  const out = [];
  for (const g of (grades || [])) {
    out.push(await prisma.grade.upsert({
      where: { itemId_userId: { itemId, userId: g.userId } },
      update: { marks: g.marks }, create: { itemId, userId: g.userId, marks: g.marks }
    }));
  }
  res.json(out);
});
router.put('/offerings/:oid/lock', requireRoles('SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY'), async (req, res) => {
  res.json(await prisma.offering.update({ where: { id: req.params.oid }, data: { isLocked: !!req.body.isLocked } }));
});

// ---- Live classes ----
router.get('/offerings/:oid/live', async (req, res) => {
  res.json(await prisma.liveClass.findMany({ where: { offeringId: req.params.oid }, orderBy: { startsAt: 'asc' } }));
});
router.post('/live', requireRoles(...TEACH), async (req, res) => {
  try {
    const d = { ...req.body, startsAt: asDate(req.body.startsAt) || new Date() };
    const row = await prisma.liveClass.create({ data: d });
    await prisma.announcement.create({ data: { title: `Live: ${row.title}`, body: `Join: ${row.joinUrl} at ${row.startsAt}`, audience: 'OFFERING', refId: row.offeringId } }).catch(() => {});
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/live/:id', requireRoles(...TEACH), async (req, res) => {
  try { res.json(await prisma.liveClass.update({ where: { id: req.params.id }, data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/live/:id', requireRoles(...TEACH), async (req, res) => {
  await prisma.liveClass.delete({ where: { id: req.params.id } }); res.json({ ok: true });
});

// ---- Announcements ----
router.get('/announcements', async (req, res) => {
  res.json(await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }));
});
router.post('/announcements', requireRoles(...TEACH), async (req, res) => {
  res.json(await prisma.announcement.create({ data: req.body }));
});

module.exports = router;
