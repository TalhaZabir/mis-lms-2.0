const jwt = require('jsonwebtoken');
const prisma = require('../db');
const config = require('../config');
const { errors } = require('./errors');

function signToken(user, sessionId) {
  return jwt.sign({ sub: user.id, sid: sessionId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: 'mis-lms',
    audience: 'mis-lms-web',
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    issuer: 'mis-lms',
    audience: 'mis-lms-web',
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || null,
    avatarUrl: user.avatarUrl || null,
  };
}

async function createSession(user, req) {
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      userAgent: String(req.get?.('user-agent') || '').slice(0, 255) || null,
      ip: String(req.ip || '').slice(0, 100) || null,
      expiresAt,
    },
  });
  return { session, token: signToken(user, session.id) };
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

async function resolveSession(token) {
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw errors.unauthenticated('Invalid or expired token');
  }
  if (!payload.sub || !payload.sid) throw errors.unauthenticated('Invalid token payload');
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true, phone: true, avatarUrl: true, isActive: true },
      },
    },
  });
  if (!session || session.userId !== payload.sub) throw errors.unauthenticated('Session not found');
  if (session.revokedAt) throw errors.unauthenticated('Session has been revoked');
  if (session.expiresAt <= new Date()) throw errors.unauthenticated('Session has expired');
  if (!session.user.isActive) throw errors.unauthenticated('Account is inactive');
  return { session, user: session.user };
}

async function optionalAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) return next();
  try {
    const { session, user } = await resolveSession(token);
    req.user = user;
    req.session = session;
    touchSession(session);
    next();
  } catch (error) {
    // Optional auth never blocks public routes; invalid credentials are ignored.
    next();
  }
}

function touchSession(session) {
  if (Date.now() - new Date(session.lastSeenAt).getTime() > 5 * 60 * 1000) {
    prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
}

async function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) return next(errors.unauthenticated());
  try {
    const { session, user } = await resolveSession(token);
    req.user = user;
    req.session = session;
    touchSession(session);
    next();
  } catch (error) {
    next(error);
  }
}

async function revokeSession(sessionId, userId) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || (userId && session.userId !== userId)) throw errors.notFound('Session not found');
  return prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

async function revokeAllSessions(userId, exceptSessionId) {
  return prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  signToken,
  verifyToken,
  publicUser,
  createSession,
  resolveSession,
  optionalAuth,
  requireAuth,
  revokeSession,
  revokeAllSessions,
  tokenFromRequest,
};
