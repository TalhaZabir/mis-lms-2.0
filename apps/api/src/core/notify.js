const prisma = require('../db');
const { logger } = require('./logger');
const { emitToUser } = require('./realtime');

function safeLink(link) {
  if (!link || typeof link !== 'string') return null;
  // Internal application paths only; never allow javascript: or absolute external links.
  return link.startsWith('/') && !link.startsWith('//') ? link.slice(0, 500) : null;
}

async function notifyUser(userId, { title, body, link, dedupeKey }) {
  if (!userId || !title) return null;
  const key = dedupeKey ? `${dedupeKey}:${userId}`.slice(0, 180) : null;
  if (key) {
    const existing = await prisma.notification.findUnique({ where: { dedupeKey: key } }).catch(() => null);
    if (existing) return existing;
  }
  try {
    const row = await prisma.notification.create({
      data: {
        userId,
        title: String(title).slice(0, 200),
        body: body ? String(body).slice(0, 1000) : null,
        link: safeLink(link),
        dedupeKey: key,
      },
    });
    emitToUser(userId, 'notification', row);
    return row;
  } catch (error) {
    if (error.code === 'P2002') return null;
    logger.error('notification_failed', { userId, error: logger.serializeError(error) });
    return null;
  }
}

async function notifyUsers(userIds, payload) {
  const unique = [...new Set((userIds || []).filter(Boolean))].slice(0, 500);
  const results = [];
  for (const userId of unique) {
    results.push(await notifyUser(userId, payload));
  }
  return results.filter(Boolean);
}

async function notifyCurators(payload, roles = ['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY']) {
  const curators = await prisma.user.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { id: true },
    take: 50,
  });
  return notifyUsers(curators.map((row) => row.id), payload);
}

module.exports = { notifyUser, notifyUsers, notifyCurators, safeLink };
