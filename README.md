# CodeSync

Real-time collaborative coding and debugging. Edit together, annotate lines, and run code in an isolated sandbox that everyone in the room can watch.

- **Frontend** – React, TypeScript, Vite, Tailwind, Radix/shadcn-style components, Lucide icons, Monaco Editor
- **Realtime** – Yjs (CRDT) over WebSockets; cursors, selections and presence via Yjs awareness
- **Backend** – Node.js + Fastify REST API and a WebSocket server (`ws`)
- **Data & auth** – Supabase (PostgreSQL + Supabase Auth, email/password and Google)
- **Execution** – one throw-away, locked-down Docker container per run

```
Browser ──REST (JWT)──────────────▶ Fastify API ──▶ Supabase Postgres
   │                                     │
   ├─WS /yjs/:room/:file (JWT) ─────────▶│  Yjs sync + awareness, debounced persistence
   ├─WS /rt/:room        (JWT) ─────────▶│  presence, "changed" hints, streamed run output
   │                                     └──▶ docker run … (no network, read-only, non-root)
   └─Supabase Auth (anon key) ─▶ Supabase
```

## Project layout

```
supabase/schema.sql      tables, indexes, RLS, profile trigger
server/src/
  index.ts               Fastify app, CORS, error handling, graceful shutdown
  routes/                rooms, files, annotations, execution
  realtime/yjs.ts        Yjs sync/awareness server, persistence, viewer enforcement
  realtime/hub.ts        JSON event channel (presence, refresh hints, exec streaming)
  realtime/upgrade.ts    WebSocket auth + membership checks
  execution/docker.ts    the sandbox (flags documented inline)
  execution/service.ts   run orchestration, one run per room, scratch dirs, streaming
  lib/                   env, auth, access control, language table
server/test/             integration test for the collaboration layer
web/src/
  pages/                 landing, auth, dashboard, join, docs, privacy
  workspace/             top bar, explorer, Monaco+Yjs editor, annotations, bottom panel, settings
scripts/pull-images.sh   pre-pull sandbox images
```

## Room chat and AI assistant

- **Room chat** – the *Chat* tab in the right-hand panel lets everyone in a room (owner, editors and viewers) message each other live. Messages are stored in `chat_messages` and pushed over the existing `/rt/:room` socket. Unread messages show a badge on the tab.
  - Existing projects: run the new "Room chat" block at the bottom of `supabase/schema.sql` in the Supabase SQL editor.
- **Execute** – the *Execute* button in the bottom panel runs the open file (Ctrl/⌘+Enter) and streams the output to everyone in the room. The language dropdown in the top bar changes the current file's language at any time.
- **AI assistant** – the round button at the bottom-right of every page opens a help bot. Inside a room it reads the file you have open: *Check my code* (or auto-check a few seconds after you stop typing) reports errors with line numbers and a corrected file you can apply, or says there are no errors. Outside a room it answers questions about CodeSync and general coding doubts. It calls `POST /assistant`, which proxies to an AI provider (Groq by default, which has a free tier; xAI Grok also works) so the key stays on the server (20 questions / 10 min per user or IP).
  - Set `GROQ_API_KEY=gsk_...` in `server/.env` (create one at console.groq.com/keys). Optional: `AI_MODEL` and `AI_FALLBACK_MODEL` (used automatically when the main model is busy or rate-limited). An xAI key (`xai-...`) works too; the provider is detected from the key. Without a key the widget explains that the assistant is not set up.

## Setup

Requirements: Node 20+ (22 recommended), a Supabase project, and Docker on the machine that runs the server (only needed for code execution).

### 1. Supabase

1. Create a project at supabase.com.
2. Open **SQL editor** and run `supabase/schema.sql`.
3. **Authentication → Providers**: email is on by default. To enable Google, add your Google OAuth client ID/secret.
4. **Authentication → URL configuration**: set *Site URL* to your web origin (`http://localhost:5173` for dev) and add `http://localhost:5173/**` to the redirect URLs. For quick local testing you can turn off *Confirm email*.
5. **Project settings → API**: copy the project URL, the `anon` key (browser) and the `service_role` key (server only).

### 2. Environment variables

