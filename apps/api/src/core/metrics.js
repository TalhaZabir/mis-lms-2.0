const config = require('../config');

const counters = new Map();
const histograms = new Map();

function inc(name, labels = {}, value = 1) {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

function observe(name, labels = {}, value = 0) {
  const key = metricKey(name, labels);
  const current = histograms.get(key) || { count: 0, sum: 0, max: 0 };
  current.count += 1;
  current.sum += value;
  current.max = Math.max(current.max, value);
  histograms.set(key, current);
}

function metricKey(name, labels) {
  const serialized = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${String(value).replace(/["\\\n]/g, '_')}"`)
    .join(',');
  return serialized ? `${name}{${serialized}}` : name;
}

function metricsMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : (req.path || 'unknown');
    inc('mis_api_requests_total', { method: req.method, route, status: res.statusCode });
    observe('mis_api_request_duration_ms', { method: req.method, route }, ms);
    if (res.statusCode >= 500) inc('mis_api_errors_total', { route, status: res.statusCode });
  });
  next();
}

function renderMetrics() {
  const lines = [
    '# HELP mis_api_requests_total Total HTTP requests',
    '# TYPE mis_api_requests_total counter',
  ];
  for (const [key, value] of counters) lines.push(`${key} ${value}`);
  lines.push('# HELP mis_api_request_duration_ms Request duration in ms');
  lines.push('# TYPE mis_api_request_duration_ms summary');
  for (const [key, value] of histograms) {
    const brace = key.indexOf('{');
    const name = brace === -1 ? key : key.slice(0, brace);
    const labels = brace === -1 ? '' : key.slice(brace);
    lines.push(`${name}_count${labels} ${value.count}`);
    lines.push(`${name}_sum${labels} ${value.sum}`);
  }
  lines.push(`mis_api_info{version="${config.version}",env="${config.env}"} 1`);
  return `${lines.join('\n')}\n`;
}

function metricsHandler(req, res) {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(renderMetrics());
}

module.exports = { inc, observe, metricsMiddleware, metricsHandler, renderMetrics };
