import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './lib/env.js';
import { authHook } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import { roomRoutes } from './routes/rooms.js';
import { fileRoutes } from './routes/files.js';
import { annotationRoutes } from './routes/annotations.js';
import { executionRoutes } from './routes/execution.js';
import { chatRoutes } from './routes/chat.js';
import { assistantRoutes } from './routes/assistant.js';
import { attachWebSockets } from './realtime/upgrade.js';
import { flushAll } from './realtime/yjs.js';
import { db } from './lib/supabase.js';

// Anything left "running" from a previous process can never finish; mark it failed.
await db.from('executions').update({ status: 'failed', stderr: 'Server restarted during execution.' }).eq('status', 'running');

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 1_000_000 });

await app.register(cors, { origin: env.webOrigins, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: 'Something went wrong on our side. Try again in a moment.' });
});

app.get('/health', async () => ({ ok: true }));
// Public (does its own light auth + rate limiting) so visitors on the landing page can ask questions too.
await app.register(assistantRoutes);
app.addHook('preHandler', authHook);
await app.register(roomRoutes);
await app.register(fileRoutes);
await app.register(annotationRoutes);
await app.register(executionRoutes);
await app.register(chatRoutes);

await app.listen({ port: env.port, host: '0.0.0.0' });
attachWebSockets(app.server);

const shutdown = async () => {
  app.log.info('Shutting down, saving documents…');
  await flushAll().catch(() => {});
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
