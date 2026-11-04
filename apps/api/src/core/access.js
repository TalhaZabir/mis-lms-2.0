const prisma = require('../db');
const { errors } = require('./errors');

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN_STAFF'];
const TEACH_ROLES = [...ADMIN_ROLES, 'FACULTY', 'TA'];
const MOD_ROLES = [...ADMIN_ROLES, 'MODERATOR'];
const MANAGER_ROLES = [...ADMIN_ROLES, 'FACULTY'];
const CURATOR_ROLES = [...ADMIN_ROLES, 'FACULTY'];

function isAdmin(user) {
  return !!user && ADMIN_ROLES.includes(user.role);
}

function isSuperAdmin(user) {
  return !!user && user.role === 'SUPER_ADMIN';
}

function isTeacher(user) {
  return !!user && TEACH_ROLES.includes(user.role);
}

function isModerator(user) {
  return !!user && MOD_ROLES.includes(user.role);
}

async function getOfferingContext(offeringId, userId) {
  const offering = await prisma.offering.findUnique({
    where: { id: offeringId },
    include: {
      course: { select: { id: true, code: true, title: true, programId: true } },
      term: { select: { id: true, code: true, name: true, status: true } },
      faculty: { select: { userId: true, isLead: true } },
      enrollments: userId ? { where: { userId }, select: { id: true } } : undefined,
    },
  });
  if (!offering) throw errors.notFound('Offering not found');
  return offering;
}

function isOfferingFaculty(user, offering) {
  return !!user && (offering.faculty || []).some((row) => row.userId === user.id);
}

function canManageContent(user, offering) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (user.role === 'FACULTY' || user.role === 'TA') return isOfferingFaculty(user, offering);
  return false;
}

function canManageGrades(user, offering) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return user.role === 'FACULTY' && isOfferingFaculty(user, offering);
}

function canViewOffering(user, offering) {
  if (!user) return false;
  if (isAdmin(user) || isOfferingFaculty(user, offering)) return true;
  return (offering.enrollments || []).length > 0;
}

async function assertViewOffering(user, offeringId) {
  const offering = await getOfferingContext(offeringId, user?.id);
  if (!canViewOffering(user, offering)) throw errors.forbidden('You are not enrolled in this offering');
  return offering;
}

async function assertContentManager(user, offeringId) {
  const offering = await getOfferingContext(offeringId, user?.id);
  if (!canManageContent(user, offering)) throw errors.forbidden('You cannot manage content for this offering');
  return offering;
}

async function assertGradeManager(user, offeringId) {
  const offering = await getOfferingContext(offeringId, user?.id);
  if (!canManageGrades(user, offering)) throw errors.forbidden('You cannot manage grades for this offering');
  return offering;
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getUserAudience(userId) {
  const [enrollments, alumni] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId },
      select: { batchId: true, offering: { select: { course: { select: { programId: true } } } } },
      take: 100,
    }),
    prisma.alumniProfile.findUnique({ where: { userId }, select: { program: true } }),
  ]);
  const batchIds = [...new Set(enrollments.map((row) => row.batchId).filter(Boolean))];
  const programIds = [...new Set(enrollments.map((row) => row.offering?.course?.programId).filter(Boolean))];
  if (alumni?.program) {
    const program = await prisma.program.findUnique({ where: { code: alumni.program }, select: { id: true } });
    if (program) programIds.push(program.id);
  }
  return { batchIds, programIds: [...new Set(programIds)], programCodes: [] };
}

function canViewPost(user, post, audience) {
  if (!user || !post) return false;
  if (isModerator(user)) return true;
  if (post.authorId === user.id) return true;
  if (post.isHidden) return false;
  if (post.visibility === 'MIS_PUBLIC') return true;
  if (post.visibility === 'ALUMNI_CIRCLE') return user.role === 'ALUMNI';
  if (post.visibility === 'PROGRAM') {
    return !!post.programId && !!audience?.programIds?.includes(post.programId);
  }
  if (post.visibility === 'BATCH') {
    return !!post.batchId && !!audience?.batchIds?.includes(post.batchId);
  }
  return false;
}

