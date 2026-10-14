import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { env } from '../lib/env.js';
import { verifyToken } from '../lib/auth.js';
import { getRole, getRoom } from '../lib/access.js';
import { logActivity } from '../lib/activity.js';
import { acceptConnection, getDoc } from './yjs.js';
import { addClient } from './hub.js';

/**
 * WebSocket endpoints (the access token is passed as ?token=… because browsers cannot set WS headers):
 *   /yjs/:roomId/:fileId   Yjs sync + awareness for one file
 *   /rt/:roomId            JSON events for the room (presence, refresh hints, execution output)
 * Membership is validated on the server before any socket is accepted.
 */
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

function reject(socket: Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

const alive = new WeakSet<WebSocket>();
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) { ws.terminate(); continue; }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000).unref();

const lastOnlineLog = new Map<string, number>();

export function attachWebSockets(server: HttpServer) {
  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    try {
      const origin = req.headers.origin;
      if (origin && !env.webOrigins.includes(origin)) return reject(socket, 403, 'Forbidden');

      const url = new URL(req.url ?? '/', 'http://localhost');
      const [kind, roomId, fileId] = url.pathname.split('/').filter(Boolean);
      if ((kind !== 'yjs' || !fileId) && (kind !== 'rt' || !roomId)) return reject(socket, 404, 'Not Found');

      const user = await verifyToken(url.searchParams.get('token'));
      if (!user) return reject(socket, 401, 'Unauthorized');
      const room = await getRoom(roomId);
      if (!room) return reject(socket, 404, 'Not Found');
      const role = await getRole(roomId, user.id);
      if (!role) return reject(socket, 403, 'Forbidden');

      if (kind === 'yjs') {
        const doc = await getDoc(roomId, fileId);
        if (!doc) return reject(socket, 404, 'Not Found');
        wss.handleUpgrade(req, socket, head, (ws) => {
          alive.add(ws);
          ws.on('pong', () => alive.add(ws));
          acceptConnection(ws, doc, { id: user.id, role });
        });
      } else {
        wss.handleUpgrade(req, socket, head, (ws) => {
          alive.add(ws);
          ws.on('pong', () => alive.add(ws));
          const { firstConnection } = addClient(roomId, user.id, ws);
          const k = `${roomId}:${user.id}`;
          if (firstConnection && Date.now() - (lastOnlineLog.get(k) ?? 0) > 10 * 60_000) {
            lastOnlineLog.set(k, Date.now());
            void logActivity(roomId, user.id, 'online');
          }
        });
      }
    } catch (err) {
      console.error('[ws] upgrade failed', err);
      reject(socket, 500, 'Server Error');
    }
  });
}
