process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./test.db';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-please-change-0123456789abcdef';
if (!process.env.DATABASE_URL.endsWith('test.db')) {
  throw new Error(`Tests must use a test.db database, received ${process.env.DATABASE_URL}`);
}

const http = require('http');
const { createApp } = require('../../src/index');
const prisma = require('../../src/db');

let server = null;
let base = null;

async function start({ realtime = false } = {}) {
  if (server) return { server, base };
  const app = createApp();
  server = http.createServer(app);
  if (realtime) {
    const { attachRealtime } = require('../../src/core/realtime');
    attachRealtime(server);
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;
  return { server, base };
}

async function stop() {
  if (!server) return;
  const { closeRealtime } = require('../../src/core/realtime');
  await closeRealtime().catch(() => {});
  await new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
  server = null;
  base = null;
  await prisma.$disconnect().catch(() => {});
}

async function request(method, path, { body, token, headers = {}, raw = false } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (raw) return response;
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, json, text };
}

async function login(email, password = 'mis123') {
  const response = await request('POST', '/auth/login', { body: { email, password } });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${response.text}`);
  }
  return response.json.token;
}

async function createUser({ name, email, role = 'STUDENT', password = 'mis123' }) {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(password, 4);
  return prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash, isActive: true },
    create: { name, email, role, passwordHash, isActive: true },
  });
}

async function createKnowledge({
  title,
  content,
  ownerId,
  visibility = 'INSTITUTION',
  status = 'APPROVED',
  courseId = null,
  programCode = null,
  allowedRoles = null,
}) {
  const doc = await prisma.knowledgeDocument.create({
    data: {
      title,
      content,
      kind: 'GUIDE',
      visibility,
      status,
      courseId,
      programCode,
      allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : null,
      ownerId,
    },
  });
  const { chunkText, hashEmbedding, estimateTokens } = require('../../src/modules/ai/embeddings');
  const chunks = chunkText(content, { size: 900, overlap: 120 });
  for (let index = 0; index < chunks.length; index += 1) {
    await prisma.knowledgeChunk.create({
      data: {
        documentId: doc.id,
        idx: index,
        text: chunks[index],
        tokens: estimateTokens(chunks[index]),
        embedding: JSON.stringify(hashEmbedding(chunks[index], 384)),
        metadata: JSON.stringify({ visibility, courseId }),
      },
    });
  }
  return doc;
}

module.exports = {
  prisma,
  start,
  stop,
  request,
  login,
  createUser,
  createKnowledge,
  get base() {
    return base;
  },
};
