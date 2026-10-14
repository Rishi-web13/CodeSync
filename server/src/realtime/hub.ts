import type { WebSocket } from 'ws';

/**
 * JSON event channel (one socket per browser tab): presence, refresh hints, execution streaming.
 * Document edits and cursors do NOT travel here — they use the Yjs sockets in yjs.ts.
 */
interface RtClient {
  ws: WebSocket;
  userId: string;
}
const rooms = new Map<string, Set<RtClient>>();

export function broadcast(roomId: string, event: Record<string, unknown>) {
  const set = rooms.get(roomId);
  if (!set) return;
  const msg = JSON.stringify(event);
  for (const c of set) if (c.ws.readyState === 1) c.ws.send(msg);
}

export function sendToUser(roomId: string, userId: string, event: Record<string, unknown>) {
  const msg = JSON.stringify(event);
  for (const c of rooms.get(roomId) ?? []) if (c.userId === userId && c.ws.readyState === 1) c.ws.send(msg);
}

export function onlineUserIds(roomId: string): string[] {
  return [...new Set([...(rooms.get(roomId) ?? [])].map((c) => c.userId))];
}

/** Register a socket. Returns whether this user was newly online in the room. */
export function addClient(roomId: string, userId: string, ws: WebSocket): { firstConnection: boolean } {
  let set = rooms.get(roomId);
  if (!set) rooms.set(roomId, (set = new Set()));
  const firstConnection = ![...set].some((c) => c.userId === userId);
  const client = { ws, userId };
  set.add(client);
  ws.send(JSON.stringify({ type: 'presence', online: onlineUserIds(roomId) }));
  broadcast(roomId, { type: 'presence', online: onlineUserIds(roomId) });
  ws.on('close', () => {
    set!.delete(client);
    if (set!.size === 0) rooms.delete(roomId);
    broadcast(roomId, { type: 'presence', online: onlineUserIds(roomId) });
  });
  return { firstConnection };
}

export function disconnectUser(roomId: string, userId: string) {
  for (const c of [...(rooms.get(roomId) ?? [])]) if (c.userId === userId) c.ws.close(4403, 'removed');
}
