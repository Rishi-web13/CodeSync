import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, CheckCircle2, Copy, RotateCcw, ScanSearch, SendHorizonal, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api } from '@/lib/api';
import { assistantBridge, type AssistantCode } from '@/lib/assistantBridge';
import { cn, copyText } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/toast';

type Status = 'ok' | 'issues' | 'unknown';
interface Msg {
  role: 'user' | 'assistant'; content: string; error?: boolean;
  kind?: 'check'; auto?: boolean; status?: Status; file?: string;
  fix?: string;          // corrected file proposed by the AI
  checkedText?: string;  // the exact file text this check was about
  applied?: boolean;
}
type Phase = 'idle' | 'waiting' | 'checking' | 'paused';

const GENERAL_SUGGESTIONS = ['How do I invite someone to my room?', 'What can viewers do vs editors?', 'Why is my code not running?', 'Explain this error message'];
const ROOM_SUGGESTIONS = ['Why did my last run fail?', 'Explain what my code does', 'How can I make this code cleaner?'];
const AUTO_KEY = 'codesync:autocheck';
const AUTO_IDLE_MS = 4000;      // check this long after the last keystroke
const AUTO_MIN_GAP_MS = 10000;  // and never more often than this (keeps within the server's 60 checks / 10 min)

function parseReview(reply: string): { status: Status; body: string } {
  const m = reply.trim().match(/^\s*(NO_ERRORS|ERRORS_FOUND)\s*\n?([\s\S]*)$/);
  return m ? { status: m[1] === 'NO_ERRORS' ? 'ok' : 'issues', body: m[2].trim() } : { status: 'unknown', body: reply.trim() };
}
function lastCodeBlock(text: string): string | undefined {
  const all = [...text.matchAll(/```[\w+#-]*\n([\s\S]*?)```/g)];
  return all.length ? all[all.length - 1][1].replace(/\n$/, '') : undefined;
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-1.5">
      <button
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Copy code"
        onClick={async () => { if (await copyText(code)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="overflow-x-auto rounded-md border bg-subtle p-2.5 pr-8 font-mono text-[12px] leading-relaxed text-foreground"><code>{code}</code></pre>
    </div>
  );
}

/** Minimal, dependency-free renderer: ``` fenced blocks, `inline code` and **bold**. Everything else is plain text. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/```(?:[\w+#-]*)\n?([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <CodeBlock key={i} code={part.replace(/\n$/, '')} /> : (
          <Fragment key={i}>
            {part.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((seg, j) =>
              seg.startsWith('`') && seg.endsWith('`') && seg.length > 2 ? <code key={j} className="rounded bg-background/60 px-1 font-mono text-[12px]">{seg.slice(1, -1)}</code>
              : seg.startsWith('**') && seg.endsWith('**') && seg.length > 4 ? <strong key={j}>{seg.slice(2, -2)}</strong>
              : <Fragment key={j}>{seg}</Fragment>,
            )}
          </Fragment>
        ),
      )}
    </>
  );
}

export default function AssistantWidget() {
  const { pathname } = useLocation();
  const { toast } = useToast();
  const inRoom = pathname.startsWith('/room/');
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<'ok' | 'issues' | null>(null); // outcome of the latest check of the CURRENT code
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const [, setEditTick] = useState(0);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; } });
  const endRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const busyRef = useRef(false); busyRef.current = busy;
  const openRef = useRef(open); openRef.current = open;
  const autoRef = useRef(auto); autoRef.current = auto;
  const lastChecked = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const lastNotified = useRef<Status | null>(null);
  const checkRef = useRef<(isAuto: boolean, force?: boolean) => Promise<void>>(async () => {});

  // Show the START of a new reply (so "Line N / Before / After" is visible first); keep the spinner in view while waiting.
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (!busy && last?.role === 'assistant') lastRef.current?.scrollIntoView({ block: 'start' });
    else endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, busy, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener('codesync:open-assistant', openIt);
    return () => window.removeEventListener('codesync:open-assistant', openIt);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => { if (!inRoom) { clearTimeout(timerRef.current); setPhase('idle'); setResult(null); lastChecked.current = { key: '', at: 0 }; lastNotified.current = null; } }, [inRoom]);

  const schedule = useCallback((delay: number) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void checkRef.current(true), delay);
  }, []);

  /** Ask the AI to review the file that is open right now. `force` skips the "nothing changed / too soon" guards. */
  const checkCode = useCallback(async (isAuto: boolean, force = false) => {
    if (busyRef.current) { if (isAuto) schedule(2000); return; }
    const snap = assistantBridge.snapshot();
    if (!snap) {
      setPhase('idle');
      if (!isAuto) setMsgs((m) => [...m, { role: 'assistant', kind: 'check', status: 'unknown', content: 'Open a file in the editor first, then I can check it.' }]);
      return;
    }
    if (!snap.text.trim()) {
      setPhase('idle'); setResult(null);
      if (!isAuto) setMsgs((m) => [...m, { role: 'assistant', kind: 'check', status: 'unknown', file: snap.name, content: `${snap.name} is empty. Type some code and I'll check it.` }]);
      return;
    }
    const key = `${snap.name}\n${snap.language}\n${snap.text}`;
    if (isAuto && !force) {
      if (key === lastChecked.current.key) { setPhase('idle'); return; }
      const wait = AUTO_MIN_GAP_MS - (Date.now() - lastChecked.current.at);
      if (wait > 0) { setPhase('waiting'); schedule(wait + 100); return; }
    }
    lastChecked.current = { key, at: Date.now() };
    clearTimeout(timerRef.current);
    setBusy(true); setPhase('checking'); setResult(null);
    if (!isAuto) setMsgs((m) => [...m, { role: 'user', kind: 'check', content: `Check ${snap.name} for errors` }]);
    try {
      const { reply } = await api.post<{ reply: string }>('/assistant', {
        mode: 'review', context: 'The user is inside a collaborative coding room.', code: snap,
        messages: [{ role: 'user', content: `Check ${snap.name} for errors.` }],
      });
      const { status, body } = parseReview(reply);
      const changedSince = assistantBridge.getText?.() !== snap.text; // user kept typing while we were checking
      setPhase('idle');
      setResult(changedSince ? null : status === 'unknown' ? null : status);
      setMsgs((m) => [...m.filter((x) => !(x.kind === 'check' && x.auto)), { role: 'assistant', kind: 'check', auto: isAuto, status, file: snap.name, content: body, checkedText: snap.text, fix: status === 'issues' ? lastCodeBlock(body) : undefined }]);
      if (isAuto && !openRef.current && status !== 'unknown' && status !== lastNotified.current && !changedSince) {
        toast(status === 'ok' ? `No errors found in ${snap.name}` : `Errors found in ${snap.name}. Open Ask AI to see the fix.`, status === 'ok' ? 'success' : 'error');
      }
      if (status !== 'unknown') lastNotified.current = status;
      if (changedSince && autoRef.current) { setPhase('waiting'); schedule(AUTO_IDLE_MS); }
    } catch (e) {
      lastChecked.current.key = ''; // allow a retry on the next edit
      const limited = (e as { status?: number }).status === 429;
      setPhase(limited ? 'paused' : 'idle');
      if (!isAuto || !limited) setMsgs((m) => (isAuto ? m : [...m, { role: 'assistant', content: (e as Error).message, error: true }]));
    } finally {
      setBusy(false);
    }
  }, [schedule, toast]);
  checkRef.current = checkCode;

  // Any local edit makes the previous result stale; with auto-check on, check again once typing pauses.
  useEffect(() => {
    if (!inRoom) return;
    const off = assistantBridge.onEdit(() => {
      setEditTick((t) => t + 1);
      setResult(null);
      setConfirmIdx(null);
      if (autoRef.current) { setPhase((p) => (p === 'checking' ? p : 'waiting')); schedule(AUTO_IDLE_MS); }
    });
    return off;
  }, [inRoom, schedule]);

  const toggleAuto = () => setAuto((v) => {
    const n = !v;
    try { localStorage.setItem(AUTO_KEY, n ? 'on' : 'off'); } catch { /* ignore */ }
    if (!n) { clearTimeout(timerRef.current); setPhase((p) => (p === 'checking' ? p : 'idle')); }
    return n;
  });

  const ask = async (q: string) => {
    const content = q.trim();
    if (!content || busy) return;
    // Failed turns and check results are shown but not sent back as chat history.
    const history = [...msgs.filter((m) => !m.error && !m.kind), { role: 'user' as const, content }].slice(-16);
    setMsgs((m) => [...m, { role: 'user', content }]);
    setText('');
    setBusy(true);
    let code: AssistantCode | undefined;
    if (inRoom) { const s = assistantBridge.snapshot(); if (s && s.text.trim()) code = s; }
    try {
      const { reply } = await api.post<{ reply: string }>('/assistant', {
        messages: history.map(({ role, content }) => ({ role, content })),
        context: inRoom ? 'The user is inside a collaborative coding room.' : undefined,
        code,
      });
      setMsgs((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const doApply = (i: number, m: Msg) => {
    setConfirmIdx(null);
    // Never overwrite code that was typed after this check (yours or a teammate's): re-check instead.
    if (assistantBridge.getText?.() !== m.checkedText) { void checkCode(false, true); return; }
    if (assistantBridge.applyText?.(m.fix!)) {
      setMsgs((list) => list.map((x, j) => (j === i ? { ...x, fix: undefined, applied: true, auto: false } : x)));
      setResult(null);
      clearTimeout(timerRef.current);
      setTimeout(() => void checkCode(true, true), 600); // confirm the fixed file really is clean
    }
  };

  const suggestions = inRoom ? ROOM_SUGGESTIONS : GENERAL_SUGGESTIONS;
  const currentText = inRoom ? assistantBridge.getText?.() ?? null : null;
  const canEdit = assistantBridge.canEdit?.() ?? false;
  const badge: 'idle' | 'checking' | 'ok' | 'issues' = phase === 'checking' ? 'checking' : result ?? 'idle';

  const statusLine =
    phase === 'checking' ? 'Checking your code…'
    : phase === 'waiting' ? 'Will check when you stop typing…'
    : phase === 'paused' ? 'Paused: too many checks. Try again in a minute.'
    : result === 'ok' ? '✓ Your code has no errors'
    : result === 'issues' ? '⚠ Errors found. See below'
    : auto ? 'Auto-check is on' : 'Auto-check is off';

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="CodeSync assistant"
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl',
            'inset-x-3 bottom-20 h-[min(34rem,calc(100dvh-7rem))] sm:w-[23rem]',
            inRoom ? 'sm:inset-x-auto sm:right-4' : 'sm:inset-x-auto sm:right-5',
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b bg-subtle px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">CodeSync Assistant</p>
                <p className="text-[11px] text-muted-foreground">{inRoom ? 'Checks the file you have open' : 'Ask about CodeSync or your code'}</p>
              </div>
            </div>
            <div className="flex gap-0.5">
              {msgs.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setMsgs([]); setConfirmIdx(null); }} aria-label="New conversation" title="New conversation"><RotateCcw className="h-4 w-4" /></Button>}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close assistant"><X className="h-4 w-4" /></Button>
            </div>
          </header>

          {inRoom && (
            <div className="shrink-0 border-b px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void checkCode(false, true)}><ScanSearch className="h-4 w-4" />Check my code</Button>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Checks your open file a few seconds after you stop typing">
                  <input type="checkbox" checked={auto} onChange={toggleAuto} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
                  Auto-check while I type
                </label>
              </div>
              <p className={cn('mt-1.5 text-[11px]', result === 'ok' ? 'text-success' : result === 'issues' || phase === 'paused' ? 'text-warning' : 'text-muted-foreground')} role="status" data-testid="auto-status">{statusLine}</p>
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            {msgs.length === 0 && (
              <div>
                <p className="text-sm">{inRoom ? 'Type your code in the editor and I’ll check it for errors, explain them, and suggest a fix. If it’s fine, I’ll tell you.' : 'Hi! I can answer questions about using CodeSync and help with coding doubts. Paste code or an error and I’ll take a look.'}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => void ask(s)} className="rounded-md border bg-background px-2.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => {
              const stale = m.checkedText !== undefined && currentText !== null && currentText !== m.checkedText;
              return (
                <div key={i} ref={i === msgs.length - 1 ? lastRef : undefined} className={cn('flex', m.role === 'user' && 'justify-end')}>
                  <div className={cn(
                    'max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[13px] leading-relaxed',
                    m.role === 'user' ? 'bg-primary text-primary-foreground' : m.error ? 'border border-danger/30 bg-danger-soft text-danger' : 'bg-muted',
                    stale && 'opacity-70',
                  )}>
                    {m.kind === 'check' && m.role === 'assistant' && m.status && m.status !== 'unknown' && (
                      <p className={cn('mb-1.5 flex items-center gap-1.5 font-medium', m.status === 'ok' ? 'text-success' : 'text-warning')}>
                        {m.status === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                        {m.status === 'ok' ? `No errors found in ${m.file ?? 'your file'}` : `Errors found in ${m.file ?? 'your file'}`}
                        {m.auto && <span className="ml-auto text-[11px] font-normal text-muted-foreground">auto-check</span>}
                      </p>
                    )}
                    {m.role === 'assistant' && !m.error ? <Rich text={m.content} /> : m.content}

                    {m.applied && <p className="mt-2 flex items-center gap-1.5 font-medium text-success"><Check className="h-4 w-4" />Fix applied to {m.file ?? 'the file'}. Press Ctrl+Z in the editor to undo.</p>}
                    {m.fix && !m.applied && (
                      <div className="mt-2">
                        {stale ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">The file changed since this check.</span>
                            <Button size="sm" disabled={busy} onClick={() => void checkCode(false, true)}>Check again</Button>
                          </div>
                        ) : !canEdit ? (
                          <p className="text-xs text-muted-foreground">You have view-only access. Ask an editor to apply this fix.</p>
                        ) : confirmIdx === i ? (
                          <div className="rounded-md border bg-background p-2.5">
                            <p className="text-xs">Replace the whole of {m.file ?? 'this file'} with the fixed version? Everyone in the room will see the change.</p>
                            <div className="mt-2 flex gap-2">
                              <Button size="sm" variant="primary" onClick={() => doApply(i, m)}>Replace file</Button>
                              <Button size="sm" onClick={() => setConfirmIdx(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" variant="primary" onClick={() => setConfirmIdx(i)}>Apply fix to {m.file ?? 'file'}</Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> {inRoom && phase === 'checking' ? 'Checking your code…' : 'Thinking…'}</div>}
            <div ref={endRef} />
          </div>

          <div className="shrink-0 border-t p-2.5">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                rows={2}
                value={text}
                maxLength={6000}
                placeholder={inRoom ? 'Ask about your code…' : 'Ask a question…'}
                aria-label="Your question"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(text); } }}
              />
              <Button variant="primary" size="icon" className="h-9 w-9 shrink-0" disabled={!text.trim() || busy} onClick={() => void ask(text)} aria-label="Send question"><SendHorizonal className="h-4 w-4" /></Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{inRoom ? 'Your open file is sent to the AI to check it. AI can make mistakes.' : 'AI can make mistakes. Check important answers.'}</p>
          </div>
        </section>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        className={cn(
          'fixed right-4 z-50 flex h-12 items-center justify-center gap-2 rounded-md pl-3.5 pr-4 text-sm font-medium bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2',
          inRoom ? 'bottom-4 left-4 right-auto' : 'bottom-5 sm:right-5',
        )}
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}{open ? 'Close' : 'Ask AI'}
        {!open && inRoom && badge !== 'idle' && (
          <span
            className={cn('absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background', badge === 'ok' && 'bg-success', badge === 'issues' && 'bg-danger', badge === 'checking' && 'animate-pulse bg-muted-foreground')}
            role="status"
            aria-label={badge === 'ok' ? 'No errors found' : badge === 'issues' ? 'Errors found' : 'Checking code'}
          >
            {badge === 'ok' && <Check className="h-2.5 w-2.5 text-background" />}
          </span>
        )}
      </button>
    </>
  );
}
