import { db } from './supabase.js';
import { broadcast } from '../realtime/hub.js';

export type ActivityType =
  | 'room_created' | 'member_joined' | 'member_left' | 'member_removed' | 'online'
  | 'file_created' | 'file_deleted' | 'file_renamed' | 'edited'
  | 'annotation_created' | 'annotation_resolved' | 'annotation_reopened'
  | 'run_started' | 'run_finished' | 'runner_changed' | 'role_changed' | 'room_renamed';

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  userId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

/** Persist an activity event and push it to everyone in the room. Never throws. */
export async function logActivity(roomId: string, userId: string | null, type: ActivityType, data: Record<string, unknown> = {}) {
  try {
    const { data: row } = await db
      .from('activity_events')
      .insert({ room_id: roomId, user_id: userId, type, data })
      .select('id, type, user_id, data, created_at')
      .single();
    if (!row) return;
    const event: ActivityEvent = { id: row.id, type: row.type, userId: row.user_id, data: row.data, createdAt: row.created_at };
    broadcast(roomId, { type: 'activity', event });
  } catch (err) {
    console.error('[activity]', err);
  }
}
