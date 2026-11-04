const prisma = require('../../db');
const { parseJsonArray } = require('../../core/access');

const GRADE_POINTS = [
  { min: 80, letter: 'A+', points: 4.0 },
  { min: 75, letter: 'A', points: 3.75 },
  { min: 70, letter: 'A-', points: 3.5 },
  { min: 65, letter: 'B+', points: 3.25 },
  { min: 60, letter: 'B', points: 3.0 },
  { min: 55, letter: 'B-', points: 2.75 },
  { min: 50, letter: 'C+', points: 2.5 },
  { min: 45, letter: 'C', points: 2.25 },
  { min: 40, letter: 'D', points: 2.0 },
  { min: 0, letter: 'F', points: 0 },
];

function letterGrade(pct) {
  return GRADE_POINTS.find((row) => pct >= row.min) || GRADE_POINTS[GRADE_POINTS.length - 1];
}

function computeOfferingResult(offering, userId) {
  const items = offering.gradeItems || [];
  let obtained = 0;
  let totalWeight = 0;
  const details = [];
  for (const item of items) {
    const grade = (item.grades || []).find((row) => row.userId === userId);
    const marks = grade?.marks ?? null;
    details.push({ item: item.name, weight: item.weight, marks });
    totalWeight += item.weight;
    if (marks != null) obtained += marks;
  }
  const pct = totalWeight ? Math.round((obtained / totalWeight) * 10000) / 100 : 0;
  const grade = letterGrade(pct);
  return {
    obtained,
    totalWeight,
    pct,
    letter: offering.isLocked ? grade.letter : 'IN-PROGRESS',
    points: grade.points,
    isLocked: !!offering.isLocked,
    details,
  };
}

async function getStudentProgress(userId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: {
      offering: {
        include: {
          course: { include: { program: true } },
          term: true,
          gradeItems: { include: { grades: { where: { userId } } } },
        },
      },
    },
    take: 200,
  });

  const programMap = new Map();
  for (const enrollment of enrollments) {
    const program = enrollment.offering?.course?.program;
    if (program) programMap.set(program.id, program);
  }
  const programs = [...programMap.values()];
  const requiredCredits = programs.length
    ? Math.max(...programs.map((program) => Number(program.requiredCredits) || 120))
    : 120;

  let earnedCredits = 0;
  let inProgressCredits = 0;
  let qualityPoints = 0;
  let gradedCredits = 0;
  const completedCodes = new Set();
  const courseRows = [];

  for (const enrollment of enrollments) {
    const offering = enrollment.offering;
    if (!offering?.course) continue;
    const result = computeOfferingResult(offering, userId);
    const credits = Number(offering.course.credits) || 0;
    if (result.isLocked) {
      gradedCredits += credits;
      qualityPoints += result.points * credits;
      if (result.pct >= 40) {
        earnedCredits += credits;
        completedCodes.add(offering.course.code);
      }
    } else {
      inProgressCredits += credits;
    }
    courseRows.push({
      offeringId: offering.id,
      courseCode: offering.course.code,
      title: offering.course.title,
      credits,
      term: offering.term?.code || null,
      pct: result.pct,
      letter: result.letter,
      isLocked: result.isLocked,
    });
  }

  const programIds = programs.map((program) => program.id);
  const courses = programIds.length
    ? await prisma.course.findMany({
      where: { programId: { in: programIds } },
      select: { code: true, title: true, credits: true, prerequisites: true },
      take: 300,
    })
    : [];
  const enrolledCodes = new Set(enrollments.map((row) => row.offering?.course?.code).filter(Boolean));
  const missingPrerequisites = [];
  for (const course of courses) {
    if (completedCodes.has(course.code) || enrolledCodes.has(course.code)) continue;
    const prerequisites = parseJsonArray(course.prerequisites);
    const missing = prerequisites.filter((code) => !completedCodes.has(code));
    if (missing.length) {
      missingPrerequisites.push({ courseCode: course.code, title: course.title, missing });
    }
  }

  const gpa = gradedCredits ? Math.round((qualityPoints / gradedCredits) * 100) / 100 : null;
  return {
    programs: programs.map((program) => ({
      code: program.code,
      name: program.name,
      requiredCredits: Number(program.requiredCredits) || 120,
    })),
    requiredCredits,
    earnedCredits,
    inProgressCredits,
    remainingCredits: Math.max(0, requiredCredits - earnedCredits),
    completionPct: requiredCredits ? Math.min(100, Math.round((earnedCredits / requiredCredits) * 10000) / 100) : 0,
    gpa,
    gradedCredits,
    courses: courseRows,
    missingPrerequisites: missingPrerequisites.slice(0, 40),
    note: 'Progress uses locked offerings and graded items only. It is an advisory indicator, not an official transcript.',
  };
}

module.exports = { getStudentProgress, computeOfferingResult, letterGrade, GRADE_POINTS };
