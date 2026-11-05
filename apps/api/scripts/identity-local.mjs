import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createConnection } from 'node:net';
import { setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { run } from '../migrations/runner.ts';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const dir = join(root, '.local-dev/identity-session');
const pgBin = 'C:/Program Files/PostgreSQL/18/bin';
const stateFile = join(dir, 'state.json');
export const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
export function pg(command) {
  const args = [command, '-D', join(dir, 'pgdata')];
  if (command === 'start') {
    const psq = (s) => "'" + s.replaceAll("'", "''") + "'";
    const cmd = `"${join(pgBin, 'pg_ctl.exe')}" start -D "${join(dir, 'pgdata')}" -l "${join(dir, 'postgres.log')}" -w -t 30`;
    const script = [
      `$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psq(cmd)} }`,
      'if ($res.ReturnValue -ne 0) { exit 1 }',
    ].join('\r\n');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      input: script,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 35000,
    });
    let attempts = 0;
    while (attempts < 20) {
      const st = spawnSync(join(pgBin, 'pg_ctl.exe'), ['status', '-D', join(dir, 'pgdata')], {
        windowsHide: true,
        stdio: 'ignore',
      });
      if (st.status === 0) return { status: 0 };
      spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 300']);
      attempts++;
    }
    return { status: r.status };
  }
  if (command === 'stop') args.push('-m', 'fast', '-w', '-t', '30');
  return spawnSync(join(pgBin, 'pg_ctl.exe'), args, {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 35000,
  });
}
export async function connect(config) {
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 55511);
  assert.ok(['postgres', 'is488_identity_local'].includes(config.database));
  const deadline = Date.now() + 15000;
  while (true) {
    try {
      const client = new Client({ ...config, connectionTimeoutMillis: 3000, query_timeout: 5000 });
      client.on('error', () => {});
      await client.connect();
      return client;
    } catch (err) {
      if (Date.now() >= deadline || !err?.message?.includes('starting up')) throw err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
export async function checkTarget(s) {
  assert.equal(resolve(s.data).toLowerCase(), resolve(dir, 'pgdata').toLowerCase());
  const admin = await connect(s.adminConfig);
  try {
    const actual = (
      await admin.query(
        "SELECT inet_server_port() AS port,current_setting('data_directory') AS directory",
      )
    ).rows[0];
    assert.equal(actual.port, 55511);
    assert.equal(resolve(actual.directory).toLowerCase(), resolve(s.data).toLowerCase());
  } finally {
    await admin.end();
  }
}
export async function initialize() {
  assert.equal(process.platform, 'win32');
  if (existsSync(stateFile)) {
    console.log('Identity environment already initialized; no mutations repeated.');
    return;
  }
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, 'target.json');
  if (existsSync(marker))
    throw Error('Preparation already attempted; inspect target and audit before recovery.');
  const data = join(dir, 'pgdata');
  writeFileSync(
    marker,
    JSON.stringify({
      scope: 'identity-session-synthetic',
      data,
      port: 55511,
      stage: 'initializing',
    }),
  );
  const s = {
    data,
    origin: 'https://localhost:8792',
    secret: randomBytes(48).toString('hex'),
    adminConfig: {
      host: '127.0.0.1',
      port: 55511,
      database: 'postgres',
      user: 'is488_identity_admin',
      password: randomBytes(32).toString('hex'),
    },
    migrationConfig: {},
    runtimeConfig: {},
  };
  s.migrationConfig = {
    ...s.adminConfig,
    database: 'is488_identity_local',
    user: 'is488_identity_migrator',
    password: randomBytes(32).toString('hex'),
  };
  s.runtimeConfig = {
    ...s.migrationConfig,
    user: 'is488_identity_runtime',
    password: randomBytes(32).toString('hex'),
  };
  writeFileSync(join(dir, 'bootstrap.json'), JSON.stringify(s));
  const passwordFile = join(dir, 'init-password.txt');
  writeFileSync(passwordFile, s.adminConfig.password + '\n');
  try {
    const init = spawnSync(
      join(pgBin, 'initdb.exe'),
      [
        '-D',
        data,
        '-U',
        s.adminConfig.user,
        '--auth-host=scram-sha-256',
        '--auth-local=scram-sha-256',
        '--encoding=UTF8',
        '--no-locale',
        '--pwfile=' + passwordFile,
      ],
      { windowsHide: true, stdio: 'ignore', timeout: 60000 },
    );
    assert.equal(init.status, 0, 'Exclusive cluster initialization');
  } finally {
    unlinkSync(passwordFile);
  }
  writeFileSync(
    join(data, 'postgresql.auto.conf'),
    "listen_addresses = '127.0.0.1'\nport = 55511\n",
  );
  assert.equal(pg('start').status, 0, 'Exclusive cluster start');
  await checkTarget(s);
  const admin = await connect(s.adminConfig);
  try {
    for (const cfg of [s.migrationConfig, s.runtimeConfig])
      await admin.query(
        `CREATE ROLE ${cfg.user} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${cfg.password}'`,
      );
    await admin.query('CREATE DATABASE is488_identity_local OWNER is488_identity_migrator');
    await admin.query(
      'REVOKE TEMPORARY ON DATABASE is488_identity_local FROM PUBLIC,is488_identity_runtime',
    );
    const result = await run('apply', {
      connection: s.migrationConfig,
      runtimeRole: s.runtimeConfig.user,
      auditFile: join(dir, 'migrations.jsonl'),
      directory: join(root, 'apps/api/migrations'),
    });
    assert.equal(result.transactionOutcome, 'committed');
    assert.deepEqual(result.applied, [1, 2, 3, 4, 5]);
    const url = new URL('postgresql://127.0.0.1:55511/is488_identity_local');
    url.username = s.runtimeConfig.user;
    url.password = s.runtimeConfig.password;
    writeFileSync(
      join(dir, '.dev.vars'),
      'DATABASE_URL=' + url.href + '\nAUTH_SECRET=' + s.secret + '\n',
    );
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      JSON.stringify(
        {
          name: 'is488-identity-local',
          main: '../../apps/api/src/index.ts',
          compatibility_date: '2024-09-23',
          compatibility_flags: ['nodejs_compat'],
          workers_dev: false,
          preview_urls: false,
          vars: {
            AUTH_MODE: 'session',
            NODE_ENV: 'development',
            AUTH_ORIGIN: s.origin,
            AUTH_MAIL_MODE: 'local',
          },
          assets: {
            directory: '../../apps/web/dist',
            binding: 'ASSETS',
            run_worker_first: true,
            not_found_handling: 'single-page-application',
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(stateFile, JSON.stringify(s, null, 2));
    writeFileSync(
      marker,
      JSON.stringify({
        scope: 'identity-session-synthetic',
        data,
        port: 55511,
        stage: 'initialized',
      }),
    );
    console.log(
      'Exclusive identity environment initialized; canonical migrations 0001-0005 committed. No accounts created implicitly.',
    );
  } finally {
    await admin.end();
    assert.equal(pg('stop').status, 0, 'Exclusive cluster stop');
  }
}
export async function provision(email, role, name, password) {
  assert.match(email, /^[^@\s]+@synthetic\.example\.test$/);
  assert.ok(['student', 'teacher', 'admin'].includes(role));
  assert.ok(name.length > 0 && name.length <= 100);
  assert.ok(password.length >= 12 && password.length <= 256);
  const s = state();
  await checkTarget(s);
  const client = await connect(s.migrationConfig);
  const userId = randomUUID();
  const hashed = await hashPassword(password);
  let stage = 'before-begin';
  try {
    await client.query('BEGIN');
    stage = 'preparation';
    await client.query(
      'INSERT INTO public.auth_user (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)',
      [userId, name, email.toLowerCase()],
    );
    await client.query(
      'INSERT INTO public.auth_account (id,"accountId","providerId","userId",password,"updatedAt") VALUES ($1,$2,\'credential\',$3,$4,now())',
      [randomUUID(), userId, userId, hashed],
    );
    await client.query(
      'INSERT INTO public.auth_role_grants (user_id,role,active,granted_by) VALUES ($1,$2,true,$3)',
      [userId, role, 'explicit-local-administrative-operator'],
    );
    stage = 'commit-dispatched';
    await client.query('COMMIT');
    stage = 'committed';
    return { userId, email: email.toLowerCase(), role };
  } catch (error) {
    if (stage === 'preparation') await client.query('ROLLBACK');
    throw new Error('Provisioning failed at ' + stage + '; no automatic retry', {
      cause: { type: error?.name, code: error?.code },
    });
  } finally {
    await client.end();
  }
}
async function hiddenPassword() {
  if (!process.stdin.isTTY) throw Error('Use an interactive terminal for hidden password entry.');
  process.stdout.write('Contraseña sintética (mínimo 12 caracteres): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolvePassword, reject) => {
    let value = '';
    function input(chunk) {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\r' || char === '\n') {
          process.stdin.off('data', input);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          if (char === '\u0003') reject(Error('Cancelled'));
          else resolvePassword(value);
          return;
        }
        if (char === '\b' || char === '\u007f') value = value.slice(0, -1);
        else if (value.length < 4096) value += char;
      }
    }
    process.stdin.on('data', input);
  });
}
export async function start() {
  const s = state();
  if (pg('status').status !== 0) assert.equal(pg('start').status, 0);
  await checkTarget(s);
  const key = join(dir, 'localhost-key.pem'),
    certificate = join(dir, 'localhost-cert.pem');
  if (!existsSync(certificate)) {
    const cert = spawnSync(
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
      { stdio: 'ignore', windowsHide: true },
    );
    assert.equal(cert.status, 0);
  }
  const logPath = join(dir, 'worker.log');
  const wranglerBin = join(root, 'node_modules/wrangler/bin/wrangler.js');
  const wranglerConfig = join(dir, 'wrangler.jsonc');
  const psq = (s) => "'" + s.replaceAll("'", "''") + "'";
  const cmd = [
    'cmd.exe /c',
    'set CI=true&&',
    'set WRANGLER_SEND_METRICS=false&&',
    `"${process.execPath}"`,
    `"${wranglerBin}" dev --local`,
    `--config "${wranglerConfig}"`,
    '--ip 127.0.0.1 --port 8792 --inspector-port 9292',
    '--local-protocol https',
    `--https-key-path "${key}"`,
    `--https-cert-path "${certificate}"`,
    '--show-interactive-dev-session=false',
    `< NUL >> "${logPath}" 2>&1`,
  ].join(' ');
  const psScript = [
    `$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psq(cmd)}; CurrentDirectory = ${psq(root)} }`,
    'if ($res.ReturnValue -ne 0) { exit 1 }',
    'Write-Output $res.ProcessId',
  ].join('\r\n');
  const launch = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    input: psScript,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  if (launch.status !== 0)
    throw new Error(
      'Worker launch failed: ' + (launch.stderr || launch.stdout || '').trim().slice(0, 300),
    );
  const workerPid = Number(launch.stdout.trim());
  assert.ok(Number.isInteger(workerPid) && workerPid > 0, 'Worker PID not obtained');
  writeFileSync(
    join(dir, 'running.json'),
    JSON.stringify({ pid: workerPid, scope: 'identity-session', origin: s.origin }),
  );
  // Wait up to 20 s for port 8792 to accept connections before announcing readiness.
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    function probe() {
      const socket = createConnection({ host: '127.0.0.1', port: 8792 }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() >= deadline)
          reject(
            new Error(
              'Worker did not listen on port 8792 within 20 s; check .local-dev/identity-session/worker.log',
            ),
          );
        else setTimeout(probe, 500);
      });
    }
    probe();
  });
  console.log('Worker ready. Local session environment: ' + s.origin);
}
export async function stop() {
  const running = join(dir, 'running.json');
  if (existsSync(running)) {
    const item = JSON.parse(readFileSync(running, 'utf8'));
    assert.equal(item.scope, 'identity-session');
    const query = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(item.pid)}").CommandLine`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (
      query.stdout.includes(join(root, 'node_modules/wrangler/bin/wrangler.js')) &&
      query.stdout.includes(join(dir, 'wrangler.jsonc'))
    )
      spawnSync('taskkill.exe', ['/PID', String(item.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    else if (query.stdout.trim())
      throw Error('Worker PID identity changed; refusing to terminate another process.');
    unlinkSync(running);
  }
  if (pg('status').status === 0) {
    await checkTarget(state());
    assert.equal(pg('stop').status, 0);
  }
  console.log('Exclusive identity environment stopped; data preserved.');
}
async function main() {
  const command = process.argv[2];
  if (command === 'init') return initialize();
  if (command === 'start') return start();
  if (command === 'stop') return stop();
  if (command === 'status') {
    const pgRunning = pg('status').status === 0;
    console.log('PostgreSQL: ' + (pgRunning ? 'running (port 55511)' : 'stopped'));
    // Probe port 8792 to check whether the Worker is listening.
    const workerOk = await new Promise((resolve) => {
      if (!existsSync(join(dir, 'running.json'))) {
        resolve(false);
        return;
      }
      const socket = createConnection({ host: '127.0.0.1', port: 8792 }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.setTimeout(1500, () => {
        socket.destroy();
        resolve(false);
      });
    });
    console.log(
      'Worker:     ' + (workerOk ? 'listening (port 8792)' : 'not responding on port 8792'),
    );
    return;
  }
  if (command === 'provision') {
    const args = process.argv.slice(3);
    const option = (key) => {
      const index = args.indexOf(key);
      return index < 0 ? undefined : args[index + 1];
    };
    const password = await hiddenPassword();
    console.log(
      await provision(
        option('--email'),
        option('--role'),
        option('--name') ?? 'Cuenta sintética',
        password,
      ),
    );
    return;
  }
  if (command === 'mail') {
    const s = state();
    await checkTarget(s);
    const client = await connect(s.migrationConfig);
    try {
      const rows = (await client.query('SELECT email,url FROM public.auth_local_mail ORDER BY id'))
        .rows;
      const escape = (value) =>
        value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
      const html =
        '<!doctype html><meta charset="utf-8"><title>Buzón sintético local</title><h1>Buzón sintético local</h1>' +
        rows
          .map(
            (row) =>
              '<p>' +
              escape(row.email) +
              ' <a href="' +
              escape(row.url) +
              '">Abrir confirmación de correo</a></p>',
          )
          .join('');
      writeFileSync(join(dir, 'mailbox.html'), html);
      console.log(
        'Buzón generado en .local-dev/identity-session/mailbox.html (sin imprimir enlaces ni tokens).',
      );
    } finally {
      await client.end();
    }
    return;
  }
  throw Error('Use init, start, stop, status, provision or mail.');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
  main().catch((error) => {
    console.error(
      JSON.stringify({ stage: 'identity-local', type: error.name, message: error.message }),
    );
    process.exitCode = 1;
  });
