import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, dbFail } from '../lib/supabase.js';
import { getProfiles } from '../lib/auth.js';
import { HttpError, parse } from '../lib/http.js';
import { requireMember } from '../lib/access.js';
import { logActivity } from '../lib/activity.js';
import { broadcast } from '../realtime/hub.js';

const text = z.string().trim().min(1, 'Write a comment first').max(2000, 'Keep comments under 2000 characters');

export async function annotationRoutes(app: FastifyInstance) {
  app.get('/rooms/:id/annotations', async (req) => {
    const { id } = req.params as { id: string };
    await requireMember(id, req.user.id);
    const { data: anns, error } = await db.from('annotations').select('*').eq('room_id', id).order('created_at');
    if (error) dbFail(error);
    const ids = (anns ?? []).map((a) => a.id);
    const { data: replies } = ids.length
      ? await db.from('annotation_replies').select('*').in('annotation_id', ids).order('created_at')
      : { data: [] as any[] };
    const people = await getProfiles([
      ...(anns ?? []).flatMap((a) => [a.author_id, a.resolved_by].filter(Boolean) as string[]),
      ...(replies ?? []).map((r) => r.author_id as string),
    ]);
    const authors: Record<string, { displayName: string; color: string; avatarUrl: string | null }> = {};
    for (const [pid, p] of people) authors[pid] = { displayName: p.displayName, color: p.color, avatarUrl: p.avatarUrl };
    return {
      authors,
      annotations: (anns ?? []).map((a) => ({
        id: a.id,
        fileId: a.file_id,
        line: a.line,
        authorId: a.author_id,
        body: a.body,
        resolved: a.resolved,
        resolvedBy: a.resolved_by,
        resolvedAt: a.resolved_at,
        createdAt: a.created_at,
        replies: (replies ?? [])
          .filter((r) => r.annotation_id === a.id)
          .map((r) => ({ id: r.id, authorId: r.author_id, body: r.body, createdAt: r.created_at })),
      })),
    };
  });

  app.post('/rooms/:id/annotations', async (req, reply) => {
    const { id } = req.params as { id: string };
    await requireMember(id, req.user.id); // viewers may comment
    const body = parse(z.object({ fileId: z.string().uuid(), line: z.number().int().min(1).max(1_000_000), body: text }), req.body);
    const { data: file } = await db.from('room_files').select('name, kind').eq('id', body.fileId).eq('room_id', id).maybeSingle();
    if (!file || file.kind !== 'file') throw new HttpError(404, 'That file no longer exists.');
    const { data, error } = await db
      .from('annotations')
      .insert({ room_id: id, file_id: body.fileId, line: body.line, author_id: req.user.id, body: body.body })
      .select('id')
      .single();
    if (error) dbFail(error);
    broadcast(id, { type: 'annotations:changed', focus: data!.id });
    void logActivity(id, req.user.id, 'annotation_created', { fileId: body.fileId, fileName: file.name, line: body.line, annotationId: data!.id });
    return reply.code(201).send({ id: data!.id });
  });

  app.post('/rooms/:id/annotations/:aid/replies', async (req, reply) => {
    const { id, aid } = req.params as { id: string; aid: string };
    await requireMember(id, req.user.id);
    const body = parse(z.object({ body: text }), req.body);
    const { data: ann } = await db.from('annotations').select('id').eq('id', aid).eq('room_id', id).maybeSingle();
    if (!ann) throw new HttpError(404, 'That thread no longer exists.');
    const { error } = await db.from('annotation_replies').insert({ annotation_id: aid, author_id: req.user.id, body: body.body });
    if (error) dbFail(error);
    broadcast(id, { type: 'annotations:changed' });
    return reply.code(201).send({ ok: true });
  });

  app.patch('/rooms/:id/annotations/:aid', async (req) => {
    const { id, aid } = req.params as { id: string; aid: string };
    await requireMember(id, req.user.id);
    const { resolved } = parse(z.object({ resolved: z.boolean() }), req.body);
    const { data: ann } = await db.from('annotations').select('id, line, file_id').eq('id', aid).eq('room_id', id).maybeSingle();
    if (!ann) throw new HttpError(404, 'That thread no longer exists.');
    const { error } = await db
      .from('annotations')
      .update({ resolved, resolved_by: resolved ? req.user.id : null, resolved_at: resolved ? new Date().toISOString() : null })
      .eq('id', aid);
    if (error) dbFail(error);
    broadcast(id, { type: 'annotations:changed' });
    void logActivity(id, req.user.id, resolved ? 'annotation_resolved' : 'annotation_reopened', { line: ann.line, fileId: ann.file_id, annotationId: aid });
    return { ok: true };
  });

  app.delete('/rooms/:id/annotations/:aid', async (req) => {
    const { id, aid } = req.params as { id: string; aid: string };
    const { role } = await requireMember(id, req.user.id);
    const { data: ann } = await db.from('annotations').select('author_id').eq('id', aid).eq('room_id', id).maybeSingle();
    if (!ann) throw new HttpError(404, 'That thread no longer exists.');
    if (ann.author_id !== req.user.id && role !== 'owner') throw new HttpError(403, 'Only the author or the room owner can delete a thread.');
    await db.from('annotations').delete().eq('id', aid);
    broadcast(id, { type: 'annotations:changed' });
    return { ok: true };
  });
}
