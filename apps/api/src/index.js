const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config');
const prisma = require('./db');
const { logger, requestContext } = require('./core/logger');
const { errors, notFoundHandler, errorHandler } = require('./core/errors');
const { RateLimiter } = require('./core/rate-limit');
const { metricsMiddleware, metricsHandler } = require('./core/metrics');
const { attachRealtime, closeRealtime } = require('./core/realtime');
const { registerHandlers, enqueueMaintenanceJobs } = require('./core/handlers');
const { startJobLoop, stopJobLoop } = require('./core/jobs');
const { startEventLoop, stopEventLoop } = require('./core/events');
const { buildOpenApi } = require('./openapi');

const identityRoutes = require('./modules/identity/routes');
const academicRoutes = require('./modules/academic/routes');
const learningRoutes = require('./modules/learning/routes');
const communityRoutes = require('./modules/community/routes');
const resourceRoutes = require('./modules/resources/routes');
const searchRoutes = require('./modules/search/routes');
const analyticsRoutes = require('./modules/analytics/routes');
const aiRoutes = require('./modules/ai/routes');

const globalLimiter = new RateLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  name: 'global',
  keyGenerator: (req) => req.ip || 'unknown',
  message: 'Too many requests — please slow down.',
});

const PUBLIC_PATHS = new Set(['/health', '/ready', '/metrics', '/openapi.json']);

function corsOptions() {
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes('*')) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(errors.forbidden('Origin is not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-Metrics-Token'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Idempotent-Replayed'],
    maxAge: 600,
  };
}

function metricsAuthorized(req) {
  const token = process.env.METRICS_TOKEN;
  if (!token) return !config.isProduction;
  const provided = req.get('x-metrics-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(token));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function healthPayload() {
  return {
    ok: true,
    service: 'mis-lms-api',
    version: config.version,
    env: config.env,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  };
}

async function readyPayload() {
  await prisma.$queryRaw`SELECT 1`;
  return { ready: true, database: 'ok', version: config.version };
}

function apiRouter() {
  const router = express.Router();
  router.get('/health', (req, res) => res.json(healthPayload()));
  router.get('/ready', async (req, res) => {
    try {
      res.json(await readyPayload());
    } catch (error) {
      logger.error('readiness_failed', { error: logger.serializeError(error) });
      res.status(503).json({ ready: false, database: 'unavailable', version: config.version });
    }
  });
  router.use(identityRoutes);
  router.use(academicRoutes);
  router.use(learningRoutes);
  router.use(communityRoutes);
  router.use(resourceRoutes);
  router.use(searchRoutes);
  router.use(analyticsRoutes);
  router.use(aiRoutes);
  return router;
}

function createApp() {
  registerHandlers();
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));
  app.use(cors(corsOptions()));
  app.use(requestContext());
  app.use(express.json({ limit: config.jsonLimit, strict: true }));
  app.use(express.urlencoded({ extended: false, limit: config.jsonLimit }));
  app.use(metricsMiddleware);

  app.use((req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    return globalLimiter.middleware()(req, res, next);
  });

  app.get('/health', (req, res) => {
    res.json(healthPayload());
  });

  app.get('/ready', async (req, res) => {
    try {
      res.json(await readyPayload());
    } catch (error) {
      logger.error('readiness_failed', { error: logger.serializeError(error) });
      res.status(503).json({ ready: false, database: 'unavailable', version: config.version });
    }
  });

  app.get('/metrics', (req, res, next) => {
    if (!metricsAuthorized(req)) return next(errors.notFound('Not found'));
    return metricsHandler(req, res);
  });

  app.get('/openapi.json', (req, res) => {
    res.json(buildOpenApi());
  });

  const router = apiRouter();
  app.use('/v1', router);
  // MIGRATION SHIM: existing single-page client calls unversioned paths.
  app.use('/', router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

let maintenanceTimer = null;

function startBackgroundWork({ enqueueMaintenance = true } = {}) {
  registerHandlers();
  if (config.features.events) startEventLoop();
  if (config.features.workers) startJobLoop();
  if (enqueueMaintenance) {
    enqueueMaintenanceJobs().catch((error) => {
      logger.warn('maintenance_enqueue_failed', { error: logger.serializeError(error) });
    });
    if (!maintenanceTimer) {
      maintenanceTimer = setInterval(() => {
        enqueueMaintenanceJobs().catch((error) => {
          logger.warn('maintenance_enqueue_failed', { error: logger.serializeError(error) });
        });
      }, 24 * 60 * 60 * 1000);
      if (maintenanceTimer.unref) maintenanceTimer.unref();
    }
  }
}

function stopBackgroundWork() {
  stopJobLoop();
  stopEventLoop();
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
  globalLimiter.destroy();
}

async function startServer({ port = config.port } = {}) {
  registerHandlers();
  const app = createApp();
  const server = http.createServer(app);

  if (config.features.realtime) attachRealtime(server);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });

  startBackgroundWork();
  logger.info('api_started', {
    port,
    env: config.env,
    version: config.version,
    realtime: config.features.realtime,
    workers: config.features.workers,
    events: config.features.events,
    ai: config.ai.enabled,
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('api_shutdown', { signal });
    stopBackgroundWork();
    const force = setTimeout(() => {
      logger.error('api_shutdown_forced', { signal });
      process.exit(1);
    }, 10_000);
    if (force.unref) force.unref();
    try {
      await closeRealtime();
      await new Promise((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    } catch (error) {
      logger.error('api_shutdown_failed', { error: logger.serializeError(error) });
    } finally {
      clearTimeout(force);
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('api_start_failed', { error: logger.serializeError(error) });
    process.exit(1);
  });
}

module.exports = {
  createApp,
  startServer,
  startBackgroundWork,
  stopBackgroundWork,
  apiRouter,
};
