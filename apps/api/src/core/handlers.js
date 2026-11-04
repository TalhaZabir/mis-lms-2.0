const prisma = require('../db');
const { registerEventHandler } = require('./events');
const { registerJobHandler } = require('./jobs');
const { notifyUser, notifyUsers, notifyCurators } = require('./notify');
const { logger } = require('./logger');
const { cleanupExpiredIdempotencyKeys } = require('./idempotency');
const { isSafeFetchUrl } = require('./urls');

let registered = false;

function formatWhen(value) {
  if (!value) return 'soon';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

async function offeringAudience(offeringId) {
  if (!offeringId) return null;
  return prisma.offering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      section: true,
      course: { select: { code: true, title: true } },
      term: { select: { code: true } },
      enrollments: { select: { userId: true }, take: 500 },
      faculty: { select: { userId: true }, take: 20 },
    },
  });
}

function courseLabel(offering) {
  if (!offering?.course) return 'your course';
  return `${offering.course.code} ${offering.course.title}`;
}

async function notifyEnrolled(offering, payload) {
  if (!offering?.enrollments?.length) return [];
  return notifyUsers(offering.enrollments.map((row) => row.userId), payload);
}

async function notifyFaculty(offering, payload) {
  if (!offering?.faculty?.length) return [];
  return notifyUsers(offering.faculty.map((row) => row.userId), payload);
}

function registerEventHandlers() {
  registerEventHandler('UserCreated', async (payload) => {
    await notifyUser(payload.userId, {
      title: 'Welcome to MIS LMS',
      body: 'Your account has been created. Complete your profile and explore your workspace.',
      link: '/',
      dedupeKey: `welcome:${payload.userId}`,
    });
  });

  registerEventHandler('EnrollmentCreated', async (payload) => {
    const offering = await offeringAudience(payload.offeringId);
    await notifyUser(payload.userId, {
      title: `Enrolled in ${courseLabel(offering)}`,
      body: `You are enrolled in section ${offering?.section || 'A'} for ${offering?.term?.code || 'this term'}.`,
      link: '/learn',
      dedupeKey: `enrollment:${payload.enrollmentId}`,
    });
  });

  registerEventHandler('AssignmentPublished', async (payload) => {
    const offering = await offeringAudience(payload.offeringId);
    await notifyEnrolled(offering, {
      title: `New assignment: ${payload.title}`,
      body: `${courseLabel(offering)} · due ${formatWhen(payload.dueAt)}`,
      link: '/learn',
      dedupeKey: `assignment:${payload.assignmentId}`,
    });
  });

  registerEventHandler('QuizPublished', async (payload) => {
    const offering = await offeringAudience(payload.offeringId);
    const window = payload.startsAt || payload.endsAt
      ? ` · ${payload.startsAt ? `opens ${formatWhen(payload.startsAt)}` : 'open now'}${payload.endsAt ? `, closes ${formatWhen(payload.endsAt)}` : ''}`
      : '';
    await notifyEnrolled(offering, {
      title: `New quiz: ${payload.title}`,
      body: `${courseLabel(offering)}${window}`,
      link: '/learn',
      dedupeKey: `quiz:${payload.quizId}`,
    });
  });

  registerEventHandler('SubmissionReceived', async (payload) => {
    const offering = await offeringAudience(payload.offeringId);
    const assignment = await prisma.assignment.findUnique({
      where: { id: payload.assignmentId },
      select: { title: true },
    });
    await notifyFaculty(offering, {
      title: `New submission: ${assignment?.title || 'assignment'}`,
      body: `${courseLabel(offering)}${payload.isLate ? ' · submitted late' : ''}`,
      link: '/teach',
      dedupeKey: `submission-received:${payload.submissionId}`,
    });
  });

  registerEventHandler('SubmissionGraded', async (payload) => {
    await notifyUser(payload.userId, {
      title: 'Assignment graded',
      body: `Your submission received ${payload.marks}/${payload.maxMarks}. Open Learn to review the feedback.`,
      link: '/learn',
      dedupeKey: `submission-graded:${payload.submissionId}:${payload.marks}`,
    });
  });

  registerEventHandler('GradePublished', async (payload) => {
    const offering = await offeringAudience(payload.offeringId);
    await notifyEnrolled(offering, {
      title: `Results published: ${payload.courseCode || courseLabel(offering)}`,
      body: 'The offering results are now locked. Review them under Learn → Results.',
      link: '/learn',
      dedupeKey: `grade-published:${payload.offeringId}`,
    });
  });

  registerEventHandler('ResourceSuggested', async (payload) => {
    await notifyCurators({
      title: 'New resource awaiting review',
      body: payload.title,
      link: '/resources',
      dedupeKey: `resource-suggest:${payload.resourceId}`,
    });
  });

  registerEventHandler('ResourceApproved', async (payload) => {
    if (!payload.addedById) return;
    await notifyUser(payload.addedById, {
      title: payload.approved ? 'Resource approved' : 'Resource not approved',
      body: payload.approved
        ? `“${payload.title}” is now visible in the Resource Corner.`
        : `“${payload.title}” was not accepted. Contact the curator for details.`,
      link: '/resources',
      dedupeKey: `resource-review:${payload.resourceId}:${payload.approved ? 'yes' : 'no'}`,
    });
  });

  registerEventHandler('MentorshipRequested', async (payload) => {
    await notifyUser(payload.mentorId, {
      title: 'New mentorship request',
      body: 'A student has requested mentorship. Review it under Connect → Mentorship.',
      link: '/connect',
      dedupeKey: `mentorship-request:${payload.requestId}`,
    });
  });

  registerEventHandler('MentorshipAccepted', async (payload) => {
    await notifyUser(payload.menteeId, {
      title: 'Mentorship request accepted',
      body: 'Your mentorship request was accepted. Start the conversation under Connect → Messages.',
      link: '/connect',
      dedupeKey: `mentorship-accepted:${payload.requestId}`,
    });
  });

  registerEventHandler('LiveClassScheduled', async (payload) => {
    const offering = await offeringAudience(payload.offeringId);
    await notifyEnrolled(offering, {
      title: `Live class: ${payload.title}`,
      body: `${courseLabel(offering)} · ${formatWhen(payload.startsAt)}`,
      link: '/learn',
      dedupeKey: `live-class:${payload.liveClassId}`,
    });
  });
}

