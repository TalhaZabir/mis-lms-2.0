const express = require('express');
const prisma = require('../../db');
const { requireAuth, revokeAllSessions } = require('../../core/auth');
const { errors, asyncHandler } = require('../../core/errors');
const { z, validateBody, validateQuery } = require('../../core/validate');
const { audit } = require('../../core/audit');
const { publishEvent } = require('../../core/events');
const {
  ADMIN_ROLES,
  isAdmin,
  assertCanManageUser,
  getOfferingContext,
  isOfferingFaculty,
} = require('../../core/access');

const router = express.Router();
router.use(requireAuth);

const ROLES = ['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY', 'TA', 'STUDENT', 'ALUMNI', 'MODERATOR'];

const programSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  requiredCredits: z.coerce.number().min(0).max(400).optional(),
}).strict();

const batchSchema = z.object({
  programId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(2).max(120),
  session: z.string().trim().min(2).max(40),
}).strict();

const termSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(40),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']).optional(),
}).strict();

const courseSchema = z.object({
  code: z.string().trim().min(2).max(40),
  title: z.string().trim().min(2).max(200),
  credits: z.coerce.number().min(0).max(30).optional(),
  programId: z.string().trim().min(1).max(64),
  description: z.string().trim().max(4000).optional(),
  prerequisites: z.union([z.array(z.string().trim().max(40)).max(20), z.string().trim().max(1000)]).optional(),
}).strict();

const offeringSchema = z.object({
  courseId: z.string().trim().min(1).max(64),
  termId: z.string().trim().min(1).max(64),
  section: z.string().trim().min(1).max(20).optional(),
  room: z.string().trim().max(80).optional(),
  routineSlot: z.string().trim().max(120).optional(),
  facultyIds: z.array(z.string().trim().max(64)).max(20).optional(),
}).strict();

const enrollmentSchema = z.object({
  offeringId: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(64),
  batchId: z.string().trim().max(64).optional(),
  status: z.enum(['ENROLLED', 'DROPPED', 'COMPLETED']).optional(),
}).strict();

const userUpdateSchema = z.object({
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).optional(),
}).strict();

function optional(schema) {
  return schema.partial();
}

router.get('/programs', asyncHandler(async (req, res) => {
  const rows = await prisma.program.findMany({ orderBy: { code: 'asc' }, take: 200 });
  res.json(rows);
}));

router.post('/programs', validateBody(programSchema), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can create programs');
  const row = await prisma.program.create({ data: req.body });
  await audit(req, 'program.create', { targetType: 'Program', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/programs/:id', validateBody(optional(programSchema)), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can update programs');
  const before = await prisma.program.findUnique({ where: { id: req.params.id } });
  if (!before) throw errors.notFound('Program not found');
  const row = await prisma.program.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'program.update', { targetType: 'Program', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/programs/:id', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can delete programs');
  const row = await prisma.program.delete({ where: { id: req.params.id } });
  await audit(req, 'program.delete', { targetType: 'Program', targetId: row.id, before: row });
  res.json({ ok: true });
}));

router.get('/batches', validateQuery(z.object({ programId: z.string().trim().max(64).optional() }).passthrough()), asyncHandler(async (req, res) => {
  const rows = await prisma.batch.findMany({
    where: req.query.programId ? { programId: req.query.programId } : {},
    orderBy: { name: 'asc' },
    take: 200,
  });
  res.json(rows);
}));

router.post('/batches', validateBody(batchSchema), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can create batches');
  const row = await prisma.batch.create({ data: req.body });
  await audit(req, 'batch.create', { targetType: 'Batch', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/batches/:id', validateBody(optional(batchSchema)), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can update batches');
  const before = await prisma.batch.findUnique({ where: { id: req.params.id } });
  if (!before) throw errors.notFound('Batch not found');
  const row = await prisma.batch.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'batch.update', { targetType: 'Batch', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/batches/:id', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can delete batches');
  const row = await prisma.batch.delete({ where: { id: req.params.id } });
  await audit(req, 'batch.delete', { targetType: 'Batch', targetId: row.id, before: row });
  res.json({ ok: true });
}));

router.get('/terms', asyncHandler(async (req, res) => {
  const rows = await prisma.term.findMany({ orderBy: { startsAt: 'desc' }, take: 100 });
  res.json(rows);
}));

router.post('/terms', validateBody(termSchema), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can create terms');
  const row = await prisma.term.create({ data: req.body });
  await audit(req, 'term.create', { targetType: 'Term', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/terms/:id', validateBody(optional(termSchema)), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can update terms');
  const before = await prisma.term.findUnique({ where: { id: req.params.id } });
  if (!before) throw errors.notFound('Term not found');
  const row = await prisma.term.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'term.update', { targetType: 'Term', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/terms/:id', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can delete terms');
  const row = await prisma.term.delete({ where: { id: req.params.id } });
  await audit(req, 'term.delete', { targetType: 'Term', targetId: row.id, before: row });
  res.json({ ok: true });
}));

