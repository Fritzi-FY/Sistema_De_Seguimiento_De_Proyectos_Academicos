import process from 'node:process';
import console from 'node:console';
import { setTimeout, setImmediate } from 'node:timers';
const { fetch, AbortSignal } = globalThis;
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(root, '.local-dev');
const targetFile = join(stateDir, 'target.json');
const runningFile = join(stateDir, 'running.json');
const cluster = join(
  process.env.LOCALAPPDATA ?? '',
  'Temp',
  'is488-migrator-d5974a0c7b7444ff9f9d85079bc86898',
);
const pgctl = 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe';
const target = {
  host: '127.0.0.1',
  port: 55490,
  database: 'is488_dev',
  migrator: 'is488_dev_migrator',
  runtime: 'is488_dev_runtime',
};
const webOrigin = 'http://127.0.0.1:5173';
const apiOrigin = 'http://127.0.0.1:8787';
const adminConfig = {
  host: target.host,
  port: target.port,
  database: 'postgres',
  user: 'is488_migration_admin',
  connectionTimeoutMillis: 3000,
  query_timeout: 5000,
};
const require = createRequire(join(root, 'apps/api/package.json'));
const { Client } = require('pg');
const children = [];
let control;
let shuttingDown = false;
mkdirSync(stateDir, { recursive: true });
function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function save(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}
function ensureWindows() {
  if (process.platform !== 'win32' || !existsSync(join(cluster, 'PG_VERSION')))
    throw new Error('Expected existing exclusive Windows PostgreSQL cluster not found.');
}
function pg(command) {
  const args = [command, '-D', cluster];
  if (command === 'start') args.push('-l', join(stateDir, 'postgres.log'), '-w', '-t', '15');
  if (command === 'stop') args.push('-m', 'fast', '-w', '-t', '15');
  return spawnSync(pgctl, args, { windowsHide: true, encoding: 'utf8', timeout: 20000 });
}
async function admin(work, database = 'postgres') {
  const client = new Client({ ...adminConfig, database });
  client.on('error', () => {});
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end();
  }
}
async function ensureCluster() {
  ensureWindows();
  if (pg('status').status !== 0) {
    const started = pg('start');
    if (started.status !== 0) throw new Error('Exclusive cluster failed to start.');
  }
  await admin(async (client) => {
    const row = (
      await client.query(
        "SELECT current_user AS actor,inet_server_port() AS port,current_setting('data_directory') AS directory",
      )
    ).rows[0];
    assert.equal(row.actor, adminConfig.user);
    assert.equal(row.port, target.port);
    assert.equal(
      row.directory.replaceAll('\\', '/').toLowerCase(),
      cluster.replaceAll('\\', '/').toLowerCase(),
    );
  });
}
function ownedTarget() {
  if (!existsSync(targetFile))
    throw new Error(
      'Run npm run dev:local:init once, after authorization to create the isolated database and roles.',
    );
  const stored = json(targetFile);
  assert.deepEqual(stored.target, target);
  assert.equal(stored.cluster, cluster);
  if (stored.phase !== 'ready')
    throw new Error(
      'Local initialization is incomplete; inspect target.json before attempting recovery. No automatic recreation.',
    );
  return stored;
}
async function migrate(mode = 'plan') {
  const { run } = await import(pathToFileURL(join(root, 'apps/api/migrations/runner.ts')).href);
  const result = await run(mode, {
    connection: {
      host: target.host,
      port: target.port,
      database: target.database,
      user: target.migrator,
    },
    runtimeRole: target.runtime,
    auditFile: join(stateDir, 'migrations.jsonl'),
  });
  if (!result.closeConfirmed) throw new Error('Migration connection closure unconfirmed.');
  return result;
}
async function initialize() {
  await ensureCluster();
  if (existsSync(targetFile)) {
    ownedTarget();
    const result = await migrate('plan');
    if (result.pending.length)
      throw new Error('Pending migrations require npm run dev:local:migrate.');
    console.log('Existing isolated development database and ledger verified; no recreation.');
    return;
  }
  await admin(async (client) => {
    const databases = (
      await client.query('SELECT oid FROM pg_database WHERE datname=$1', [target.database])
    ).rows;
    const roles = (
      await client.query('SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[])', [
        [target.migrator, target.runtime],
      ])
    ).rows;
    if (databases.length || roles.length)
      throw new Error(
        'Names already exist without this environment manifest; no adoption or modification.',
      );
    const manifest = {
      target,
      cluster,
      phase: 'creating',
      createdAt: new Date().toISOString(),
      created: [],
    };
    save(targetFile, manifest);
    for (const role of [target.migrator, target.runtime]) {
      await client.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10`,
      );
      manifest.created.push({ kind: 'role', name: role });
      save(targetFile, manifest);
    }
    await client.query(`CREATE DATABASE ${target.database} OWNER ${target.migrator}`);
    manifest.created.push({ kind: 'database', name: target.database });
    save(targetFile, manifest);
    await client.query(`REVOKE ALL ON DATABASE ${target.database} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${target.database} TO ${target.runtime}`);
    await admin(async (database) => {
      await database.query(`ALTER SCHEMA public OWNER TO ${target.migrator}`);
      await database.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC,${target.runtime}`);
      await database.query(`GRANT USAGE ON SCHEMA public TO ${target.runtime}`);
    }, target.database);
    const plan = await migrate('plan');
    console.log(
      'Reviewed existing migration versions:',
      plan.pending.map((p) => p.version).join(','),
    );
    await migrate('apply');
    const after = await migrate('plan');
    if (after.pending.length) throw new Error('Migrations remain pending.');
    manifest.phase = 'ready';
    save(targetFile, manifest);
  });
  console.log(
    'Isolated synthetic development database initialized. No other database was changed.',
  );
}
async function waitReady(url, child) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error('Development process exited; inspect .local-dev logs.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      await response.body?.cancel();
    } catch {
      /* Readiness only; no mutation is retried. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Development readiness timeout.');
}
function launch(name, script, args, cwd, extra = {}) {
  const log = createWriteStream(join(stateDir, name + '.log'), { flags: 'a' });
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', ...extra },
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  child.on('error', () => {
    void shutdown(1);
  });
  child.on('exit', () => {
    if (!shuttingDown) void shutdown(1);
  });
  return child;
}
async function stopClusterIfIdle() {
  if (pg('status').status !== 0) return;
  const other = await admin(
    async (client) =>
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()",
        )
      ).rows[0].n,
  );
  if (other) {
    console.log('PostgreSQL remains running: other client sessions are present.');
    return;
  }
  const stopped = pg('stop');
  if (stopped.status !== 0) throw new Error('Exclusive cluster stop failed.');
  console.log('Exclusive PostgreSQL stopped; development database and roles retained.');
}
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (control) control.close();
  for (const child of children)
    if (child.exitCode === null && child.pid)
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 10000,
      });
  try {
    await stopClusterIfIdle();
  } catch {
    console.error('Automatic PostgreSQL stop could not be confirmed; use dev:local:status.');
    code = 1;
  }
  save(runningFile, { stopped: true, stoppedAt: new Date().toISOString(), code });
  process.exitCode = code;
}
async function start() {
  ownedTarget();
  if (existsSync(runningFile)) {
    const previous = json(runningFile);
    if (!previous.stopped) {
      try {
        const response = await fetch(previous.origin + '/status', {
          headers: { 'X-Local-Control': previous.nonce },
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) throw new Error('already_running');
      } catch (error) {
        if (error.message === 'already_running') throw new Error('Local stack is already running.');
      }
    }
  }
  for (const port of [5173, 8787, 9231]) {
    await new Promise((resolve, reject) => {
      const probe = createTcpServer();
      probe.once('error', () =>
        reject(new Error(`Local port ${port} is occupied; no process was stopped.`)),
      );
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(resolve));
    });
  }
  await ensureCluster();
  const plan = await migrate();
  if (plan.pending.length) throw new Error('Pending migrations; run dev:local:migrate explicitly.');
  const nonce = randomUUID();
  control = createServer((request, response) => {
    if (request.headers['x-local-control'] !== nonce) {
      response.writeHead(403).end();
      return;
    }
    if (request.url === '/status' && request.method === 'GET') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ apiOrigin, webOrigin, kanbanPersistence: 'postgres' }));
      return;
    }
    if (request.url === '/stop' && request.method === 'POST') {
      response.writeHead(202).end();
      setImmediate(() => void shutdown());
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    control.once('error', reject);
    control.listen(0, '127.0.0.1', resolve);
  });
  save(runningFile, {
    origin: 'http://127.0.0.1:' + control.address().port,
    nonce,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  const api = launch(
    'api',
    join(root, 'node_modules/wrangler/bin/wrangler.js'),
    [
      'dev',
      '--config',
      'wrangler.local.jsonc',
      '--env',
      'local',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      '8787',
      '--inspector-port',
      '9231',
      '--show-interactive-dev-session=false',
    ],
    join(root, 'apps/api'),
  );
  const web = launch(
    'web',
    join(root, 'node_modules/vite/bin/vite.js'),
    ['--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    join(root, 'apps/web'),
    { IS488_LOCAL_API_ORIGIN: apiOrigin },
  );
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  try {
    await Promise.all([waitReady(apiOrigin + '/api/health', api), waitReady(webOrigin, web)]);
    console.log(
      `Frontend: ${webOrigin}\nAPI: ${apiOrigin}\nPostgreSQL: ${target.host}:${target.port}/${target.database}`,
    );
    console.log(
      'Synthetic identities only. Projects, memberships, boards, tasks and history persist in PostgreSQL.',
    );
    console.log('Seed/verify: npm run dev:local:verify. Stop: Ctrl+C or npm run dev:local:stop.');
  } catch (error) {
    await shutdown(1);
    throw error;
  }
}
async function stop() {
  ensureWindows();
  if (existsSync(runningFile)) {
    const running = json(runningFile);
    if (!running.stopped) {
      const response = await fetch(running.origin + '/stop', {
        method: 'POST',
        headers: { 'X-Local-Control': running.nonce },
        signal: AbortSignal.timeout(3000),
      });
      if (response.status !== 202) throw new Error('Stack shutdown was not accepted.');
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (json(runningFile).stopped) {
          console.log('Local stack stopped.');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('Stack shutdown remains unconfirmed.');
    }
  }
  await stopClusterIfIdle();
}
async function verify() {
  ownedTarget();
  const demoFile = join(stateDir, 'demo.json');
  const owner = '11111111-1111-4111-8111-111111111111',
    member = '22222222-2222-4222-8222-222222222222';
  const events = [];
  const pendingFile = join(stateDir, 'mutation-pending.json');
  async function request(method, path, body, expected) {
    const mutation = method !== 'GET';
    if (mutation) {
      if (existsSync(pendingFile))
        throw new Error(
          'Prior local mutation is unresolved; inspect mutation-pending.json before another write.',
        );
      writeFileSync(
        pendingFile,
        JSON.stringify({ at: new Date().toISOString(), attempt: randomUUID(), method, path }),
        { flag: 'wx' },
      );
    }
    const response = await fetch(webOrigin + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-User-Id': owner,
        'X-Dev-User-Role': 'student',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    events.push({ method, path, status: response.status });
    if (response.status !== expected)
      throw new Error(`Local ${method} ${path} returned ${response.status}; expected ${expected}.`);
    if (mutation) {
      assert.match(data.id, /^[0-9a-f-]{36}$/);
      unlinkSync(pendingFile);
    }
    return data;
  }
  const html = await fetch(webOrigin, { signal: AbortSignal.timeout(3000) });
  assert.ok(html.ok);
  assert.ok((await html.text()).includes('/src/main.tsx'));
  const before = existsSync(demoFile) ? json(demoFile) : null;
  let project;
  if (before) project = await request('GET', '/api/projects/' + before.projectId, undefined, 200);
  else {
    project = await request(
      'POST',
      '/api/projects',
      {
        title: 'Desarrollo local IS488',
        courseCode: 'IS488',
        startDate: '2026-10-28T00:00:00.000Z',
        targetDate: '2026-12-31T00:00:00.000Z',
      },
      201,
    );
    save(demoFile, { projectId: project.id, owner, member });
  }
  const members = await request('GET', `/api/projects/${project.id}/members`, undefined, 200);
  if (!members.some((m) => m.userId === member && m.status === 'active'))
    await request(
      'POST',
      `/api/projects/${project.id}/members`,
      { userId: member, role: 'collaborator' },
      201,
    );
  const board = await request('GET', `/api/projects/${project.id}/board`, undefined, 200);
  assert.ok(board.columns.length > 0);
  const task = await request(
    'POST',
    `/api/projects/${project.id}/tasks`,
    {
      title: 'Tarea sintética de desarrollo',
      columnId: board.columns[0].id,
      priority: 'MEDIUM',
      assigneeIds: [],
    },
    201,
  );
  const assigned = await request(
    'PATCH',
    `/api/projects/${project.id}/tasks/${task.id}`,
    { assigneeIds: [member] },
    200,
  );
  assert.deepEqual(assigned.assigneeIds, [member]);
  const history = await request(
    'GET',
    `/api/projects/${project.id}/tasks/${task.id}/activity`,
    undefined,
    200,
  );
  assert.ok(history.some((event) => event.action === 'CREATED'));
  assert.ok(history.some((event) => event.action === 'UPDATED' && event.details?.assigneeIds));
  const sql = new Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.runtime,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
  });
  sql.on('error', () => {});
  let persisted;
  try {
    await sql.connect();
    persisted = (
      await sql.query(
        "SELECT p.id,p.creator_id,count(m.*)::int AS active_members FROM public.projects p JOIN public.project_memberships m ON m.project_id=p.id AND m.status='active' WHERE p.id=$1 GROUP BY p.id",
        [project.id],
      )
    ).rows[0];
    assert.equal(persisted.creator_id, owner);
    assert.equal(persisted.active_members, 2);
  } finally {
    await sql.end();
  }
  const result = {
    at: new Date().toISOString(),
    scope: 'localhost frontend proxy -> Workers local -> exclusive PostgreSQL',
    projectId: project.id,
    taskId: task.id,
    projectCreatedThisRun: !before,
    assigneeIds: assigned.assigneeIds,
    historyActions: history.map((event) => event.action),
    sqlSnapshot: persisted,
    requests: events,
    volatile: [],
    durable: ['projects', 'memberships', 'board', 'columns', 'tasks', 'task history'],
    browserInteractionPerformed: false,
  };
  save(join(stateDir, 'verification.json'), result);
  console.log(JSON.stringify(result, null, 2));
}
const action = process.argv[2];
try {
  if (action === 'init') await initialize();
  else if (action === 'start') await start();
  else if (action === 'stop') await stop();
  else if (action === 'verify') await verify();
  else if (action === 'migrate') {
    ownedTarget();
    await ensureCluster();
    console.log(JSON.stringify(await migrate('apply')));
  } else if (action === 'status') {
    ensureWindows();
    console.log(
      JSON.stringify(
        {
          clusterRunning: pg('status').status === 0,
          target: existsSync(targetFile) ? json(targetFile) : null,
          stack: existsSync(runningFile) ? { ...json(runningFile), nonce: undefined } : null,
        },
        null,
        2,
      ),
    );
  } else throw new Error('Use init|start|stop|status|verify|migrate.');
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? 'Local invariant failed; see configuration and isolated target.'
      : error.message,
  );
  process.exitCode = 1;
}
