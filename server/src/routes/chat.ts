import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, dbFail } from '../lib/supabase.js';
import { parse } from '../lib/http.js';
import { requireMember } from '../lib/access.js';
import { broadcast } from '../realtime/hub.js';

const body = z.string().trim().min(1, 'Write a message first').max(2000, 'Keep messages under 2000 characters');

const toDto = (m: any) => ({ id: m.id as string, authorId: (m.author_id as string | null) ?? null, body: m.body as string, createdAt: m.created_at as string });

// Light per-user throttle: 20 messages / 10 s.
const recent = new Map<string, number[]>();
function throttled(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 10_000);
  hits.push(now);
  recent.set(key, hits);
  return hits.length > 20;
}

export async function chatRoutes(app: FastifyInstance) {
  // Newest 100 messages (oldest first). Pass ?before=<ISO time> to page further back.
  app.get('/rooms/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    await requireMember(id, req.user.id);
    const { before } = req.query as { before?: string };
    let q = db.from('chat_messages').select('*').eq('room_id', id).order('created_at', { ascending: false }).limit(100);
    if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
    const { data, error } = await q;
    if (error) dbFail(error);
    return { messages: (data ?? []).reverse().map(toDto) };
  });

  // Every member (including viewers) can chat.
  app.post('/rooms/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    await requireMember(id, req.user.id);
    if (throttled(`${id}:${req.user.id}`)) return reply.code(429).send({ error: "You're sending messages too fast. Slow down a little." });
    const { body: text } = parse(z.object({ body }), req.body);
    const { data, error } = await db.from('chat_messages').insert({ room_id: id, author_id: req.user.id, body: text }).select('*').single();
    if (error) dbFail(error);
    const message = toDto(data);
    broadcast(id, { type: 'chat:message', message });
    return reply.code(201).send({ message });
  });
}
