import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, dbFail } from '../lib/supabase.js';
import { env } from '../lib/env.js';
import { getProfile, getProfiles } from '../lib/auth.js';
import { HttpError, parse } from '../lib/http.js';
import { getRoom, requireMember, type RoomRow } from '../lib/access.js';
import { LANG_BY_ID, isKnownLanguage } from '../lib/languages.js';
import { logActivity } from '../lib/activity.js';
import { broadcast, disconnectUser, onlineUserIds, sendToUser } from '../realtime/hub.js';
import { closeUserConns, dropRoomDocs } from '../realtime/yjs.js';
import { getActive } from '../execution/service.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

export const roomDto = (r: RoomRow) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  defaultLanguage: r.default_language,
  ownerId: r.owner_id,
  runnerId: r.runner_id,
  createdAt: r.created_at,
});

export const fileDto = (f: { id: string; parent_id: string | null; kind: string; name: string; language: string; updated_at: string }) => ({
  id: f.id, parentId: f.parent_id, kind: f.kind, name: f.name, language: f.language, updatedAt: f.updated_at,
});

const language = z.string().refine(isKnownLanguage, 'Unknown language');
const roomName = z.string().trim().min(1, 'Enter a room name').max(80, 'Keep the name under 80 characters');

async function loadMembers(roomId: string) {
  const { data, error } = await db.from('room_members').select('user_id, role, joined_at').eq('room_id', roomId);
  if (error) dbFail(error);
  const profiles = await getProfiles((data ?? []).map((m) => m.user_id));
  return (data ?? []).map((m) => {
    const p = profiles.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      displayName: p?.displayName ?? 'Unknown',
      color: p?.color ?? '#6b7280',
      avatarUrl: p?.avatarUrl ?? null,
    };
  });
}

