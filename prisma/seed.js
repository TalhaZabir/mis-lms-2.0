const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { chunkText, hashEmbedding, estimateTokens } = require('../apps/api/src/modules/ai/embeddings');

const prisma = new PrismaClient();

async function upsertKnowledgeDocument({ title, content, kind, visibility, courseId, ownerId, programCode }) {
  const existing = await prisma.knowledgeDocument.findFirst({ where: { title, ownerId } });
  const data = {
    title,
    content,
    kind,
    visibility,
    courseId: courseId || null,
    programCode: programCode || null,
    ownerId,
    status: 'APPROVED',
    version: 1,
  };
  const document = existing
    ? await prisma.knowledgeDocument.update({ where: { id: existing.id }, data })
    : await prisma.knowledgeDocument.create({ data });

  const chunks = chunkText(content, { size: 900, overlap: 120 });
  await prisma.knowledgeChunk.deleteMany({ where: { documentId: document.id } });
  for (let index = 0; index < chunks.length; index += 1) {
    const text = chunks[index];
    await prisma.knowledgeChunk.create({
      data: {
        documentId: document.id,
        idx: index,
        text,
        tokens: estimateTokens(text),
        embedding: JSON.stringify(hashEmbedding(text, 384)),
        metadata: JSON.stringify({ kind, visibility, courseId: courseId || null }),
      },
    });
  }
  return document;
}