function serializePrerequisites(value) {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? JSON.stringify(value) : value;
}

router.get('/courses', validateQuery(z.object({ programId: z.string().trim().max(64).optional() }).passthrough()), asyncHandler(async (req, res) => {
  const rows = await prisma.course.findMany({
    where: req.query.programId ? { programId: req.query.programId } : {},
    include: { program: { select: { code: true, name: true } } },
    orderBy: { code: 'asc' },
    take: 300,
  });
  res.json(rows);
}));

router.post('/courses', validateBody(courseSchema), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can create courses');
  const row = await prisma.course.create({ data: { ...req.body, prerequisites: serializePrerequisites(req.body.prerequisites) } });
  await audit(req, 'course.create', { targetType: 'Course', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/courses/:id', validateBody(optional(courseSchema)), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can update courses');
  const before = await prisma.course.findUnique({ where: { id: req.params.id } });
  if (!before) throw errors.notFound('Course not found');
  const data = { ...req.body };
  if (data.prerequisites !== undefined) data.prerequisites = serializePrerequisites(data.prerequisites);
  const row = await prisma.course.update({ where: { id: req.params.id }, data });
  await audit(req, 'course.update', { targetType: 'Course', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/courses/:id', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can delete courses');
  const row = await prisma.course.delete({ where: { id: req.params.id } });
  await audit(req, 'course.delete', { targetType: 'Course', targetId: row.id, before: row });
  res.json({ ok: true });
}));

router.get('/offerings', asyncHandler(async (req, res) => {
  let where = {};
  if (isAdmin(req.user)) {
    where = {};
  } else if (['FACULTY', 'TA'].includes(req.user.role)) {
    where = { faculty: { some: { userId: req.user.id } } };
  } else {
    where = { enrollments: { some: { userId: req.user.id } } };
  }
  const rows = await prisma.offering.findMany({
    where,
    include: {
      course: { select: { id: true, code: true, title: true, credits: true, programId: true } },
      term: { select: { id: true, code: true, name: true, status: true } },
      faculty: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { enrollments: true } },
    },
    orderBy: { id: 'desc' },
    take: 200,
  });
  res.json(rows);
}));

router.post('/offerings', validateBody(offeringSchema), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can create offerings');
  const { facultyIds = [], ...data } = req.body;
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.offering.create({ data });
    if (facultyIds.length) {
      await tx.offeringFaculty.createMany({
        data: facultyIds.map((userId, index) => ({ offeringId: created.id, userId, isLead: index === 0 })),
      });
    }
    await publishEvent(tx, 'OfferingCreated', { offeringId: created.id, courseId: created.courseId, termId: created.termId });
    return created;
  });
  await audit(req, 'offering.create', { targetType: 'Offering', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.put('/offerings/:id', validateBody(optional(offeringSchema)), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can update offerings');
  const before = await prisma.offering.findUnique({ where: { id: req.params.id } });
  if (!before) throw errors.notFound('Offering not found');
  const { facultyIds, ...data } = req.body;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.offering.update({ where: { id: req.params.id }, data });
    if (facultyIds) {
      await tx.offeringFaculty.deleteMany({ where: { offeringId: req.params.id } });
      if (facultyIds.length) {
        await tx.offeringFaculty.createMany({
          data: facultyIds.map((userId, index) => ({ offeringId: req.params.id, userId, isLead: index === 0 })),
        });
      }
    }
    return updated;
  });
  await audit(req, 'offering.update', { targetType: 'Offering', targetId: row.id, before, after: row });
  res.json(row);
}));

router.delete('/offerings/:id', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can delete offerings');
  const row = await prisma.offering.delete({ where: { id: req.params.id } });
  await audit(req, 'offering.delete', { targetType: 'Offering', targetId: row.id, before: row });
  res.json({ ok: true });
}));

