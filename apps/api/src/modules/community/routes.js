const express = require('express');
const prisma = require('../../db');
const { requireAuth, revokeAllSessions } = require('../../core/auth');
const { errors, asyncHandler } = require('../../core/errors');
const { z, validateBody, validateQuery, paginationFrom } = require('../../core/validate');
const { audit } = require('../../core/audit');
const { publishEvent } = require('../../core/events');
const { getIo } = require('../../core/realtime');
const {
  MOD_ROLES,
  isAdmin,
  isModerator,
  getUserAudience,
  canViewPost,
  assertCanViewPost,
  assertCanManageUser,
} = require('../../core/access');

const router = express.Router();
router.use(requireAuth);

const BANNED = ['spam', 'scam', 'abuse', 'hate', 'bokachoda', 'madarchod'];
function hasAbuse(value) {
  if (!value) return false;
  const text = value.toLowerCase();
  return BANNED.some((word) => text.includes(word));
}

const VISIBILITIES = ['BATCH', 'PROGRAM', 'ALUMNI_CIRCLE', 'MIS_PUBLIC'];
const POST_TYPES = ['TEXT', 'IMAGE', 'FILE', 'POLL', 'JOB', 'EVENT', 'HELP'];

const postCreate = z.object({
  body: z.string().trim().min(1).max(10000),
  type: z.enum(POST_TYPES).optional(),
  courseTag: z.string().trim().max(80).optional(),
  imageUrls: z.string().trim().max(5000).optional(),
  pollData: z.string().trim().max(5000).optional(),
  jobMeta: z.string().trim().max(5000).optional(),
  visibility: z.enum(VISIBILITIES).optional(),
}).strict();

const commentCreate = z.object({
  body: z.string().trim().min(1).max(5000),
  parentId: z.string().trim().max(64).optional(),
}).strict();

const reportCreate = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
}).strict();

const mentorshipCreate = z.object({
  mentorId: z.string().trim().min(1).max(64),
  message: z.string().trim().max(2000).optional(),
}).strict();

const mentorshipUpdate = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED']),
}).strict();

const conversationCreate = z.object({
  type: z.enum(['DM', 'GROUP', 'MENTORSHIP', 'PLACEMENT']).optional(),
  title: z.string().trim().max(160).optional(),
  memberIds: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
  offeringId: z.string().trim().max(64).optional(),
  batchName: z.string().trim().max(80).optional(),
}).strict();

const messageCreate = z.object({
  body: z.string().trim().min(1).max(5000),
  attachments: z.string().trim().max(5000).optional(),
  replyToId: z.string().trim().max(64).optional(),
}).strict();

const alumniVerify = z.object({
  approve: z.boolean().optional(),
  gradBatch: z.string().trim().max(80).optional(),
  program: z.string().trim().max(80).optional(),
  mentorshipOptIn: z.boolean().optional(),
}).strict();

const moderationAction = z.object({
  postId: z.string().trim().max(64).optional(),
  targetUserId: z.string().trim().max(64).optional(),
  action: z.enum(['HIDE', 'WARN', 'MUTE', 'BAN', 'DISMISS']),
  note: z.string().trim().max(1000).optional(),
  reportId: z.string().trim().max(64).optional(),
}).strict().refine((value) => value.postId || value.targetUserId || value.reportId, {
  message: 'postId, targetUserId or reportId is required',
});

async function feedWhere(user, query = {}) {
  const audience = await getUserAudience(user.id);
  let where;
  if (isModerator(user)) {
    where = { isHidden: false };
  } else {
    const or = [
      { visibility: 'MIS_PUBLIC' },
      { authorId: user.id },
    ];
    if (user.role === 'ALUMNI') or.push({ visibility: 'ALUMNI_CIRCLE' });
    if (audience.programIds.length) or.push({ visibility: 'PROGRAM', programId: { in: audience.programIds } });
    if (audience.batchIds.length) or.push({ visibility: 'BATCH', batchId: { in: audience.batchIds } });
    where = { isHidden: false, OR: or };
  }
  if (query.visibility) where.visibility = query.visibility;
  if (query.q) where.body = { contains: query.q };
  return { where, audience };
}

