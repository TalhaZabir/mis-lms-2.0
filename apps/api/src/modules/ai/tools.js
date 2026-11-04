const prisma = require('../../db');
const { errors } = require('../../core/errors');
const { TEACH_ROLES, ADMIN_ROLES, canAccessCourse } = require('../../core/access');
const { getStudentProgress } = require('../academic/progress');

const ALL_ROLES = ['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY', 'TA', 'STUDENT', 'ALUMNI', 'MODERATOR'];

async function myCourses(user) {
  const rows = await prisma.enrollment.findMany({
    where: { userId: user.id },
    select: {
      status: true,
      offering: {
        select: {
          id: true,
          section: true,
          room: true,
          routineSlot: true,
          course: { select: { code: true, title: true, credits: true } },
          term: { select: { code: true, status: true } },
        },
      },
    },
    take: 50,
  });
  return rows.map((row) => ({
    offeringId: row.offering.id,
    course: `${row.offering.course.code} ${row.offering.course.title}`,
    credits: row.offering.course.credits,
    term: row.offering.term.code,
    section: row.offering.section,
    room: row.offering.room,
    routine: row.offering.routineSlot,
  }));
}

async function myTeaching(user) {
  const rows = await prisma.offeringFaculty.findMany({
    where: { userId: user.id },
    select: {
      isLead: true,
      offering: {
        select: {
          id: true,
          section: true,
          course: { select: { code: true, title: true } },
          term: { select: { code: true } },
          _count: { select: { enrollments: true } },
        },
      },
    },
    take: 50,
  });
  return rows.map((row) => ({
    offeringId: row.offering.id,
    course: `${row.offering.course.code} ${row.offering.course.title}`,
    term: row.offering.term.code,
    section: row.offering.section,
    students: row.offering._count.enrollments,
    lead: row.isLead,
  }));
}

async function upcomingDeadlines(user) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: user.id },
    select: { offeringId: true },
    take: 100,
  });
  const taught = await prisma.offeringFaculty.findMany({
    where: { userId: user.id },
    select: { offeringId: true },
    take: 100,
  });
  const offeringIds = [...new Set([...enrollments, ...taught].map((row) => row.offeringId))];
  if (!offeringIds.length) return [];
  const now = new Date();
  const [assignments, quizzes, live] = await Promise.all([
    prisma.assignment.findMany({
      where: { offeringId: { in: offeringIds }, dueAt: { gte: now } },
      select: { id: true, title: true, dueAt: true, offering: { select: { course: { select: { code: true } } } } },
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    prisma.quiz.findMany({
      where: { offeringId: { in: offeringIds }, endsAt: { gte: now } },
      select: { id: true, title: true, endsAt: true, offering: { select: { course: { select: { code: true } } } } },
      orderBy: { endsAt: 'asc' },
      take: 20,
    }),
    prisma.liveClass.findMany({
      where: { offeringId: { in: offeringIds }, startsAt: { gte: now } },
      select: { id: true, title: true, startsAt: true, offering: { select: { course: { select: { code: true } } } } },
      orderBy: { startsAt: 'asc' },
      take: 20,
    }),
  ]);
  return [
    ...assignments.map((row) => ({ type: 'assignment', title: row.title, course: row.offering.course.code, at: row.dueAt })),
    ...quizzes.map((row) => ({ type: 'quiz', title: row.title, course: row.offering.course.code, at: row.endsAt })),
    ...live.map((row) => ({ type: 'live', title: row.title, course: row.offering.course.code, at: row.startsAt })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 20);
}

async function searchResources(user, args = {}) {
  const q = String(args.query || '').trim().slice(0, 120);
  const where = {
    isVerified: true,
    brokenFlag: false,
    ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }, { tags: { contains: q } }] } : {}),
  };
  const rows = await prisma.resource.findMany({
    where,
    select: { id: true, title: true, url: true, category: true, description: true, course: { select: { code: true } } },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({ ...row, url: row.url }));
}

async function describeCourse(user, args = {}) {
  const code = String(args.code || '').trim().toUpperCase().slice(0, 20);
  if (!code) throw errors.badRequest('Course code is required');
  const course = await prisma.course.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      title: true,
      credits: true,
      description: true,
      prerequisites: true,
      program: { select: { code: true, name: true, requiredCredits: true } },
    },
  });
  if (!course) throw errors.notFound('Course not found');
  if (!(await canAccessCourse(user, course.id)) && !TEACH_ROLES.includes(user.role)) {
    throw errors.forbidden('You do not have access to this course');
  }
  return course;
}

const TOOLS = {
  my_courses: {
    description: 'List the authenticated student\'s enrolled courses. Read-only.',
    roles: ['STUDENT', 'ALUMNI', 'MODERATOR', ...TEACH_ROLES, ...ADMIN_ROLES],
    handler: (user) => myCourses(user),
  },
  my_teaching: {
    description: 'List offerings taught by the authenticated faculty member or TA. Read-only.',
    roles: TEACH_ROLES,
    handler: (user) => myTeaching(user),
  },
  upcoming_deadlines: {
    description: 'List upcoming assignment, quiz and live-class deadlines for the user. Read-only.',
    roles: ALL_ROLES,
    handler: (user) => upcomingDeadlines(user),
  },
  academic_progress: {
    description: 'Explain degree progress, credits and prerequisites from authorized records. Read-only and advisory.',
    roles: ['STUDENT'],
    handler: (user) => getStudentProgress(user.id),
  },
  search_resources: {
    description: 'Search verified resource-corner links. Read-only.',
    roles: ALL_ROLES,
    handler: (user, args) => searchResources(user, args),
  },
  describe_course: {
    description: 'Describe an authorized course, its credits and prerequisites. Read-only.',
    roles: ALL_ROLES,
    handler: (user, args) => describeCourse(user, args),
  },
};

function listTools(user) {
  return Object.entries(TOOLS)
    .filter(([, tool]) => tool.roles.includes(user.role))
    .map(([name, tool]) => ({ name, description: tool.description, readOnly: true }));
}

async function executeTool(name, user, args = {}) {
  const tool = TOOLS[name];
  if (!tool) throw errors.notFound('Tool not found');
  if (!tool.roles.includes(user.role)) throw errors.forbidden('Your role cannot use this tool');
  const result = await tool.handler(user, args || {});
  return { tool: name, readOnly: true, result };
}

module.exports = { TOOLS, listTools, executeTool };
