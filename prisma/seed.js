const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('mis123', 10);
  const admin = await prisma.user.upsert({ where: { email: 'chairman@mis.du.ac.bd' }, update: {}, create: { name: 'Chairman Office', email: 'chairman@mis.du.ac.bd', passwordHash: hash, role: 'SUPER_ADMIN' } });
  const faculty = await prisma.user.upsert({ where: { email: 'faculty@mis.du.ac.bd' }, update: {}, create: { name: 'Demo Faculty', email: 'faculty@mis.du.ac.bd', passwordHash: hash, role: 'FACULTY' } });
  const student = await prisma.user.upsert({ where: { email: 'student@mis.du.ac.bd' }, update: {}, create: { name: 'Demo Student (BBA 29th)', email: 'student@mis.du.ac.bd', passwordHash: hash, role: 'STUDENT' } });
  const alumni = await prisma.user.upsert({ where: { email: 'alumni@mis.du.ac.bd' }, update: {}, create: { name: 'Demo Alumni (BBA 22nd)', email: 'alumni@mis.du.ac.bd', passwordHash: hash, role: 'ALUMNI' } });
  await prisma.alumniProfile.upsert({ where: { userId: alumni.id }, update: { isVerified: true, mentorshipOptIn: true }, create: { userId: alumni.id, gradBatch: 'BBA 22nd', program: 'BBA-MIS', org: 'Grameenphone', designation: 'MIS Analyst', mentorshipOptIn: true, isVerified: true } });

  const bba = await prisma.program.upsert({ where: { code: 'BBA-MIS' }, update: {}, create: { code: 'BBA-MIS', name: 'BBA in Management Information Systems', description: '4-year 8-semester undergraduate' } });
  const mba = await prisma.program.upsert({ where: { code: 'MBA-MIS' }, update: {}, create: { code: 'MBA-MIS', name: 'MBA in MIS', description: 'Regular masters' } });
  await prisma.program.upsert({ where: { code: 'EMBA' }, update: {}, create: { code: 'EMBA', name: 'Evening MBA', description: 'Professional weekend' } });
  await prisma.program.upsert({ where: { code: 'DIPLOMA' }, update: {}, create: { code: 'DIPLOMA', name: 'Diploma / Certificate', description: 'Short courses' } });

  const batch29 = await prisma.batch.findFirst({ where: { name: 'BBA 29th', programId: bba.id } })
    || await prisma.batch.create({ data: { programId: bba.id, name: 'BBA 29th', session: '2023-24' } });
  const term = await prisma.term.upsert({ where: { code: 'FALL-2026' }, update: { status: 'ACTIVE' }, create: { name: 'Fall 2026 (Sem 3/5/7)', code: 'FALL-2026', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-12-31'), status: 'ACTIVE' } });

  const courses = [
    { code: 'MIS-101', title: 'Intro to MIS', credits: 3 },
    { code: 'MIS-352', title: 'Database Management', credits: 3 },
    { code: 'MIS-361', title: 'Systems Analysis & Design', credits: 3 },
    { code: 'MIS-401', title: 'ERP & Business Analytics', credits: 3 },
  ];
  for (const c of courses) {
    await prisma.course.upsert({ where: { code: c.code }, update: {}, create: { ...c, programId: bba.id } });
  }
  const db = await prisma.course.findUnique({ where: { code: 'MIS-352' } });
  let offering = await prisma.offering.findFirst({ where: { courseId: db.id, termId: term.id } });
  if (!offering) offering = await prisma.offering.create({ data: { courseId: db.id, termId: term.id, section: 'A', room: 'MIS Lab-2', routineSlot: 'Sun 10:00-11:30' } });
  await prisma.offeringFaculty.upsert({ where: { offeringId_userId: { offeringId: offering.id, userId: faculty.id } }, update: {}, create: { offeringId: offering.id, userId: faculty.id, isLead: true } });
  await prisma.enrollment.upsert({ where: { offeringId_userId: { offeringId: offering.id, userId: student.id } }, update: {}, create: { offeringId: offering.id, userId: student.id, batchId: batch29.id } });

  const welcome = await prisma.announcement.findFirst({ where: { title: 'Welcome to MIS LMS Fall 2026' } });
  if (!welcome) {
    await prisma.announcement.create({ data: { title: 'Welcome to MIS LMS Fall 2026', body: 'Part 1 live: academic structure + admin. Parts 2-5 next.', audience: 'ALL' } });
  }
  const demoResource = await prisma.resource.findFirst({ where: { url: 'https://nptel.ac.in' } });
  if (!demoResource) {
    await prisma.resource.create({ data: { title: 'DBMS – NPTEL Playlist', url: 'https://nptel.ac.in', category: 'COURSE_MAT', description: 'Supplementary for MIS-352', forProgram: 'BBA-MIS', courseId: db.id, addedById: faculty.id, isVerified: true } });
  }

  console.log('Seed done. Logins: chairman@mis.du.ac.bd / faculty@mis.du.ac.bd / student@mis.du.ac.bd / alumni@mis.du.ac.bd (pw: mis123)');
}
main()
  .catch((e) => { console.error('Seed failed:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