router.get('/feed', validateQuery(z.object({
  visibility: z.enum(VISIBILITIES).optional(),
  q: z.string().trim().max(120).optional(),
}).passthrough()), asyncHandler(async (req, res) => {
  const { where } = await feedWhere(req.user, req.query);
  const { take, skip } = paginationFrom(req, 50);
  const rows = await prisma.socialPost.findMany({
    where,
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take,
    skip,
    include: {
      author: { select: { id: true, name: true, role: true } },
      _count: { select: { likes: true, comments: true } },
    },
  });
  res.json(rows);
}));

router.post('/posts', validateBody(postCreate), asyncHandler(async (req, res) => {
  if (hasAbuse(req.body.body)) throw errors.badRequest('Blocked by the automatic abuse/spam filter');
  const audience = await getUserAudience(req.user.id);
  let visibility = req.body.visibility || (req.user.role === 'ALUMNI' ? 'ALUMNI_CIRCLE' : 'BATCH');
  if (visibility === 'ALUMNI_CIRCLE' && req.user.role !== 'ALUMNI' && !isAdmin(req.user)) {
    throw errors.forbidden('Only alumni can post to the alumni circle');
  }
  if (visibility === 'BATCH' && !audience.batchIds.length) {
    visibility = audience.programIds.length ? 'PROGRAM' : 'MIS_PUBLIC';
  }
  if (visibility === 'PROGRAM' && !audience.programIds.length) {
    throw errors.badRequest('You need a programme enrolment before posting to a programme-wide feed');
  }
  const row = await prisma.$transaction(async (tx) => {
    const post = await tx.socialPost.create({
      data: {
        authorId: req.user.id,
        body: req.body.body,
        type: req.body.type || 'TEXT',
        courseTag: req.body.courseTag || null,
        imageUrls: req.body.imageUrls || null,
        pollData: req.body.pollData || null,
        jobMeta: req.body.jobMeta || null,
        visibility,
        programId: visibility === 'PROGRAM' ? audience.programIds[0] : null,
        batchId: visibility === 'BATCH' ? audience.batchIds[0] : null,
      },
    });
    await publishEvent(tx, 'PostCreated', { postId: post.id, authorId: post.authorId, visibility: post.visibility });
    return post;
  });
  await audit(req, 'post.create', { targetType: 'SocialPost', targetId: row.id, after: { visibility, type: row.type } });
  res.status(201).json(row);
}));

router.post('/posts/:id/like', asyncHandler(async (req, res) => {
  await assertCanViewPost(req.user, req.params.id);
  const existing = await prisma.postLike.findUnique({
    where: { postId_userId: { postId: req.params.id, userId: req.user.id } },
  });
  if (existing) {
    await prisma.postLike.delete({ where: { postId_userId: { postId: req.params.id, userId: req.user.id } } });
    return res.json({ liked: false });
  }
  await prisma.postLike.create({ data: { postId: req.params.id, userId: req.user.id } });
  res.json({ liked: true });
}));

