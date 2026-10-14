import { db } from './supabase.js';
import { HttpError } from './http.js';

export type Role = 'owner' | 'editor' | 'viewer';

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  default_language: string;
  owner_id: string;
  runner_id: string | null;
  created_at: string;
}

export async function getRoom(roomId: string): Promise<RoomRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return null;
  const { data } = await db.from('rooms').select('*').eq('id', roomId).maybeSingle();
  return (data as RoomRow | null) ?? null;
}

export async function getRole(roomId: string, userId: string): Promise<Role | null> {
  const { data } = await db.from('room_members').select('role').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
  return (data?.role as Role | undefined) ?? null;
}

/** Load a room and require the user to be a member. 404 if the room is missing, 403 if access is denied. */
export async function requireMember(roomId: string, userId: string, opts: { write?: boolean; owner?: boolean } = {}) {
  const room = await getRoom(roomId);
  if (!room) throw new HttpError(404, 'This room does not exist.');
  const role = await getRole(roomId, userId);
  if (!role) throw new HttpError(403, "You don't have access to this room. Ask the owner for an invite link.");
  if (opts.owner && role !== 'owner') throw new HttpError(403, 'Only the room owner can do that.');
  if (opts.write && role === 'viewer') throw new HttpError(403, 'You have view-only access in this room.');
  return { room, role };
}
