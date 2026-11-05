import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { request as httpsRequest, Agent } from 'node:https';
import { Buffer } from 'node:buffer';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const { fetch, WebSocket } = globalThis;

const root = fileURLToPath(new URL('../../../../', import.meta.url)),
  dir = join(root, '.local-dev/auth-spike');
const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
mkdirSync(join(root, 'evidence/identity-access-spike'), { recursive: true });
assert.equal(state.runtimeConfig.host, '127.0.0.1');
assert.equal(state.runtimeConfig.port, 55510);
assert.equal(state.runtimeConfig.database, 'is488_auth_spike');
assert.equal(resolve(state.data).toLowerCase(), resolve(join(dir, 'pgdata')).toLowerCase());
const require = createRequire(new URL('../../package.json', import.meta.url));
const { Client } = require('pg');
const certificate = join(dir, 'localhost-cert.pem'),
  key = join(dir, 'localhost-key.pem');
if (!existsSync(certificate)) {
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
      '1',
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
  agent = new Agent({ ca });
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
  throw new Error('Local wait deadline: ' + (last?.name ?? 'condition not met'));
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
    assert.equal(guard.actor, 'is488_auth_spike_admin');
    assert.equal(guard.port, 55510);
    assert.equal(resolve(guard.directory).toLowerCase(), resolve(state.data).toLowerCase());
  } finally {
    await admin.end();
  }
  await sql.connect();
  const actual = (
    await sql.query(
      'SELECT current_database() AS database,inet_server_port() AS port,current_user AS actor',
    )
  ).rows[0];
  assert.equal(actual.database, 'is488_auth_spike');
  assert.equal(actual.port, 55510);
  assert.equal(actual.actor, 'is488_auth_spike_migrator');
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
      '8791',
      '--inspector-port',
      '9291',
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
    return (await http('GET', '/spike-ready')).status === 200;
  }, 45000);
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
    await http('POST', '/api/auth/send-verification-email', {
      email: student.email,
      callbackURL: state.origin + '/',
    }),
    200,
    'local verification request',
  );
  const mail = (
    await sql.query('SELECT url FROM public.spike_auth_mail WHERE email=$1', [student.email])
  ).rows.at(-1);
  assert.ok(mail, 'Synthetic mailbox received verification');
  const verification = new URL(mail.url);
  assert.equal(verification.origin, state.origin);
  const verified = await http('GET', verification.pathname + verification.search);
  assert.ok([200, 302, 303].includes(verified.status));
  assert.equal(
    (
      await sql.query('SELECT "emailVerified" FROM public.spike_auth_user WHERE id=$1', [
        student.userId,
      ])
    ).rows[0].emailVerified,
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
      await sql.query('SELECT count(*)::int AS n FROM public.spike_auth_user WHERE email=$1', [
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
    rememberMe: true,
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
      'SELECT extract(epoch from ("expiresAt"-"createdAt"))::float AS seconds,"expiresAt" AS expires FROM public.spike_auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC',
      [student.userId],
    )
  ).rows[0];
  assert.ok(before.seconds > 0 && before.seconds <= 28800);
  await http('GET', '/api/auth/me', undefined, transientCookie);
  const after = (
    await sql.query(
      'SELECT "expiresAt" AS expires FROM public.spike_auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC',
      [student.userId],
    )
  ).rows[0];
  assert.equal(after.expires.toISOString(), before.expires.toISOString());
  check('Eight-hour absolute limit without refresh or remember-me');
  assertStatus(
    await http('POST', '/api/auth/update-user', { role: 'admin' }, transientCookie),
    400,
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
      runtime.query("UPDATE public.spike_role_grants SET role='admin' WHERE user_id=$1", [
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
    (
      await sql.query('SELECT role FROM public.spike_role_grants WHERE user_id=$1', [
        student.userId,
      ])
    ).rows[0].role,
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
    'UPDATE public.spike_auth_session SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1',
    [student.userId],
  );
  assertStatus(
    await http('GET', '/api/auth/me', undefined, transientCookie),
    401,
    'expired session',
  );
  check('Expired session rejected by server');
  const profile = join(dir, 'chrome-profile');
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
  await waitUntil(() => evaluate('document.querySelector("main")?.dataset.state==="signed-out"'));
  await evaluate(
    'document.querySelector("#email").value=' +
      JSON.stringify(student.email) +
      ';document.querySelector("#password").value=' +
      JSON.stringify(student.password) +
      ';document.querySelector("#login").click();true',
  );
  await waitUntil(() =>
    evaluate(
      'location.pathname==="/app"&&document.querySelector("main")?.dataset.state==="authenticated"',
    ),
  );
  assert.equal(
    await evaluate('document.querySelector("#identity").dataset.userId'),
    student.userId,
  );
  assert.equal(await evaluate('document.querySelector("#identity").dataset.role'), 'student');
  assert.ok(
    (await evaluate('document.querySelector("#projects").textContent')).includes(
      'Synthetic authentication project',
    ),
  );
  check('Chrome: login opens protected React application and real project API');
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
        '&&document.querySelector("main")?.dataset.state==="authenticated"',
    ),
  );
  assert.equal(
    await evaluate('document.querySelector("#identity").dataset.userId'),
    student.userId,
  );
  check('Chrome: reload retains the same authenticated UUID');
  const forged = await evaluate(
    'fetch("/api/projects",{headers:{"X-Dev-User-Role":"admin","X-Dev-User-Id":' +
      JSON.stringify(state.fixtures.teacher.userId) +
      '}}).then(r=>r.status)',
  );
  assert.equal(forged, 401);
  check('Development identity headers cannot override session authority');
  await evaluate('document.querySelector("#logout").click();true');
  await waitUntil(() =>
    evaluate(
      'location.pathname==="/"&&document.querySelector("main")?.dataset.state==="signed-out"',
    ),
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
        'SELECT count(*)::int AS n FROM public.spike_auth_session WHERE "expiresAt">now()',
      )
    ).rows[0].n,
    0,
  );
  writeFileSync(
    join(root, 'evidence/identity-access-spike/results.json'),
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
  console.log('Authentication spike passed ' + evidence.length + ' focused checks.');
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
