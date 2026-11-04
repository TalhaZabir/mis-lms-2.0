const express = require('express');
const prisma = require('../db');
const { auth, requireRoles } = require('../auth');
const router = express.Router();
router.use(auth());

const MODS = ['SUPER_ADMIN', 'ADMIN_STAFF', 'MODERATOR'];
const BANNED = ['spam', 'scam', 'abuse', 'hate', 'bokachoda', 'madarchod']; // EN/BN starter list
function hasAbuse(s) {
  if (!s) return false;
  const t = s.toLowerCase();
  return BANNED.some(w => t.includes(w));
}

// ---------- Feed ----------
router.post('/posts', async (req, res) => {
  const { body, type, courseTag, imageUrls, pollData, jobMeta, visibility } = req.body;
  if (!body) return res.status(400).json({ error: 'body required' });
  if (hasAbuse(body)) return res.status(400).json({ error: 'Blocked by auto-filter (abuse/spam)' });
  // alumni defaults to ALUMNI_CIRCLE, students to BATCH
  const vis = visibility || (req.user.role === 'ALUMNI' ? 'ALUMNI_CIRCLE' : 'BATCH');
  try {
    res.json(await prisma.socialPost.create({ data: { authorId: req.user.id, body, type: type || 'TEXT', courseTag, imageUrls, pollData, jobMeta, visibility: vis } }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/feed', async (req, res) => {
  // visibility rule: BATCH hidden from ALUMNI; others visible to all
  let visFilter = undefined;
  if (req.user.role === 'ALUMNI') visFilter = { not: 'BATCH' };
  if (req.query.visibility) visFilter = req.query.visibility;
  const where = { isHidden: false, ...(visFilter ? { visibility: visFilter } : {}),
    ...(req.query.q ? { body: { contains: req.query.q } } : {}) };
  const rows = await prisma.socialPost.findMany({
    where, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: 50,
    include: { author: { select: { id: true, name: true, role: true } }, _count: { select: { likes: true, comments: true } } }
  }).catch(() => prisma.socialPost.findMany({ where: { isHidden: false }, orderBy: { createdAt: 'desc' }, take: 50 }));
  res.json(rows);
});

router.post('/posts/:id/like', async (req, res) => {
  const postId = req.params.id, userId = req.user.id;
  const ex = await prisma.postLike.findUnique({ where: { postId_userId: { postId, userId } } }).catch(() => null);
  if (ex) { await prisma.postLike.delete({ where: { postId_userId: { postId, userId } } }); return res.json({ liked: false }); }
  await prisma.postLike.create({ data: { postId, userId } }); res.json({ liked: true });
});

router.post('/posts/:id/comments', async (req, res) => {
  if (!req.body.body) return res.status(400).json({ error: 'body required' });
  if (hasAbuse(req.body.body)) return res.status(400).json({ error: 'Blocked by auto-filter' });
  res.json(await prisma.postComment.create({ data: { postId: req.params.id, authorId: req.user.id, body: req.body.body, parentId: req.body.parentId } }));
});
router.get('/posts/:id/comments', async (req, res) => {
  res.json(await prisma.postComment.findMany({ where: { postId: req.params.id }, orderBy: { createdAt: 'asc' }, take: 100 }));
});

router.post('/posts/:id/save', async (req, res) => {
  const postId = req.params.id, userId = req.user.id;
  const ex = await prisma.postSave.findUnique({ where: { postId_userId: { postId, userId } } }).catch(() => null);
  if (ex) { await prisma.postSave.delete({ where: { postId_userId: { postId, userId } } }); return res.json({ saved: false }); }
  await prisma.postSave.create({ data: { postId, userId } }); res.json({ saved: true });
});

router.post('/posts/:id/report', async (req, res) => {
  res.json(await prisma.postReport.create({ data: { postId: req.params.id, reporterId: req.user.id, reason: req.body.reason || 'spam' } }));
});

router.delete('/posts/:id', async (req, res) => {
  const p = await prisma.socialPost.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'Not found' });
  // No faculty review (locked decision): only author or student-led mods/admin
  if (p.authorId !== req.user.id && !MODS.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  await prisma.socialPost.delete({ where: { id: req.params.id } }); res.json({ ok: true });
});

// ---------- Alumni + Mentorship ----------
router.get('/directory/alumni', async (req, res) => {
  const q = req.query.q || '';
  const profs = await prisma.alumniProfile.findMany({
    where: { isVerified: true, ...(q ? { OR: [{ org: { contains: q } }, { gradBatch: { contains: q } }] } : {}) },
    include: { user: { select: { id: true, name: true, email: true } } }, take: 100
  });
  res.json(profs);
});

router.post('/alumni/verify/:userId', requireRoles('SUPER_ADMIN', 'ADMIN_STAFF'), async (req, res) => {
  const approve = req.body.approve !== false;
  const row = await prisma.alumniProfile.upsert({
    where: { userId: req.params.userId },
    update: { isVerified: approve, verifiedBy: req.user.id },
    create: { userId: req.params.userId, gradBatch: req.body.gradBatch || 'Unknown', program: req.body.program || 'BBA-MIS', mentorshipOptIn: !!req.body.mentorshipOptIn, isVerified: approve, verifiedBy: req.user.id }
  });
  res.json(row);
});

router.post('/mentorship/requests', async (req, res) => {
  const { mentorId, message } = req.body;
  const prof = await prisma.alumniProfile.findUnique({ where: { userId: mentorId } });
  if (!prof || !prof.isVerified) return res.status(400).json({ error: 'Mentor not verified' });
  if (!prof.mentorshipOptIn) return res.status(400).json({ error: 'Mentor has opt-out; request blocked' });
  res.json(await prisma.mentorshipRequest.create({ data: { menteeId: req.user.id, mentorId, message } }));
});
router.get('/mentorship/requests', async (req, res) => {
  res.json(await prisma.mentorshipRequest.findMany({ where: { OR: [{ menteeId: req.user.id }, { mentorId: req.user.id }] }, orderBy: { createdAt: 'desc' }, take: 100 }));
});
router.put('/mentorship/requests/:id', async (req, res) => {
  const r = await prisma.mentorshipRequest.findUnique({ where: { id: req.params.id } });
  if (!r || (r.mentorId !== req.user.id && r.menteeId !== req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  res.json(await prisma.mentorshipRequest.update({ where: { id: req.params.id }, data: { status: req.body.status } }));
});

// ---------- Conversations + Messages ----------
router.post('/conversations', async (req, res) => {
  const { type, title, memberIds, offeringId, batchName } = req.body;
  const members = [...new Set([...(memberIds || []), req.user.id])];
  // gate: student->alumni DM only if mentorship opt-in or accepted request
  if ((type === 'DM' || type === 'MENTORSHIP') && members.length === 2) {
    const other = members.find(m => m !== req.user.id);
    const otherUser = await prisma.user.findUnique({ where: { id: other }, include: { alumniProfile: true } }).catch(() => null);
    if (otherUser && otherUser.role === 'ALUMNI' && req.user.role === 'STUDENT') {
      const prof = otherUser.alumniProfile;
      const accepted = await prisma.mentorshipRequest.findFirst({ where: { menteeId: req.user.id, mentorId: other, status: 'ACCEPTED' } });
      if ((!prof || !prof.mentorshipOptIn) && !accepted) return res.status(403).json({ error: 'Alumni opt-out. Send mentorship request first.' });
    }
  }
  const conv = await prisma.conversation.create({ data: { type: type || 'DM', title, offeringId, batchName, createdBy: req.user.id } });
  await prisma.conversationMember.createMany({ data: members.map(userId => ({ conversationId: conv.id, userId, role: userId === req.user.id ? 'ADMIN' : 'MEMBER' })) });
  res.json(conv);
});

router.get('/me/conversations', async (req, res) => {
  const mems = await prisma.conversationMember.findMany({ where: { userId: req.user.id }, include: { conversation: { include: { members: { include: { user: { select: { id: true, name: true, role: true } } } } } } }, take: 100 });
  res.json(mems.map(m => m.conversation));
});

router.get('/conversations/:id/messages', async (req, res) => {
  const mem = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } } });
  if (!mem) return res.status(403).json({ error: 'Not a member' });
  res.json(await prisma.message.findMany({ where: { conversationId: req.params.id, isDeleted: false }, orderBy: { createdAt: 'asc' }, take: 100 }));
});

