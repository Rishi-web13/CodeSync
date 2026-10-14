// Integration test for room chat: real Fastify routes + real WebSockets, database stubbed in memory.
process.env.SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';

const { db } = await import('../src/lib/supabase.js');
const { chatRoutes } = await import('../src/routes/chat.js');
const { addClient } = await import('../src/realtime/hub.js');

const ROOM = '11111111-1111-1111-1111-111111111111';
const members: Record<string, string> = { alice: 'editor', bob: 'viewer' }; // carol is NOT a member
const messages: any[] = [];
(db as any).from = (table: string) => {
  const q: any = { f: {} as any, ins: null as any };
  q.select = () => q;
  q.eq = (k: string, v: unknown) => ((q.f[k] = v), q);
  q.order = () => q; q.limit = () => q; q.lt = () => q;
  q.maybeSingle = async () => {
    if (table === 'rooms') return { data: q.f.id === ROOM ? { id: ROOM, name: 'r' } : null };
    if (table === 'room_members') return { data: members[q.f.user_id] ? { role: members[q.f.user_id] } : null };
    return { data: null };
  };
  q.insert = (row: any) => { q.ins = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }; return q; };
  q.single = async () => { messages.push(q.ins); return { data: q.ins, error: null }; };
  q.then = (res: any) => Promise.resolve({ data: [...messages].reverse(), error: null }).then(res);
  return q;
};

const app = Fastify();
app.addHook('preHandler', async (req) => { (req as any).user = { id: String(req.headers['x-user']), email: null }; });
await app.register(chatRoutes);
await app.listen({ port: 0 });
const base = `http://localhost:${(app.server.address() as any).port}`;

const wss = new WebSocketServer({ port: 0 });
wss.on('connection', (ws, req) => addClient(ROOM, new URL(req.url!, 'http://x').searchParams.get('u')!, ws));
const wsPort = (wss.address() as any).port;
const listen = (u: string) => new Promise<{ got: any[] }>((resolve) => {
  const got: any[] = []; const ws = new WebSocket(`ws://localhost:${wsPort}/?u=${u}`);
  ws.on('message', (d) => got.push(JSON.parse(String(d)))); ws.on('open', () => resolve({ got }));
});
const bob = await listen('bob'); const alice = await listen('alice');
const call = (user: string, method: string, body?: unknown) => fetch(`${base}/rooms/${ROOM}/messages`, { method, headers: { 'x-user': user, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

let r = await call('alice', 'POST', { body: '  hello team  ' });
assert.equal(r.status, 201);
assert.equal((await r.json()).message.body, 'hello team');
await new Promise((x) => setTimeout(x, 200));
for (const c of [alice, bob]) assert.ok(c.got.some((e) => e.type === 'chat:message' && e.message.body === 'hello team'));
console.log('✓ message is saved and pushed live to every connected member');

r = await call('bob', 'POST', { body: 'viewer here' });
assert.equal(r.status, 201);
console.log('✓ view-only members can chat');

r = await call('alice', 'GET');
const list = (await r.json()).messages;
assert.equal(list.length, 2); assert.equal(list[0].body, 'hello team');
console.log('✓ history loads oldest-first');

assert.equal((await call('carol', 'POST', { body: 'let me in' })).status, 403);
assert.equal((await call('carol', 'GET')).status, 403);
console.log('✓ non-members cannot read or write chat');

assert.equal((await call('alice', 'POST', { body: '   ' })).status, 400);
assert.equal((await call('alice', 'POST', { body: 'x'.repeat(2001) })).status, 400);
console.log('✓ empty and oversized messages are rejected');
console.log('All chat checks passed.');
process.exit(0);
