const prisma = require('../db');
const { logger } = require('./logger');
const { inc, observe } = require('./metrics');
const config = require('../config');

const handlers = new Map();

function registerJobHandler(type, handler) {
  handlers.set(type, handler);
}

async function enqueueJob(type, payload = {}, { dedupeKey, runAt, maxAttempts = 5 } = {}) {
  try {
    return await prisma.job.create({
      data: {
        type,
        payload: JSON.stringify(payload),
        dedupeKey: dedupeKey || null,
        runAt: runAt || new Date(),
        maxAttempts,
      },
    });
  } catch (error) {
    if (error.code === 'P2002' && dedupeKey) {
      return prisma.job.findUnique({ where: { dedupeKey } });
    }
    throw error;
  }
}

async function claimJobs(limit) {
  const now = new Date();
  const candidates = await prisma.job.findMany({
    where: { status: 'PENDING', runAt: { lte: now } },
    orderBy: { runAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  const claimed = [];
  for (const candidate of candidates) {
    const result = await prisma.job.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: { status: 'PROCESSING', lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (result.count === 1) {
      claimed.push(await prisma.job.findUnique({ where: { id: candidate.id } }));
    }
  }
  return claimed;
}

async function runJobs({ limit = config.worker.batchSize } = {}) {
  const jobs = await claimJobs(limit);
  let completed = 0;
  for (const job of jobs) {
    const started = Date.now();
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
      const payload = JSON.parse(job.payload || '{}');
      await handler(payload, job);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date(), error: null, lockedAt: null },
      });
      completed += 1;
      inc('mis_jobs_total', { type: job.type, status: 'completed' });
    } catch (error) {
      const failed = job.attempts >= job.maxAttempts;
      const backoffMs = Math.min(5 * 60_000, 1000 * 2 ** Math.max(0, job.attempts - 1));
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: failed ? 'FAILED' : 'PENDING',
          runAt: failed ? job.runAt : new Date(Date.now() + backoffMs),
          lockedAt: null,
          error: String(error.message || error).slice(0, 1000),
        },
      }).catch((updateError) => logger.error('job_update_failed', { jobId: job.id, error: logger.serializeError(updateError) }));
      inc('mis_jobs_total', { type: job.type, status: failed ? 'failed' : 'retry' });
      logger.error('job_failed', { jobId: job.id, type: job.type, attempts: job.attempts, failed, error: logger.serializeError(error) });
    }
    observe('mis_job_duration_ms', { type: job.type }, Date.now() - started);
  }
  return { claimed: jobs.length, completed };
}

let jobTimer = null;

function startJobLoop() {
  if (jobTimer) return jobTimer;
  jobTimer = setInterval(() => {
    runJobs().catch((error) => logger.error('job_loop_failed', { error: logger.serializeError(error) }));
  }, config.worker.intervalMs);
  if (jobTimer.unref) jobTimer.unref();
  return jobTimer;
}

function stopJobLoop() {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = null;
}

module.exports = {
  registerJobHandler,
  enqueueJob,
  runJobs,
  startJobLoop,
  stopJobLoop,
  handlers,
};