export async function roomRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const p = await getProfile(req.user.id);
    return { id: p.id, email: req.user.email, displayName: p.displayName, color: p.color, avatarUrl: p.avatarUrl };
  });

  app.get('/config', async () => ({
    execEnabled: env.exec.enabled,
    execTimeoutMs: env.exec.timeoutMs,
    languages: [...LANG_BY_ID.values()].map((l) => ({ id: l.id, label: l.label, ext: l.ext, runnable: !!l.run })),
  }));

  app.get('/rooms', async (req) => {
    const { data, error } = await db
      .from('room_members')
      .select('role, rooms(id, code, name, default_language, owner_id, runner_id, created_at)')
      .eq('user_id', req.user.id);
    if (error) dbFail(error);
    const rooms = (data ?? [])
      .map((m) => ({ role: m.role, room: m.rooms as unknown as RoomRow | null }))
      .filter((m): m is { role: string; room: RoomRow } => !!m.room)
      .sort((a, b) => b.room.created_at.localeCompare(a.room.created_at));
    return { rooms: rooms.map((m) => ({ ...roomDto(m.room), role: m.role })) };
  });

  app.post('/rooms', async (req, reply) => {
    const body = parse(z.object({ name: roomName, language }), req.body);
    const userId = req.user.id;

    let room: RoomRow | null = null;
    for (let i = 0; i < 5 && !room; i++) {
      const { data, error } = await db
        .from('rooms')
        .insert({ code: makeCode(), name: body.name, default_language: body.language, owner_id: userId, runner_id: userId })
        .select('*')
        .single();
      if (error && error.code !== '23505') dbFail(error);
      room = (data as RoomRow | null) ?? null;
    }
    if (!room) throw new Error('Could not generate a unique room code');

    const { error: mErr } = await db.from('room_members').insert({ room_id: room.id, user_id: userId, role: 'owner' });
    if (mErr) dbFail(mErr);

    const spec = LANG_BY_ID.get(body.language)!;
    const fileName = spec.id === 'java' ? 'Main.java' : `main.${spec.ext}`;
    const { error: fErr } = await db
      .from('room_files')
      .insert({ room_id: room.id, name: fileName, language: spec.id, initial_content: spec.starter });
    if (fErr) dbFail(fErr);

    void logActivity(room.id, userId, 'room_created', { name: room.name });
    return reply.code(201).send({ room: roomDto(room) });
  });

  app.post('/rooms/join', async (req) => {
    const { code } = parse(z.object({ code: z.string().trim().min(4, 'Enter a room code').max(64) }), req.body);
    const normalized = code.toUpperCase();
    const { data } = await db.from('rooms').select('*').eq('code', normalized).maybeSingle();
    const room = data as RoomRow | null;
    if (!room) throw new HttpError(404, "We couldn't find a room with that code. Check the link or code and try again.");

    const { data: existing } = await db.from('room_members').select('role').eq('room_id', room.id).eq('user_id', req.user.id).maybeSingle();
    if (!existing) {
      const { error } = await db.from('room_members').insert({ room_id: room.id, user_id: req.user.id, role: 'editor' });
      if (error) dbFail(error);
      broadcast(room.id, { type: 'members:changed' });
      void logActivity(room.id, req.user.id, 'member_joined');
    }
    return { room: roomDto(room) };
  });

  app.get('/rooms/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { room, role } = await requireMember(id, req.user.id);
    const [members, filesRes] = await Promise.all([
      loadMembers(id),
      db.from('room_files').select('id, parent_id, kind, name, language, updated_at').eq('room_id', id).order('name'),
    ]);
    if (filesRes.error) dbFail(filesRes.error);
    const run = getActive(id);
    return {
      room: roomDto(room),
      role,
      members,
      online: onlineUserIds(id),
      files: (filesRes.data ?? []).map(fileDto),
      execEnabled: env.exec.enabled,
      activeExecutionId: run?.executionId ?? null,
    };
  });

  app.patch('/rooms/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { room } = await requireMember(id, req.user.id, { owner: true });
    const body = parse(z.object({ name: roomName.optional(), defaultLanguage: language.optional() }), req.body);
    const patch: Record<string, string> = {};
    if (body.name) patch.name = body.name;
    if (body.defaultLanguage) patch.default_language = body.defaultLanguage;
    if (Object.keys(patch).length) {
      const { error } = await db.from('rooms').update(patch).eq('id', id);
      if (error) dbFail(error);
      if (body.name && body.name !== room.name) void logActivity(id, req.user.id, 'room_renamed', { name: body.name });
      broadcast(id, { type: 'room:updated' });
    }
    return { ok: true };
  });

  app.delete('/rooms/:id', async (req) => {
    const { id } = req.params as { id: string };
    await requireMember(id, req.user.id, { owner: true });
    dropRoomDocs(id);
    const { error } = await db.from('rooms').delete().eq('id', id);
    if (error) dbFail(error);
    broadcast(id, { type: 'room:deleted' });
    return { ok: true };
  });

  app.post('/rooms/:id/leave', async (req) => {
    const { id } = req.params as { id: string };
    const { room, role } = await requireMember(id, req.user.id);
    if (role === 'owner') throw new HttpError(400, "Owners can't leave their own room. Delete the room from settings instead.");
    await db.from('room_members').delete().eq('room_id', id).eq('user_id', req.user.id);
    if (room.runner_id === req.user.id) await db.from('rooms').update({ runner_id: room.owner_id }).eq('id', id);
    closeUserConns(id, req.user.id);
    disconnectUser(id, req.user.id);
    broadcast(id, { type: 'members:changed' });
    broadcast(id, { type: 'room:updated' });
    void logActivity(id, req.user.id, 'member_left');
    return { ok: true };
  });

  app.patch('/rooms/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { room } = await requireMember(id, req.user.id, { owner: true });
    const { role } = parse(z.object({ role: z.enum(['editor', 'viewer']) }), req.body);
    if (userId === room.owner_id) throw new HttpError(400, "The owner's role can't be changed.");
    const { data, error } = await db.from('room_members').update({ role }).eq('room_id', id).eq('user_id', userId).select('user_id');
    if (error) dbFail(error);
    if (!data?.length) throw new HttpError(404, 'That person is not in this room.');
    if (role === 'viewer' && room.runner_id === userId) await db.from('rooms').update({ runner_id: room.owner_id }).eq('id', id);
    closeUserConns(id, userId); // reconnect with the new permission level
    broadcast(id, { type: 'members:changed' });
    broadcast(id, { type: 'room:updated' });
    void logActivity(id, req.user.id, 'role_changed', { targetUserId: userId, role });
    return { ok: true };
  });

  app.delete('/rooms/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { room } = await requireMember(id, req.user.id, { owner: true });
    if (userId === room.owner_id) throw new HttpError(400, "The owner can't be removed.");
    await db.from('room_members').delete().eq('room_id', id).eq('user_id', userId);
    if (room.runner_id === userId) await db.from('rooms').update({ runner_id: room.owner_id }).eq('id', id);
    sendToUser(id, userId, { type: 'removed' });
    closeUserConns(id, userId);
    disconnectUser(id, userId);
    broadcast(id, { type: 'members:changed' });
    broadcast(id, { type: 'room:updated' });
    void logActivity(id, req.user.id, 'member_removed', { targetUserId: userId });
    return { ok: true };
  });

  app.post('/rooms/:id/runner', async (req) => {
    const { id } = req.params as { id: string };
    await requireMember(id, req.user.id, { owner: true });
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.body);
    const { data: m } = await db.from('room_members').select('role').eq('room_id', id).eq('user_id', userId).maybeSingle();
    if (!m) throw new HttpError(404, 'That person is not in this room.');
    if (m.role === 'viewer') throw new HttpError(400, 'View-only members cannot run code. Change their role to editor first.');
    const { error } = await db.from('rooms').update({ runner_id: userId }).eq('id', id);
    if (error) dbFail(error);
    broadcast(id, { type: 'room:updated' });
    void logActivity(id, req.user.id, 'runner_changed', { targetUserId: userId });
    return { ok: true };
  });

  app.get('/rooms/:id/activity', async (req) => {
    const { id } = req.params as { id: string };
    await requireMember(id, req.user.id);
    const { data, error } = await db
      .from('activity_events')
      .select('id, type, user_id, data, created_at')
      .eq('room_id', id)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) dbFail(error);
    return {
      events: (data ?? []).map((e) => ({ id: e.id, type: e.type, userId: e.user_id, data: e.data, createdAt: e.created_at })),
    };
  });
}

export { getRoom };
