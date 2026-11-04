import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { request as httpsRequest, Agent } from 'node:https';
import { Buffer } from 'node:buffer';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { provision } from './identity-local.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
const { fetch, WebSocket } = globalThis;

const root = fileURLToPath(new URL('../../../', import.meta.url)),
  dir = join(root, '.local-dev/identity-session');
const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
mkdirSync(join(root, 'evidence/identity-access-session-flow'), { recursive: true });
assert.equal(state.runtimeConfig.host, '127.0.0.1');
assert.equal(state.runtimeConfig.port, 55511);
assert.equal(state.runtimeConfig.database, 'is488_identity_local');
assert.equal(resolve(state.data).toLowerCase(), resolve(join(dir, 'pgdata')).toLowerCase());
const require = createRequire(new URL('../package.json', import.meta.url));
const { Client } = require('pg');
const certificate = join(dir, 'localhost-cert.pem'),
  key = join(dir, 'localhost-key.pem');
function certValid(path) {
  if (!existsSync(path)) return false;
  try {
    return Date.now() < Date.parse(new X509Certificate(readFileSync(path)).validTo);
  } catch {
    return false;
  }
}
if (!certValid(certificate)) {
  const r = spawnSync(
    'C:/Program Files/Git/usr/bin/openssl.exe',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      certificate,
      '-days',
      '30',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { windowsHide: true, encoding: 'utf8' },
  );
  if (r.status !== 0) throw Error('Local certificate generation failed');
}
const ca = readFileSync(certificate),
  agent = new Agent({ ca, autoSelectFamily: true });
