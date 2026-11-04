const express = require('express');
const crypto = require('crypto');
const prisma = require('../../db');
const { requireAuth } = require('../../core/auth');
const { errors, asyncHandler } = require('../../core/errors');
const { z, validateBody, validateQuery, paginationFrom } = require('../../core/validate');
const { audit } = require('../../core/audit');
const { publishEvent } = require('../../core/events');
const { assertHttpUrl } = require('../../core/urls');
const {
  TEACH_ROLES,
  isAdmin,
  getOfferingContext,
  canManageContent,
  assertViewOffering,
  assertContentManager,
  assertGradeManager,
  getUserAudience,
  isOfferingFaculty,
} = require('../../core/access');
const { getStudentProgress, computeOfferingResult, letterGrade } = require('../academic/progress');

const router = express.Router();
router.use(requireAuth);

const KINDS = ['VIDEO', 'PDF', 'SLIDE', 'LINK', 'SCORM'];
const LATE_RULES = ['NO_LATE', 'ALLOW_LATE'];
const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE'];
const QUESTION_KINDS = ['MCQ', 'TRUE_FALSE', 'SHORT', 'DESCRIPTIVE'];

const moduleCreate = z.object({
  offeringId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  order: z.coerce.number().int().min(0).max(1000).optional(),
}).strict();

const moduleUpdate = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  order: z.coerce.number().int().min(0).max(1000).optional(),
}).strict();

const lessonCreate = z.object({
  moduleId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(KINDS).optional(),
  url: z.string().trim().max(2000).optional(),
  body: z.string().trim().max(20000).optional(),
  order: z.coerce.number().int().min(0).max(1000).optional(),
}).strict();

const lessonUpdate = lessonCreate.omit({ moduleId: true }).partial().strict();

const assignmentCreate = z.object({
  offeringId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  brief: z.string().trim().max(20000).optional(),
  dueAt: z.coerce.date().optional(),
  maxMarks: z.coerce.number().min(0).max(1000).optional(),
  lateRule: z.enum(LATE_RULES).optional(),
}).strict();

const assignmentUpdate = assignmentCreate.omit({ offeringId: true }).partial().strict();

const bankCreate = z.object({
  title: z.string().trim().min(2).max(200),
  courseCode: z.string().trim().max(40).optional(),
}).strict();

const questionCreate = z.object({
  kind: z.enum(QUESTION_KINDS).optional(),
  stem: z.string().trim().min(3).max(5000),
  options: z.union([z.array(z.string().max(500)).max(20), z.string().max(5000)]).optional(),
  answer: z.string().trim().max(2000).optional(),
  marks: z.coerce.number().min(0).max(100).optional(),
}).strict();

const quizCreate = z.object({
  offeringId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  durationMin: z.coerce.number().int().min(1).max(600).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(20).optional(),
  negativeMark: z.coerce.number().min(0).max(100).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
}).strict().refine((value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt, {
  message: 'startsAt must be before endsAt',
  path: ['endsAt'],
});

const quizUpdate = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  durationMin: z.coerce.number().int().min(1).max(600).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(20).optional(),
  negativeMark: z.coerce.number().min(0).max(100).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
}).strict().refine((value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt, {
  message: 'startsAt must be before endsAt',
  path: ['endsAt'],
});

const attendanceSessionCreate = z.object({
  date: z.coerce.date().optional(),
}).strict();

const attendanceMark = z.object({
  records: z.array(z.object({
    userId: z.string().trim().min(1).max(64),
    status: z.enum(ATTENDANCE_STATUSES),
  })).max(500),
}).strict();

const gradeItemCreate = z.object({
  offeringId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  weight: z.coerce.number().min(0).max(100),
}).strict();

const gradesBulk = z.object({
  itemId: z.string().trim().min(1).max(64),
  grades: z.array(z.object({
    userId: z.string().trim().min(1).max(64),
    marks: z.coerce.number().min(0).max(1000),
  })).max(500),
}).strict();

const lockSchema = z.object({ isLocked: z.boolean() }).strict();

const liveCreate = z.object({
  offeringId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  joinUrl: z.string().trim().max(2000),
  startsAt: z.coerce.date().optional(),
  recordingUrl: z.string().trim().max(2000).optional(),
}).strict();

const liveUpdate = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  joinUrl: z.string().trim().max(2000).optional(),
  startsAt: z.coerce.date().optional(),
  recordingUrl: z.string().trim().max(2000).optional(),
}).strict();

