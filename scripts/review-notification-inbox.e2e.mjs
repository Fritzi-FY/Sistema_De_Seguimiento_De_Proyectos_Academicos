import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
/* global document, window, localStorage, getComputedStyle, Event */
const { Headers, Request, URL } = globalThis;
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:https';

const root = process.cwd();
const require = createRequire(join(root, 'apps/api/package.json'));
const { Client } = require('pg');
const { build } = require('esbuild');
const { hashPassword } = await import(pathToFileURL(require.resolve('better-auth/crypto')));
const { createServer: createVite } = await import('vite');
const { chromium } = await import(pathToFileURL(process.env.IS488_PLAYWRIGHT_MODULE));
const target = {
  host: process.env.IS488_SQL_HOST,
  port: Number(process.env.IS488_SQL_PORT),
  directory: process.env.IS488_SQL_DATA_DIR,
};
assert.deepEqual(target, {
  host: '127.0.0.1',
  port: 55491,
  directory: 'C:/Users/fritz/is488-db/reviews-cluster',
});
assert.ok(process.env.IS488_SQL_ADMIN_USER);
const suffix = randomUUID().replaceAll('-', '');
const database = 'is488_test_inbox_e2e_' + suffix;
const migrator = 'is488_iem_' + suffix;
const runtime = 'is488_ier_' + suffix;
const local = resolve('.local-dev/list-student-review-notifications-block5', suffix);
const evidence = resolve('evidence/review-notification-inbox');
mkdirSync(local, { recursive: true });
mkdirSync(evidence, { recursive: true });
const base = {
  host: target.host,
  port: target.port,
  user: process.env.IS488_SQL_ADMIN_USER,
  connectionTimeoutMillis: 3000,
  query_timeout: 6000,
};
const admin = new Client({ ...base, database: 'postgres' });
let data,
  browser,
  vite,
  server,
  databaseCreated = false;
