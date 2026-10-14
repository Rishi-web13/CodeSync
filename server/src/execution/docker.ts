import { spawn } from 'node:child_process';
import { env } from '../lib/env.js';

export interface DockerRun {
  name: string;
  image: string;
  cmd: string[];
  hostDir: string;
  stdin: string;
  extraEnv?: Record<string, string>;
  onChunk: (stream: 'stdout' | 'stderr', data: string) => void;
}
export interface DockerResult {
  exitCode: number;
  durationMs: number;
  reason: 'exit' | 'timeout' | 'stopped' | 'output-limit' | 'docker-unavailable';
}

/**
 * Run one program in a throw-away, locked-down container.
 *  --network none          no network access at all
 *  --read-only + tmpfs     root filesystem is immutable; only /tmp is writable (size-capped)
 *  -v dir:/work:ro         user code is mounted read-only
 *  --cap-drop ALL          no Linux capabilities
 *  no-new-privileges       setuid binaries cannot escalate
 *  --user 1000:1000        never root inside the container
 *  --memory/--cpus/--pids  resource ceilings (memory-swap == memory disables swap)
 *  --pull never            images are pre-pulled by an admin; nothing downloads at run time
 * Arguments are passed as an argv array — there is no shell on the host involved, so user code
 * can never inject host commands. The Docker socket is only ever touched by this server process.
 */
export function runInDocker(opts: DockerRun): { done: Promise<DockerResult>; stop: () => void } {
  const { memoryMb, cpus, pidsLimit, timeoutMs, maxOutputBytes } = env.exec;
  const args = [
    'run', '--rm', '-i', '--pull', 'never',
    '--name', opts.name,
    '--label', 'debugroom=1',
    '--network', 'none',
    '--memory', `${memoryMb}m`, '--memory-swap', `${memoryMb}m`,
    '--cpus', String(cpus),
    '--pids-limit', String(pidsLimit),
    '--ulimit', 'nofile=256:256',
    '--read-only',
    '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=128m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '1000:1000',
    '-v', `${opts.hostDir}:/work:ro`,
    '-w', '/work',
    '-e', 'HOME=/tmp',
    ...Object.entries(opts.extraEnv ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    opts.image,
    ...opts.cmd,
  ];

  const started = Date.now();
  let reason: DockerResult['reason'] = 'exit';
  let bytes = 0;
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  const kill = (why: DockerResult['reason']) => {
    if (reason === 'exit') reason = why;
    // Killing the container (not just the CLI) guarantees the program stops.
    spawn('docker', ['kill', opts.name], { stdio: 'ignore' }).on('error', () => {});
  };

  const handle = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
    if (bytes >= maxOutputBytes) return;
    let text = chunk.toString('utf8');
    bytes += chunk.length;
    if (bytes > maxOutputBytes) {
      text = text.slice(0, Math.max(0, text.length - (bytes - maxOutputBytes))) + `\n[output truncated at ${Math.round(maxOutputBytes / 1024)} KB]\n`;
      kill('output-limit');
    }
    opts.onChunk(stream, text);
  };
  child.stdout.on('data', handle('stdout'));
  child.stderr.on('data', handle('stderr'));

  child.stdin.on('error', () => {});
  child.stdin.end(opts.stdin);

  const timer = setTimeout(() => kill('timeout'), timeoutMs);

  const done = new Promise<DockerResult>((resolve) => {
    child.on('error', (err) => {
      clearTimeout(timer);
      opts.onChunk('stderr', `Code execution is unavailable on this server (${err.message}).\n`);
      resolve({ exitCode: 127, durationMs: Date.now() - started, reason: 'docker-unavailable' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 137, durationMs: Date.now() - started, reason });
    });
  });

  return { done, stop: () => kill('stopped') };
}
