const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/harness');
const { dispatchEvents } = require('../src/core/events');
const { publishEvent } = require('../src/core/events');

const { prisma } = harness;

let studentToken;
let facultyToken;
let adminToken;
let otherFacultyToken;
let otherStudentToken;
let student;
let faculty;
let admin;
let offering;
let otherStudent;
let otherFaculty;
let otherBatch;
let secondOffering;
let conversation;
let otherNotification;
let institutionDoc;
let adminDoc;
let courseOnlyDoc;
let assignmentId;
let submissionId;

async function pendingEvents() {
  return prisma.outboxEvent.count({ where: { status: 'PENDING' } });
}

test.before(async () => {
  await harness.start();
  student = await prisma.user.findUnique({ where: { email: 'student@mis.du.ac.bd' } });
  faculty = await prisma.user.findUnique({ where: { email: 'faculty@mis.du.ac.bd' } });
  admin = await prisma.user.findUnique({ where: { email: 'chairman@mis.du.ac.bd' } });
  otherFaculty = await harness.createUser({ name: 'Unaffiliated Faculty', email: 'unaffiliated@test.local', role: 'FACULTY' });
  otherStudent = await harness.createUser({ name: 'Other Student', email: 'other.student@test.local', role: 'STUDENT' });

  offering = await prisma.offering.findFirst({
    where: { course: { code: 'MIS-352' }, term: { code: 'FALL-2026' } },
    include: { course: true, term: true },
  });
  const otherCourse = await prisma.course.findUnique({ where: { code: 'MIS-410' } });
  secondOffering = await prisma.offering.create({
    data: { courseId: otherCourse.id, termId: offering.termId, section: 'B' },
  });
  otherBatch = await prisma.batch.create({
    data: { programId: offering.course.programId, name: `Other Batch ${Date.now()}`, session: '2026-27' },
  });
  await prisma.enrollment.create({
    data: { offeringId: offering.id, userId: otherStudent.id, batchId: otherBatch.id },
  });

  conversation = await prisma.conversation.create({
    data: {
      type: 'DM',
      createdBy: otherStudent.id,
      members: {
        create: [
          { userId: otherStudent.id, role: 'ADMIN' },
          { userId: faculty.id, role: 'MEMBER' },
        ],
      },
    },
  });

  otherNotification = await prisma.notification.create({
    data: { userId: otherStudent.id, title: 'Private notification for another user' },
  });

  institutionDoc = await harness.createKnowledge({
    title: 'Institution Search Fixture',
    content: 'The distinctive term zebraunicornpolicy refers to an institution-wide test fixture for search. It is approved for everyone.',
    ownerId: admin.id,
    visibility: 'INSTITUTION',
  });
  adminDoc = await harness.createKnowledge({
    title: 'Administrator Search Fixture',
    content: 'The distinctive term adminonlyzebra is restricted to administrators and must never reach students.',
    ownerId: admin.id,
    visibility: 'ADMIN',
  });
  courseOnlyDoc = await harness.createKnowledge({
    title: 'MIS-410 Only Fixture',
    content: 'The distinctive term courseonlyzebra belongs to MIS-410 and must only be visible to enrolled or teaching users.',
    ownerId: faculty.id,
    visibility: 'COURSE',
    courseId: otherCourse.id,
  });

  await prisma.socialPost.create({
    data: {
      authorId: admin.id,
      body: 'otherbatchpost visible only to another batch',
      visibility: 'BATCH',
      batchId: otherBatch.id,
    },
  });
  const studentBatch = await prisma.enrollment.findFirst({ where: { userId: student.id, batchId: { not: null } } });
  await prisma.socialPost.create({
    data: {
      authorId: admin.id,
      body: 'samebatchpost visible to the student batch',
      visibility: 'BATCH',
      batchId: studentBatch.batchId,
    },
  });

  studentToken = await harness.login('student@mis.du.ac.bd');
  facultyToken = await harness.login('faculty@mis.du.ac.bd');
  adminToken = await harness.login('chairman@mis.du.ac.bd');
  otherFacultyToken = await harness.login('unaffiliated@test.local');
  otherStudentToken = await harness.login('other.student@test.local');
});

test.after(async () => {
  await harness.stop();
});

test('system endpoints are public and versioned', async () => {
  for (const path of ['/health', '/ready', '/openapi.json', '/v1/health', '/v1/ready']) {
    const response = await harness.request('GET', path);
    assert.equal(response.status, 200, path);
  }
});