const submissionCreate = z.object({
  assignmentId: z.string().trim().min(1).max(64),
  fileUrl: z.string().trim().max(2000).optional(),
  body: z.string().trim().max(20000).optional(),
}).strict();

const gradeSubmission = z.object({
  marks: z.coerce.number().min(0).max(1000),
  feedback: z.string().trim().max(5000).optional(),
}).strict();

const quizAttemptSchema = z.object({
  answers: z.union([z.record(z.any()), z.string().max(20000)]).optional(),
}).strict();

const announcementCreate = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  audience: z.enum(['ALL', 'PROGRAM', 'BATCH', 'OFFERING']).optional(),
  refId: z.string().trim().max(64).optional(),
}).strict();

async function moduleOfferingId(moduleId) {
  const row = await prisma.module.findUnique({ where: { id: moduleId }, select: { offeringId: true } });
  if (!row) throw errors.notFound('Module not found');
  return row.offeringId;
}

async function lessonOfferingId(lessonId) {
  const row = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { module: { select: { offeringId: true } } },
  });
  if (!row) throw errors.notFound('Lesson not found');
  return row.module.offeringId;
}

async function assignmentOfferingId(assignmentId) {
  const row = await prisma.assignment.findUnique({ where: { id: assignmentId }, select: { offeringId: true } });
  if (!row) throw errors.notFound('Assignment not found');
  return row.offeringId;
}

async function quizOfferingId(quizId) {
  const row = await prisma.quiz.findUnique({ where: { id: quizId }, select: { offeringId: true } });
  if (!row) throw errors.notFound('Quiz not found');
  return row.offeringId;
}

async function sessionOfferingId(sessionId) {
  const row = await prisma.attendanceSession.findUnique({ where: { id: sessionId }, select: { offeringId: true } });
  if (!row) throw errors.notFound('Attendance session not found');
  return row.offeringId;
}

async function liveOfferingId(liveId) {
  const row = await prisma.liveClass.findUnique({ where: { id: liveId }, select: { offeringId: true } });
  if (!row) throw errors.notFound('Live class not found');
  return row.offeringId;
}

async function gradeItemOfferingId(itemId) {
  const row = await prisma.gradeItem.findUnique({ where: { id: itemId }, select: { offeringId: true, weight: true } });
  if (!row) throw errors.notFound('Grade item not found');
  return row;
}

function isTeacherFor(user, offering) {
  return isAdmin(user) || isOfferingFaculty(user, offering);
}

router.get('/teach/offerings', asyncHandler(async (req, res) => {
  if (!TEACH_ROLES.includes(req.user.role)) throw errors.forbidden('Teaching staff only');
  const where = isAdmin(req.user)
    ? {}
    : { faculty: { some: { userId: req.user.id } } };
  const rows = await prisma.offering.findMany({
    where,
    include: {
      course: { select: { code: true, title: true, credits: true } },
      term: { select: { code: true, name: true, status: true } },
      _count: { select: { enrollments: true } },
    },
    take: 100,
    orderBy: { id: 'desc' },
  });
  res.json(rows);
}));

router.get('/offerings/:oid/modules', asyncHandler(async (req, res) => {
  await assertViewOffering(req.user, req.params.oid);
  const rows = await prisma.module.findMany({
    where: { offeringId: req.params.oid },
    include: { lessons: { orderBy: { order: 'asc' } } },
    orderBy: { order: 'asc' },
  });
  res.json(rows);
}));

