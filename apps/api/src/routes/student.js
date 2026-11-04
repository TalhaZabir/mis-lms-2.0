const express = require('express');
const prisma = require('../db');
const { auth } = require('../auth');
const router = express.Router();
router.use(auth());

async function myOfferingIds(userId) {
  const en = await prisma.enrollment.findMany({ where: { userId }, select: { offeringId: true } });
  return en.map(e => e.offeringId);
}

// My courses
router.get('/me/courses', async (req, res) => {
  const rows = await prisma.enrollment.findMany({
    where: { userId: req.user.id },
    include: { offering: { include: { course: true, term: true, faculty: { include: { user: { select: { name: true, email: true } } } } } } },
    take: 100
  });
  res.json(rows);
});

// Course learn view (student-safe: no answer keys)
router.get('/offerings/:oid/learn', async (req, res) => {
  const oid = req.params.oid;
  const allowed = await prisma.enrollment.findUnique({ where: { offeringId_userId: { offeringId: oid, userId: req.user.id } } });
  if (!allowed && !['FACULTY', 'SUPER_ADMIN', 'ADMIN_STAFF', 'TA'].includes(req.user.role)) return res.status(403).json({ error: 'Not enrolled' });
  const [modules, assignments, quizzes, live] = await Promise.all([
    prisma.module.findMany({ where: { offeringId: oid }, include: { lessons: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } }),
    prisma.assignment.findMany({ where: { offeringId: oid }, include: { submissions: { where: { userId: req.user.id } } }, orderBy: { dueAt: 'asc' } }),
    prisma.quiz.findMany({ where: { offeringId: oid }, include: { attempts: { where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 5 } } }),
    prisma.liveClass.findMany({ where: { offeringId: oid }, orderBy: { startsAt: 'asc' }, take: 20 }),
  ]);
  res.json({ modules, assignments, quizzes, live });
});

// Submit assignment (upsert mine)
router.post('/submissions', async (req, res) => {
  const { assignmentId, fileUrl, body } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });
  const asg = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!asg) return res.status(404).json({ error: 'Assignment not found' });
  const en = await prisma.enrollment.findUnique({ where: { offeringId_userId: { offeringId: asg.offeringId, userId: req.user.id } } });
  if (!en) return res.status(403).json({ error: 'Not enrolled in offering' });
  const late = new Date() > new Date(asg.dueAt) && asg.lateRule === 'NO_LATE';
  if (late) return res.status(400).json({ error: 'Past due (NO_LATE)' });
  const row = await prisma.submission.upsert({
    where: { assignmentId_userId: { assignmentId, userId: req.user.id } },
    update: { fileUrl, body }, create: { assignmentId, userId: req.user.id, fileUrl, body }
  });
  res.json({ ...row, isLate: new Date() > new Date(asg.dueAt) });
});
router.get('/me/submissions', async (req, res) => {
  res.json(await prisma.submission.findMany({ where: { userId: req.user.id }, include: { assignment: { include: { offering: { include: { course: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 }));
});

// Quiz attempt
router.post('/quizzes/:qid/attempt', async (req, res) => {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.qid } });
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const now = new Date();
  if (quiz.startsAt && now < new Date(quiz.startsAt)) return res.status(400).json({ error: 'Not started' });
  if (quiz.endsAt && now > new Date(quiz.endsAt)) return res.status(400).json({ error: 'Ended' });
  const en = await prisma.enrollment.findUnique({ where: { offeringId_userId: { offeringId: quiz.offeringId, userId: req.user.id } } });
  if (!en) return res.status(403).json({ error: 'Not enrolled' });
  res.json(await prisma.quizAttempt.create({ data: { quizId: quiz.id, userId: req.user.id, answers: typeof req.body.answers === 'string' ? req.body.answers : JSON.stringify(req.body.answers || {}) } }));
});
router.get('/me/attempts', async (req, res) => {
  res.json(await prisma.quizAttempt.findMany({ where: { userId: req.user.id }, include: { quiz: { include: { offering: { include: { course: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 }));
});

// My attendance per offering + %
router.get('/offerings/:oid/attendance/me', async (req, res) => {
  const sessions = await prisma.attendanceSession.findMany({ where: { offeringId: req.params.oid }, include: { records: { where: { userId: req.user.id } } }, orderBy: { date: 'asc' } });
  const total = sessions.length;
  const present = sessions.filter(s => s.records[0] && (s.records[0].status === 'PRESENT' || s.records[0].status === 'LATE')).length;
  res.json({ sessions, total, present, pct: total ? Math.round((present / total) * 100) : 100 });
});

// Routine: enrolled offerings slots + upcoming live + dues
router.get('/me/routine', async (req, res) => {
  const oids = await myOfferingIds(req.user.id);
  const [offerings, live, assignments, quizzes] = await Promise.all([
    prisma.offering.findMany({ where: { id: { in: oids } }, include: { course: true, term: true } }),
    prisma.liveClass.findMany({ where: { offeringId: { in: oids }, startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' }, take: 20 }),
    prisma.assignment.findMany({ where: { offeringId: { in: oids }, dueAt: { gte: new Date() } }, orderBy: { dueAt: 'asc' }, take: 20 }),
    prisma.quiz.findMany({ where: { offeringId: { in: oids } }, orderBy: { startsAt: 'asc' }, take: 20 }),
  ]);
  res.json({ offerings, live, assignments, quizzes });
});

// Results / transcript
function letter(pct) {
  if (pct >= 80) return 'A+'; if (pct >= 75) return 'A'; if (pct >= 70) return 'A-';
  if (pct >= 65) return 'B+'; if (pct >= 60) return 'B'; if (pct >= 55) return 'B-';
  if (pct >= 50) return 'C+'; if (pct >= 45) return 'C'; if (pct >= 40) return 'D'; return 'F';
}
router.get('/me/results', async (req, res) => {
  const oids = await myOfferingIds(req.user.id);
  const items = await prisma.gradeItem.findMany({ where: { offeringId: { in: oids } }, include: { grades: { where: { userId: req.user.id } }, offering: { include: { course: true, term: true } } } });
  const byOff = {};
  for (const it of items) {
    const k = it.offeringId;
    byOff[k] = byOff[k] || { offering: it.offering, obtained: 0, totalWeight: 0, details: [] };
    const marks = it.grades[0]?.marks ?? null;
    byOff[k].details.push({ item: it.name, weight: it.weight, marks });
    byOff[k].totalWeight += it.weight;
    if (marks != null) byOff[k].obtained += marks; // marks assumed already weighted-scale; else faculty enters weighted marks
  }
  const rows = Object.values(byOff).map(r => {
    const pct = r.totalWeight ? (r.obtained / r.totalWeight) * 100 : 0;
    const locked = r.offering.isLocked;
    return { course: r.offering.course.code + ' ' + r.offering.course.title, term: r.offering.term.code, obtained: r.obtained, totalWeight: r.totalWeight, pct: Math.round(pct * 100) / 100, grade: locked ? letter(pct) : 'IN-PROGRESS', details: r.details, isLocked: locked };
  });
  res.json(rows);
});

module.exports = router;