router.post('/posts/:id/comments', validateBody(commentCreate), asyncHandler(async (req, res) => {
  await assertCanViewPost(req.user, req.params.id);
  if (hasAbuse(req.body.body)) throw errors.badRequest('Blocked by the automatic abuse/spam filter');
  if (req.body.parentId) {
    const parent = await prisma.postComment.findUnique({ where: { id: req.body.parentId }, select: { postId: true } });
    if (!parent || parent.postId !== req.params.id) throw errors.badRequest('Parent comment does not belong to this post');
  }
  const row = await prisma.postComment.create({
    data: { postId: req.params.id, authorId: req.user.id, body: req.body.body, parentId: req.body.parentId || null },
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  res.status(201).json(row);
}));

router.get('/posts/:id/comments', asyncHandler(async (req, res) => {
  await assertCanViewPost(req.user, req.params.id);
  const rows = await prisma.postComment.findMany({
    where: { postId: req.params.id },
    include: { author: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  res.json(rows);
}));

router.post('/posts/:id/save', asyncHandler(async (req, res) => {
  await assertCanViewPost(req.user, req.params.id);
  const existing = await prisma.postSave.findUnique({
    where: { postId_userId: { postId: req.params.id, userId: req.user.id } },
  });
  if (existing) {
    await prisma.postSave.delete({ where: { postId_userId: { postId: req.params.id, userId: req.user.id } } });
    return res.json({ saved: false });
  }
  await prisma.postSave.create({ data: { postId: req.params.id, userId: req.user.id } });
  res.json({ saved: true });
}));

router.post('/posts/:id/report', validateBody(reportCreate), asyncHandler(async (req, res) => {
  await assertCanViewPost(req.user, req.params.id);
  const existing = await prisma.postReport.findFirst({
    where: { postId: req.params.id, reporterId: req.user.id, status: 'OPEN' },
  });
  if (existing) return res.json({ ok: true, alreadyReported: true, report: existing });
  const row = await prisma.postReport.create({
    data: { postId: req.params.id, reporterId: req.user.id, reason: req.body.reason || 'spam' },
  });
  res.status(201).json(row);
}));

router.delete('/posts/:id', asyncHandler(async (req, res) => {
  const post = await prisma.socialPost.findUnique({ where: { id: req.params.id } });
  if (!post) throw errors.notFound('Post not found');
  if (post.authorId !== req.user.id && !isModerator(req.user)) throw errors.forbidden('Only the author or a moderator can delete this post');
  await prisma.socialPost.delete({ where: { id: post.id } });
  await audit(req, 'post.delete', { targetType: 'SocialPost', targetId: post.id, before: { authorId: post.authorId, visibility: post.visibility } });
  res.json({ ok: true });
}));

router.get('/directory/alumni', validateQuery(z.object({ q: z.string().trim().max(120).optional() }).passthrough()), asyncHandler(async (req, res) => {
  const q = req.query.q || '';
  const rows = await prisma.alumniProfile.findMany({
    where: {
      isVerified: true,
      ...(q ? { OR: [{ org: { contains: q } }, { gradBatch: { contains: q } }, { designation: { contains: q } }] } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    take: 100,
  });
  res.json(rows);
}));

router.post('/alumni/verify/:userId', validateBody(alumniVerify), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Only administrators can verify alumni');
  const target = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, role: true } });
  if (!target) throw errors.notFound('User not found');
  const approve = req.body.approve !== false;
  const row = await prisma.alumniProfile.upsert({
    where: { userId: target.id },
    update: {
      isVerified: approve,
      verifiedBy: req.user.id,
      ...(req.body.gradBatch ? { gradBatch: req.body.gradBatch } : {}),
      ...(req.body.program ? { program: req.body.program } : {}),
      ...(typeof req.body.mentorshipOptIn === 'boolean' ? { mentorshipOptIn: req.body.mentorshipOptIn } : {}),
    },
    create: {
      userId: target.id,
      gradBatch: req.body.gradBatch || 'Unknown',
      program: req.body.program || 'BBA-MIS',
      mentorshipOptIn: !!req.body.mentorshipOptIn,
      isVerified: approve,
      verifiedBy: req.user.id,
    },
  });
  await audit(req, 'alumni.verify', { targetType: 'AlumniProfile', targetId: target.id, after: { isVerified: approve } });
  res.json(row);
}));

router.post('/mentorship/requests', validateBody(mentorshipCreate), asyncHandler(async (req, res) => {
  if (req.body.mentorId === req.user.id) throw errors.badRequest('You cannot request mentorship from yourself');
  const profile = await prisma.alumniProfile.findUnique({
    where: { userId: req.body.mentorId },
    include: { user: { select: { isActive: true, role: true } } },
  });
  if (!profile || !profile.isVerified || !profile.user.isActive) throw errors.badRequest('Mentor is not available');
  if (!profile.mentorshipOptIn) throw errors.badRequest('This mentor has opted out of mentorship requests');
  const existing = await prisma.mentorshipRequest.findFirst({
    where: { menteeId: req.user.id, mentorId: req.body.mentorId, status: { in: ['PENDING', 'ACCEPTED'] } },
  });
  if (existing) throw errors.conflict('You already have an open mentorship request with this mentor');
  const row = await prisma.$transaction(async (tx) => {
    const request = await tx.mentorshipRequest.create({
      data: { menteeId: req.user.id, mentorId: req.body.mentorId, message: req.body.message || null },
    });
    await publishEvent(tx, 'MentorshipRequested', {
      requestId: request.id,
      menteeId: request.menteeId,
      mentorId: request.mentorId,
    });
    return request;
  });
  await audit(req, 'mentorship.request', { targetType: 'MentorshipRequest', targetId: row.id, after: { mentorId: row.mentorId } });
  res.status(201).json(row);
}));

router.get('/mentorship/requests', asyncHandler(async (req, res) => {
  const rows = await prisma.mentorshipRequest.findMany({
    where: { OR: [{ menteeId: req.user.id }, { mentorId: req.user.id }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(rows);
}));

router.put('/mentorship/requests/:id', validateBody(mentorshipUpdate), asyncHandler(async (req, res) => {
  const request = await prisma.mentorshipRequest.findUnique({ where: { id: req.params.id } });
  if (!request) throw errors.notFound('Mentorship request not found');
  const isMentor = request.mentorId === req.user.id;
  const isMentee = request.menteeId === req.user.id;
  if (!isMentor && !isMentee && !isAdmin(req.user)) throw errors.forbidden('You are not part of this mentorship request');
  const next = req.body.status;
  if (['ACCEPTED', 'DECLINED'].includes(next) && !isMentor && !isAdmin(req.user)) {
    throw errors.forbidden('Only the mentor can accept or decline a request');
  }
  if (next === 'CANCELLED' && !isMentee && !isMentor && !isAdmin(req.user)) {
    throw errors.forbidden('You cannot cancel this request');
  }
  const allowedTransitions = {
    PENDING: ['ACCEPTED', 'DECLINED', 'CANCELLED'],
    ACCEPTED: ['CANCELLED'],
    DECLINED: [],
    CANCELLED: [],
  };
  if (!(allowedTransitions[request.status] || []).includes(next)) {
    throw errors.badRequest(`Cannot move a ${request.status} request to ${next}`);
  }
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.mentorshipRequest.update({ where: { id: request.id }, data: { status: next } });
    if (next === 'ACCEPTED') {
      await publishEvent(tx, 'MentorshipAccepted', {
        requestId: updated.id,
        menteeId: updated.menteeId,
        mentorId: updated.mentorId,
      });
    }
    return updated;
  });
  await audit(req, 'mentorship.status', { targetType: 'MentorshipRequest', targetId: row.id, before: { status: request.status }, after: { status: row.status } });
  res.json(row);
}));

router.post('/conversations', validateBody(conversationCreate), asyncHandler(async (req, res) => {
  const type = req.body.type || 'DM';
  const memberIds = [...new Set([...(req.body.memberIds || []), req.user.id])];
  if (type === 'DM' && memberIds.length !== 2) throw errors.badRequest('A direct message must have exactly two members');
  const members = await prisma.user.findMany({
    where: { id: { in: memberIds }, isActive: true },
    select: { id: true, role: true, alumniProfile: { select: { mentorshipOptIn: true } } },
  });
  if (members.length !== memberIds.length) throw errors.badRequest('One or more conversation members do not exist or are inactive');

  if (type === 'DM' || type === 'MENTORSHIP') {
    const other = members.find((member) => member.id !== req.user.id);
    if (other?.role === 'ALUMNI' && req.user.role === 'STUDENT') {
      const accepted = await prisma.mentorshipRequest.findFirst({
        where: { menteeId: req.user.id, mentorId: other.id, status: 'ACCEPTED' },
      });
      const optedIn = other.alumniProfile?.mentorshipOptIn;
      if (!optedIn && !accepted) throw errors.forbidden('This alumni has opted out. Send a mentorship request first.');
    }
  }
  if (req.body.offeringId) {
    const offering = await prisma.offering.findUnique({
      where: { id: req.body.offeringId },
      include: { faculty: { select: { userId: true } }, enrollments: { where: { userId: req.user.id }, select: { id: true } } },
    });
    if (!offering) throw errors.notFound('Offering not found');
    const allowed = isAdmin(req.user)
      || offering.faculty.some((row) => row.userId === req.user.id)
      || offering.enrollments.length > 0;
    if (!allowed) throw errors.forbidden('You do not have access to this offering');
  }
  const row = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        type,
        title: req.body.title || null,
        offeringId: req.body.offeringId || null,
        batchName: req.body.batchName || null,
        createdBy: req.user.id,
      },
    });
    await tx.conversationMember.createMany({
      data: memberIds.map((userId) => ({
        conversationId: conversation.id,
        userId,
        role: userId === req.user.id ? 'ADMIN' : 'MEMBER',
      })),
    });
    return conversation;
  });
  await audit(req, 'conversation.create', { targetType: 'Conversation', targetId: row.id, after: { type: row.type, members: memberIds.length } });
  res.status(201).json(row);
}));