`server/.env` (copy from `server/.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API + WebSocket port |
| `WEB_ORIGIN` | `http://localhost:5173` | Allowed browser origin(s), comma-separated. Used for CORS **and** WebSocket origin checks |
| `SUPABASE_URL` | – | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | – | **Secret.** Server only. Bypasses RLS, so all authorization happens in the server |
| `EXEC_ENABLED` | `true` | `false` disables running code |
| `EXEC_TIMEOUT_MS` | `10000` | Wall-clock limit per run (compile + run) |
| `EXEC_MEMORY_MB` | `256` | Container memory limit (swap disabled) |
| `EXEC_CPUS` | `0.5` | Container CPU limit |
| `EXEC_PIDS_LIMIT` | `128` | Max processes (fork-bomb guard) |
| `EXEC_MAX_OUTPUT_BYTES` | `65536` | Output cap; the run is killed when exceeded |

`web/.env` (copy from `web/.env.example`) — these are public values

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_API_URL` | CodeSync server URL, e.g. `http://localhost:4000` |
| `VITE_GITHUB_URL` | Optional: footer GitHub link |

### 3. Run it

```bash
npm run install:all
npm run pull-images     # one-time; sandbox containers run with --pull never and no network
npm run dev:server      # terminal 1  → http://localhost:4000
npm run dev:web         # terminal 2  → http://localhost:5173
```

Sign up, create a room, copy the invite link, and open it in a second browser profile (or another account) to see live collaboration.

### 4. Tests and checks

```bash
npm test             # Yjs collaboration integration test (merge, viewer rejection, persistence, reconnect)
npm run typecheck    # server + web
npm run build
```

## How the pieces behave

**Rooms & roles.** Rooms are private: a user must be a member. Joining happens through the invite link (`/join/<code>`) or the code. Roles: `owner`, `editor`, `viewer`. Viewers can read, comment and see output, but their document updates are discarded by the server (not just disabled in the UI).

**Execution permission.** Only the room's *runner* can start a run (the owner by default). The owner can transfer it in **Room settings** to any non-viewer. The runner or owner can stop a run. One run per room at a time.

**Persistence.** File text is stored as a Yjs update (`room_files.ydoc_state`, base64), saved ~1.5 s after the last edit and when the last collaborator leaves. Annotations, replies, activity, membership and run history are ordinary rows. Cursors and presence are never stored.

**Reconnects.** Yjs clients buffer edits while offline and merge on reconnect; a dot on the tab marks files with edits that haven't reached the server. The event socket refetches everything after a reconnect, so missed events can't leave the UI stale.

## Sandbox security model

Every run is `docker run` with (see `server/src/execution/docker.ts`):

- `--network none` – no network
- `--read-only` root filesystem, `/tmp` as a size-capped tmpfs; user code mounted read-only at `/work`
- `--user 1000:1000`, `--cap-drop ALL`, `--security-opt no-new-privileges`
- `--memory` = `--memory-swap` (no swap), `--cpus`, `--pids-limit`, `--ulimit nofile`
- wall-clock timeout that `docker kill`s the container, plus an output size cap
- arguments passed as an argv array (no host shell), random container names, scratch dir deleted afterwards
- the Docker socket is only touched by the server process and is never exposed to the browser

**Deployment guidance.** The API server must be able to run `docker`. Anyone who can talk to the Docker daemon effectively has root on that host, so: run the server on a dedicated VM (not on a machine holding other secrets), run it as a non-root user in the `docker` group (or use rootless Docker / gVisor / Firecracker for stronger isolation), and **don't** run the API in a container with the host's Docker socket mounted. For larger deployments, split `server/src/execution/` into its own service on a separate runner host and call it from the API.

## Deploying

- **Web** – any static host (Vercel, Netlify, Cloudflare Pages). Build: `npm run build --prefix web`, output `web/dist`. SPA rewrites are included (`vercel.json`, `_redirects`). Set the `VITE_*` variables at build time.
- **Server** – a VM or container host with Docker: `npm run build --prefix server && npm start --prefix server` (Node 22: `node --env-file=.env dist/index.js`). Put it behind TLS (WebSockets must be proxied with `Upgrade` headers) and set `WEB_ORIGIN` to your web origin.
- Run `scripts/pull-images.sh` on the server host. Rooms with `typescript` files need Node ≥ 22.6 images (included).

## Languages

Runnable: JavaScript, TypeScript (Node type-stripping — no enums/namespaces), Python, Java (single-file source launcher), C, C++, Go, Ruby. Editable but not runnable: Rust, PHP, SQL, Shell, HTML, CSS, JSON, YAML, Markdown, plain text. Add runtimes in `server/src/lib/languages.ts` (and mirror the badge in `web/src/lib/languages.ts`).

## Known limitations

- Annotations are anchored to a **line number**. If someone inserts or deletes lines above, a thread can point at a neighbouring line. Anchoring to a Yjs relative position would fix this.
- Collaborator names/colours in cursors come from the client's awareness state, so they're display hints, not a security boundary (server-side membership and roles are authoritative).
- WebSocket access tokens travel in the query string (browsers can't set WS headers); keep proxy access logs private or strip query strings.
- Light theme only. Editor undo is Monaco's model undo, which can revert remote edits when you undo.
- The landing page's product preview is a static illustration, not live data.
