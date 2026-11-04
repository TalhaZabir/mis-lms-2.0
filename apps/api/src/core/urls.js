const net = require('net');
const { errors } = require('./errors');

function parseHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  return parsed;
}

function assertHttpUrl(value, message = 'Only http(s) URLs are allowed') {
  const parsed = parseHttpUrl(value);
  if (!parsed) throw errors.badRequest(message);
  return parsed.toString();
}

function isPrivateIp(host) {
  if (!net.isIP(host)) return false;
  if (host.includes(':')) {
    const normalized = host.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
  }
  const parts = host.split('.').map(Number);
  if (parts.length !== 4) return false;
  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return false;
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === 'metadata.google.internal') return true;
  if (isPrivateIp(host)) return true;
  return false;
}

function isSafeFetchUrl(value) {
  const parsed = parseHttpUrl(value);
  if (!parsed) return false;
  return !isPrivateHostname(parsed.hostname);
}

module.exports = {
  parseHttpUrl,
  assertHttpUrl,
  isPrivateIp,
  isPrivateHostname,
  isSafeFetchUrl,
};