router.post('/conversations/:id/messages', async (req, res) => {
  const mem = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } } });
  if (!mem) return res.status(403).json({ error: 'Not a member' });
  if (!req.body.body) return res.status(400).json({ error: 'body required' });
  if (hasAbuse(req.body.body)) return res.status(400).json({ error: 'Blocked by auto-filter' });
  const msg = await prisma.message.create({ data: { conversationId: req.params.id, senderId: req.user.id, body: req.body.body, attachments: req.body.attachments, replyToId: req.body.replyToId } });
  try { global.__mis_io?.to(req.params.id).emit('message', msg); } catch {}
  res.json(msg);
});

// ---------- Moderation (NO faculty review) ----------
router.get('/moderate/reports', requireRoles(...MODS), async (req, res) => {
  res.json(await prisma.postReport.findMany({ where: { status: 'OPEN' }, include: { post: true }, orderBy: { createdAt: 'desc' }, take: 100 }));
});
router.post('/moderate/action', requireRoles(...MODS), async (req, res) => {
  const { postId, targetUserId, action, note, reportId } = req.body; // HIDE, WARN, MUTE, BAN, DISMISS
  if (postId && (action === 'HIDE' || action === 'DISMISS')) {
    await prisma.socialPost.update({ where: { id: postId }, data: { isHidden: action === 'HIDE' } });
  }
  if (targetUserId && action === 'BAN') {
    await prisma.user.update({ where: { id: targetUserId }, data: { isActive: false } });
  }
  if (reportId) await prisma.postReport.update({ where: { id: reportId }, data: { status: 'ACTIONED' } }).catch(() => {});
  res.json(await prisma.moderationAction.create({ data: { postId, targetUserId, modById: req.user.id, action, note: note || `by ${req.user.role} (no faculty review)` } }));
});

module.exports = router;
