import { createServer } from 'node:http';
import { createApp } from '../infrastructure/http/app.js';

const actors: Record<string, { userId: string; role: string }> = {
  student: { userId: '11111111-1111-4111-8111-111111111111', role: 'student' },
  peer: { userId: '22222222-2222-4222-8222-222222222222', role: 'student' },
  teacher: { userId: '33333333-3333-4333-8333-333333333333', role: 'teacher' },
  replacement: { userId: '44444444-4444-4444-8444-444444444444', role: 'teacher' },
  changed: { userId: '11111111-1111-4111-8111-111111111111', role: 'teacher' },
};
const app = createApp({
  nodeEnv: 'test',
  persistence: {
    mode: 'postgres',
    connection: {
      host: process.env.IS488_SQL_HOST,
      port: Number(process.env.IS488_SQL_PORT),
      database: process.env.IS488_NOTIFICATION_HTTP_DATABASE,
      user: process.env.IS488_NOTIFICATION_HTTP_USER,
    },
  },
  authentication: async (context, next) => {
    const actor = actors[context.req.header('Cookie')?.replace(/^test_session=/, '') ?? ''];
    if (actor) context.set('user', actor);
    await next();
  },
});
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const response = await app.fetch(
      new Request('http://127.0.0.1' + incoming.url, {
        method: incoming.method,
        headers,
        ...(['GET', 'HEAD'].includes(incoming.method ?? 'GET')
          ? {}
          : { body: Buffer.concat(chunks) }),
      }),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end();
  }
});
server.listen(0, '127.0.0.1', () => {
  process.send?.({ port: (server.address() as { port: number }).port, pid: process.pid });
});
process.on('message', (message) => {
  if (message === 'stop') {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  }
});
