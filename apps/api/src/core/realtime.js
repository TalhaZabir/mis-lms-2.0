const { Server } = require('socket.io');
const prisma = require('../db');
const config = require('../config');
const { resolveSession, tokenFromRequest } = require('./auth');
const { logger } = require('./logger');

let io = null;

function corsOrigin() {
  if (config.corsOrigins.includes('*')) return true;
  return config.corsOrigins;
}

function extractToken(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === 'string' && authToken) return authToken;
  const header = socket.handshake?.headers?.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

async function canJoinRoom(user, room) {
  if (typeof room !== 'string' || room.length === 0 || room.length > 120) return false;
  if (room === `user:${user.id}`) return true;
  // Conversation rooms keep the existing conversation id as the room name.
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: room, userId: user.id } },
    select: { userId: true },
  }).catch(() => null);
  return !!member;
}

function attachRealtime(server) {
  if (io) return io;
  io = new Server(server, {
    cors: { origin: corsOrigin(), credentials: true },
    maxHttpBufferSize: 1e6,
    pingTimeout: 30000,
  });

  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error('Authentication required'));
      const { user, session } = await resolveSession(token);
      socket.data.user = user;
      socket.data.sessionId = session.id;
      next();
    } catch (error) {
      logger.warn('socket_auth_failed', { message: error.message });
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    socket.data.messageWindow = { count: 0, reset: Date.now() + 10000 };

    socket.emit('ready', { userId: user.id, role: user.role });

    socket.on('join', async (room, ack) => {
      try {
        if (!(await canJoinRoom(user, room))) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Not allowed to join this room' });
          return;
        }
        socket.join(room);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        logger.error('socket_join_failed', { error: logger.serializeError(error) });
        if (typeof ack === 'function') ack({ ok: false, error: 'Join failed' });
      }
    });

    socket.on('leave', (room) => {
      if (typeof room === 'string' && room !== `user:${user.id}`) socket.leave(room);
    });

    socket.on('message', async (payload, ack) => {
      const respond = (body) => { if (typeof ack === 'function') ack(body); };
      try {
        const window = socket.data.messageWindow;
        if (Date.now() > window.reset) {
          window.count = 0;
          window.reset = Date.now() + 10000;
        }
        window.count += 1;
        if (window.count > 30) {
          respond({ ok: false, error: 'Rate limit exceeded' });
          return;
        }

        const conversationId = payload?.conversationId;
        const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
        if (!conversationId || typeof conversationId !== 'string' || !body) {
          respond({ ok: false, error: 'conversationId and body are required' });
          return;
        }
        if (body.length > 5000) {
          respond({ ok: false, error: 'Message too long' });
          return;
        }

        const member = await prisma.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId, userId: user.id } },
        });
        if (!member) {
          respond({ ok: false, error: 'Not a member of this conversation' });
          return;
        }

        // Sender identity always comes from the authenticated session, never the client.
        const saved = await prisma.message.create({
          data: {
            conversationId,
            senderId: user.id,
            body,
            attachments: typeof payload.attachments === 'string' ? payload.attachments.slice(0, 2000) : null,
            replyToId: typeof payload.replyToId === 'string' ? payload.replyToId : null,
          },
          include: { sender: { select: { id: true, name: true, role: true } } },
        });
        io.to(conversationId).emit('message', saved);
        respond({ ok: true, message: saved });
      } catch (error) {
        logger.error('socket_message_failed', { error: logger.serializeError(error), userId: user.id });
        respond({ ok: false, error: 'Could not send message' });
      }
    });
  });

  logger.info('realtime_attached');
  return io;
}

function getIo() {
  return io;
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function emitToRoom(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

async function closeRealtime() {
  if (!io) return;
  const current = io;
  io = null;
  await new Promise((resolve) => current.close(() => resolve()));
}

module.exports = {
  attachRealtime,
  getIo,
  emitToUser,
  emitToRoom,
  closeRealtime,
  canJoinRoom,
  extractToken,
};
