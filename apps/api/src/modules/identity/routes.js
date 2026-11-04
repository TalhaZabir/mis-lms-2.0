const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../../db');
const config = require('../../config');
const { requireAuth, createSession, publicUser, revokeSession, revokeAllSessions } = require('../../core/auth');
const { errors, asyncHandler } = require('../../core/errors');
const { z, zEmail, zName, zPassword, validateBody } = require('../../core/validate');
const { RateLimiter } = require('../../core/rate-limit');
const { audit } = require('../../core/audit');
const { publishEvent } = require('../../core/events');

const router = express.Router();

// A fixed hash keeps failed-login timing similar whether or not the email exists.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-parity-placeholder', 10);

const loginLimiter = new RateLimiter({
  name: 'login',
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  keyGenerator: (req) => `${req.ip || 'ip'}|${String(req.body?.email || '').trim().toLowerCase()}`,
  message: 'Too many login attempts. Please wait before trying again.',
});

const loginSchema = z.object({
  email: zEmail,
  password: z.string().min(1).max(200),
}).strict();

const registerSchema = z.object({
  name: zName,
  email: zEmail,
  password: zPassword,
}).strict();

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: zPassword,
}).strict();

router.post('/auth/login', validateBody(loginSchema), loginLimiter.middleware(), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  const ok = await bcrypt.compare(req.body.password, user ? user.passwordHash : DUMMY_PASSWORD_HASH);
  if (!user || !user.isActive || !ok) {
    await prisma.auditLog.create({
      data: {
        userId: user?.id || null,
        action: 'auth.login_failed',
        ip: String(req.ip || '').slice(0, 100) || null,
        requestId: req.id || null,
        meta: JSON.stringify({ email: req.body.email, reason: !user ? 'unknown' : (!user.isActive ? 'inactive' : 'bad_password') }),
      },
    }).catch(() => {});
    throw errors.unauthenticated('Invalid email or password');
  }
  const { session, token } = await createSession(user, req);
  req.user = user;
  await audit(req, 'auth.login', { targetType: 'Session', targetId: session.id });
  res.json({
    token,
    expiresAt: session.expiresAt,
    user: publicUser(user),
  });
}));

router.post('/auth/register', validateBody(registerSchema), asyncHandler(async (req, res) => {
  if (!config.allowPublicRegistration) {
    throw errors.forbidden('Public registration is disabled. Please contact the department office.');
  }
  const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (existing) throw errors.conflict('An account with this email already exists');
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: req.body.name,
        email: req.body.email,
        passwordHash,
        role: 'STUDENT',
      },
    });
    await publishEvent(tx, 'UserCreated', { userId: created.id, email: created.email, name: created.name });
    return created;
  });
  const { session, token } = await createSession(user, req);
  req.user = user;
  await audit(req, 'auth.register', { targetType: 'User', targetId: user.id });
  res.status(201).json({ token, expiresAt: session.expiresAt, user: publicUser(user) });
}));

router.get('/auth/me', requireAuth, asyncHandler(async (req, res) => {
  res.json(publicUser(req.user));
}));

router.post('/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  await revokeSession(req.session.id, req.user.id);
  await audit(req, 'auth.logout', { targetType: 'Session', targetId: req.session.id });
  res.json({ ok: true });
}));

router.get('/auth/sessions', requireAuth, asyncHandler(async (req, res) => {
  const rows = await prisma.session.findMany({
    where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });
  res.json(rows.map((row) => ({ ...row, current: row.id === req.session.id })));
}));

router.post('/auth/sessions/:id/revoke', requireAuth, asyncHandler(async (req, res) => {
  await revokeSession(req.params.id, req.user.id);
  await audit(req, 'auth.session_revoke', { targetType: 'Session', targetId: req.params.id });
  res.json({ ok: true });
}));

router.put('/auth/password', requireAuth, validateBody(passwordSchema), asyncHandler(async (req, res) => {
  const ok = await bcrypt.compare(req.body.currentPassword, req.user.passwordHash).catch(() => false);
  if (!ok) throw errors.badRequest('Current password is incorrect');
  const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
  await revokeAllSessions(req.user.id, req.session.id);
  await audit(req, 'auth.password_change', { targetType: 'User', targetId: req.user.id });
  res.json({ ok: true, message: 'Password updated. Other sessions have been revoked.' });
}));

module.exports = router;