router.get('/me/conversations', asyncHandler(async (req, res) => {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: req.user.id },
    include: {
      conversation: {
        include: {
          members: { include: { user: { select: { id: true, name: true, role: true } } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, createdAt: true } },
        },
      },
    },
    take: 100,
  });
  res.json(memberships.map((membership) => membership.conversation));
}));

router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } },
  });
  if (!member) throw errors.forbidden('You are not a member of this conversation');
  const rows = await prisma.message.findMany({
    where: { conversationId: req.params.id, isDeleted: false },
    include: { sender: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  res.json(rows);
}));

router.post('/conversations/:id/messages', validateBody(messageCreate), asyncHandler(async (req, res) => {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } },
  });
  if (!member) throw errors.forbidden('You are not a member of this conversation');
  if (hasAbuse(req.body.body)) throw errors.badRequest('Blocked by the automatic abuse/spam filter');
  const message = await prisma.message.create({
    data: {
      conversationId: req.params.id,
      senderId: req.user.id,
      body: req.body.body,
      attachments: req.body.attachments || null,
      replyToId: req.body.replyToId || null,
    },
    include: { sender: { select: { id: true, name: true, role: true } } },
  });
  const io = getIo();
  if (io) io.to(req.params.id).emit('message', message);
  res.status(201).json(message);
}));

