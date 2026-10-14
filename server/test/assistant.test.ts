// The assistant route against a local fake of an OpenAI-compatible (xAI Grok) API.
import http from 'node:http';
import assert from 'node:assert/strict';
const seen: { auth?: string; body?: any }[] = [];
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
    if (req.url === '/v1/chat/completions' && JSON.parse(raw).model === 'busy-model') { res.statusCode = 429; res.end('{"error":"rate limit"}'); }
    else if (req.url === '/v1/chat/completions') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: ' Click **Invite** in the top bar. ' } }] })); }
    else { res.statusCode = 404; res.end('{}'); }
  });
});
await new Promise<void>((r) => fake.listen(0, r));
process.env.SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.GROQ_API_KEY = 'gsk_test_key';
process.env.AI_MODEL = 'busy-model';
process.env.AI_FALLBACK_MODEL = 'llama-test';
process.env.AI_BASE_URL = `http://localhost:${(fake.address() as any).port}/v1/`;

const Fastify = (await import('fastify')).default;
const { assistantRoutes } = await import('../src/routes/assistant.js');
const app = Fastify();
app.setErrorHandler((err: any, _q, reply) => reply.code(err.status ?? 500).send({ error: err.message }));
await app.register(assistantRoutes);
await app.listen({ port: 0 });
const url = `http://localhost:${(app.server.address() as any).port}/assistant`;
const post = (b: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

let r = await post({ messages: [{ role: 'user', content: 'How do I invite someone?' }] });
assert.equal(r.status, 200);
assert.equal((await r.json()).reply, 'Click **Invite** in the top bar.');
assert.equal(seen[0].auth, 'Bearer gsk_test_key');
assert.equal(seen[0].body.model, 'busy-model');
assert.equal(seen[1].body.model, 'llama-test', 'falls back to the second model when the first is rate-limited');
assert.equal(seen[1].body.messages[0].role, 'system');
assert.equal(seen[1].body.messages[1].content, 'How do I invite someone?');
console.log('✓ Groq-style key is used, a busy model falls back to the backup model, and the reply is parsed');

seen.length = 0;
r = await post({ mode: 'review', messages: [{ role: 'user', content: 'Check my code for errors.' }], code: { name: 'main.js', language: 'javascript', text: 'console.log(items.length)', output: 'ReferenceError: items is not defined' } });
assert.equal(r.status, 200);
const sent = seen[seen.length - 1].body;
assert.ok(sent.messages[0].content.includes('REVIEW MODE'), 'review rules are in the system prompt');
assert.ok(sent.messages[1].content.includes('console.log(items.length)'), "the user's real code is attached to the question");
assert.ok(sent.messages[1].content.includes('ReferenceError: items is not defined'), 'last run output is attached');
assert.equal(sent.max_tokens, 3000);
console.log('✓ review mode sends the real file and last run output to the AI');

assert.equal((await post({ messages: [{ role: 'assistant', content: 'hi' }] })).status, 400);
assert.equal((await post({ messages: [{ role: 'user', content: 'x' }], code: { name: 'a', language: 'js', text: 'x'.repeat(30_001) } })).status, 400);
assert.equal((await post({ messages: [] })).status, 400);
console.log('✓ bad requests are rejected');
for (let i = 0; i < 25; i++) r = await post({ messages: [{ role: 'user', content: 'q' }] });
assert.equal(r.status, 429);
console.log('✓ chat rate limit kicks in');
// Code checks have their own allowance: chat being throttled must not block them.
r = await post({ mode: 'review', messages: [{ role: 'user', content: 'Check it' }], code: { name: 'main.js', language: 'javascript', text: '1+1' } });
assert.equal(r.status, 200);
console.log('✓ code checks are not blocked by the chat limit');
console.log('All assistant checks passed.');
process.exit(0);
