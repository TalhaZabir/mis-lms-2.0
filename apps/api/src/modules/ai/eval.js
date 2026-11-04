#!/usr/bin/env node
/**
 * AI assistant evaluation harness.
 *
 * Runs a deterministic, citation and access-control focused evaluation against a
 * disposable SQLite database using the mock provider. It never touches the
 * production database, never calls an external provider and never mutates
 * application records outside the disposable eval database.
 *
 * Usage:
 *   npm run ai:eval
 *   AI_EVAL_SKIP_SETUP=1 npm run ai:eval   # reuse the existing eval database
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../../../..');
const DATASET_PATH = path.join(__dirname, 'eval-dataset.json');

if (process.env.NODE_ENV === 'production') {
  console.error('[ai:eval] Refusing to run with NODE_ENV=production');
  process.exit(1);
}
if (process.env.DATABASE_URL && !/eval\.db|test\.db/.test(process.env.DATABASE_URL)) {
  console.error('[ai:eval] Refusing to run against a non-eval database. Unset DATABASE_URL or use eval.db/test.db.');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || 'file:./eval.db';
const EVAL_ENV = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'eval-only-secret-please-change-0123456789abcdef',
  AI_ENABLED: 'true',
  AI_PROVIDER: 'mock',
  AI_FALLBACK_TO_MOCK: 'true',
  AI_DAILY_REQUESTS: '1000',
  AI_DAILY_BUDGET_USD: '100',
  WORKERS_INLINE: 'false',
  EVENTS_INLINE: 'false',
  LOG_LEVEL: 'error',
};

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, env: EVAL_ENV, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`[ai:eval] ${label} failed`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status || 1);
  }
}

if (process.env.AI_EVAL_SKIP_SETUP !== '1') {
  process.stdout.write('[ai:eval] Preparing disposable eval database…\n');
  run('database reset', process.execPath, [
    require.resolve('prisma/build/index.js'),
    'db',
    'push',
    '--schema=prisma/schema.prisma',
    '--force-reset',
    '--skip-generate',
  ]);
  run('seed', process.execPath, ['prisma/seed.js']);
}

// Environment must be in place before the application modules load config.
Object.assign(process.env, EVAL_ENV);

const prisma = require('../../db');
const config = require('../../config');
const { answerQuestion, ingestDocument } = require('./rag');

const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));

async function upsertFixture({ title, content, visibility, ownerId, allowedRoles = null }) {
  const existing = await prisma.knowledgeDocument.findFirst({ where: { title } });
  const data = {
    title,
    content,
    kind: 'GUIDE',
    visibility,
    status: 'APPROVED',
    ownerId,
    allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : null,
    version: 1,
  };
  const document = existing
    ? await prisma.knowledgeDocument.update({ where: { id: existing.id }, data })
    : await prisma.knowledgeDocument.create({ data });
  await ingestDocument(document.id);
  return document;
}

async function prepareFixtures() {
  const admin = await prisma.user.findUnique({ where: { email: 'chairman@mis.du.ac.bd' } });
  const faculty = await prisma.user.findUnique({ where: { email: 'faculty@mis.du.ac.bd' } });
  if (!admin || !faculty) throw new Error('Seed users are missing; run without AI_EVAL_SKIP_SETUP to reseed');

  await upsertFixture({
    title: 'Eval Admin Only Fixture',
    ownerId: admin.id,
    visibility: 'ADMIN',
    content: 'The eval admin budget code evaladminzebra is restricted to administrators. It records a confidential budget figure that students must never retrieve through search or the assistant.',
  });
  await upsertFixture({
    title: 'Eval Faculty Only Fixture',
    ownerId: faculty.id,
    visibility: 'FACULTY',
    content: 'The evalfacultyzebra guidance is available to faculty and teaching staff. It explains the faculty review workflow for course materials and assessment changes.',
  });
  await upsertFixture({
    title: 'Eval Role Allowlist Fixture',
    ownerId: admin.id,
    visibility: 'INSTITUTION',
    allowedRoles: ['FACULTY'],
    content: 'The evalstudentzebra record describes an internal programme review that is institution-wide but limited to faculty through an explicit role allowlist.',
  });
}

function matchesTerm(answer, term) {
  return answer.toLowerCase().includes(String(term).toLowerCase());
}

function evaluate(result, testCase) {
  const failures = [];
  const sourceTitles = (result.sources || []).map((source) => source.title || '');

  if (testCase.expectBlocked !== undefined && Boolean(result.blocked) !== testCase.expectBlocked) {
    failures.push(`expected blocked=${testCase.expectBlocked}`);
  }
  if (testCase.expectGrounded !== undefined && Boolean(result.grounded) !== testCase.expectGrounded) {
    failures.push(`expected grounded=${testCase.expectGrounded}`);
  }
  if (testCase.citationsAtLeast !== undefined && (result.citations || []).length < testCase.citationsAtLeast) {
    failures.push(`expected at least ${testCase.citationsAtLeast} citation(s)`);
  }
  if (testCase.maxCitations !== undefined && (result.citations || []).length > testCase.maxCitations) {
    failures.push(`expected at most ${testCase.maxCitations} citation(s)`);
  }
  if (testCase.maxSources !== undefined && (result.sources || []).length > testCase.maxSources) {
    failures.push(`expected at most ${testCase.maxSources} source(s)`);
  }
  if (testCase.sourceTitleIncludes
    && !sourceTitles.some((title) => title.toLowerCase().includes(testCase.sourceTitleIncludes.toLowerCase()))) {
    failures.push(`missing source title containing "${testCase.sourceTitleIncludes}"`);
  }
  for (const forbidden of testCase.forbidSourceTitles || []) {
    if (sourceTitles.some((title) => title.toLowerCase().includes(forbidden.toLowerCase()))) {
      failures.push(`forbidden source "${forbidden}" leaked`);
    }
  }
  for (const forbidden of testCase.forbidAnswerTerms || []) {
    if (matchesTerm(result.answer || '', forbidden)) {
      failures.push(`forbidden term "${forbidden}" appeared in the answer`);
    }
  }
  for (const group of testCase.termGroups || []) {
    if (!group.some((term) => matchesTerm(result.answer || '', term))) {
      failures.push(`answer is missing one of: ${group.join(' / ')}`);
    }
  }
  if (result.grounded) {
    if (!(result.citations || []).length) failures.push('grounded answer has no citations');
    for (const marker of result.citations || []) {
      if (!Number.isInteger(marker) || marker < 1 || marker > (result.sources || []).length) {
        failures.push(`citation [${marker}] does not map to a source`);
      }
    }
  }
  return failures;
}

async function main() {
  await prepareFixtures();

  const users = {};
  for (const [role, email] of Object.entries({
    student: 'student@mis.du.ac.bd',
    faculty: 'faculty@mis.du.ac.bd',
  })) {
    users[role] = await prisma.user.findUnique({ where: { email } });
    if (!users[role]) throw new Error(`Missing ${role} user`);
  }

  const results = [];
  for (const testCase of dataset.cases) {
    const started = Date.now();
    const result = await answerQuestion(users[testCase.role || 'student'], { question: testCase.question });
    const failures = evaluate(result, testCase);
    results.push({
      id: testCase.id,
      passed: failures.length === 0,
      failures,
      latencyMs: Date.now() - started,
      grounded: Boolean(result.grounded),
      blocked: Boolean(result.blocked),
      citations: result.citations || [],
      sources: (result.sources || []).map((source) => source.title),
    });
    const status = failures.length === 0 ? 'PASS' : 'FAIL';
    process.stdout.write(`${status} ${testCase.id} (${Date.now() - started} ms)\n`);
    if (failures.length) {
      process.stdout.write(`  answer: ${String(result.answer || '').replace(/\s+/g, ' ').slice(0, 500)}\n`);
      process.stdout.write(`  sources: ${(result.sources || []).map((source) => source.title).join(' | ')}\n`);
    }
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  }

  const passed = results.filter((row) => row.passed).length;
  const score = passed / results.length;
  process.stdout.write(`\n[ai:eval] ${passed}/${results.length} cases passed (${(score * 100).toFixed(1)}%), threshold ${(dataset.threshold * 100).toFixed(0)}%\n`);
  process.stdout.write(`[ai:eval] provider=${config.ai.provider} model=${config.ai.model} grounded=${results.filter((row) => row.grounded).length} blocked=${results.filter((row) => row.blocked).length}\n`);

  if (score < dataset.threshold) {
    process.stdout.write('[ai:eval] Below threshold. Review the failing cases above.\n');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[ai:eval] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