const roles = [];
const results = [];
const check = (name, details = {}) => {
  results.push({ name, passed: true, ...details });
  console.log('PASS ' + name);
};
async function validate(client) {
  assert.deepEqual(
    (
      await client.query(
        "SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory",
      )
    ).rows[0],
    target,
  );
}
async function snapshot() {
  const result = {};
  for (const table of [
    'projects',
    'project_memberships',
    'teacher_project_assignments',
    'teacher_review_requests',
    'teacher_review_actions',
    'internal_notifications',
  ])
    result[table] = (
      await data.query(
        `SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
  return result;
}
let failure;
try {
  await admin.connect();
  await validate(admin);
  for (const role of [migrator, runtime]) {
    await validate(admin);
    await admin.query(
      'CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
    );
    roles.push(role);
  }
  await validate(admin);
  await admin.query('CREATE DATABASE ' + database + ' OWNER ' + migrator);
  databaseCreated = true;
  await admin.query('REVOKE TEMPORARY ON DATABASE ' + database + ' FROM PUBLIC,' + runtime);
  const { run } = await import(pathToFileURL(resolve('apps/api/migrations/runner.ts')));
  await validate(admin);
  const migration = await run('apply', {
    connection: { ...base, database, user: migrator },
    runtimeRole: runtime,
    directory: resolve('apps/api/migrations'),
    auditFile: join(local, 'migration.jsonl'),
  });
  assert.equal(migration.closeConfirmed, true);
  data = new Client({ ...base, database });
  await data.connect();
  await validate(data);
  const password = randomBytes(24).toString('base64url');
  const hashed = await hashPassword(password);
  const accounts = {};
  for (const [name, role] of [
    ['student', 'student'],
    ['peer', 'student'],
    ['teacher', 'teacher'],
  ]) {
    const id = randomUUID(),
      email = name + '@synthetic.example.test';
    accounts[name] = { id, email };
    await data.query(
      'INSERT INTO public.auth_user(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
      [id, 'E2E ' + name, email],
    );
    await data.query(
      'INSERT INTO public.auth_account(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2::text,\'credential\',$2::uuid,$3,now())',
      [randomUUID(), id, hashed],
    );
    await data.query(
      "INSERT INTO public.auth_role_grants(user_id,role,active,granted_by) VALUES($1,$2,true,'inbox-e2e')",
      [id, role],
    );
  }
  const projects = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    projects.push(id);
    await data.query(
      "INSERT INTO public.projects(id,title,course_code,status,start_date,target_date,creator_id,created_at,updated_at) VALUES($1,$2,'IS488','active',now(),now(),$3,now(),now())",
      [id, 'E2E synthetic project ' + i, accounts.student.id],
    );
    for (const name of ['student', 'peer', 'teacher'])
      await data.query(
        "INSERT INTO public.project_memberships(id,project_id,user_id,role,status,joined_at,updated_at) VALUES($1,$2,$3,$4,'active',now(),now())",
        [randomUUID(), id, accounts[name].id, name === 'student' ? 'owner' : 'collaborator'],
      );
    await data.query(
      'INSERT INTO public.teacher_project_assignments(teacher_user_id,project_id) VALUES($1,$2)',
      [accounts.teacher.id, id],
    );
  }
  const bundled = join(local, 'session.cjs');
  await build({
    entryPoints: [resolve('apps/api/src/infrastructure/auth/session-worker.ts')],
    outfile: bundled,
    bundle: true,
    external: ['pg', 'better-auth', 'better-auth/*', 'kysely', 'hono', 'hono/*', 'zod', 'jose'],
    plugins: [
      {
        name: 'workspace-api-dependencies',
        setup(builder) {
          builder.onResolve({ filter: /^(pg|better-auth|kysely|hono|zod|jose)(\/|$)/ }, (args) => ({
            path: require.resolve(args.path),
            external: true,
          }));
        },
      },
    ],
    platform: 'node',
    format: 'cjs',
  });
  const { sessionFetch } = require(bundled);
  process.chdir(join(root, 'apps/web'));
  vite = await createVite({
    root: join(root, 'apps/web'),
    configFile: join(root, 'apps/web/vite.config.ts'),
    server: { middlewareMode: true },
    mode: 'development',
  });
  let origin;
  const env = {
    AUTH_MODE: 'session',
    NODE_ENV: 'development',
    AUTH_SECRET: randomBytes(48).toString('base64url'),
    DATABASE_URL: `postgresql://${runtime}@127.0.0.1:55491/${database}`,
  };
  server = createServer(
    {
      cert: readFileSync(process.env.IS488_E2E_TLS_CERT),
      key: readFileSync(process.env.IS488_E2E_TLS_KEY),
    },
    async (incoming, outgoing) => {
      if (!incoming.url.startsWith('/api/')) {
        vite.middlewares(incoming, outgoing);
        return;
      }
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(',') : value);
        const response = await sessionFetch(
          new Request(origin + incoming.url, {
            method: incoming.method,
            headers,
            ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }),
          }),
          { ...env, AUTH_ORIGIN: origin },
        );
        const output = Object.fromEntries(response.headers);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) output['set-cookie'] = cookies;
        outgoing.writeHead(response.status, output);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(500);
        outgoing.end();
      }
    },
  );
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = 'https://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.IS488_CHROMIUM_EXECUTABLE,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const api = async (path, body) => {
    const response = await context.request.post(origin + path, {
      data: body,
      headers: { Origin: origin },
    });
    assert.ok(response.ok(), 'API status ' + response.status() + ' at ' + path);
    return response.json();
  };
  const login = async (name) => {
    await api('/api/auth/sign-in/email', { email: accounts[name].email, password });
  };
  const logout = async () => {
    await api('/api/auth/sign-out', {});
  };
  await login('student');
  const reviews = [];
  for (let i = 0; i < 23; i++) {
    const project = projects[i < 21 ? 0 : 1];
    const review = await api(`/api/projects/${project}/reviews`, {
      title: 'Synthetic E2E review ' + i,
      description: 'Progress for browser test',
    });
    reviews.push({ id: review.id, project });
  }
  await logout();
  await login('teacher');
  for (const review of reviews)
    await api(`/api/projects/${review.project}/reviews/${review.id}/response`, {
      status: 'APPROVED',
      observation: 'Synthetic E2E teacher response',
    });
  await logout();
  await page.goto(origin);
  await page.getByLabel('Correo', { exact: true }).fill(accounts.student.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByTestId('session-user').waitFor();
  check('real password login and secure session', {
    httpOnlySecureCookies: (await context.cookies())
      .filter((c) => c.name.includes('session_token'))
      .every((c) => c.httpOnly && c.secure),
  });
  const tabTo = async (locator) => {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await locator.evaluate((e) => e === document.activeElement)) return;
    }
    throw Error('Keyboard target not reached');
  };
  await tabTo(page.getByRole('button', { name: 'Notificaciones', exact: true }));
  await page.keyboard.press('Enter');
  await page.getByRole('status').filter({ hasText: '20 notificaciones' }).waitFor();
  const before = await snapshot();
  const first = await (
    await context.request.get(origin + '/api/review-notifications?limit=20')
  ).json();
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  assert.equal(await page.getByRole('listitem').count(), 20);
  await page.screenshot({ path: join(evidence, 'desktop.png'), fullPage: true });
  const next = page.getByRole('button', { name: 'Siguiente', exact: true });
  await tabTo(next);
  assert.notEqual(await next.evaluate((e) => getComputedStyle(e).outlineStyle), 'none');
  const received = page.waitForResponse(
    (r) => r.url().includes('/api/review-notifications?') && r.url().includes('cursor='),
  );
  await page.keyboard.press('Enter');
  const secondResponse = await received;
  const second = await secondResponse.json();
  assert.equal(new URL(secondResponse.url()).searchParams.get('cursor'), first.nextCursor);
  await page.getByRole('status').filter({ hasText: '3 notificaciones' }).waitFor();
  assert.equal(await page.getByRole('listitem').count(), 3);
  assert.ok(second.items.every((item) => !first.items.some((old) => item.id === old.id)));
  assert.equal(await page.getByRole('button', { name: 'Siguiente', exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole('heading', { name: 'Notificaciones de revisión' })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  assert.deepEqual(await snapshot(), before);
  check('Tab Enter pagination, literal cursor, replacement and heading focus', {
    firstPage: 20,
    secondPage: 3,
    businessTablesUnchanged: true,
  });
  await tabTo(page.getByRole('button', { name: 'Actualizar notificaciones' }));
  await page.keyboard.press('Enter');
  await page.getByRole('status').filter({ hasText: '20 notificaciones' }).waitFor();
  await validate(data);
  await data.query(
    "UPDATE public.project_memberships SET status='removed',removed_at=now(),updated_at=now() WHERE project_id=$1 AND user_id=$2",
    [projects[0], accounts.student.id],
  );
  await tabTo(page.getByRole('button', { name: 'Siguiente', exact: true }));
  await page.keyboard.press('Enter');
  await page.getByRole('status').filter({ hasText: 'No hay notificaciones' }).waitFor();
  assert.equal(await page.getByText(projects[0], { exact: true }).count(), 0);
  check('membership withdrawal before next page excludes removed project');
  // Headless tab activation does not emit a window focus event in this environment.
  // Dispatch that event explicitly; session and inbox requests still use the real API.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('status').filter({ hasText: '2 notificaciones' }).waitFor();
  assert.equal(await page.getByText(projects[0], { exact: true }).count(), 0);
  assert.equal(await page.getByRole('listitem').count(), 2);
  check('DOM-dispatched window focus revalidates from first page using real API');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    assert.equal(
      await page
        .getByRole('region', { name: 'Notificaciones de revisión' })
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
      true,
    );
    await page.screenshot({ path: join(evidence, `mobile-${width}.png`), fullPage: true });
  }
  check('mobile has no horizontal overflow', { widths: [390, 320] });
  await page.getByTestId('logout').click();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).waitFor();
  assert.equal(await page.getByRole('listitem').count(), 0);
  await page.getByLabel('Correo', { exact: true }).fill(accounts.peer.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByTestId('session-user').waitFor();
  await page.getByRole('button', { name: 'Notificaciones', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'No hay notificaciones' }).waitFor();
  assert.equal(await page.getByRole('listitem').count(), 0);
  assert.equal(await page.getByText(projects[1], { exact: true }).count(), 0);
  check('UI logout and second account show no prior account notifications');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
  check('inbox is not persisted in localStorage');
  const manifest = JSON.parse(
    readFileSync(join(root, 'apps/api/migrations/manifest.json'), 'utf8'),
  );
  for (const version of [6, 7]) {
    const item = manifest.find((m) => m.version === version);
    assert.equal(
      createHash('sha256')
        .update(readFileSync(join(root, 'apps/api/migrations/sql', item.name)))
        .digest('hex'),
      item.sha256,
    );
  }
  check('migration 0006 and 0007 hashes preserved');
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (server)
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections();
    });
  if (data) await data.end();
  if (databaseCreated) {
    await validate(admin);
    await admin.query('DROP DATABASE ' + database + ' WITH (FORCE)');
  }
  for (const role of roles.reverse()) {
    await validate(admin);
    await admin.query('DROP ROLE ' + role);
  }
  await admin.end();
  writeFileSync(
    join(evidence, 'results.json'),
    JSON.stringify(
      {
        environment:
          'local real React + sessionFetch API + Better Auth + PostgreSQL; no HTTP mocks; no OAuth or remote Workers/Hyperdrive coverage',
        target,
        database,
        results,
        passed: !failure,
        failure: failure ? { name: failure.name, message: failure.message } : null,
        cleanedOwnDatabaseAndRoles: true,
      },
      null,
      2,
    ) + '\n',
  );
}
if (failure) process.exitCode = 1;
