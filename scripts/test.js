const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./test.db',
  JWT_SECRET: 'test-only-secret-please-change-0123456789abcdef',
  JWT_EXPIRES: '1h',
  ALLOW_PUBLIC_REGISTRATION: 'false',
  AI_ENABLED: 'false',
  AI_PROVIDER: 'mock',
  AI_FALLBACK_TO_MOCK: 'true',
  WORKERS_INLINE: 'false',
  EVENTS_INLINE: 'false',
  LOG_LEVEL: 'error',
  CORS_ORIGINS: 'http://localhost:3000',
};

if (!env.DATABASE_URL.endsWith('test.db')) {
  throw new Error(`Refusing to reset a non-test database: ${env.DATABASE_URL}`);
}

function run(label, command, args) {
  process.stdout.write(`\n[test] ${label}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', env, cwd: process.cwd() });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

run(
  'reset test database',
  process.execPath,
  [
    require.resolve('prisma/build/index.js'),
    'db',
    'push',
    '--schema=prisma/schema.prisma',
    '--force-reset',
    '--skip-generate',
  ],
);

run('seed test fixtures', process.execPath, ['prisma/seed.js']);

const testDir = path.join(process.cwd(), 'apps', 'api', 'test');
const testFiles = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join('apps', 'api', 'test', name));

if (testFiles.length === 0) {
  console.error('No API test files found');
  process.exit(1);
}

run('run API tests', process.execPath, ['--test', '--test-concurrency=1', ...testFiles]);
