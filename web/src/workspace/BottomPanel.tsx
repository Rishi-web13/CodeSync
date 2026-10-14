import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eraser, Keyboard, Loader2, Play, Square } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import { langOf } from '@/lib/languages';
import type { ExecState, FileNode } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseErrors } from './errors';

interface Props {
  exec: ExecState;
  files: FileNode[];
  activeFile: FileNode | null;
  starterName: string;
  runnerName: string;
  canRun: boolean;
  canStop: boolean;
  execEnabled: boolean;
  runBlockedReason: string | null;
  stdin: string;
  setStdin: (s: string) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  height: number;
  setHeight: (h: number) => void;
  maxHeight: number;
  tab: string;
  setTab: (t: string) => void;
  onRun: () => void;
  onStop: () => void;
  onClear: () => void;
  onJump: (fileId: string, line: number) => void;
}

const STATUS = {
  idle: { label: 'Idle', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  running: { label: 'Running', dot: 'bg-primary animate-pulse', text: 'text-primary' },
  completed: { label: 'Completed', dot: 'bg-success', text: 'text-success' },
  failed: { label: 'Failed', dot: 'bg-danger', text: 'text-danger' },
} as const;

export default function BottomPanel(p: Props) {
  const [showInput, setShowInput] = useState(false);
  const [now, setNow] = useState(Date.now());
  const running = p.exec.status === 'running';

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  // Surface errors automatically when a run fails; return to output when a new run starts.
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    if (p.exec.status === 'running' && p.exec.id !== lastId.current) { lastId.current = p.exec.id; p.setTab('output'); if (p.collapsed) p.setCollapsed(false); }
    if (p.exec.status === 'failed' && p.exec.stderr.trim()) p.setTab('errors');
  }, [p.exec.status, p.exec.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const errorLines = useMemo(() => (p.exec.stderr ? parseErrors(p.exec.stderr, p.files) : []), [p.exec.stderr, p.files]);
  const elapsed = running && p.exec.startedAt ? now - p.exec.startedAt : p.exec.durationMs;
  const st = STATUS[p.exec.status];
  const langLabel = p.activeFile ? langOf(p.activeFile.language).label : '';

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = p.height;
    const move = (ev: PointerEvent) => p.setHeight(Math.max(120, Math.min(p.maxHeight, startH + (startY - ev.clientY))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="flex shrink-0 flex-col border-t bg-background" style={{ height: p.collapsed ? 40 : p.height }} aria-label="Execution panel">
      {!p.collapsed && (
        <div role="separator" aria-orientation="horizontal" aria-label="Resize panel" tabIndex={0}
          className="-mt-1 h-2 shrink-0 cursor-row-resize hover:bg-primary/20 focus-visible:bg-primary/30"
          onPointerDown={drag}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') p.setHeight(Math.min(p.maxHeight, p.height + 24)); if (e.key === 'ArrowDown') p.setHeight(Math.max(120, p.height - 24)); }} />
      )}
      <Tabs value={p.tab} onValueChange={(t) => { p.setTab(t); if (p.collapsed) p.setCollapsed(false); }} className="flex min-h-0 flex-1 flex-col">
        <div className={cn('flex shrink-0 items-center gap-2 border-b pl-1.5 pr-2', p.collapsed ? 'h-10 border-b-0' : '-mt-1 h-10')}>
          <TabsList className="shrink-0">
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="errors">Errors{p.exec.status === 'failed' && p.exec.stderr.trim() && <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-label="Errors present" />}</TabsTrigger>
            <TabsTrigger value="console">Console</TabsTrigger>
          </TabsList>

          <div className="ml-1 flex min-w-0 items-center gap-2 text-xs" aria-live="polite">
            <span className={cn('inline-flex items-center gap-1.5 font-medium', st.text)}>
              <span className={cn('h-2 w-2 rounded-full', st.dot)} />{st.label}
            </span>
            {elapsed != null && p.exec.status !== 'idle' && <span className="hidden text-muted-foreground sm:inline">{formatDuration(Math.round(elapsed))}</span>}
            {p.exec.exitCode != null && !running && <span className="hidden text-muted-foreground sm:inline">exit {p.exec.exitCode}</span>}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setShowInput((v) => !v)} aria-pressed={showInput} className={cn(showInput && 'bg-muted text-foreground')} title="Standard input for the program">
              <Keyboard className="h-4 w-4" /><span className="hidden md:inline">Input</span>
            </Button>
            <Button size="icon" variant="ghost" onClick={p.onClear} aria-label="Clear output" title="Clear output"><Eraser className="h-4 w-4" /></Button>
            {running ? (
              <Button size="sm" variant="danger" disabled={!p.canStop} onClick={p.onStop} title={p.canStop ? 'Stop the running program' : 'Only the runner or room owner can stop a run'}>
                <Square className="h-3.5 w-3.5 fill-current" />Stop
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={!p.canRun || !!p.runBlockedReason} onClick={p.onRun} title={p.runBlockedReason ?? `Execute ${p.activeFile?.name ?? ''} (Ctrl/⌘+Enter)`}>
                <Play className="h-3.5 w-3.5 fill-current" />Execute{langLabel ? ` ${langLabel}` : ''}
              </Button>
            )}
            <Button size="icon" variant="ghost" onClick={() => p.setCollapsed(!p.collapsed)} aria-label={p.collapsed ? 'Expand panel' : 'Collapse panel'} title={p.collapsed ? 'Expand panel' : 'Collapse panel'}>
              {p.collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {!p.collapsed && (
          <div className="flex min-h-0 flex-1 flex-col">
            {showInput && (
              <div className="shrink-0 border-b bg-subtle p-2">
                <Textarea rows={2} value={p.stdin} onChange={(e) => setStdinSafe(e.target.value)} placeholder="Standard input — each line is sent to the program when it starts" className="font-mono text-xs" aria-label="Standard input" />
              </div>
            )}
            {p.runBlockedReason && p.exec.status === 'idle' && <p className="shrink-0 border-b bg-subtle px-3 py-1.5 text-xs text-muted-foreground">{p.runBlockedReason}</p>}
            <TabsContent value="output" className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12.5px] leading-5">
              {p.exec.status === 'idle' ? <Empty title="No output yet" body={`Click Execute to see the output here. Everyone in the room sees it live. ${p.runnerName} is the runner for this room.`} />
                : p.exec.stdout ? <pre className="whitespace-pre-wrap break-words">{p.exec.stdout}</pre>
                : running ? <span className="inline-flex items-center gap-2 font-sans text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Waiting for output…</span>
                : <span className="font-sans text-muted-foreground">The program finished without printing anything.</span>}
            </TabsContent>
            <TabsContent value="errors" className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12.5px] leading-5">
              {errorLines.length === 0 ? <Empty title={p.exec.status === 'idle' ? 'No errors' : 'No errors in the last run'} body="Compilation errors and runtime exceptions appear here with clickable line references." />
                : <div className="text-danger">{errorLines.map((segs, i) => (
                    <div key={i} className="whitespace-pre-wrap break-words">
                      {segs.map((s, j) => s.fileId ? (
                        <button key={j} onClick={() => p.onJump(s.fileId!, s.line!)} className="rounded-sm underline decoration-danger/40 underline-offset-2 hover:bg-danger-soft hover:decoration-danger" title="Go to line">{s.text}</button>
                      ) : <span key={j}>{s.text}</span>)}
                    </div>))}</div>}
            </TabsContent>
            <TabsContent value="console" className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12.5px] leading-5">
              {p.exec.logs.length === 0 ? <Empty title="Console is empty" body="A timeline of each run — start, output streams, and exit status — shows up here." />
                : p.exec.logs.map((l, i) => (
                  <div key={i} className="flex gap-3">
                    <time className="w-[4.5rem] shrink-0 select-none text-muted-foreground/70">{new Date(l.ts).toLocaleTimeString([], { hour12: false })}</time>
                    <span className={cn('w-12 shrink-0 select-none', l.kind === 'stderr' ? 'text-danger' : l.kind === 'system' ? 'text-primary' : 'text-muted-foreground')}>{l.kind}</span>
                    <pre className={cn('min-w-0 flex-1 whitespace-pre-wrap break-words', l.kind === 'stderr' && 'text-danger')}>{l.text.replace(/\n$/, '')}</pre>
                  </div>))}
            </TabsContent>
          </div>
        )}
      </Tabs>
    </section>
  );

  function setStdinSafe(v: string) { p.setStdin(v.slice(0, 20000)); }
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="font-sans">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 max-w-md text-[13px] text-muted-foreground">{body}</p>
    </div>
  );
}