router.get('/moderate/reports', asyncHandler(async (req, res) => {
  if (!isModerator(req.user)) throw errors.forbidden('Moderator access required');
  const rows = await prisma.postReport.findMany({
    where: { status: 'OPEN' },
    include: { post: { include: { author: { select: { id: true, name: true, role: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(rows);
}));

router.post('/moderate/action', validateBody(moderationAction), asyncHandler(async (req, res) => {
  if (!isModerator(req.user)) throw errors.forbidden('Moderator access required');
  const { postId, targetUserId, action, note, reportId } = req.body;
  if (targetUserId) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw errors.notFound('Target user not found');
    assertCanManageUser(req.user, target, { isActive: false });
  }
  if (postId) {
    const post = await prisma.socialPost.findUnique({ where: { id: postId } });
    if (!post) throw errors.notFound('Post not found');
  }
  const result = await prisma.$transaction(async (tx) => {
    if (postId && (action === 'HIDE' || action === 'DISMISS')) {
      await tx.socialPost.update({ where: { id: postId }, data: { isHidden: action === 'HIDE' } });
    }
    if (targetUserId && action === 'BAN') {
      await tx.user.update({ where: { id: targetUserId }, data: { isActive: false } });
    }
    if (reportId) {
      await tx.postReport.update({
        where: { id: reportId },
        data: { status: action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED' },
      }).catch(() => null);
    }
    return tx.moderationAction.create({
      data: {
        postId: postId || null,
        targetUserId: targetUserId || null,
        modById: req.user.id,
        action,
        note: note || `by ${req.user.role} (no faculty review)`,
      },
    });
  });
  if (targetUserId && action === 'BAN') await revokeAllSessions(targetUserId);
  await audit(req, 'moderation.action', {
    targetType: 'ModerationAction',
    targetId: result.id,
    meta: { action, postId, targetUserId, reportId },
  });
  res.json(result);
}));

module.exports = router;
