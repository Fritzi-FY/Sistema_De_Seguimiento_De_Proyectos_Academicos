import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
if (process.env.IS488_CI_SQL !== '1' || process.env.GITHUB_ACTIONS !== 'true')
  throw new Error('Explicit GitHub CI SQL profile required');
const evidence = process.env.IS488_CI_EVIDENCE;
if (!evidence) throw new Error('CI evidence directory required');
mkdirSync(evidence, { recursive: true });
const output = join(evidence, 'sql-vitest.json');
const cases = [
  ['apps/api/src/infrastructure/postgresql/postgresql.sql.test.ts', 7],
  ['apps/api/src/infrastructure/postgresql/kanban.sql.test.ts', 16],
  ['apps/api/src/infrastructure/postgresql/teacher-project-scope.adapter.test.ts', 2],
  ['apps/api/migrations/adapters.test.ts', 1],
];
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    ...cases.map(([path]) => path),
    '--reporter=default',
    '--reporter=json',
    '--outputFile=' + output,
  ],
  { stdio: 'inherit', env: process.env },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const report = JSON.parse(readFileSync(output, 'utf8'));
for (const [path, count] of cases) {
  const file = report.testResults.find((test) => test.name.replaceAll('\\', '/').endsWith(path));
  if (
    !file ||
    file.assertionResults.length !== count ||
    file.assertionResults.some((test) => test.status !== 'passed')
  )
    throw new Error('SQL coverage missing, omitted or failed: ' + path);
}
if (report.numPendingTests !== 0 || report.numFailedTests !== 0 || report.numPassedTests !== 26)
  throw new Error(
    'Expected 25 formerly omitted SQL cases plus one existing adapter unit test, without omissions',
  );
console.log(
  'SQL gate: all 25 formerly omitted cases and one adapter unit case passed; zero omissions.',
);