async function assertCanViewPost(user, postId) {
  const post = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!post) throw errors.notFound('Post not found');
  const audience = await getUserAudience(user.id);
  if (!canViewPost(user, post, audience)) throw errors.forbidden('This post is not visible to you');
  return post;
}

async function canAccessCourse(user, courseId) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const offering = await prisma.offering.findFirst({
    where: {
      courseId,
      OR: [
        { enrollments: { some: { userId: user.id } } },
        { faculty: { some: { userId: user.id } } },
      ],
    },
    select: { id: true },
  });
  return !!offering;
}

async function canViewKnowledge(user, document) {
  if (!user || !document) return false;
  if (isAdmin(user) || document.ownerId === user.id) return true;
  if (document.status !== 'APPROVED') return false;

  const allowedRoles = parseJsonArray(document.allowedRoles);
  if (allowedRoles.length && !allowedRoles.includes(user.role)) return false;

  switch (document.visibility) {
    case 'INSTITUTION':
      return true;
    case 'ALUMNI':
      return user.role === 'ALUMNI';
    case 'FACULTY':
      return TEACH_ROLES.includes(user.role);
    case 'ADMIN':
      return false;
    case 'PROGRAM': {
      const audience = await getUserAudience(user.id);
      if (!document.programCode) return false;
      const program = await prisma.program.findUnique({ where: { code: document.programCode }, select: { id: true } });
      return !!program && audience.programIds.includes(program.id);
    }
    case 'COURSE':
      return !!document.courseId && canAccessCourse(user, document.courseId);
    default:
      return false;
  }
}

async function assertCanManageKnowledge(user, document) {
  if (!user) throw errors.forbidden();
  if (isAdmin(user) || (document && document.ownerId === user.id)) return;
  if (document?.courseId && user.role === 'FACULTY') {
    const offering = await prisma.offering.findFirst({ where: { courseId: document.courseId, faculty: { some: { userId: user.id } } }, select: { id: true } });
    if (offering) return;
  }
  throw errors.forbidden('You cannot manage this knowledge document');
}

function assertCanManageUser(actor, target, changes = {}) {
  if (!actor || !target) throw errors.forbidden();
  if (actor.id === target.id) {
    if (changes.isActive === false) throw errors.badRequest('You cannot deactivate your own account');
    if (changes.role && changes.role !== actor.role) throw errors.badRequest('You cannot change your own role');
    return;
  }
  if (isSuperAdmin(actor)) return;
  if (actor.role === 'ADMIN_STAFF') {
    if (['SUPER_ADMIN', 'ADMIN_STAFF'].includes(target.role)) throw errors.forbidden('Only a super admin can manage administrators');
    if (changes.role === 'SUPER_ADMIN') throw errors.forbidden('Only a super admin can grant SUPER_ADMIN');
    return;
  }
  if (actor.role === 'MODERATOR') {
    if (!['STUDENT', 'ALUMNI'].includes(target.role)) throw errors.forbidden('Moderators can only act on students and alumni');
    return;
  }
  throw errors.forbidden('You cannot manage this user');
}

function canViewResource(user, resource) {
  if (!user || !resource) return false;
  if (resource.isVerified) return true;
  return isAdmin(user) || ['FACULTY'].includes(user.role) || resource.addedById === user.id;
}

module.exports = {
  ADMIN_ROLES,
  TEACH_ROLES,
  MOD_ROLES,
  MANAGER_ROLES,
  CURATOR_ROLES,
  isAdmin,
  isSuperAdmin,
  isTeacher,
  isModerator,
  getOfferingContext,
  isOfferingFaculty,
  canManageContent,
  canManageGrades,
  canViewOffering,
  assertViewOffering,
  assertContentManager,
  assertGradeManager,
  getUserAudience,
  canViewPost,
  assertCanViewPost,
  canAccessCourse,
  canViewKnowledge,
  assertCanManageKnowledge,
  assertCanManageUser,
  canViewResource,
  parseJsonArray,
};