async function http(method, path, body, cookie, origin = state.origin) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = httpsRequest(
      new URL(path, state.origin),
      {
        method,
        agent,
        headers: {
          ...(data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {}),
          ...(method === 'POST' ? { origin } : {}),
          ...(cookie ? { cookie } : {}),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (part) => {
          text += part;
          if (text.length > 100000) req.destroy(new Error('Response limit'));
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            json: () => JSON.parse(text),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('Local HTTP deadline')));
    if (data) req.write(data);
    req.end();
  });
}
const evidence = [];
let worker, browser, ws;
const sql = new Client({ ...state.migrationConfig, connectionTimeoutMillis: 3000 });
function check(name) {
  evidence.push({ name, result: 'passed' });
  console.log(name + ': passed');
}
function assertStatus(response, expected, stage) {
  assert.equal(response.status, expected, stage + ' HTTP status');
}
function cookieHeader(response) {
  return (response.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
}
async function waitUntil(work, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const result = await work();
      if (result) return result;
    } catch (e) {
      last = e;
    }
    await delay(100);
  }
  throw new Error(
    'Local wait deadline: ' + (last ? `${last.name}: ${last.message}` : 'condition not met'),
  );
}
async function cdpConnect(url) {
  ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const value = JSON.parse(String(event.data));
    if (!value.id) return;
    const call = pending.get(value.id);
    if (!call) return;
    pending.delete(value.id);
    if (value.error) call.reject(new Error('CDP command failed'));
    else call.resolve(value.result);
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const current = ++id;
      pending.set(current, { resolve, reject });
      ws.send(JSON.stringify({ id: current, method, params }));
    });
}
try {
  const pgctl = 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe';
  const running = spawnSync(pgctl, ['status', '-D', state.data], {
    windowsHide: true,
    stdio: 'ignore',
  });
  if (running.status !== 0) {
    const start = spawnSync(
      pgctl,
      ['start', '-D', state.data, '-l', join(dir, 'postgres.log'), '-w', '-t', '30'],
      { windowsHide: true, stdio: 'ignore', timeout: 35000 },
    );
    assert.equal(start.status, 0, 'Exclusive cluster start');
  }
  const admin = new Client({ ...state.adminConfig, connectionTimeoutMillis: 3000 });
  await admin.connect();
  try {
    const guard = (
      await admin.query(
        "SELECT current_user AS actor,inet_server_port() AS port,current_setting('data_directory') AS directory",
      )
    ).rows[0];
    assert.equal(guard.actor, 'is488_identity_admin');
    assert.equal(guard.port, 55511);
    assert.equal(resolve(guard.directory).toLowerCase(), resolve(state.data).toLowerCase());
  } finally {
    await admin.end();
  }
  await sql.connect();
  await sql.query('UPDATE public.auth_session SET "expiresAt"=now() WHERE "expiresAt">now()');
  const nonce = randomUUID().slice(0, 8);
  state.fixtures = {};
  for (const key of ['student', 'otherStudent']) {
    const password = randomBytes(24).toString('hex');
    state.fixtures[key] = {
      ...(await provision(
        key.toLowerCase() + '-' + nonce + '@synthetic.example.test',
        'student',
        'Synthetic ' + key,
        password,
      )),
      password,
    };
  }
  writeFileSync(join(dir, 'verify-fixtures.json'), JSON.stringify(state.fixtures));
  const actual = (
    await sql.query(
      'SELECT current_database() AS database,inet_server_port() AS port,current_user AS actor',
    )
  ).rows[0];
  assert.equal(actual.database, 'is488_identity_local');
  assert.equal(actual.port, 55511);
  assert.equal(actual.actor, 'is488_identity_migrator');
  const log = openSync(join(dir, 'worker.log'), 'a');
  worker = spawn(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--config',
      join(dir, 'wrangler.jsonc'),
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      '8792',
      '--inspector-port',
      '9292',
      '--local-protocol',
      'https',
      '--https-key-path',
      key,
      '--https-cert-path',
      certificate,
      '--show-interactive-dev-session=false',
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    },
  );
  await waitUntil(async () => {
    if (worker.exitCode !== null) throw Error('Worker exited before ready');
    return (await http('GET', '/api/auth/me')).status === 401;
  }, 60000);
  assertStatus(await http('GET', '/api/auth/me'), 401, 'anonymous me');
  assertStatus(await http('GET', '/api/projects'), 401, 'anonymous project API');
  assertStatus(await http('GET', '/app'), 303, 'anonymous private page');
  check('Anonymous API and frontend rejected');
  const student = state.fixtures.student;
  assertStatus(
    await http('POST', '/api/auth/sign-in/email', {
      email: student.email,
      password: student.password,
    }),
    403,
    'unverified login',
  );
  check('Unverified preauthorized user rejected');
  assertStatus(
    await http('POST', '/api/auth/verification/request', {
      email: student.email,
    }),
    200,
    'local verification request',
  );
  const mail = (
    await sql.query('SELECT url FROM public.auth_local_mail WHERE email=$1', [student.email])
  ).rows.at(-1);
  assert.ok(mail, 'Synthetic mailbox received verification');
  const verification = new URL(mail.url);
  assert.equal(verification.origin, state.origin);
  const verified = await http('GET', verification.pathname + verification.search);
  assert.equal(verified.status, 200);
  assert.equal(
    (await sql.query('SELECT "emailVerified" FROM public.auth_user WHERE id=$1', [student.userId]))
      .rows[0].emailVerified,
    false,
  );
  assertStatus(
    await http('POST', '/api/auth/verification/confirm', {
      token: verification.searchParams.get('token'),
    }),
    200,
    'explicit verification confirmation',
  );
  assertStatus(
    await http('POST', '/api/auth/verification/confirm', {
      token: verification.searchParams.get('token'),
    }),
    400,
    'verification replay rejected',
  );
  assert.equal(
    (await sql.query('SELECT "emailVerified" FROM public.auth_user WHERE id=$1', [student.userId]))
      .rows[0].emailVerified,
    true,
  );
  check('Synthetic mailbox verifies provisioned identity');
  const signup = await http('POST', '/api/auth/sign-up/email', {
    name: 'Unprovisioned',
    email: 'unknown@synthetic.example.test',
    password: student.password,
  });
  assert.ok([400, 403, 404].includes(signup.status));
  assert.equal(
    (
      await sql.query('SELECT count(*)::int AS n FROM public.auth_user WHERE email=$1', [
        'unknown@synthetic.example.test',
      ])
    ).rows[0].n,
    0,
  );
  check('Public registration disabled');
  assertStatus(
    await http('POST', '/api/auth/sign-in/email', {
      email: student.email,
      password: student.password,
      role: 'admin',
    }),
    400,
    'client role rejected',
  );
  const login = await http('POST', '/api/auth/sign-in/email', {
    email: student.email,
    password: student.password,
  });
  assertStatus(login, 200, 'verified login');
  assert.deepEqual(Object.keys(login.json()), ['success']);
  const transientCookie = cookieHeader(login);
  assert.ok(transientCookie);
  const sessionCookie = (login.headers['set-cookie'] ?? []).find((c) =>
    c.includes('.session_token='),
  );
  assert.ok(sessionCookie);
  assert.ok(/httponly/i.test(sessionCookie));
  assert.ok(/secure/i.test(sessionCookie));
  assert.ok(/samesite=lax/i.test(sessionCookie));
  assert.ok(!/max-age=/i.test(sessionCookie));
  const me = await http('GET', '/api/auth/me', undefined, transientCookie);
  assertStatus(me, 200, 'authenticated me');
  assert.equal(me.json().userId, student.userId);
  assert.equal(me.json().role, 'student');
  assert.ok(!('token' in me.json()));
  check('Internal UUID and role come from server; token absent from DTO');
  const before = (
    await sql.query(
      'SELECT extract(epoch from ("expiresAt"-"createdAt"))::float AS seconds,"expiresAt" AS expires FROM public.auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC',
      [student.userId],
    )
  ).rows[0];
  assert.ok(before.seconds > 0 && before.seconds <= 28800);
  await http('GET', '/api/auth/me', undefined, transientCookie);
  const after = (
    await sql.query(
      'SELECT "expiresAt" AS expires FROM public.auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC',
      [student.userId],
    )
  ).rows[0];
  assert.equal(after.expires.toISOString(), before.expires.toISOString());
  check('Eight-hour absolute limit without refresh or remember-me');
  assertStatus(
    await http('POST', '/api/auth/update-user', { role: 'admin' }, transientCookie),
    404,
    'profile role escalation',
  );
  assertStatus(
    await http(
      'POST',
      '/api/auth/admin/set-role',
      { userId: student.userId, role: 'admin' },
      transientCookie,
    ),
    404,
    'role administration not exposed',
  );
  const runtime = new Client(state.runtimeConfig);
  await runtime.connect();
  try {
    await assert.rejects(
      runtime.query("UPDATE public.auth_role_grants SET role='admin' WHERE user_id=$1", [
        student.userId,
      ]),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      runtime.query('CREATE TABLE public.forbidden_auth_spike(id int)'),
      (e) => e.code === '42501',
    );
  } finally {
    await runtime.end();
  }
  assert.equal(
    (await sql.query('SELECT role FROM public.auth_role_grants WHERE user_id=$1', [student.userId]))
      .rows[0].role,
    'student',
  );
  check('Client and runtime cannot self-grant roles or issue DDL');
  assertStatus(
    await http('POST', '/api/auth/sign-out', {}, transientCookie, 'https://untrusted.example.test'),
    403,
    'cross-origin logout',
  );
  assertStatus(
    await http('GET', '/api/auth/me', undefined, transientCookie),
    200,
    'session survives forged logout',
  );
  check('Cross-origin mutation rejected without revoking session');
  await sql.query(
    'UPDATE public.auth_session SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1',
    [student.userId],
  );
  assertStatus(
    await http('GET', '/api/auth/me', undefined, transientCookie),
    401,
    'expired session',
  );
  check('Expired session rejected by server');
  const second = state.fixtures.otherStudent;
  await http('POST', '/api/auth/verification/request', { email: second.email });
  const secondMail = (
    await sql.query('SELECT url FROM public.auth_local_mail WHERE email=$1', [second.email])
  ).rows.at(-1);
  assertStatus(
    await http('POST', '/api/auth/verification/confirm', {
      token: new URL(secondMail.url).searchParams.get('token'),
    }),
    200,
    'second verification',
  );
  const ownerLogin = await http('POST', '/api/auth/sign-in/email', {
    email: student.email,
    password: student.password,
  });
  assertStatus(ownerLogin, 200, 'owner login');
  const ownerCookie = cookieHeader(ownerLogin);
  const created = await http(
    'POST',
    '/api/projects',
    {
      title: 'Synthetic authentication project',
      courseCode: 'IS488',
      startDate: '2026-01-01T00:00:00.000Z',
      targetDate: '2026-12-31T00:00:00.000Z',
    },
    ownerCookie,
  );
  assertStatus(created, 201, 'authenticated product creation');
  state.project = created.json().id;
  await delay(11000);
  const otherLogin = await http('POST', '/api/auth/sign-in/email', {
    email: second.email,
    password: second.password,
  });
  assertStatus(otherLogin, 200, 'second login');
  const otherCookie = cookieHeader(otherLogin);
  assert.deepEqual((await http('GET', '/api/projects', undefined, otherCookie)).json(), []);
  assertStatus(
    await http('GET', '/api/projects/' + state.project + '/board', undefined, otherCookie),
    404,
    'cross-user project isolation',
  );

  const boardRes = await http(
    'GET',
    '/api/projects/' + state.project + '/board',
    undefined,
    ownerCookie,
  );
  assertStatus(boardRes, 200, 'owner get board');
  const board = boardRes.json();
  assert.ok(board.columns.length >= 3, 'default columns created');
  const columnId = board.columns[0].id;

  const memberRes = await http(
    'POST',
    '/api/projects/' + state.project + '/members',
    { userId: second.userId, role: 'collaborator' },
    ownerCookie,
  );
  assertStatus(memberRes, 201, 'add collaborator membership');

  const taskRes = await http(
    'POST',
    '/api/projects/' + state.project + '/tasks',
    {
      title: 'Synthetic authenticated task',
      description: 'Task created under session',
      columnId,
      priority: 'HIGH',
      assigneeIds: [second.userId],
    },
    ownerCookie,
  );
  assertStatus(taskRes, 201, 'create task');
  state.task = taskRes.json().id;

  const activityRes = await http(
    'GET',
    '/api/projects/' + state.project + '/tasks/' + state.task + '/activity',
    undefined,
    ownerCookie,
  );
  assertStatus(activityRes, 200, 'task activity history');
  assert.ok(activityRes.json().length >= 1, 'activity history recorded');
  assert.equal(activityRes.json()[0].action, 'CREATED');

  const secondProjects = await http('GET', '/api/projects', undefined, otherCookie);
  assertStatus(secondProjects, 200, 'collaborator projects list');
  assert.equal(secondProjects.json().length, 1);
  assert.equal(secondProjects.json()[0].id, state.project);

  const memberRows = (
    await sql.query(
      'SELECT user_id, role, status FROM public.project_memberships WHERE project_id=$1',
      [state.project],
    )
  ).rows;
  assert.equal(memberRows.length, 2);

  const taskRows = (
    await sql.query('SELECT id, title, column_id FROM public.tasks WHERE id=$1', [state.task])
  ).rows;
  assert.equal(taskRows.length, 1);
  assert.equal(taskRows[0].title, 'Synthetic authenticated task');

  const activityRows = (
    await sql.query('SELECT action, actor_id FROM public.task_activity WHERE task_id=$1', [
      state.task,
    ])
  ).rows;
  assert.equal(activityRows.length, 1);
  assert.equal(activityRows[0].action, 'CREATED');
  assert.equal(activityRows[0].actor_id, student.userId);

  assertStatus(
    await http(
      'POST',
      '/api/projects',
      { title: 'Forbidden CSRF' },
      ownerCookie,
      'https://untrusted.example.test',
    ),
    403,
    'product CSRF',
  );

  assertStatus(await http('POST', '/api/auth/sign-out', {}, ownerCookie), 200, 'owner logout');
  check('Real product creation, CSRF and cross-user isolation');

  const profile = join(dir, 'chrome-profile');
  rmSync(join(profile, 'DevToolsActivePort'), { force: true });
  mkdirSync(profile, { recursive: true });
  const spki = createHash('sha256')
    .update(new X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
  const browserLog = openSync(join(dir, 'browser.log'), 'a');
  browser = spawn(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      '--ignore-certificate-errors-spki-list=' + spki,
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    { windowsHide: true, stdio: ['ignore', browserLog, browserLog] },
  );
  const port = await waitUntil(() =>
    existsSync(join(profile, 'DevToolsActivePort'))
      ? Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
      : false,
  );
  const page = await waitUntil(async () => {
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    return targets.find((t) => t.type === 'page');
  });
  assert.ok(page);
  const cdp = await cdpConnect(page.webSocketDebuggerUrl);
  await cdp('Page.enable');
  await cdp('Network.enable');
  async function evaluate(expression) {
    const r = await cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error('Browser evaluation failed');
    return r.result.value;
  }
  await cdp('Page.navigate', { url: state.origin + '/' });
  await waitUntil(() => evaluate('Boolean(document.querySelector("form input[name=email]"))'));
  await evaluate(
    'document.querySelector("input[name=email]").value=' +
      JSON.stringify(student.email) +
      ';document.querySelector("input[name=password]").value=' +
      JSON.stringify(student.password) +
      ';document.querySelector("button[type=submit]").click();true',
  );
  await waitUntil(() =>
    evaluate(
      'location.pathname==="/app"&&Boolean(document.querySelector("[data-testid=session-user]"))',
    ),
  );
  assert.equal(
    await evaluate('document.querySelector("[data-testid=session-user]").dataset.userId'),
    student.userId,
  );
  assert.equal(
    await evaluate('document.querySelector("[data-testid=session-user]").dataset.role'),
    'student',
  );
  await waitUntil(() =>
    evaluate(
      'document.querySelector("main")?.textContent.includes("Synthetic authentication project")',
    ),
  );
  assert.ok(
    (await evaluate('document.querySelector("main").textContent')).includes(
      'Synthetic authentication project',
    ),
  );
  check('Chrome: login opens protected React application and real project API');

  await evaluate(
    'document.querySelector("[data-testid=view-project-btn-' + state.project + ']").click();true',
  );
  await waitUntil(() => evaluate('Boolean(document.querySelector("[data-testid=kanban-board]"))'));
  await waitUntil(() =>
    evaluate('Boolean(document.querySelector("[data-testid=task-card-' + state.task + ']"))'),
  );
  assert.ok(
    (
      await evaluate(
        'document.querySelector("[data-testid=task-card-' + state.task + ']").textContent',
      )
    ).includes('Synthetic authenticated task'),
  );
  await evaluate(
    'document.querySelector("[data-testid=task-card-' + state.task + '] button").click();true',
  );
  await waitUntil(() => evaluate('Boolean(document.querySelector("[role=dialog]"))'));
  await waitUntil(() =>
    evaluate('Boolean(document.querySelector("[role=dialog]")?.textContent.includes("Creación"))'),
  );
  await evaluate(
    'document.querySelector("[role=dialog] button[aria-label*=\'Cerrar\']")?.click();true',
  );
  await waitUntil(() => evaluate('!document.querySelector("[role=dialog]")'));
  check('Chrome: project detail renders Kanban board, task and activity history');
  const cookies = (await cdp('Network.getCookies', { urls: [state.origin] })).cookies;
  const browserSession = cookies.find((c) => c.name.includes('session_token'));
  assert.ok(browserSession);
  assert.equal(browserSession.httpOnly, true);
  assert.equal(browserSession.secure, true);
  assert.equal(browserSession.session, true);
  assert.equal(browserSession.sameSite, 'Lax');
  assert.equal(await evaluate('localStorage.length'), 0);
  assert.ok(!(await evaluate('document.cookie')).includes('session_token'));
  check('Chrome: secure HttpOnly session cookie; no browser-storage token');
  const stolen = cookies.map((c) => c.name + '=' + c.value).join('; ');
  const previousDocument = await evaluate('performance.timeOrigin');
  await cdp('Page.reload', { ignoreCache: true });
  await waitUntil(() =>
    evaluate(
      'performance.timeOrigin!==' +
        JSON.stringify(previousDocument) +
        '&&Boolean(document.querySelector("[data-testid=session-user]"))',
    ),
  );
  assert.equal(
    await evaluate('document.querySelector("[data-testid=session-user]").dataset.userId'),
    student.userId,
  );
  check('Chrome: reload retains the same authenticated UUID');
  const forged = await evaluate(
    'fetch("/api/projects",{headers:{"X-Dev-User-Role":"admin","X-Dev-User-Id":' +
      JSON.stringify(state.fixtures.otherStudent.userId) +
      '}}).then(r=>r.status)',
  );
  assert.equal(forged, 401);
  check('Development identity headers cannot override session authority');
  await evaluate('document.querySelector("[data-testid=logout]").click();true');
  await waitUntil(() =>
    evaluate('location.pathname==="/"&&Boolean(document.querySelector("form input[name=email]"))'),
  );
  assertStatus(await http('GET', '/api/auth/me', undefined, stolen), 401, 'revoked cookie me');
  assertStatus(
    await http('GET', '/api/projects', undefined, stolen),
    401,
    'revoked cookie projects',
  );
  assertStatus(await http('GET', '/app', undefined, stolen), 303, 'revoked cookie page');
  check('Chrome: logout revokes server session; replay and private page denied');
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM public.auth_session WHERE "userId"=$1 AND "expiresAt">now()',
        [student.userId],
      )
    ).rows[0].n,
    0,
  );
  assertStatus(await http('POST', '/api/auth/sign-out', {}, stolen), 200, 'idempotent logout');
  assertStatus(
    await http('GET', '/api/auth/me', undefined, otherCookie),
    200,
    'logout preserves other identity session',
  );
  assertStatus(await http('POST', '/api/auth/sign-out', {}, otherCookie), 200, 'second logout');
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM public.auth_session WHERE "userId"=$1 AND "expiresAt">now()',
        [second.userId],
      )
    ).rows[0].n,
    0,
  );
  check('Logout is idempotent and isolated from other users');
  writeFileSync(
    join(root, 'evidence/identity-access-session-flow/results.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        library: 'better-auth@1.7.14',
        runtime: 'Wrangler local workerd; existing nodejs_compat 2024-09-23',
        browser: 'Chrome headless, isolated profile, local certificate SPKI pin',
        maxSessionSeconds: 28800,
        google: 'planned, not configured or contacted',
        externalServicesUsed: false,
        cases: evidence,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Identity session flow passed ' + evidence.length + ' focused checks.');
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.close();
  }
  if (browser?.pid)
    spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  if (worker?.pid)
    spawnSync('taskkill', ['/PID', String(worker.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  await sql.end().catch(() => {});
  agent.destroy();
  const stopped = spawnSync(
    'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe',
    ['stop', '-D', state.data, '-m', 'fast', '-w', '-t', '30'],
    { windowsHide: true, stdio: 'ignore', timeout: 35000 },
  );
  if (stopped.status !== 0) console.error('Exclusive spike cluster stop requires inspection.');
}
