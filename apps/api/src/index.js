const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const prisma = require('./db');

const authRoutes = require('./routes/auth');
const academicRoutes = require('./routes/academic');
const facultyRoutes = require('./routes/faculty');
const studentRoutes = require('./routes/student');
const socialRoutes = require('./routes/social');
const resourceRoutes = require('./routes/resources');

const app = express();
app.disable('x-powered-by');

// CORS allowlist for deploy (comma-separated) — defaults to open for DU LAN/dev
const ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: ORIGINS.includes('*') ? true : ORIGINS, credentials: true }));
app.use(express.json({ limit: '5mb' }));

// Minimal security headers (no extra deps for deploy)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// Tiny in-memory rate limiter (deploy-safe, no Redis needed for MVP)
const buckets = new Map();
const WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || '60000', 10);
const MAX_REQ = parseInt(process.env.RATE_MAX || '300', 10);
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/ready') return next();
  const key = req.ip || req.headers['x-forwarded-for'] || 'local';
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, reset: now + WINDOW_MS };
  if (now > b.reset) { b.count = 0; b.reset = now + WINDOW_MS; }
  b.count++; buckets.set(key, b);
  if (b.count > MAX_REQ) return res.status(429).json({ error: 'Too many requests — slow down' });
  next();
});

// Request log (single line, prod-friendly)
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`));
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'mis-lms-api', parts: '5/5 done', time: new Date().toISOString() }));
app.get('/ready', async (req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ ready: true }); }
  catch (e) { res.status(503).json({ ready: false, error: e.message }); }
});
app.use('/auth', authRoutes);
app.use('/', academicRoutes);
app.use('/', facultyRoutes);
app.use('/', studentRoutes);
app.use('/', socialRoutes);
app.use('/', resourceRoutes);

// 404 + error handler (deploy-grade JSON errors)
app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
});

// Socket (persist + broadcast) with auth-light check (senderId must exist)
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGINS.includes('*') ? true : ORIGINS } });
global.__mis_io = io;
io.on('connection', (socket) => {
  socket.on('join', (room) => { if (typeof room === 'string' && room.length < 100) socket.join(room); });
  socket.on('message', async (msg) => {
    try {
      if (msg && msg.conversationId && msg.senderId && typeof msg.body === 'string' && msg.body.length < 5000) {
        const mem = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: msg.conversationId, userId: msg.senderId } } }).catch(() => null);
        if (!mem) { socket.emit('error', { error: 'Not a member' }); return; }
        const saved = await prisma.message.create({ data: { conversationId: msg.conversationId, senderId: msg.senderId, body: msg.body } });
        io.to(msg.conversationId).emit('message', saved);
        return;
      }
    } catch {}
    io.to((msg && msg.conversationId) || 'global').emit('message', { ...(msg || {}), at: new Date().toISOString() });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`MIS LMS API on :${PORT} (env=${process.env.NODE_ENV || 'dev'})`));
