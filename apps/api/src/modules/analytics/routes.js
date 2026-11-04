const express = require('express');
const prisma = require('../../db');
const { requireAuth } = require('../../core/auth');
const { errors, asyncHandler } = require('../../core/errors');
const { isAdmin, getOfferingContext, isOfferingFaculty } = require('../../core/access');
const { computeOfferingResult, letterGrade, getStudentProgress } = require('../academic/progress');

const router = express.Router();
router.use(requireAuth);

router.get('/analytics/overview', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw errors.forbidden('Administrators only');
  const [users, programs, courses, offerings, enrollments, resources, posts, activeTerms, aiToday] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.program.count(),
    prisma.course.count(),
    prisma.offering.count(),
    prisma.enrollment.count(),
    prisma.resource.count({ where: { isVerified: true } }),
    prisma.socialPost.count({ where: { isHidden: false } }),
    prisma.term.count({ where: { status: 'ACTIVE' } }),
    prisma.aiUsage.aggregate({
      where: { createdAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } },
      _count: true,
      _sum: { costUsd: true, totalTokens: true },
    }),
  ]);
  res.json({
    users: Object.fromEntries(users.map((row) => [row.role, row._count._all])),
    programs,
    courses,
    offerings,
    enrollments,
    verifiedResources: resources,
    visiblePosts: posts,
    activeTerms,
    ai: {
      requestsToday: aiToday._count,
      tokensToday: aiToday._sum.totalTokens || 0,
      costTodayUsd: Math.round((aiToday._sum.costUsd || 0) * 10000) / 10000,
    },
    generatedAt: new Date().toISOString(),
  });
}));

router.get('/analytics/offerings/:oid', asyncHandler(async (req, res) => {
  const offering = await getOfferingContext(req.params.oid, req.user.id);
  if (!isAdmin(req.user) && !isOfferingFaculty(req.user, offering)) {
    throw errors.forbidden('Only the assigned faculty or an administrator can view offering analytics');
  }
  const [enrollments, gradeItems, assignments, attendanceSessions, attendanceRecords, conversations] = await Promise.all([
    prisma.enrollment.findMany({
      where: { offeringId: offering.id },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.gradeItem.findMany({ where: { offeringId: offering.id }, include: { grades: true } }),
    prisma.assignment.findMany({ where: { offeringId: offering.id }, include: { submissions: true } }),
    prisma.attendanceSession.findMany({ where: { offeringId: offering.id }, include: { records: true } }),
    prisma.attendanceRecord.count({ where: { session: { offeringId: offering.id } } }),
    prisma.conversation.findMany({ where: { offeringId: offering.id }, select: { id: true, _count: { select: { messages: true } } } }),
  ]);

  const distribution = {};
  const studentRows = enrollments.map((enrollment) => {
    const result = computeOfferingResult(
      { ...offering, gradeItems, isLocked: offering.isLocked },
      enrollment.userId,
    );
    const letter = result.totalWeight ? letterGrade(result.pct).letter : 'N/A';
    distribution[letter] = (distribution[letter] || 0) + 1;
    return {
      studentId: enrollment.userId,
      name: enrollment.user?.name,
      pct: result.pct,
      letter: offering.isLocked ? letter : 'IN-PROGRESS',
      gradedItems: result.details.filter((detail) => detail.marks !== null).length,
    };
  });

  let submissionCount = 0;
  let lateCount = 0;
  let gradedCount = 0;
  let marksSum = 0;
  for (const assignment of assignments) {
    for (const submission of assignment.submissions) {
      submissionCount += 1;
      if (new Date(submission.createdAt) > new Date(assignment.dueAt)) lateCount += 1;
      if (submission.marks != null) {
        gradedCount += 1;
        marksSum += submission.marks;
      }
    }
  }
  const attendancePresent = attendanceSessions.reduce(
    (sum, session) => sum + session.records.filter((record) => record.status === 'PRESENT' || record.status === 'LATE').length,
    0,
  );
  const attendanceTotal = attendanceSessions.length * Math.max(1, enrollments.length);
  const messageCount = conversations.reduce((sum, conversation) => sum + (conversation._count?.messages || 0), 0);

  res.json({
    offering: {
      id: offering.id,
      course: `${offering.course.code} ${offering.course.title}`,
      term: offering.term.code,
      section: offering.section,
      isLocked: offering.isLocked,
    },
    enrollmentCount: enrollments.length,
    students: studentRows.sort((a, b) => b.pct - a.pct),
    gradeDistribution: distribution,
    assignments: {
      count: assignments.length,
      submissions: submissionCount,
      lateSubmissions: lateCount,
      graded: gradedCount,
      averageMarks: gradedCount ? Math.round((marksSum / gradedCount) * 100) / 100 : null,
      submissionRate: assignments.length && enrollments.length
        ? Math.round((submissionCount / (assignments.length * enrollments.length)) * 10000) / 100
        : 0,
    },
    attendance: {
      sessions: attendanceSessions.length,
      records: attendanceRecords,
      presentOrLate: attendancePresent,
      rate: attendanceTotal ? Math.round((attendancePresent / attendanceTotal) * 10000) / 100 : 0,
    },
    engagement: { messages: messageCount },
    notes: [
      'Indicators are advisory and use only records available in the LMS.',
      'Grade distribution includes ungraded items as zero until they are entered.',
      'Attendance rate assumes every enrolled student should be marked in every session.',
    ],
    generatedAt: new Date().toISOString(),
  });
}));

router.get('/me/analytics', asyncHandler(async (req, res) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: req.user.id },
    include: {
      offering: {
        include: {
          course: true,
          term: true,
          gradeItems: { include: { grades: { where: { userId: req.user.id } } } },
          assignments: { include: { submissions: { where: { userId: req.user.id } } } },
          attendanceSessions: { include: { records: { where: { userId: req.user.id } } } },
        },
      },
    },
    take: 100,
  });
  const courses = enrollments.map((enrollment) => {
    const offering = enrollment.offering;
    const result = computeOfferingResult(offering, req.user.id);
    const sessions = offering.attendanceSessions || [];
    const present = sessions.filter((session) => {
      const record = session.records[0];
      return record && (record.status === 'PRESENT' || record.status === 'LATE');
    }).length;
    const assignments = offering.assignments || [];
    const submitted = assignments.filter((assignment) => assignment.submissions.length > 0).length;
    return {
      course: `${offering.course.code} ${offering.course.title}`,
      term: offering.term.code,
      currentPct: result.pct,
      letter: result.letter,
      attendancePct: sessions.length ? Math.round((present / sessions.length) * 100) : 100,
      assignmentsSubmitted: submitted,
      assignmentsTotal: assignments.length,
      submissionRate: assignments.length ? Math.round((submitted / assignments.length) * 100) : 100,
    };
  });
  const progress = await getStudentProgress(req.user.id);
  res.json({
    courses,
    progress: {
      earnedCredits: progress.earnedCredits,
      requiredCredits: progress.requiredCredits,
      completionPct: progress.completionPct,
      gpa: progress.gpa,
    },
    notes: ['Attendance is based on marked sessions only.', 'Current percentages are advisory until results are locked.'],
    generatedAt: new Date().toISOString(),
  });
}));

module.exports = router;