async function checkResourceLink(resource) {
  if (!isSafeFetchUrl(resource.url)) return { id: resource.id, skipped: true };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    let response = await fetch(resource.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'MIS-LMS-LinkChecker/2.0' },
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(resource.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'MIS-LMS-LinkChecker/2.0', Range: 'bytes=0-2048' },
      });
      if (response.body?.cancel) await response.body.cancel().catch(() => {});
    }
    return { id: resource.id, ok: response.status < 400, status: response.status };
  } catch (error) {
    return { id: resource.id, ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkResourceLinks() {
  const resources = await prisma.resource.findMany({
    where: { isVerified: true },
    select: { id: true, url: true, title: true, brokenFlag: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  let checked = 0;
  let broken = 0;
  for (let index = 0; index < resources.length; index += 5) {
    const batch = resources.slice(index, index + 5);
    const results = await Promise.all(batch.map((resource) => checkResourceLink(resource)));
    for (const result of results) {
      if (result.skipped) continue;
      checked += 1;
      const isBroken = !result.ok;
      if (isBroken) broken += 1;
      await prisma.resource.update({
        where: { id: result.id },
        data: { brokenFlag: isBroken },
      }).catch(() => {});
    }
  }
  return { checked, broken };
}

async function cleanupExpiredSessions() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const expired = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: cutoff } },
        { revokedAt: { lt: cutoff } },
      ],
    },
  });
  return { deleted: expired.count };
}

async function cleanupOutbox() {
  const now = Date.now();
  const [processed, failed] = await Promise.all([
    prisma.outboxEvent.deleteMany({
      where: { status: 'PROCESSED', processedAt: { lt: new Date(now - 7 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.outboxEvent.deleteMany({
      where: { status: 'FAILED', createdAt: { lt: new Date(now - 30 * 24 * 60 * 60 * 1000) } },
    }),
  ]);
  return { processed: processed.count, failed: failed.count };
}

function registerJobHandlers() {
  registerJobHandler('resource.check-links', async () => checkResourceLinks());

  registerJobHandler('cleanup.expired-sessions', async () => cleanupExpiredSessions());

  registerJobHandler('cleanup.idempotency', async () => {
    const result = await cleanupExpiredIdempotencyKeys();
    return { deleted: result.count };
  });

  registerJobHandler('cleanup.outbox', async () => cleanupOutbox());

  registerJobHandler('ai.reindex-all', async () => {
    // Loaded lazily so the API can start even if AI modules are disabled.
    const { reindexAll } = require('../modules/ai/rag');
    const results = await reindexAll();
    return { documents: results.length, chunks: results.reduce((sum, row) => sum + row.chunks, 0) };
  });
}

function registerHandlers() {
  if (registered) return;
  registered = true;
  registerEventHandlers();
  registerJobHandlers();
  logger.info('handlers_registered', { events: 12, jobs: 5 });
}

async function enqueueMaintenanceJobs() {
  const day = new Date().toISOString().slice(0, 10);
  const jobs = [
    ['cleanup.expired-sessions', `maintenance:sessions:${day}`],
    ['cleanup.idempotency', `maintenance:idempotency:${day}`],
    ['cleanup.outbox', `maintenance:outbox:${day}`],
    ['resource.check-links', `maintenance:links:${day}`],
  ];
  for (const [type, dedupeKey] of jobs) {
    await prisma.job.create({
      data: { type, payload: '{}', dedupeKey },
    }).catch((error) => {
      if (error.code !== 'P2002') logger.warn('maintenance_enqueue_failed', { type, error: logger.serializeError(error) });
    });
  }
}

module.exports = {
  registerHandlers,
  enqueueMaintenanceJobs,
  checkResourceLinks,
  checkResourceLink,
  cleanupExpiredSessions,
  cleanupOutbox,
  offeringAudience,
};
