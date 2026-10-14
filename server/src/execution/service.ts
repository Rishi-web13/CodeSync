import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../lib/supabase.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http.js';
import { LANG_BY_ID } from '../lib/languages.js';
import { logActivity } from '../lib/activity.js';
import { getProfile } from '../lib/auth.js';
import { broadcast } from '../realtime/hub.js';
import { readText } from '../realtime/yjs.js';
import { runInDocker } from './docker.js';

interface FileRow {
  id: string;
  parent_id: string | null;
  kind: 'file' | 'folder';
  name: string;
  language: string;
  initial_content: string;
  ydoc_state: string | null;
}

interface Active {
  executionId: string;
  userId: string;
  stop: () => void;
  stoppedBy?: string;
}
const active = new Map<string, Active>(); // roomId → running execution

export const getActive = (roomId: string) => active.get(roomId);

function pathOf(file: FileRow, byId: Map<string, FileRow>): string {
  const parts = [file.name];
  let cur = file;
  for (let i = 0; i < 20 && cur.parent_id; i++) {
    const parent = byId.get(cur.parent_id);
    if (!parent) break;
    parts.unshift(parent.name);
    cur = parent;
  }
  return parts.join('/');
}

export async function startExecution(args: { roomId: string; fileId: string; userId: string; stdin: string }) {
  const { roomId, fileId, userId, stdin } = args;
  if (!env.exec.enabled) throw new HttpError(503, 'Code execution is disabled on this server.');
  if (active.has(roomId)) throw new HttpError(409, 'Something is already running in this room. Wait for it to finish or stop it.');

  const { data: files, error } = await db
    .from('room_files')
    .select('id, parent_id, kind, name, language, initial_content, ydoc_state')
    .eq('room_id', roomId);
  if (error) throw new Error(error.message);
  const all = (files ?? []) as FileRow[];
  const entry = all.find((f) => f.id === fileId && f.kind === 'file');
  if (!entry) throw new HttpError(404, 'That file no longer exists.');
  const spec = LANG_BY_ID.get(entry.language);
  if (!spec?.run) throw new HttpError(400, `${spec?.label ?? 'This language'} files can't be run. Pick a runnable language such as JavaScript or Python.`);

  const byId = new Map(all.map((f) => [f.id, f]));
  const entryPath = pathOf(entry, byId);

  // Reserve the slot before any await so two requests can't both start.
  const executionId = crypto.randomUUID();
  const slot: Active = { executionId, userId, stop: () => {} };
  active.set(roomId, slot);

  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), 'debugroom-'));
    await chmod(dir, 0o755);
    for (const f of all) {
      if (f.kind !== 'file') continue;
      const rel = pathOf(f, byId);
      const abs = path.resolve(dir, rel);
      if (!abs.startsWith(dir + path.sep)) continue; // never write outside the scratch dir
      await mkdir(path.dirname(abs), { recursive: true });
      await chmod(path.dirname(abs), 0o755);
      await writeFile(abs, readText(roomId, f), { mode: 0o644 });
    }

    const command = spec.run.cmd(`/work/${entryPath}`);
    const { error: insErr } = await db.from('executions').insert({
      id: executionId, room_id: roomId, file_id: entry.id, started_by: userId, language: entry.language, status: 'running', stdin: stdin.slice(0, 20_000),
    });
    if (insErr) throw new Error(insErr.message);

    const startedAt = new Date().toISOString();
    broadcast(roomId, {
      type: 'exec:start',
      execution: { id: executionId, startedBy: userId, fileId: entry.id, filePath: entryPath, language: entry.language, startedAt, command: command.join(' ') },
    });
    void logActivity(roomId, userId, 'run_started', { fileId: entry.id, fileName: entryPath });

    let stdout = '';
    let stderr = '';
    const run = runInDocker({
      name: `debugroom-${randomBytes(6).toString('hex')}`,
      image: spec.run.image,
      cmd: command,
      hostDir: dir,
      stdin,
      extraEnv: spec.run.env,
      onChunk: (stream, data) => {
        if (stream === 'stdout') stdout += data; else stderr += data;
        broadcast(roomId, { type: 'exec:chunk', id: executionId, stream, data, ts: Date.now() });
      },
    });
    slot.stop = run.stop;

    // Finish asynchronously; the HTTP request returns immediately.
    const scratch = dir;
    void run.done
      .then(async (result) => {
        let note: string | undefined;
        if (result.reason === 'timeout') note = `Stopped: exceeded the ${Math.round(env.exec.timeoutMs / 1000)}s time limit.`;
        else if (result.reason === 'stopped') {
          const who = slot.stoppedBy ? (await getProfile(slot.stoppedBy)).displayName : 'someone';
          note = `Stopped by ${who}.`;
        } else if (result.reason === 'output-limit') note = 'Stopped: output limit reached.';
        else if (result.exitCode === 125 && /No such image|Unable to find image/i.test(stderr)) {
          note = `The runtime image ${spec.run!.image} is not installed on the server. An admin needs to run scripts/pull-images.sh.`;
        } else if (result.exitCode === 137 && result.reason === 'exit') note = 'The program was killed (probably out of memory).';
        if (note) {
          stderr += (stderr && !stderr.endsWith('\n') ? '\n' : '') + note + '\n';
          broadcast(roomId, { type: 'exec:chunk', id: executionId, stream: 'stderr', data: note + '\n', ts: Date.now() });
        }
        const status = result.exitCode === 0 ? 'completed' : 'failed';
        await db
          .from('executions')
          .update({ status, exit_code: result.exitCode, duration_ms: result.durationMs, stdout, stderr })
          .eq('id', executionId);
        broadcast(roomId, { type: 'exec:end', id: executionId, status, exitCode: result.exitCode, durationMs: result.durationMs, note });
        void logActivity(roomId, userId, 'run_finished', { fileName: entryPath, status, exitCode: result.exitCode, durationMs: result.durationMs });
      })
      .catch((err) => {
        console.error('[exec] finish failed', err);
        broadcast(roomId, { type: 'exec:end', id: executionId, status: 'failed', exitCode: 1, durationMs: 0, note: 'Execution failed unexpectedly.' });
      })
      .finally(async () => {
        active.delete(roomId);
        await rm(scratch, { recursive: true, force: true }).catch(() => {});
      });

    return { executionId };
  } catch (err) {
    active.delete(roomId);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export function stopExecution(roomId: string, byUserId: string): boolean {
  const run = active.get(roomId);
  if (!run) return false;
  run.stoppedBy = byUserId;
  run.stop();
  return true;
}
