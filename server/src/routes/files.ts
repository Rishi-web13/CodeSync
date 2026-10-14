import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, dbFail } from '../lib/supabase.js';
import { HttpError, parse } from '../lib/http.js';
import { requireMember } from '../lib/access.js';
import { isKnownLanguage, languageFromName } from '../lib/languages.js';
import { logActivity } from '../lib/activity.js';
import { broadcast } from '../realtime/hub.js';
import { dropDocs } from '../realtime/yjs.js';
import { fileDto } from './rooms.js';

const fileName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(64, 'Keep names under 64 characters')
  .refine((n) => !/[\\/:*?"<>|\0]/.test(n), 'Names cannot contain / \\ : * ? " < > |')
  .refine((n) => n !== '.' && n !== '..', 'Choose a different name');

const FILE_COLS = 'id, parent_id, kind, name, language, updated_at';

export async function fileRoutes(app: FastifyInstance) {
  app.post('/rooms/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { room } = await requireMember(id, req.user.id, { write: true });
    const body = parse(
      z.object({
        name: fileName,
        kind: z.enum(['file', 'folder']).default('file'),
        parentId: z.string().uuid().nullable().optional(),
        language: z.string().refine(isKnownLanguage).optional(),
      }),
      req.body,
    );
    if (body.parentId) {
      const { data: parent } = await db.from('room_files').select('kind').eq('id', body.parentId).eq('room_id', id).maybeSingle();
      if (!parent || parent.kind !== 'folder') throw new HttpError(400, 'The destination folder does not exist.');
    }
    const lang = body.kind === 'folder' ? 'plaintext' : body.language ?? languageFromName(body.name) ?? 'plaintext';
    const { data, error } = await db
      .from('room_files')
      .insert({ room_id: id, parent_id: body.parentId ?? null, kind: body.kind, name: body.name, language: lang })
      .select(FILE_COLS)
      .single();
    if (error) {
      if (error.code === '23505') throw new HttpError(409, `"${body.name}" already exists in this location.`);
      dbFail(error);
    }
    broadcast(id, { type: 'files:changed' });
    void logActivity(id, req.user.id, 'file_created', { fileName: body.name, kind: body.kind });
    void room;
    return reply.code(201).send({ file: fileDto(data!) });
  });

  app.patch('/rooms/:id/files/:fileId', async (req) => {
    const { id, fileId } = req.params as { id: string; fileId: string };
    await requireMember(id, req.user.id, { write: true });
    const body = parse(z.object({ name: fileName.optional(), language: z.string().refine(isKnownLanguage).optional() }), req.body);
    const { data: current } = await db.from('room_files').select('name, kind').eq('id', fileId).eq('room_id', id).maybeSingle();
    if (!current) throw new HttpError(404, 'That file no longer exists.');

    const patch: Record<string, string> = {};
    if (body.name && body.name !== current.name) {
      patch.name = body.name;
      if (current.kind === 'file' && !body.language) {
        const inferred = languageFromName(body.name);
        if (inferred) patch.language = inferred;
      }
    }
    if (body.language && current.kind === 'file') patch.language = body.language;
    if (Object.keys(patch).length) {
      const { error } = await db.from('room_files').update(patch).eq('id', fileId);
      if (error) {
        if (error.code === '23505') throw new HttpError(409, `"${body.name}" already exists in this location.`);
        dbFail(error);
      }
      if (patch.name) void logActivity(id, req.user.id, 'file_renamed', { from: current.name, fileName: patch.name });
      broadcast(id, { type: 'files:changed' });
    }
    return { ok: true };
  });

  app.delete('/rooms/:id/files/:fileId', async (req) => {
    const { id, fileId } = req.params as { id: string; fileId: string };
    await requireMember(id, req.user.id, { write: true });
    const { data: all } = await db.from('room_files').select('id, parent_id, name').eq('room_id', id);
    const target = all?.find((f) => f.id === fileId);
    if (!target) throw new HttpError(404, 'That file no longer exists.');
    // Collect descendants so their live documents can be dropped.
    const doomed = new Set([fileId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of all ?? []) if (f.parent_id && doomed.has(f.parent_id) && !doomed.has(f.id)) { doomed.add(f.id); grew = true; }
    }
    dropDocs(id, [...doomed]);
    const { error } = await db.from('room_files').delete().eq('id', fileId).eq('room_id', id);
    if (error) dbFail(error);
    broadcast(id, { type: 'files:changed' });
    broadcast(id, { type: 'annotations:changed' });
    void logActivity(id, req.user.id, 'file_deleted', { fileName: target.name });
    return { ok: true };
  });
}
