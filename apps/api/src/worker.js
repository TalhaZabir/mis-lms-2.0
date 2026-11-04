const config = require('./config');
const prisma = require('./db');
const { logger } = require('./core/logger');
const { registerHandlers, enqueueMaintenanceJobs } = require('./core/handlers');
const { startJobLoop, stopJobLoop } = require('./core/jobs');
const { startEventLoop, stopEventLoop } = require('./core/events');

async function main() {
  registerHandlers();
  startEventLoop();
  startJobLoop();
  await enqueueMaintenanceJobs().catch((error) => {
    logger.warn('maintenance_enqueue_failed', { error: logger.serializeError(error) });
  });
  logger.info('worker_started', {
    version: config.version,
    env: config.env,
    intervalMs: config.worker.intervalMs,
    batchSize: config.worker.batchSize,
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('worker_shutdown', { signal });
    stopJobLoop();
    stopEventLoop();
    const force = setTimeout(() => process.exit(1), 10_000);
    if (force.unref) force.unref();
    await prisma.$disconnect().catch(() => {});
    clearTimeout(force);
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('worker_start_failed', { error: logger.serializeError(error) });
  process.exit(1);
});
