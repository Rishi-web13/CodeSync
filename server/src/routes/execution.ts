import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, dbFail } from '../lib/supabase.js';
import { HttpError, parse } from '../lib/http.js';
import { requireMember } from '../lib/access.js';
import { startExecution, stopExecution } from '../execution/service.js';

export async function executionRoutes(app: FastifyInstance) {
  // Only the designated runner may start code. The owner can transfer this via POST /rooms/:id/runner.
  app.post('/rooms/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { room, role } = await requireMember(id, req.user.id, { write: true });
    if (room.runner_id !== req.user.id || role === 'viewer') {
      throw new HttpError(403, 'Only the designated runner can run code in this room. Ask the owner to transfer run access.');
    }
    const body = parse(z.object({ fileId: z.string().uuid(), stdin: z.string().max(20_000).default('') }), req.body);
    const { executionId } = await startExecution({ roomId: id, fileId: body.fileId, userId: req.user.id, stdin: body.stdin });
    return reply.code(202).send({ executionId });
  });

  app.post('/rooms/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    const { room, role } = await requireMember(id, req.user.id, { write: true });
    if (room.runner_id !== req.user.id && role !== 'owner') throw new HttpError(403, 'Only the runner or the room owner can stop a run.');
    return { stopped: stopExecution(id, req.user.id) };
  });

  app.get('/rooms/:id/executions', async (req) => {
    const { id } = req.params as { id: string };
    await requireMember(id, req.user.id);
    const { data, error } = await db
      .from('executions')
      .select('id, file_id, started_by, language, status, exit_code, duration_ms, stdout, stderr, created_at')
      .eq('room_id', id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) dbFail(error);
    return {
      executions: (data ?? []).map((e) => ({
        id: e.id, fileId: e.file_id, startedBy: e.started_by, language: e.language, status: e.status,
        exitCode: e.exit_code, durationMs: e.duration_ms, stdout: e.stdout, stderr: e.stderr, createdAt: e.created_at,
      })),
    };
  });
}
