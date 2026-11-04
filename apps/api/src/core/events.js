const prisma = require('../db');
const { logger } = require('./logger');
const { inc, observe } = require('./metrics');
const config = require('../config');

const handlers = new Map();
const MAX_ATTEMPTS = 5;

function registerEventHandler(type, handler) {
  handlers.set(type, handler);
}

async function publishEvent(tx, type, payload) {
  const client = tx || prisma;
  return client.outboxEvent.create({
    data: { type, payload: JSON.stringify(payload || {}) },
  });
}

async function claimEvents(limit) {
  const now = new Date();
  const candidates = await prisma.outboxEvent.findMany({
    where: { status: 'PENDING', availableAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  const claimed = [];
  for (const candidate of candidates) {
    const result = await prisma.outboxEvent.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    if (result.count === 1) {
      const event = await prisma.outboxEvent.findUnique({ where: { id: candidate.id } });
      claimed.push(event);
    }
  }
  return claimed;
}

async function handleEvent(event) {
  const handler = handlers.get(event.type);
  if (!handler) {
    logger.warn('event_handler_missing', { type: event.type, eventId: event.id });
    return;
  }
  let payload = {};
  try {
    payload = JSON.parse(event.payload || '{}');
  } catch {
    payload = {};
  }
  await handler(payload, event);
}

async function dispatchEvents({ limit = config.worker.batchSize } = {}) {
  const events = await claimEvents(limit);
  let processed = 0;
  for (const event of events) {
    const started = Date.now();
    try {
      await handleEvent(event);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), error: null },
      });
      processed += 1;
      inc('mis_events_total', { type: event.type, status: 'processed' });
    } catch (error) {
      const attempts = event.attempts;
      const failed = attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: failed ? 'FAILED' : 'PENDING',
          availableAt: failed ? event.availableAt : new Date(Date.now() + backoffMs),
          error: String(error.message || error).slice(0, 1000),
        },
      }).catch((updateError) => logger.error('event_update_failed', { eventId: event.id, error: logger.serializeError(updateError) }));
      inc('mis_events_total', { type: event.type, status: failed ? 'failed' : 'retry' });
      logger.error('event_handler_failed', { eventId: event.id, type: event.type, attempts, failed, error: logger.serializeError(error) });
    }
    observe('mis_event_duration_ms', { type: event.type }, Date.now() - started);
  }
  return { claimed: events.length, processed };
}

let eventTimer = null;

function startEventLoop() {
  if (eventTimer) return eventTimer;
  eventTimer = setInterval(() => {
    dispatchEvents().catch((error) => logger.error('event_loop_failed', { error: logger.serializeError(error) }));
  }, config.worker.intervalMs);
  if (eventTimer.unref) eventTimer.unref();
  return eventTimer;
}

function stopEventLoop() {
  if (eventTimer) clearInterval(eventTimer);
  eventTimer = null;
}

module.exports = {
  registerEventHandler,
  publishEvent,
  dispatchEvents,
  startEventLoop,
  stopEventLoop,
  handlers,
};
