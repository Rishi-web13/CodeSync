import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { WebSocket } from 'ws';
import { db } from '../lib/supabase.js';
import { logActivity } from '../lib/activity.js';
import { broadcast } from './hub.js';
import type { Role } from '../lib/access.js';

/**
 * Server side of the Yjs sync protocol (compatible with y-websocket clients).
 * - The server is the persistence point: docs are loaded from room_files.ydoc_state,
 *   saved (debounced) as base64, and evicted when the last collaborator leaves.
 * - Awareness (cursors, selections, presence) is relayed but never stored.
 * - View-only members can receive updates but their document updates are discarded.
 */
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const SAVE_DEBOUNCE_MS = 1500;
const EDIT_LOG_EVERY_MS = 3 * 60_000;

interface ConnMeta {
  roomId: string;
  fileId: string;
  userId: string;
  role: Role;
  controlledIds: Set<number>;
}

class SharedDoc extends Y.Doc {
  conns = new Map<WebSocket, ConnMeta>();
  awareness: awarenessProtocol.Awareness;
  saveTimer: NodeJS.Timeout | null = null;
  saving: Promise<void> | null = null;
  dirty = false;
  constructor(public roomId: string, public fileId: string) {
    super({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.awareness.on('update', this.onAwareness);
    this.on('update', this.onUpdate);
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    for (const ws of this.conns.keys()) send(ws, msg);

    if (origin === 'seed') return; // seeding persists itself
    this.dirty = true;
    scheduleSave(this);
    const meta = origin && typeof origin === 'object' ? this.conns.get(origin as WebSocket) : undefined;
    if (meta) noteEdit(this.roomId, this.fileId, meta.userId);
  };

  private onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const meta = origin && typeof origin === 'object' ? this.conns.get(origin as WebSocket) : undefined;
    if (meta) {
      added.forEach((id) => meta.controlledIds.add(id));
      removed.forEach((id) => meta.controlledIds.delete(id));
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
    const msg = encoding.toUint8Array(enc);
    for (const ws of this.conns.keys()) send(ws, msg);
  };
}

const docs = new Map<string, SharedDoc>();
const loading = new Map<string, Promise<SharedDoc | null>>();
const key = (roomId: string, fileId: string) => `${roomId}:${fileId}`;

function send(ws: WebSocket, msg: Uint8Array) {
  if (ws.readyState !== 1) return;
  ws.send(msg, (err) => err && ws.close());
}

const lastEditLog = new Map<string, number>();
function noteEdit(roomId: string, fileId: string, userId: string) {
  const k = `${roomId}:${fileId}:${userId}`;
  const now = Date.now();
  if (now - (lastEditLog.get(k) ?? 0) < EDIT_LOG_EVERY_MS) return;
  lastEditLog.set(k, now);
  void (async () => {
    const { data } = await db.from('room_files').select('name').eq('id', fileId).maybeSingle();
    await logActivity(roomId, userId, 'edited', { fileId, fileName: data?.name ?? 'a file' });
  })();
}

const b64encode = (u: Uint8Array) => Buffer.from(u).toString('base64');
const b64decode = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

async function saveNow(doc: SharedDoc) {
  if (doc.saveTimer) clearTimeout(doc.saveTimer);
  doc.saveTimer = null;
  if (doc.saving) await doc.saving;
  if (!doc.dirty) return;
  doc.dirty = false;
  const state = b64encode(Y.encodeStateAsUpdate(doc));
  doc.saving = (async () => {
    const { error } = await db
      .from('room_files')
      .update({ ydoc_state: state, updated_at: new Date().toISOString() })
      .eq('id', doc.fileId);
    if (error) {
      doc.dirty = true;
      console.error('[yjs] save failed', error.message);
    } else {
      broadcast(doc.roomId, { type: 'doc:saved', fileId: doc.fileId, at: new Date().toISOString() });
    }
  })().finally(() => (doc.saving = null));
  await doc.saving;
}

function scheduleSave(doc: SharedDoc) {
  if (doc.saveTimer) return;
  doc.saveTimer = setTimeout(() => void saveNow(doc), SAVE_DEBOUNCE_MS);
}

/** Load (or create) the live document for a file. Returns null when the file does not exist in the room. */
export function getDoc(roomId: string, fileId: string): Promise<SharedDoc | null> {
  const k = key(roomId, fileId);
  const live = docs.get(k);
  if (live) return Promise.resolve(live);
  let p = loading.get(k);
  if (!p) {
    p = (async () => {
      const { data: file } = await db
        .from('room_files')
        .select('id, kind, initial_content, ydoc_state')
        .eq('id', fileId)
        .eq('room_id', roomId)
        .maybeSingle();
      if (!file || file.kind !== 'file') return null;
      const doc = new SharedDoc(roomId, fileId);
      if (file.ydoc_state) {
        Y.applyUpdate(doc, b64decode(file.ydoc_state), 'seed');
      } else {
        doc.transact(() => doc.getText('content').insert(0, file.initial_content ?? ''), 'seed');
        doc.dirty = true;
        await saveNow(doc); // persist the seed immediately so a restart never re-seeds with a new client id
      }
      docs.set(k, doc);
      return doc;
    })().finally(() => loading.delete(k));
    loading.set(k, p);
  }
  return p;
}

/** Current text of a file, from the live doc when present, otherwise from the database. */
export function readText(roomId: string, file: { id: string; initial_content: string; ydoc_state: string | null }): string {
  const live = docs.get(key(roomId, file.id));
  if (live) return live.getText('content').toString();
  if (file.ydoc_state) {
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, b64decode(file.ydoc_state));
    const text = tmp.getText('content').toString();
    tmp.destroy();
    return text;
  }
  return file.initial_content ?? '';
}

export function acceptConnection(ws: WebSocket, doc: SharedDoc, user: { id: string; role: Role }) {
  ws.binaryType = 'arraybuffer';
  const meta: ConnMeta = { roomId: doc.roomId, fileId: doc.fileId, userId: user.id, role: user.role, controlledIds: new Set() };
  doc.conns.set(ws, meta);

  ws.on('message', (raw: ArrayBuffer | Buffer) => {
    try {
      handleMessage(ws, doc, meta, new Uint8Array(raw as ArrayBuffer));
    } catch (err) {
      console.error('[yjs] bad message', err);
    }
  });
  ws.on('close', () => closeConn(doc, ws));
  ws.on('error', () => closeConn(doc, ws));

  // Initial handshake: our state vector, then the current awareness states.
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  send(ws, encoding.toUint8Array(enc));
  const states = doc.awareness.getStates();
  if (states.size > 0) {
    const aenc = encoding.createEncoder();
    encoding.writeVarUint(aenc, MSG_AWARENESS);
    encoding.writeVarUint8Array(aenc, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, [...states.keys()]));
    send(ws, encoding.toUint8Array(aenc));
  }
}

