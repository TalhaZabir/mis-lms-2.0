const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('safe defaults keep risky features disabled without explicit opt-in', () => {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    AI_ENABLED: '',
    ALLOW_PUBLIC_REGISTRATION: '',
    WORKERS_INLINE: '',
    EVENTS_INLINE: '',
    FEATURES_REALTIME: '',
    JWT_SECRET: 'test-only-secret-please-change-0123456789abcdef',
  };
  const script = "const c=require('./apps/api/src/config');console.log(JSON.stringify({ai:c.ai.enabled,registration:c.allowPublicRegistration,workers:c.features.workers,events:c.features.events,realtime:c.features.realtime,provider:c.ai.provider}));";
  const output = execFileSync(process.execPath, ['-e', script], { cwd: root, env, encoding: 'utf8' });
  const config = JSON.parse(output.trim().split('\n').pop());
  assert.equal(config.ai, false, 'AI must be disabled by default');
  assert.equal(config.registration, false, 'public registration must be disabled by default');
  assert.equal(config.workers, false, 'background workers must be off in tests');
  assert.equal(config.events, false, 'event workers must be off in tests');
  assert.equal(config.realtime, true);
  assert.equal(config.provider, 'mock');
});