async function main() {
  const hash = await bcrypt.hash('mis123', 10);
  const admin = await prisma.user.upsert({ where: { email: 'chairman@mis.du.ac.bd' }, update: { isActive: true }, create: { name: 'Chairman Office', email: 'chairman@mis.du.ac.bd', passwordHash: hash, role: 'SUPER_ADMIN' } });
  const faculty = await prisma.user.upsert({ where: { email: 'faculty@mis.du.ac.bd' }, update: { isActive: true }, create: { name: 'Demo Faculty', email: 'faculty@mis.du.ac.bd', passwordHash: hash, role: 'FACULTY' } });
  const student = await prisma.user.upsert({ where: { email: 'student@mis.du.ac.bd' }, update: { isActive: true }, create: { name: 'Demo Student (BBA 29th)', email: 'student@mis.du.ac.bd', passwordHash: hash, role: 'STUDENT' } });
  const alumni = await prisma.user.upsert({ where: { email: 'alumni@mis.du.ac.bd' }, update: { isActive: true }, create: { name: 'Demo Alumni (BBA 22nd)', email: 'alumni@mis.du.ac.bd', passwordHash: hash, role: 'ALUMNI' } });
  await prisma.alumniProfile.upsert({ where: { userId: alumni.id }, update: { isVerified: true, mentorshipOptIn: true }, create: { userId: alumni.id, gradBatch: 'BBA 22nd', program: 'BBA-MIS', org: 'Grameenphone', designation: 'MIS Analyst', mentorshipOptIn: true, isVerified: true } });

  const bba = await prisma.program.upsert({
    where: { code: 'BBA-MIS' },
    update: { requiredCredits: 120 },
    create: { code: 'BBA-MIS', name: 'BBA in Management Information Systems', description: '4-year 8-semester undergraduate', requiredCredits: 120 },
  });
  const mba = await prisma.program.upsert({
    where: { code: 'MBA-MIS' },
    update: { requiredCredits: 36 },
    create: { code: 'MBA-MIS', name: 'MBA in MIS', description: 'Regular masters', requiredCredits: 36 },
  });
  await prisma.program.upsert({ where: { code: 'EMBA' }, update: { requiredCredits: 48 }, create: { code: 'EMBA', name: 'Evening MBA', description: 'Professional weekend', requiredCredits: 48 } });
  await prisma.program.upsert({ where: { code: 'DIPLOMA' }, update: { requiredCredits: 30 }, create: { code: 'DIPLOMA', name: 'Diploma / Certificate', description: 'Short courses', requiredCredits: 30 } });

  const batch29 = await prisma.batch.findFirst({ where: { name: 'BBA 29th', programId: bba.id } })
    || await prisma.batch.create({ data: { programId: bba.id, name: 'BBA 29th', session: '2023-24' } });
  const term = await prisma.term.upsert({ where: { code: 'FALL-2026' }, update: { status: 'ACTIVE' }, create: { name: 'Fall 2026 (Sem 3/5/7)', code: 'FALL-2026', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-12-31'), status: 'ACTIVE' } });
  const spring = await prisma.term.upsert({ where: { code: 'SPRING-2026' }, update: { status: 'CLOSED' }, create: { name: 'Spring 2026', code: 'SPRING-2026', startsAt: new Date('2026-01-05'), endsAt: new Date('2026-06-20'), status: 'CLOSED' } });

  const courses = [
    { code: 'MIS-101', title: 'Intro to MIS', credits: 3, prerequisites: [] },
    { code: 'MIS-352', title: 'Database Management', credits: 3, prerequisites: ['MIS-101'] },
    { code: 'MIS-361', title: 'Systems Analysis & Design', credits: 3, prerequisites: ['MIS-101'] },
    { code: 'MIS-401', title: 'ERP & Business Analytics', credits: 3, prerequisites: ['MIS-352'] },
    { code: 'MIS-410', title: 'Business Intelligence', credits: 3, prerequisites: ['MIS-352'] },
    { code: 'MIS-420', title: 'IS Strategy and Governance', credits: 3, prerequisites: ['MIS-361'] },
  ];
  for (const course of courses) {
    await prisma.course.upsert({
      where: { code: course.code },
      update: { title: course.title, credits: course.credits, prerequisites: JSON.stringify(course.prerequisites), programId: bba.id },
      create: { ...course, prerequisites: JSON.stringify(course.prerequisites), programId: bba.id },
    });
  }
  const db = await prisma.course.findUnique({ where: { code: 'MIS-352' } });
  const bi = await prisma.course.findUnique({ where: { code: 'MIS-410' } });

  let offering = await prisma.offering.findFirst({ where: { courseId: db.id, termId: term.id, section: 'A' } });
  if (!offering) offering = await prisma.offering.create({ data: { courseId: db.id, termId: term.id, section: 'A', room: 'MIS Lab-2', routineSlot: 'Sun 10:00-11:30' } });
  await prisma.offeringFaculty.upsert({ where: { offeringId_userId: { offeringId: offering.id, userId: faculty.id } }, update: { isLead: true }, create: { offeringId: offering.id, userId: faculty.id, isLead: true } });
  await prisma.enrollment.upsert({
    where: { offeringId_userId: { offeringId: offering.id, userId: student.id } },
    update: { batchId: batch29.id, status: 'ENROLLED' },
    create: { offeringId: offering.id, userId: student.id, batchId: batch29.id },
  });

  // A completed offering gives degree-progress and GPA demos something to compute.
  const legacy = await prisma.course.findUnique({ where: { code: 'MIS-101' } });
  let completed = await prisma.offering.findFirst({ where: { courseId: legacy.id, termId: spring.id, section: 'A' } });
  if (!completed) completed = await prisma.offering.create({ data: { courseId: legacy.id, termId: spring.id, section: 'A', isLocked: true } });
  await prisma.offeringFaculty.upsert({ where: { offeringId_userId: { offeringId: completed.id, userId: faculty.id } }, update: {}, create: { offeringId: completed.id, userId: faculty.id, isLead: true } });
  await prisma.enrollment.upsert({
    where: { offeringId_userId: { offeringId: completed.id, userId: student.id } },
    update: { batchId: batch29.id, status: 'COMPLETED' },
    create: { offeringId: completed.id, userId: student.id, batchId: batch29.id, status: 'COMPLETED' },
  });
  let legacyFinal = await prisma.gradeItem.findFirst({ where: { offeringId: completed.id, name: 'Final' } });
  if (!legacyFinal) legacyFinal = await prisma.gradeItem.create({ data: { offeringId: completed.id, name: 'Final', weight: 100 } });
  await prisma.grade.upsert({
    where: { itemId_userId: { itemId: legacyFinal.id, userId: student.id } },
    update: { marks: 82 },
    create: { itemId: legacyFinal.id, userId: student.id, marks: 82 },
  });

  let moduleRow = await prisma.module.findFirst({ where: { offeringId: offering.id, title: 'Week 1 – Databases and the MIS curriculum' } });
  if (!moduleRow) moduleRow = await prisma.module.create({ data: { offeringId: offering.id, title: 'Week 1 – Databases and the MIS curriculum', order: 1 } });
  let lesson = await prisma.lesson.findFirst({ where: { moduleId: moduleRow.id, title: 'Course overview and relational model' } });
  if (!lesson) {
    lesson = await prisma.lesson.create({
      data: {
        moduleId: moduleRow.id,
        title: 'Course overview and relational model',
        kind: 'LINK',
        url: 'https://example.edu/mis-352/overview',
        body: 'Read the course guide, then review entities, relationships and normalisation.',
        order: 1,
      },
    });
  }

  let assignment = await prisma.assignment.findFirst({ where: { offeringId: offering.id, title: 'ER modelling exercise' } });
  if (!assignment) {
    assignment = await prisma.assignment.create({
      data: {
        offeringId: offering.id,
        title: 'ER modelling exercise',
        brief: 'Model the departmental library as an ER diagram, then map it to relational tables.',
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        maxMarks: 20,
        lateRule: 'ALLOW_LATE',
      },
    });
  }

  let quiz = await prisma.quiz.findFirst({ where: { offeringId: offering.id, title: 'Normalisation checkpoint' } });
  if (!quiz) {
    quiz = await prisma.quiz.create({
      data: {
        offeringId: offering.id,
        title: 'Normalisation checkpoint',
        durationMin: 20,
        maxAttempts: 2,
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  for (const [name, weight] of [['Class Test', 20], ['Midterm', 30], ['Final', 50]]) {
    const existing = await prisma.gradeItem.findFirst({ where: { offeringId: offering.id, name } });
    if (!existing) await prisma.gradeItem.create({ data: { offeringId: offering.id, name, weight } });
  }

  let attendance = await prisma.attendanceSession.findFirst({ where: { offeringId: offering.id, qrToken: 'DEMO-QR-1' } });
  if (!attendance) attendance = await prisma.attendanceSession.create({ data: { offeringId: offering.id, date: new Date(), qrToken: 'DEMO-QR-1' } });
  await prisma.attendanceRecord.upsert({
    where: { sessionId_userId: { sessionId: attendance.id, userId: student.id } },
    update: { status: 'PRESENT' },
    create: { sessionId: attendance.id, userId: student.id, status: 'PRESENT' },
  });

  let live = await prisma.liveClass.findFirst({ where: { offeringId: offering.id, title: 'Database normalisation clinic' } });
  if (!live) {
    live = await prisma.liveClass.create({
      data: {
        offeringId: offering.id,
        title: 'Database normalisation clinic',
        joinUrl: 'https://meet.example.edu/mis-352-clinic',
        startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const welcome = await prisma.announcement.findFirst({ where: { title: 'Welcome to MIS LMS Fall 2026' } });
  if (!welcome) {
    await prisma.announcement.create({ data: { title: 'Welcome to MIS LMS Fall 2026', body: 'MIS LMS 2.0 is live with global search, notifications and an optional read-only assistant.', audience: 'ALL' } });
  }

  const demoResource = await prisma.resource.findFirst({ where: { url: 'https://nptel.ac.in' } });
  if (!demoResource) {
    await prisma.resource.create({ data: { title: 'DBMS – NPTEL Playlist', url: 'https://nptel.ac.in', category: 'COURSE_MAT', description: 'Supplementary for MIS-352', forProgram: 'BBA-MIS', courseId: db.id, addedById: faculty.id, isVerified: true } });
  }

  await upsertKnowledgeDocument({
    title: 'MIS-352 Database Management – Course Guide',
    kind: 'SYLLABUS',
    visibility: 'COURSE',
    courseId: db.id,
    ownerId: faculty.id,
    content: `MIS-352 Database Management is a three-credit course in the BBA in Management Information Systems programme at the Department of Management Information Systems, University of Dhaka.

The course introduces the relational model, entity-relationship modelling, database design, SQL, normalisation, transactions and basic database administration. Students practise with a departmental case study and a term project.

Assessment for MIS-352 is: class tests 20 percent, midterm examination 30 percent, final examination 50 percent. To pass the course a student must obtain at least 40 percent overall. The course prerequisites are MIS-101 Introduction to MIS.

Classes are held in MIS Lab-2. The demonstration section for Fall 2026 meets on Sunday from 10:00 to 11:30. Students should bring a laptop for lab sessions. The recommended reading is the NPTEL database playlist and the course notes posted in Learn.

Late assignment submissions are accepted for MIS-352 with a recorded lateness flag. Quiz attempts are limited to the number configured by the course teacher, normally two attempts. Results are advisory inside the LMS until the offering is locked by the teacher; only the departmental office issues the official transcript.`,
  });

  await upsertKnowledgeDocument({
    title: 'Academic Policy – Attendance, Assessment and Results',
    kind: 'POLICY',
    visibility: 'INSTITUTION',
    ownerId: admin.id,
    content: `This policy applies to all students of the Department of Management Information Systems.

Attendance: a student must attend at least 70 percent of scheduled classes for each course. Attendance below 70 percent may lead to being barred from the final examination, subject to departmental review. Attendance recorded in the LMS is advisory and may be corrected by the course teacher.

Assessment: each course has a total weight of 100. Teachers publish the grade items and their weights in the gradebook. Marks must not exceed the weight of a grade item. Once a course offering is locked, results are considered published and normal changes require an administrator.

Grading: letter grades follow the departmental scale. A+ is 80 percent or above, A is 75 to below 80, A- is 70 to below 75, B+ is 65 to below 70, B is 60 to below 65, B- is 55 to below 60, C+ is 50 to below 55, C is 45 to below 50, D is 40 to below 45, and F is below 40. The passing mark for an individual course is 40 percent.

Official results and transcripts are issued by the Chairman Office. The LMS transcript and degree-progress view are advisory tools that derive from locked offerings and recorded grades.`,
  });

  await upsertKnowledgeDocument({
    title: 'Business Intelligence Reading List',
    kind: 'RESEARCH',
    visibility: 'PROGRAM',
    programCode: 'BBA-MIS',
    courseId: bi.id,
    ownerId: faculty.id,
    content: `This reading list supports MIS-410 Business Intelligence and analytics electives.

Week 1: analytics value chain and decision support. Read the departmental note on dashboards versus operational reporting.
Week 2: data modelling for analytics, dimensions and facts, and the difference between OLTP and OLAP.
Week 3: descriptive statistics, data quality and bias. Always state the source and the time window of an indicator.
Week 4: visualisation and accessibility. Use colour with contrast, do not rely on colour alone, and provide text summaries.
Week 5: predictive analytics and responsible AI. The LMS assistant is read-only: it may retrieve authorized documents and explain recorded information, but it cannot change grades, delete records, publish results or change permissions.

Assessment for MIS-410 includes a group dashboard project and an individual analytics critique. The project must use authorised institutional data only and must document assumptions, limitations and data protection measures.`,
  });

  console.log('Seed done. Logins: chairman@mis.du.ac.bd / faculty@mis.du.ac.bd / student@mis.du.ac.bd / alumni@mis.du.ac.bd (pw: mis123)');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