function handleMessage(ws: WebSocket, doc: SharedDoc, meta: ConnMeta, message: Uint8Array) {
  const decoder = decoding.createDecoder(message);
  const type = decoding.readVarUint(decoder);
  if (type === MSG_SYNC) {
    // View-only members may request state (step 1) but never write (step 2 / update).
    if (meta.role === 'viewer' && decoding.peekVarUint(decoder) !== syncProtocol.messageYjsSyncStep1) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.readSyncMessage(decoder, enc, doc, ws);
    if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc));
  } else if (type === MSG_AWARENESS) {
    awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), ws);
  }
}

function closeConn(doc: SharedDoc, ws: WebSocket) {
  const meta = doc.conns.get(ws);
  if (!meta) return;
  doc.conns.delete(ws);
  awarenessProtocol.removeAwarenessStates(doc.awareness, [...meta.controlledIds], null);
  try { ws.close(); } catch { /* already closed */ }
  if (doc.conns.size === 0) {
    void saveNow(doc).finally(() => {
      // Evict only if nobody reconnected while we were saving.
      if (doc.conns.size === 0 && docs.get(key(doc.roomId, doc.fileId)) === doc && !doc.dirty) {
        docs.delete(key(doc.roomId, doc.fileId));
        doc.destroy();
      }
    });
  }
}

/** Disconnect a user's document sockets (permission change or removal). Clients reconnect with their new role. */
export function closeUserConns(roomId: string, userId: string) {
  for (const doc of docs.values()) {
    if (doc.roomId !== roomId) continue;
    for (const [ws, meta] of [...doc.conns]) if (meta.userId === userId) ws.close(4403, 'permissions changed');
  }
}

/** Drop documents for deleted files without saving. */
export function dropDocs(roomId: string, fileIds: string[]) {
  for (const id of fileIds) {
    const doc = docs.get(key(roomId, id));
    if (!doc) continue;
    docs.delete(key(roomId, id));
    for (const ws of doc.conns.keys()) ws.close(4404, 'file deleted');
    if (doc.saveTimer) clearTimeout(doc.saveTimer);
    doc.dirty = false;
    doc.destroy();
  }
}

export function dropRoomDocs(roomId: string) {
  dropDocs(roomId, [...docs.values()].filter((d) => d.roomId === roomId).map((d) => d.fileId));
}

export async function flushAll() {
  await Promise.all([...docs.values()].map((d) => saveNow(d)));
}