router.post('/modules', validateBody(moduleCreate), asyncHandler(async (req, res) => {
  await assertContentManager(req.user, req.body.offeringId);
  const row = await prisma.module.create({ data: req.body });
  await audit(req, 'module.create', { targetType: 'Module', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/modules/:id', validateBody(moduleUpdate), asyncHandler(async (req, res) => {
  const offeringId = await moduleOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const before = await prisma.module.findUnique({ where: { id: req.params.id } });
  const row = await prisma.module.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'module.update', { targetType: 'Module', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/modules/:id', asyncHandler(async (req, res) => {
  const offeringId = await moduleOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const row = await prisma.module.delete({ where: { id: req.params.id } });
  await audit(req, 'module.delete', { targetType: 'Module', targetId: row.id, before: row });
  res.json({ ok: true });
}));

router.post('/lessons', validateBody(lessonCreate), asyncHandler(async (req, res) => {
  const offeringId = await moduleOfferingId(req.body.moduleId);
  await assertContentManager(req.user, offeringId);
  if (req.body.url) req.body.url = assertHttpUrl(req.body.url);
  const row = await prisma.lesson.create({ data: req.body });
  await audit(req, 'lesson.create', { targetType: 'Lesson', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/lessons/:id', validateBody(lessonUpdate), asyncHandler(async (req, res) => {
  const offeringId = await lessonOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  if (req.body.url) req.body.url = assertHttpUrl(req.body.url);
  const before = await prisma.lesson.findUnique({ where: { id: req.params.id } });
  const row = await prisma.lesson.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'lesson.update', { targetType: 'Lesson', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/lessons/:id', asyncHandler(async (req, res) => {
  const offeringId = await lessonOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const row = await prisma.lesson.delete({ where: { id: req.params.id } });
  await audit(req, 'lesson.delete', { targetType: 'Lesson', targetId: row.id, before: row });
  res.json({ ok: true });
}));

router.get('/offerings/:oid/assignments', asyncHandler(async (req, res) => {
  const offering = await assertViewOffering(req.user, req.params.oid);
  const teacher = canManageContent(req.user, offering);
  const rows = await prisma.assignment.findMany({
    where: { offeringId: req.params.oid },
    include: {
      submissions: teacher
        ? { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' } }
        : { where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { dueAt: 'asc' },
  });
  res.json(rows);
}));

router.post('/assignments', validateBody(assignmentCreate), asyncHandler(async (req, res) => {
  await assertContentManager(req.user, req.body.offeringId);
  const data = { ...req.body, dueAt: req.body.dueAt || new Date() };
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.assignment.create({ data });
    await publishEvent(tx, 'AssignmentPublished', {
      assignmentId: created.id,
      offeringId: created.offeringId,
      title: created.title,
      dueAt: created.dueAt,
    });
    return created;
  });
  await audit(req, 'assignment.create', { targetType: 'Assignment', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/assignments/:id', validateBody(assignmentUpdate), asyncHandler(async (req, res) => {
  const offeringId = await assignmentOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const before = await prisma.assignment.findUnique({ where: { id: req.params.id } });
  const row = await prisma.assignment.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'assignment.update', { targetType: 'Assignment', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/assignments/:id', asyncHandler(async (req, res) => {
  const offeringId = await assignmentOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const row = await prisma.assignment.delete({ where: { id: req.params.id } });
  await audit(req, 'assignment.delete', { targetType: 'Assignment', targetId: row.id, before: row });
  res.json({ ok: true });
}));

router.put('/submissions/:id/grade', validateBody(gradeSubmission), asyncHandler(async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.id },
    include: { assignment: true },
  });
  if (!submission) throw errors.notFound('Submission not found');
  const offering = await assertGradeManager(req.user, submission.assignment.offeringId);
  if (offering.isLocked) throw errors.conflict('Results are locked; unlock the offering before changing grades');
  if (req.body.marks > submission.assignment.maxMarks) {
    throw errors.badRequest(`Marks cannot exceed the assignment maximum (${submission.assignment.maxMarks})`);
  }
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.submission.update({
      where: { id: submission.id },
      data: { marks: req.body.marks, feedback: req.body.feedback ?? null },
    });
    await publishEvent(tx, 'SubmissionGraded', {
      submissionId: updated.id,
      assignmentId: submission.assignmentId,
      userId: updated.userId,
      marks: updated.marks,
      maxMarks: submission.assignment.maxMarks,
    });
    return updated;
  });
  await audit(req, 'submission.grade', {
    targetType: 'Submission',
    targetId: submission.id,
    before: { marks: submission.marks, feedback: submission.feedback },
    after: { marks: row.marks, feedback: row.feedback },
  });
  res.json(row);
}));

router.get('/banks', validateQuery(z.object({ courseCode: z.string().trim().max(40).optional() }).passthrough()), asyncHandler(async (req, res) => {
  if (!TEACH_ROLES.includes(req.user.role)) throw errors.forbidden('Question banks are available to teaching staff only');
  const rows = await prisma.questionBank.findMany({
    where: req.query.courseCode ? { courseCode: req.query.courseCode } : {},
    include: { questions: true },
    take: 100,
  });
  res.json(rows);
}));

router.post('/banks', validateBody(bankCreate), asyncHandler(async (req, res) => {
  if (!TEACH_ROLES.includes(req.user.role)) throw errors.forbidden('Question banks are available to teaching staff only');
  const row = await prisma.questionBank.create({ data: req.body });
  await audit(req, 'question_bank.create', { targetType: 'QuestionBank', targetId: row.id, after: { title: row.title } });
  res.status(201).json(row);
}));

router.post('/banks/:bid/questions', validateBody(questionCreate), asyncHandler(async (req, res) => {
  if (!TEACH_ROLES.includes(req.user.role)) throw errors.forbidden('Question banks are available to teaching staff only');
  const bank = await prisma.questionBank.findUnique({ where: { id: req.params.bid } });
  if (!bank) throw errors.notFound('Question bank not found');
  const options = Array.isArray(req.body.options) ? JSON.stringify(req.body.options) : req.body.options;
  const row = await prisma.question.create({ data: { ...req.body, options, bankId: bank.id } });
  await audit(req, 'question.create', { targetType: 'Question', targetId: row.id, after: { bankId: bank.id } });
  res.status(201).json(row);
}));

router.get('/offerings/:oid/quizzes', asyncHandler(async (req, res) => {
  const offering = await assertViewOffering(req.user, req.params.oid);
  const teacher = canManageContent(req.user, offering);
  const rows = await prisma.quiz.findMany({
    where: { offeringId: req.params.oid },
    include: {
      attempts: teacher
        ? { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' } }
        : { where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { startsAt: 'asc' },
  });
  res.json(rows);
}));

router.post('/quizzes', validateBody(quizCreate), asyncHandler(async (req, res) => {
  await assertContentManager(req.user, req.body.offeringId);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.quiz.create({ data: req.body });
    await publishEvent(tx, 'QuizPublished', {
      quizId: created.id,
      offeringId: created.offeringId,
      title: created.title,
      startsAt: created.startsAt,
      endsAt: created.endsAt,
    });
    return created;
  });
  await audit(req, 'quiz.create', { targetType: 'Quiz', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/quizzes/:id', validateBody(quizUpdate), asyncHandler(async (req, res) => {
  const offeringId = await quizOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const before = await prisma.quiz.findUnique({ where: { id: req.params.id } });
  const row = await prisma.quiz.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'quiz.update', { targetType: 'Quiz', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/quizzes/:id', asyncHandler(async (req, res) => {
  const offeringId = await quizOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const row = await prisma.quiz.delete({ where: { id: req.params.id } });
  await audit(req, 'quiz.delete', { targetType: 'Quiz', targetId: row.id, before: row });
  res.json({ ok: true });
}));

router.get('/offerings/:oid/attendance', asyncHandler(async (req, res) => {
  const offering = await assertViewOffering(req.user, req.params.oid);
  const teacher = isTeacherFor(req.user, offering);
  const rows = await prisma.attendanceSession.findMany({
    where: { offeringId: req.params.oid },
    include: {
      records: teacher
        ? true
        : { where: { userId: req.user.id } },
    },
    orderBy: { date: 'desc' },
    take: 100,
  });
  res.json(rows);
}));

router.post('/offerings/:oid/attendance/sessions', validateBody(attendanceSessionCreate), asyncHandler(async (req, res) => {
  await assertContentManager(req.user, req.params.oid);
  const qrToken = crypto.randomBytes(6).toString('base64url').slice(0, 10).toUpperCase();
  const row = await prisma.attendanceSession.create({
    data: {
      offeringId: req.params.oid,
      date: req.body.date || new Date(),
      qrToken,
    },
  });
  await audit(req, 'attendance.session_create', { targetType: 'AttendanceSession', targetId: row.id, after: { offeringId: row.offeringId, date: row.date } });
  res.status(201).json(row);
}));

router.post('/attendance/sessions/:sid/mark', validateBody(attendanceMark), asyncHandler(async (req, res) => {
  const offeringId = await sessionOfferingId(req.params.sid);
  await assertContentManager(req.user, offeringId);
  const userIds = [...new Set(req.body.records.map((row) => row.userId))];
  const enrolled = await prisma.enrollment.findMany({
    where: { offeringId, userId: { in: userIds } },
    select: { userId: true },
  });
  const enrolledIds = new Set(enrolled.map((row) => row.userId));
  const invalid = userIds.filter((userId) => !enrolledIds.has(userId));
  if (invalid.length) throw errors.badRequest('Some users are not enrolled in this offering', { userIds: invalid });
  const rows = await prisma.$transaction(req.body.records.map((record) => prisma.attendanceRecord.upsert({
    where: { sessionId_userId: { sessionId: req.params.sid, userId: record.userId } },
    update: { status: record.status },
    create: { sessionId: req.params.sid, userId: record.userId, status: record.status },
  })));
  await audit(req, 'attendance.mark', { targetType: 'AttendanceSession', targetId: req.params.sid, meta: { records: rows.length } });
  res.json(rows);
}));

router.get('/offerings/:oid/gradebook', asyncHandler(async (req, res) => {
  await assertGradeManager(req.user, req.params.oid);
  const [items, enrollments] = await Promise.all([
    prisma.gradeItem.findMany({ where: { offeringId: req.params.oid }, include: { grades: true } }),
    prisma.enrollment.findMany({
      where: { offeringId: req.params.oid },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  res.json({ items, enrollments });
}));

router.post('/grade-items', validateBody(gradeItemCreate), asyncHandler(async (req, res) => {
  await assertGradeManager(req.user, req.body.offeringId);
  const row = await prisma.gradeItem.create({ data: req.body });
  await audit(req, 'grade_item.create', { targetType: 'GradeItem', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.post('/grades/bulk', validateBody(gradesBulk), asyncHandler(async (req, res) => {
  const item = await gradeItemOfferingId(req.body.itemId);
  const offering = await assertGradeManager(req.user, item.offeringId);
  if (offering.isLocked) throw errors.conflict('Results are locked; unlock the offering before changing grades');
  const overLimit = req.body.grades.filter((row) => row.marks > item.weight);
  if (overLimit.length) throw errors.badRequest(`Marks cannot exceed the grade item maximum (${item.weight})`);
  const userIds = [...new Set(req.body.grades.map((row) => row.userId))];
  const enrolled = await prisma.enrollment.findMany({
    where: { offeringId: item.offeringId, userId: { in: userIds } },
    select: { userId: true },
  });
  const enrolledIds = new Set(enrolled.map((row) => row.userId));
  const invalid = userIds.filter((userId) => !enrolledIds.has(userId));
  if (invalid.length) throw errors.badRequest('Some users are not enrolled in this offering', { userIds: invalid });
  const rows = await prisma.$transaction(req.body.grades.map((row) => prisma.grade.upsert({
    where: { itemId_userId: { itemId: item.id, userId: row.userId } },
    update: { marks: row.marks },
    create: { itemId: item.id, userId: row.userId, marks: row.marks },
  })));
  await audit(req, 'grades.bulk', {
    targetType: 'GradeItem',
    targetId: item.id,
    meta: { offeringId: item.offeringId, records: rows.length, userIds },
  });
  res.json(rows);
}));

router.put('/offerings/:oid/lock', validateBody(lockSchema), asyncHandler(async (req, res) => {
  const offering = await getOfferingContext(req.params.oid, req.user.id);
  if (!isAdmin(req.user) && !(req.user.role === 'FACULTY' && isOfferingFaculty(req.user, offering))) {
    throw errors.forbidden('Only the assigned faculty or an administrator can lock results');
  }
  const before = { isLocked: offering.isLocked };
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.offering.update({ where: { id: offering.id }, data: { isLocked: req.body.isLocked } });
    if (updated.isLocked) {
      await publishEvent(tx, 'GradePublished', { offeringId: updated.id, courseCode: offering.course.code, title: offering.course.title });
    }
    return updated;
  });
  await audit(req, 'offering.lock', { targetType: 'Offering', targetId: offering.id, before, after: { isLocked: row.isLocked } });
  res.json(row);
}));

router.get('/offerings/:oid/live', asyncHandler(async (req, res) => {
  await assertViewOffering(req.user, req.params.oid);
  const rows = await prisma.liveClass.findMany({
    where: { offeringId: req.params.oid },
    orderBy: { startsAt: 'asc' },
    take: 100,
  });
  res.json(rows);
}));

router.post('/live', validateBody(liveCreate), asyncHandler(async (req, res) => {
  await assertContentManager(req.user, req.body.offeringId);
  const data = {
    ...req.body,
    joinUrl: assertHttpUrl(req.body.joinUrl),
    recordingUrl: req.body.recordingUrl ? assertHttpUrl(req.body.recordingUrl) : null,
    startsAt: req.body.startsAt || new Date(),
  };
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.liveClass.create({ data });
    await tx.announcement.create({
      data: {
        title: `Live: ${created.title}`,
        body: `Join: ${created.joinUrl} at ${created.startsAt.toISOString()}`,
        audience: 'OFFERING',
        refId: created.offeringId,
      },
    });
    await publishEvent(tx, 'LiveClassScheduled', {
      liveClassId: created.id,
      offeringId: created.offeringId,
      title: created.title,
      startsAt: created.startsAt,
    });
    return created;
  });
  await audit(req, 'live.create', { targetType: 'LiveClass', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/live/:id', validateBody(liveUpdate), asyncHandler(async (req, res) => {
  const offeringId = await liveOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const data = { ...req.body };
  if (data.joinUrl) data.joinUrl = assertHttpUrl(data.joinUrl);
  if (data.recordingUrl) data.recordingUrl = assertHttpUrl(data.recordingUrl);
  const before = await prisma.liveClass.findUnique({ where: { id: req.params.id } });
  const row = await prisma.liveClass.update({ where: { id: req.params.id }, data });
  await audit(req, 'live.update', { targetType: 'LiveClass', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/live/:id', asyncHandler(async (req, res) => {
  const offeringId = await liveOfferingId(req.params.id);
  await assertContentManager(req.user, offeringId);
  const row = await prisma.liveClass.delete({ where: { id: req.params.id } });
  await audit(req, 'live.delete', { targetType: 'LiveClass', targetId: row.id, before: row });
  res.json({ ok: true });
}));

async function viewableAnnouncementWhere(user) {
  if (isAdmin(user)) return {};
  const audience = await getUserAudience(user.id);
  const [enrollments, taught] = await Promise.all([
    prisma.enrollment.findMany({ where: { userId: user.id }, select: { offeringId: true }, take: 200 }),
    prisma.offeringFaculty.findMany({ where: { userId: user.id }, select: { offeringId: true }, take: 200 }),
  ]);
  const offeringIds = [...new Set([...enrollments, ...taught].map((row) => row.offeringId))];
  const or = [{ audience: 'ALL' }];
  if (offeringIds.length) or.push({ audience: 'OFFERING', refId: { in: offeringIds } });
  if (audience.programIds.length) or.push({ audience: 'PROGRAM', refId: { in: audience.programIds } });
  if (audience.batchIds.length) or.push({ audience: 'BATCH', refId: { in: audience.batchIds } });
  return { OR: or };
}

router.get('/announcements', asyncHandler(async (req, res) => {
  const rows = await prisma.announcement.findMany({
    where: await viewableAnnouncementWhere(req.user),
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(rows);
}));

router.post('/announcements', validateBody(announcementCreate), asyncHandler(async (req, res) => {
  if (!TEACH_ROLES.includes(req.user.role)) throw errors.forbidden('Teaching staff only');
  const audience = req.body.audience || 'ALL';
  if (audience === 'OFFERING') {
    if (!req.body.refId) throw errors.badRequest('refId is required for offering announcements');
    await assertContentManager(req.user, req.body.refId);
  } else if (!isAdmin(req.user)) {
    throw errors.forbidden('Only administrators can post departmental announcements');
  }
  const row = await prisma.announcement.create({
    data: {
      title: req.body.title,
      body: req.body.body,
      audience,
      refId: req.body.refId || null,
    },
  });
  await audit(req, 'announcement.create', { targetType: 'Announcement', targetId: row.id, after: { audience, refId: row.refId } });
  res.status(201).json(row);
}));

// ---------- Student-facing endpoints ----------

router.get('/me/courses', asyncHandler(async (req, res) => {
  const rows = await prisma.enrollment.findMany({
    where: { userId: req.user.id },
    include: {
      offering: {
        include: {
          course: true,
          term: true,
          faculty: { include: { user: { select: { name: true, email: true } } } },
        },
      },
    },
    take: 100,
  });
  res.json(rows);
}));

router.get('/offerings/:oid/learn', asyncHandler(async (req, res) => {
  await assertViewOffering(req.user, req.params.oid);
  const [modules, assignments, quizzes, live] = await Promise.all([
    prisma.module.findMany({
      where: { offeringId: req.params.oid },
      include: { lessons: { orderBy: { order: 'asc' } } },
      orderBy: { order: 'asc' },
    }),
    prisma.assignment.findMany({
      where: { offeringId: req.params.oid },
      include: { submissions: { where: { userId: req.user.id } } },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.quiz.findMany({
      where: { offeringId: req.params.oid },
      include: { attempts: { where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 5 } },
    }),
    prisma.liveClass.findMany({ where: { offeringId: req.params.oid }, orderBy: { startsAt: 'asc' }, take: 20 }),
  ]);
  res.json({ modules, assignments, quizzes, live });
}));

router.post('/submissions', validateBody(submissionCreate), asyncHandler(async (req, res) => {
  if (req.body.fileUrl) req.body.fileUrl = assertHttpUrl(req.body.fileUrl);
  const assignment = await prisma.assignment.findUnique({ where: { id: req.body.assignmentId } });
  if (!assignment) throw errors.notFound('Assignment not found');
  const enrollment = await prisma.enrollment.findUnique({
    where: { offeringId_userId: { offeringId: assignment.offeringId, userId: req.user.id } },
  });
  if (!enrollment) throw errors.forbidden('You are not enrolled in this offering');
  const now = new Date();
  const isLate = now > new Date(assignment.dueAt);
  if (isLate && assignment.lateRule === 'NO_LATE') throw errors.badRequest('The deadline has passed and late submissions are not allowed');
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.submission.upsert({
      where: { assignmentId_userId: { assignmentId: assignment.id, userId: req.user.id } },
      update: { fileUrl: req.body.fileUrl || null, body: req.body.body || null },
      create: {
        assignmentId: assignment.id,
        userId: req.user.id,
        fileUrl: req.body.fileUrl || null,
        body: req.body.body || null,
      },
    });
    await publishEvent(tx, 'SubmissionReceived', {
      submissionId: saved.id,
      assignmentId: assignment.id,
      offeringId: assignment.offeringId,
      userId: req.user.id,
      isLate,
    });
    return saved;
  });
  res.json({ ...row, isLate });
}));

router.get('/me/submissions', asyncHandler(async (req, res) => {
  const rows = await prisma.submission.findMany({
    where: { userId: req.user.id },
    include: { assignment: { include: { offering: { include: { course: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(rows);
}));

router.post('/quizzes/:qid/attempt', validateBody(quizAttemptSchema), asyncHandler(async (req, res) => {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.qid } });
  if (!quiz) throw errors.notFound('Quiz not found');
  const now = new Date();
  if (quiz.startsAt && now < new Date(quiz.startsAt)) throw errors.badRequest('This quiz has not started');
  if (quiz.endsAt && now > new Date(quiz.endsAt)) throw errors.badRequest('This quiz has ended');
  const enrollment = await prisma.enrollment.findUnique({
    where: { offeringId_userId: { offeringId: quiz.offeringId, userId: req.user.id } },
  });
  if (!enrollment) throw errors.forbidden('You are not enrolled in this offering');
  const attempts = await prisma.quizAttempt.count({ where: { quizId: quiz.id, userId: req.user.id } });
  if (attempts >= quiz.maxAttempts) throw errors.conflict(`No attempts remaining (maximum ${quiz.maxAttempts})`);
  const answers = typeof req.body.answers === 'string' ? req.body.answers : JSON.stringify(req.body.answers || {});
  const row = await prisma.quizAttempt.create({
    data: { quizId: quiz.id, userId: req.user.id, answers },
  });
  res.json(row);
}));

router.get('/me/attempts', asyncHandler(async (req, res) => {
  const rows = await prisma.quizAttempt.findMany({
    where: { userId: req.user.id },
    include: { quiz: { include: { offering: { include: { course: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(rows);
}));

router.get('/offerings/:oid/attendance/me', asyncHandler(async (req, res) => {
  await assertViewOffering(req.user, req.params.oid);
  const sessions = await prisma.attendanceSession.findMany({
    where: { offeringId: req.params.oid },
    include: { records: { where: { userId: req.user.id } } },
    orderBy: { date: 'asc' },
  });
  const total = sessions.length;
  const present = sessions.filter((session) => {
    const record = session.records[0];
    return record && (record.status === 'PRESENT' || record.status === 'LATE');
  }).length;
  res.json({ sessions, total, present, pct: total ? Math.round((present / total) * 100) : 100 });
}));

router.get('/me/routine', asyncHandler(async (req, res) => {
  const enrollments = await prisma.enrollment.findMany({ where: { userId: req.user.id }, select: { offeringId: true } });
  const offeringIds = enrollments.map((row) => row.offeringId);
  const [offerings, live, assignments, quizzes] = await Promise.all([
    prisma.offering.findMany({
      where: { id: { in: offeringIds } },
      include: { course: true, term: true },
    }),
    prisma.liveClass.findMany({
      where: { offeringId: { in: offeringIds }, startsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      take: 20,
    }),
    prisma.assignment.findMany({
      where: { offeringId: { in: offeringIds }, dueAt: { gte: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    prisma.quiz.findMany({
      where: { offeringId: { in: offeringIds }, OR: [{ startsAt: null }, { startsAt: { gte: new Date() } }] },
      orderBy: { startsAt: 'asc' },
      take: 20,
    }),
  ]);
  res.json({ offerings, live, assignments, quizzes });
}));

router.get('/me/results', asyncHandler(async (req, res) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: req.user.id },
    include: {
      offering: {
        include: {
          course: true,
          term: true,
          gradeItems: { include: { grades: { where: { userId: req.user.id } } } },
        },
      },
    },
    take: 200,
  });
  const rows = enrollments.map((enrollment) => {
    const offering = enrollment.offering;
    const result = computeOfferingResult(offering, req.user.id);
    return {
      course: `${offering.course.code} ${offering.course.title}`,
      term: offering.term.code,
      obtained: result.obtained,
      totalWeight: result.totalWeight,
      pct: result.pct,
      grade: result.letter,
      details: result.details,
      isLocked: result.isLocked,
      credits: offering.course.credits,
    };
  });
  res.json(rows);
}));

router.get('/me/transcript', asyncHandler(async (req, res) => {
  const progress = await getStudentProgress(req.user.id);
  const locked = progress.courses.filter((course) => course.isLocked);
  const rows = locked.map((course) => {
    const grade = letterGrade(course.pct);
    return {
      courseCode: course.courseCode,
      title: course.title,
      credits: course.credits,
      term: course.term,
      pct: course.pct,
      letter: grade.letter,
      points: grade.points,
      passed: course.pct >= 40,
    };
  });
  res.json({
    gpa: progress.gpa,
    gradedCredits: progress.gradedCredits,
    earnedCredits: progress.earnedCredits,
    requiredCredits: progress.requiredCredits,
    courses: rows,
    note: 'Advisory transcript derived from locked offerings. The departmental office issues the official transcript.',
  });
}));

function icsDate(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

router.get('/me/calendar.ics', asyncHandler(async (req, res) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: req.user.id },
    include: { offering: { include: { course: true, term: true } } },
    take: 100,
  });
  const offeringIds = enrollments.map((row) => row.offeringId);
  const [assignments, quizzes, live] = await Promise.all([
    prisma.assignment.findMany({ where: { offeringId: { in: offeringIds } }, take: 200 }),
    prisma.quiz.findMany({ where: { offeringId: { in: offeringIds } }, take: 200 }),
    prisma.liveClass.findMany({ where: { offeringId: { in: offeringIds } }, take: 200 }),
  ]);
  const courseByOffering = new Map(enrollments.map((row) => [row.offeringId, row.offering.course]));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MIS LMS DU//Academic Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:MIS LMS – My calendar',
  ];
  const add = (uid, start, end, summary, description, url) => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}@mis-lms`);
    lines.push(`DTSTAMP:${icsDate(new Date())}`);
    lines.push(`DTSTART:${icsDate(start)}`);
    lines.push(`DTEND:${icsDate(end)}`);
    lines.push(`SUMMARY:${icsText(summary)}`);
    if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
    if (url) lines.push(`URL:${icsText(url)}`);
    lines.push('END:VEVENT');
  };
  for (const assignment of assignments) {
    const course = courseByOffering.get(assignment.offeringId);
    add(`assignment-${assignment.id}`, assignment.dueAt, new Date(new Date(assignment.dueAt).getTime() + 30 * 60000), `${course?.code || 'Course'} assignment: ${assignment.title}`, assignment.brief || '', null);
  }
  for (const quiz of quizzes) {
    if (!quiz.startsAt) continue;
    const end = quiz.endsAt || new Date(new Date(quiz.startsAt).getTime() + (quiz.durationMin || 20) * 60000);
    const course = courseByOffering.get(quiz.offeringId);
    add(`quiz-${quiz.id}`, quiz.startsAt, end, `${course?.code || 'Course'} quiz: ${quiz.title}`, `${quiz.durationMin} minutes`, null);
  }
  for (const session of live) {
    const course = courseByOffering.get(session.offeringId);
    add(`live-${session.id}`, session.startsAt, new Date(new Date(session.startsAt).getTime() + 60 * 60000), `${course?.code || 'Course'} live: ${session.title}`, session.joinUrl, session.joinUrl);
  }
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mis-lms-calendar.ics"');
  res.send(`${lines.join('\r\n')}\r\n`);
}));

router.get('/me/progress', asyncHandler(async (req, res) => {
  res.json(await getStudentProgress(req.user.id));
}));

module.exports = router;
