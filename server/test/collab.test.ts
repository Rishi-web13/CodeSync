// Integration test for the Yjs layer: real WebSockets + the same y-websocket client the browser uses,
// with the database stubbed in memory. Run: npm test
process.env.SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const { db } = await import('../src/lib/supabase.js');
const yjs = await import('../src/realtime/yjs.js');

// ── in-memory room_files table ──
const row: any = { id: 'f1', kind: 'file', initial_content: 'hello', ydoc_state: null as string | null };
let saves = 0;
(db as any).from = (_t: string) => {
  const q: any = { filters: {} as any, patch: null as any };
  q.select = () => q;
  q.eq = (k: string, v: unknown) => ((q.filters[k] = v), q);
  q.maybeSingle = async () => ({ data: q.filters.id === row.id ? row : null });
  q.insert = () => q;
  q.single = async () => ({ data: null });
  q.update = (patch: any) => { q.patch = patch; return q; };
  q.then = (res: any) => { if (q.patch) { Object.assign(row, q.patch); saves++; } return Promise.resolve({ error: null }).then(res); };
  return q;
};

const wss = new WebSocketServer({ port: 0 });
const port = (wss.address() as any).port;
wss.on('connection', async (ws, req) => {
  const role = new URL(req.url!, 'http://x').searchParams.get('role') as any;
  const doc = await yjs.getDoc('r1', 'f1');
  yjs.acceptConnection(ws, doc!, { id: `u-${role}-${Math.random()}`, role });
});

const connect = (role: string) => {
  const doc = new Y.Doc();
  const p = new WebsocketProvider(`ws://localhost:${port}`, 'room', doc, { params: { role }, WebSocketPolyfill: WebSocket as any, disableBc: true });
  return { doc, p, text: doc.getText('content') };
};
const until = async (fn: () => boolean, label: string) => {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
  assert.fail(`timed out: ${label}`);
};

const a = connect('editor');
const b = connect('editor');
const v = connect('viewer');
await until(() => a.p.synced && b.p.synced && v.p.synced, 'initial sync');
assert.equal(a.text.toString(), 'hello', 'server seeds the file from initial_content');
console.log('✓ initial content seeded and synced to all clients');

// Concurrent edits at different positions must both survive.
a.text.insert(0, 'A:');
b.text.insert(b.text.length, ':B');
await until(() => a.text.toString() === b.text.toString() && a.text.toString().includes('A:') && a.text.toString().includes(':B'), 'concurrent merge');
assert.equal(a.text.toString(), 'A:hello:B');
await until(() => v.text.toString() === 'A:hello:B', 'viewer receives updates');
console.log('✓ simultaneous edits merge without overwriting; viewer sees them live');

// Viewer writes must be discarded by the server.
v.text.insert(0, 'HACK');
await new Promise((r) => setTimeout(r, 400));
assert.equal(a.text.toString(), 'A:hello:B');
assert.equal(b.text.toString(), 'A:hello:B');
console.log('✓ view-only client edits are rejected by the server');

// Awareness (cursors/presence) relays between clients but is never persisted.
a.p.awareness.setLocalStateField('user', { name: 'Ann', color: '#f00' });
await until(() => [...b.p.awareness.getStates().values()].some((s: any) => s.user?.name === 'Ann'), 'awareness relay');
console.log('✓ presence/cursor awareness relays between clients');

// Persistence is debounced and stores the merged state.
const persisted = () => {
  const d = new Y.Doc();
  Y.applyUpdate(d, new Uint8Array(Buffer.from(row.ydoc_state, 'base64')));
  return d.getText('content').toString();
};
await until(() => saves > 1 && persisted() === 'A:hello:B', 'debounced save of merged state');
console.log('✓ document state persisted (merged result, no viewer edits)');

// Reconnect: offline edits sync after the connection returns.
a.p.disconnect();
a.text.insert(0, '[offline]');
b.text.insert(b.text.length, '!');
a.p.connect();
await until(() => a.text.toString() === b.text.toString() && a.text.toString().includes('[offline]') && a.text.toString().endsWith('!'), 'reconnect merge');
console.log('✓ offline edits merge cleanly after reconnect');

for (const c of [a, b, v]) c.p.destroy();
await yjs.flushAll();
wss.close();
console.log('\nAll collaboration checks passed.');
process.exit(0);