test('authentication uses revocable sessions', async () => {
  const token = await harness.login('student@mis.du.ac.bd');
  const me = await harness.request('GET', '/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.json.role, 'STUDENT');

  const logout = await harness.request('POST', '/auth/logout', { token, body: {} });
  assert.equal(logout.status, 200);

  const after = await harness.request('GET', '/auth/me', { token });
  assert.equal(after.status, 401);
});

test('protected routes reject anonymous requests', async () => {
  assert.equal((await harness.request('GET', '/me/courses')).status, 401);
  assert.equal((await harness.request('PUT', '/auth/password', { body: { currentPassword: 'x', newPassword: 'longenough123' } })).status, 401);
  assert.equal((await harness.request('GET', '/v1/me/courses')).status, 401);
});

test('students cannot escalate roles or enumerate users', async () => {
  const escalation = await harness.request('PUT', `/users/${otherStudent.id}`, {
    token: studentToken,
    body: { role: 'SUPER_ADMIN' },
  });
  assert.equal(escalation.status, 403);

  assert.equal((await harness.request('GET', '/users', { token: studentToken })).status, 403);
  assert.equal((await harness.request('POST', '/programs', {
    token: studentToken,
    body: { code: 'HACK', name: 'Hacked Program' },
  })).status, 403);
  assert.equal((await harness.request('GET', '/programs', { token: studentToken })).status, 200);

  const facultyEscalation = await harness.request('PUT', `/users/${otherStudent.id}`, {
    token: facultyToken,
    body: { role: 'SUPER_ADMIN' },
  });
  assert.equal(facultyEscalation.status, 403);
});

test('gradebook and question banks are staff-only and offering-scoped', async () => {
  assert.equal((await harness.request('GET', `/offerings/${offering.id}/gradebook`, { token: studentToken })).status, 403);
  assert.equal((await harness.request('GET', '/banks', { token: studentToken })).status, 403);

  const gradebook = await harness.request('GET', `/offerings/${offering.id}/gradebook`, { token: facultyToken });
  assert.equal(gradebook.status, 200);
  assert.ok(Array.isArray(gradebook.json.items));

  assert.equal((await harness.request('GET', '/banks', { token: facultyToken })).status, 200);

  const unaffiliated = await harness.request('GET', `/offerings/${offering.id}/gradebook`, { token: otherFacultyToken });
  assert.equal(unaffiliated.status, 403);
});

test('offering ownership is enforced for content writes and reads', async () => {
  const create = await harness.request('POST', '/assignments', {
    token: otherFacultyToken,
    body: { offeringId: offering.id, title: 'Unauthorized assignment', maxMarks: 10 },
  });
  assert.equal(create.status, 403);

  const moduleWrite = await harness.request('POST', '/modules', {
    token: otherFacultyToken,
    body: { offeringId: offering.id, title: 'Unauthorized module' },
  });
  assert.equal(moduleWrite.status, 403);

  assert.equal((await harness.request('GET', `/offerings/${secondOffering.id}/assignments`, { token: studentToken })).status, 403);

  const allowed = await harness.request('POST', '/assignments', {
    token: facultyToken,
    body: {
      offeringId: offering.id,
      title: 'Authorized test assignment',
      brief: 'Security test',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      maxMarks: 20,
      lateRule: 'ALLOW_LATE',
    },
  });
  assert.equal(allowed.status, 201);
  assignmentId = allowed.json.id;
});

test('IDOR checks protect enrollments, conversations, notifications and offerings', async () => {
  assert.equal((await harness.request('GET', `/enrollments?userId=${otherStudent.id}`, { token: studentToken })).status, 403);
  assert.equal((await harness.request('GET', `/conversations/${conversation.id}/messages`, { token: studentToken })).status, 403);
  assert.equal((await harness.request('PUT', `/notifications/${otherNotification.id}/read`, { token: studentToken, body: {} })).status, 403);
  assert.equal((await harness.request('GET', `/offerings/${secondOffering.id}/learn`, { token: studentToken })).status, 403);
  assert.equal((await harness.request('GET', `/offerings/${secondOffering.id}/live`, { token: studentToken })).status, 403);
});

test('resource suggestions reject unsafe URLs and duplicates', async () => {
  const javascript = await harness.request('POST', '/resources/suggest', {
    token: studentToken,
    body: { title: 'Bad link', url: 'javascript:alert(1)' },
  });
  assert.equal(javascript.status, 400);

  const privateHost = await harness.request('POST', '/resources/suggest', {
    token: studentToken,
    body: { title: 'Private link', url: 'http://127.0.0.1/private' },
  });
  assert.equal(privateHost.status, 400);

  const good = await harness.request('POST', '/resources/suggest', {
    token: studentToken,
    body: { title: 'Security test resource', url: `https://example.org/resource-${Date.now()}`, category: 'TOOLS' },
  });
  assert.equal(good.status, 201);

  const duplicate = await harness.request('POST', '/resources/suggest', {
    token: studentToken,
    body: { title: 'Duplicate', url: good.json.url },
  });
  assert.equal(duplicate.status, 409);
});

test('events fan out notifications with deduplication', async () => {
  await dispatchEvents();
  const assignmentNote = await prisma.notification.findFirst({
    where: { userId: student.id, title: { contains: 'Authorized test assignment' } },
  });
  assert.ok(assignmentNote, 'student should be notified about the new assignment');

  const submitted = await harness.request('POST', '/submissions', {
    token: studentToken,
    body: { assignmentId, body: 'My submission for the security test' },
  });
  assert.equal(submitted.status, 200);
  submissionId = submitted.json.id;

  await dispatchEvents();
  const submissionNote = await prisma.notification.findFirst({
    where: { userId: faculty.id, title: { contains: 'New submission' } },
  });
  assert.ok(submissionNote, 'faculty should be notified about the submission');

  const graded = await harness.request('PUT', `/submissions/${submissionId}/grade`, {
    token: facultyToken,
    body: { marks: 18, feedback: 'Good work' },
  });
  assert.equal(graded.status, 200);
  await dispatchEvents();

  const gradedNote = await prisma.notification.count({
    where: { userId: student.id, title: 'Assignment graded' },
  });
  assert.equal(gradedNote, 1);

  await publishEvent(null, 'SubmissionGraded', {
    submissionId,
    assignmentId,
    userId: student.id,
    marks: 18,
    maxMarks: 20,
  });
  await dispatchEvents();
  const afterDuplicate = await prisma.notification.count({
    where: { userId: student.id, title: 'Assignment graded' },
  });
  assert.equal(afterDuplicate, 1, 'duplicate events must not duplicate notifications');
});

test('grading respects locks and offering ownership', async () => {
  const otherFacultyGrade = await harness.request('PUT', `/submissions/${submissionId}/grade`, {
    token: otherFacultyToken,
    body: { marks: 10 },
  });
  assert.equal(otherFacultyGrade.status, 403);

  await prisma.offering.update({ where: { id: offering.id }, data: { isLocked: true } });
  const lockedGrade = await harness.request('PUT', `/submissions/${submissionId}/grade`, {
    token: facultyToken,
    body: { marks: 19 },
  });
  assert.equal(lockedGrade.status, 409);
  await prisma.offering.update({ where: { id: offering.id }, data: { isLocked: false } });

  const gradeItem = await prisma.gradeItem.findFirst({ where: { offeringId: offering.id } });
  const overLimit = await harness.request('POST', '/grades/bulk', {
    token: facultyToken,
    body: { itemId: gradeItem.id, grades: [{ userId: student.id, marks: gradeItem.weight + 1 }] },
  });
  assert.equal(overLimit.status, 400);
});

test('search respects document, post and people visibility', async () => {
  const institution = await harness.request('GET', '/search?q=zebraunicornpolicy', { token: studentToken });
  assert.equal(institution.status, 200);
  assert.ok(institution.json.results.some((row) => row.id === institutionDoc.id));

  const adminOnlyStudent = await harness.request('GET', '/search?q=adminonlyzebra', { token: studentToken });
  assert.equal(adminOnlyStudent.status, 200);
  assert.ok(!adminOnlyStudent.json.results.some((row) => row.id === adminDoc.id));

  const adminOnlyAdmin = await harness.request('GET', '/search?q=adminonlyzebra', { token: adminToken });
  assert.ok(adminOnlyAdmin.json.results.some((row) => row.id === adminDoc.id));

  const courseOnly = await harness.request('GET', '/search?q=courseonlyzebra', { token: studentToken });
  assert.ok(!courseOnly.json.results.some((row) => row.id === courseOnlyDoc.id));

  const otherBatch = await harness.request('GET', '/search?q=otherbatchpost&types=post', { token: studentToken });
  assert.equal(otherBatch.json.total, 0);
  const sameBatch = await harness.request('GET', '/search?q=samebatchpost&types=post', { token: studentToken });
  assert.ok(sameBatch.json.results.length >= 1);

  assert.equal((await harness.request('GET', '/search?q=x', { token: studentToken })).status, 400);
});

test('closed registration and safe defaults are enforced', async () => {
  const register = await harness.request('POST', '/auth/register', {
    body: { name: 'Public Person', email: 'public.person@test.local', password: 'longenough123' },
  });
  assert.equal(register.status, 403);
});

test('admin analytics and user administration remain admin-only', async () => {
  assert.equal((await harness.request('GET', '/analytics/overview', { token: facultyToken })).status, 403);
  const overview = await harness.request('GET', '/analytics/overview', { token: adminToken });
  assert.equal(overview.status, 200);
  assert.ok(overview.json.users.STUDENT >= 2);

  const listing = await harness.request('GET', '/users?role=STUDENT', { token: adminToken });
  assert.equal(listing.status, 200);
  assert.ok(listing.json.some((row) => row.id === otherStudent.id));
});

test('pending event backlog is drained', async () => {
  for (let index = 0; index < 10; index += 1) {
    const pending = await pendingEvents();
    if (pending === 0) break;
    await dispatchEvents();
  }
  const pending = await pendingEvents();
  assert.equal(pending, 0);
});
