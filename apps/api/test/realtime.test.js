process.env.FEATURES_REALTIME = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const harness = require('./helpers/harness');

const { prisma } = harness;

let studentToken;
let facultyToken;
let student;
let faculty;
let conversation;
let client;

function connect(token, base) {
  return new Promise((resolve, reject) => {
    const socket = io(base, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Socket connection timed out'));
    }, 6000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ack for ${event}`)), 5000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

test.before(async () => {
  await harness.start({ realtime: true });
  student = await prisma.user.findUnique({ where: { email: 'student@mis.du.ac.bd' } });
  faculty = await prisma.user.findUnique({ where: { email: 'faculty@mis.du.ac.bd' } });
  studentToken = await harness.login('student@mis.du.ac.bd');
  facultyToken = await harness.login('faculty@mis.du.ac.bd');
  conversation = await prisma.conversation.create({
    data: {
      type: 'GROUP',
      title: 'Realtime security fixture',
      createdBy: student.id,
      members: {
        create: [
          { userId: student.id, role: 'ADMIN' },
          { userId: faculty.id, role: 'MEMBER' },
        ],
      },
    },
  });
});

test.after(async () => {
  if (client) client.close();
  await harness.stop();
});

test('socket connections require a valid session', async () => {
  await assert.rejects(() => connect(null, harness.base), /Authentication required|Authentication failed/);
});

test('room joins are authorized and sender identity cannot be spoofed', async () => {
  client = await connect(studentToken, harness.base);
  const forbiddenRoom = await emitAck(client, 'join', `user:${faculty.id}`);
  assert.equal(forbiddenRoom.ok, false);

  const allowedRoom = await emitAck(client, 'join', conversation.id);
  assert.equal(allowedRoom.ok, true);

  const response = await emitAck(client, 'message', {
    conversationId: conversation.id,
    senderId: faculty.id, // spoof attempt: must be ignored
    body: 'Spoofed sender check',
  });
  assert.equal(response.ok, true);
  assert.equal(response.message.sender.id, student.id);

  const stored = await prisma.message.findUnique({ where: { id: response.message.id } });
  assert.equal(stored.senderId, student.id);
});

test('socket message membership and validation are enforced', async () => {
  const outsider = await harness.createUser({ name: 'Socket Outsider', email: `socket.outsider.${Date.now()}@test.local`, role: 'STUDENT' });
  const outsiderToken = await harness.login(outsider.email);
  const outsiderClient = await connect(outsiderToken, harness.base);
  try {
    const denied = await emitAck(outsiderClient, 'message', {
      conversationId: conversation.id,
      body: 'I should not be able to post',
    });
    assert.equal(denied.ok, false);

    const empty = await emitAck(outsiderClient, 'message', { conversationId: conversation.id, body: '' });
    assert.equal(empty.ok, false);
  } finally {
    outsiderClient.close();
  }
});