router.get('/enrollments', validateQuery(z.object({
  offeringId: z.string().trim().max(64).optional(),
  userId: z.string().trim().max(64).optional(),
}).passthrough()), asyncHandler(async (req, res) => {
  if (isAdmin(req.user)) {
    const where = {
      ...(req.query.offeringId ? { offeringId: req.query.offeringId } : {}),
      ...(req.query.userId ? { userId: req.query.userId } : {}),
    };
    return res.json(await prisma.enrollment.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        offering: { include: { course: { select: { code: true, title: true } }, term: { select: { code: true } } } },
      },
      take: 500,
    }));
  }
  if (req.query.userId && req.query.userId !== req.user.id) throw errors.forbidden('You can only view your own enrollments');
  if (['FACULTY', 'TA'].includes(req.user.role)) {
    if (!req.query.offeringId) throw errors.badRequest('offeringId is required for teaching staff');
    const offering = await getOfferingContext(req.query.offeringId, req.user.id);
    if (!isOfferingFaculty(req.user, offering)) throw errors.forbidden('You do not teach this offering');
    return res.json(await prisma.enrollment.findMany({
      where: { offeringId: req.query.offeringId },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      take: 500,
    }));
  }
  const rows = await prisma.enrollment.findMany({
    where: { userId: req.user.id, ...(req.query.offeringId ? { offeringId: req.query.offeringId } : {}) },
    include: { offering: { include: { course: { select: { code: true, title: true } }, term: { select: { code: true } } } } },
    take: 200,
  });
  res.json(rows);
}));

router.post('/enrollments', validateBody(enrollmentSchema), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    if (!['FACULTY'].includes(req.user.role)) throw errors.forbidden('Only administrators or the assigned faculty can enroll students');
    const offering = await getOfferingContext(req.body.offeringId, req.user.id);
    if (!isOfferingFaculty(req.user, offering)) throw errors.forbidden('You do not teach this offering');
  }
  const target = await prisma.user.findUnique({ where: { id: req.body.userId }, select: { id: true, role: true, isActive: true } });
  if (!target) throw errors.notFound('User not found');
  if (!target.isActive) throw errors.badRequest('Cannot enroll an inactive user');
  if (!isAdmin(req.user) && target.role !== 'STUDENT') {
    throw errors.badRequest('Teaching staff can only enroll student accounts');
  }
  const row = await prisma.$transaction(async (tx) => {
    const enrollment = await tx.enrollment.create({ data: req.body });
    await publishEvent(tx, 'EnrollmentCreated', {
      enrollmentId: enrollment.id,
      offeringId: enrollment.offeringId,
      userId: enrollment.userId,
    });
    return enrollment;
  });
  await audit(req, 'enrollment.create', { targetType: 'Enrollment', targetId: row.id, after: row });
  res.status(201).json(row);
}));

router.delete('/enrollments/:id', asyncHandler(async (req, res) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: req.params.id },
    include: { offering: { select: { id: true, isLocked: true } } },
  });
  if (!enrollment) throw errors.notFound('Enrollment not found');
  if (!isAdmin(req.user)) {
    if (!['FACULTY'].includes(req.user.role)) throw errors.forbidden();
    const offering = await getOfferingContext(enrollment.offeringId, req.user.id);
    if (!isOfferingFaculty(req.user, offering)) throw errors.forbidden('You do not teach this offering');
  }
  if (enrollment.offering.isLocked) throw errors.conflict('Results are locked; enrollment changes require an administrator');
  await prisma.enrollment.delete({ where: { id: enrollment.id } });
  await audit(req, 'enrollment.delete', { targetType: 'Enrollment', targetId: enrollment.id, before: enrollment });
  res.json({ ok: true });
}));

router.get('/users', validateQuery(z.object({
  role: z.enum(ROLES).optional(),
  q: z.string().trim().max(120).optional(),
}).passthrough()), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can list users');
  const rows = await prisma.user.findMany({
    where: {
      ...(req.query.role ? { role: req.query.role } : {}),
      ...(req.query.q ? { OR: [{ name: { contains: req.query.q } }, { email: { contains: req.query.q } }] } : {}),
    },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    orderBy: { name: 'asc' },
    take: 500,
  });
  res.json(rows);
}));

router.put('/users/:id', validateBody(userUpdateSchema), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can update users');
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw errors.notFound('User not found');
  if (!req.body.role && req.body.isActive === undefined && !req.body.name) throw errors.badRequest('No supported changes supplied');
  assertCanManageUser(req.user, target, req.body);
  if (target.role === 'SUPER_ADMIN' && (req.body.role && req.body.role !== 'SUPER_ADMIN' || req.body.isActive === false)) {
    const activeSupers = await prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
    if (activeSupers <= 1) throw errors.conflict('The last active super administrator cannot be demoted or deactivated');
  }
  const row = await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(req.body.role ? { role: req.body.role } : {}),
      ...(typeof req.body.isActive === 'boolean' ? { isActive: req.body.isActive } : {}),
      ...(req.body.name ? { name: req.body.name } : {}),
    },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (req.body.role && req.body.role !== target.role || req.body.isActive === false) {
    await revokeAllSessions(target.id);
  }
  await audit(req, 'user.update', {
    targetType: 'User',
    targetId: target.id,
    before: { role: target.role, isActive: target.isActive, name: target.name },
    after: { role: row.role, isActive: row.isActive, name: row.name },
  });
  res.json(row);
}));

module.exports = router;
