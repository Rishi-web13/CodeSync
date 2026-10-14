import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Eye, WifiOff, X } from 'lucide-react';
import { api } from '@/lib/api';
import { langOf } from '@/lib/languages';
import { cn, copyText } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LangBadge } from '@/components/LangBadge';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { FullPageSpinner } from '@/components/ui/spinner';
import CodeEditor, { type WireStatus } from './CodeEditor';
import FileExplorer, { type Dlg } from './FileExplorer';
import { assistantBridge } from '@/lib/assistantBridge';
import InviteDialog from '@/components/InviteDialog';
import RightPanel, { type Composer } from './RightPanel';
import BottomPanel from './BottomPanel';
import TopBar from './TopBar';
import RoomSettings from './RoomSettings';
import { errorLinesFor } from './errors';
import { useRoomState } from './useRoomState';

const useIsDesktop = () => {
  const q = '(min-width: 1024px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
};

const useOffline = () => {
  const [off, setOff] = useState(!navigator.onLine);
  useEffect(() => {
    const a = () => setOff(false), b = () => setOff(true);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return off;
};

const load = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export default function Workspace() {
  const { roomId = '' } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const { toast } = useToast();
  const isDesktop = useIsDesktop();
  const offline = useOffline();
  const meId = me!.id;
  const rs = useRoomState(roomId, meId);
  const { data } = rs;

  // ── layout state ──
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 1024);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth >= 1280);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(() => Math.max(160, Math.min(380, Math.round(window.innerHeight * 0.3))));
  const [bottomTab, setBottomTab] = useState('output');
  const [rightTab, setRightTab] = useState('annotations');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [chatSeenAt, setChatSeenAt] = useState(() => Date.now());
  const chatVisible = rightOpen && rightTab === 'chat';
  const lastMsgAt = rs.messages.length ? new Date(rs.messages[rs.messages.length - 1].createdAt).getTime() : 0;
  useEffect(() => { if (chatVisible) setChatSeenAt(Math.max(Date.now(), lastMsgAt)); }, [chatVisible, lastMsgAt]);
  const unreadChat = chatVisible ? 0 : rs.messages.filter((m) => m.authorId !== meId && new Date(m.createdAt).getTime() > chatSeenAt).length;

  // ── editor state ──
  const storeKey = `debugroom:tabs:${roomId}`;
  const [openTabs, setOpenTabs] = useState<string[]>(() => load<{ tabs: string[] }>(storeKey, { tabs: [] }).tabs);
  const [activeId, setActiveId] = useState<string | null>(() => load<{ active?: string }>(storeKey, {}).active ?? null);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  const [wire, setWire] = useState<WireStatus>('connecting');
  const [cursorLine, setCursorLine] = useState(1);
  const [reveal, setReveal] = useState<{ fileId: string; line: number; nonce: number } | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [fileDialog, setFileDialog] = useState<Dlg>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'leave' | 'delete'>(null);
  const [stdin, setStdin] = useState('');

  const files = data?.files ?? [];
  const role = data?.role ?? 'viewer';
  const canEdit = role !== 'viewer';
  const room = data?.room;
  const activeFile = files.find((f) => f.id === activeId && f.kind === 'file') ?? null;

  useEffect(() => { document.title = room ? `${room.name} — CodeSync` : 'CodeSync'; return () => { document.title = 'CodeSync'; }; }, [room?.name]);

  // Initial tabs: restore, otherwise open the first file; drop tabs for files that no longer exist.
  useEffect(() => {
    if (!data) return;
    const valid = new Set(files.filter((f) => f.kind === 'file').map((f) => f.id));
    setOpenTabs((tabs) => {
      let next = tabs.filter((t) => valid.has(t));
      if (next.length === 0 && !load<{ tabs: string[] }>(storeKey, { tabs: [] }).tabs.length) {
        const first = files.find((f) => f.kind === 'file' && /^(main|index|app)\./i.test(f.name)) ?? files.find((f) => f.kind === 'file');
        if (first) next = [first.id];
      }
      return next.length === tabs.length && next.every((t, i) => t === tabs[i]) ? tabs : next;
    });
    setActiveId((a) => (a && valid.has(a) ? a : null));
  }, [data?.files]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setActiveId((a) => (a && openTabs.includes(a) ? a : openTabs[0] ?? null)); }, [openTabs]);
  useEffect(() => { if (data) save(storeKey, { tabs: openTabs, active: activeId }); }, [openTabs, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFile = useCallback((id: string) => {
    setOpenTabs((t) => (t.includes(id) ? t : [...t, id]));
    setActiveId(id);
    if (!isDesktop) setLeftOpen(false);
  }, [isDesktop]);

  const closeTab = (id: string) => {
    setOpenTabs((tabs) => {
      const i = tabs.indexOf(id);
      const next = tabs.filter((t) => t !== id);
      if (activeId === id) setActiveId(next[Math.min(i, next.length - 1)] ?? null);
      return next;
    });
  };

  const jump = useCallback((fileId: string, line: number) => {
    openFile(fileId);
    setReveal({ fileId, line, nonce: Date.now() });
    if (!isDesktop) setRightOpen(false);
  }, [openFile, isDesktop]);

  const showThread = useCallback((id: string) => {
    setFocus({ id, nonce: Date.now() });
    setRightTab('annotations');
    setRightOpen(true);
  }, []);

  // A thread I just created gets focus in my panel (others just see it appear).
  useEffect(() => {
    const f = rs.focusAnnotation;
    if (!f) return;
    const a = rs.annotations.find((x) => x.id === f.id);
    if (a && a.authorId === meId) showThread(a.id);
  }, [rs.focusAnnotation?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGutterLine = useCallback((fileId: string, line: number) => {
    const existing = rs.annotations.find((a) => a.fileId === fileId && a.line === line && !a.resolved) ?? rs.annotations.find((a) => a.fileId === fileId && a.line === line);
    if (existing) { setComposer(null); showThread(existing.id); }
    else { setComposer({ fileId, line }); setRightTab('annotations'); setRightOpen(true); }
  }, [rs.annotations, showThread]);

  // ── permissions & running ──
  const runner = data?.members.find((m) => m.userId === room?.runnerId);
  const runnerName = runner ? (runner.userId === meId ? 'You' : runner.displayName) : 'The room owner';
  const lang = activeFile ? langOf(activeFile.language) : null;
  const running = rs.exec.status === 'running';
  const runBlockedReason = !data ? 'Loading…'
    : !data.execEnabled ? 'Code execution is turned off on this server.'
    : role === 'viewer' ? 'You have view-only access in this room.'
    : room?.runnerId !== meId ? `Only ${runner?.displayName ?? 'the designated runner'} can run code. Ask the room owner to transfer run access.`
    : !activeFile ? 'Open a file to run it.'
    : !lang?.runnable ? `${lang?.label} files can’t be run here. Change the file’s language to a runnable one.`
    : null;
  const canStop = room?.runnerId === meId || role === 'owner';

  const run = useCallback(async () => {
    if (runBlockedReason || !activeFile || running) { if (runBlockedReason && !running) toast(runBlockedReason, 'error'); return; }
    try { await api.post(`/rooms/${roomId}/run`, { fileId: activeFile.id, stdin }); }
    catch (e) { toast((e as Error).message, 'error'); }
  }, [runBlockedReason, activeFile, running, roomId, stdin, toast]);
  const bridgeInfo = useRef({ file: null as { name: string; language: string } | null, output: '' });
  bridgeInfo.current = {
    file: activeFile ? { name: activeFile.name, language: activeFile.language } : null,
    output: [rs.exec.stdout, rs.exec.stderr].filter(Boolean).join('\n').trim() ? `${rs.exec.status} (exit ${rs.exec.exitCode ?? '-'})\n${rs.exec.stdout}${rs.exec.stderr ? `\n${rs.exec.stderr}` : ''}`.trim() : '',
  };
  useEffect(() => {
    assistantBridge.getFile = () => bridgeInfo.current.file;
    assistantBridge.getOutput = () => bridgeInfo.current.output;
    return () => { assistantBridge.getFile = null; assistantBridge.getOutput = null; };
  }, []);
  const runRef = useMemo(() => ({ current: run }), []); // eslint-disable-line react-hooks/exhaustive-deps
  runRef.current = run;
  const stop = async () => { try { await api.post(`/rooms/${roomId}/stop`); } catch (e) { toast((e as Error).message, 'error'); } };

  // ── shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); setLeftOpen((v) => !v); }
      if (e.key.toLowerCase() === 'j') { e.preventDefault(); setBottomCollapsed((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const inviteUrl = room ? `${window.location.origin}/join/${room.code}` : '';
  const copyInvite = async () => {
    if (await copyText(inviteUrl)) toast('Invite link copied', 'success');
    else window.prompt('Copy this invite link:', inviteUrl);
  };

  const errorLines = useMemo(() => (rs.exec.status === 'failed' && rs.exec.fileId === activeId ? errorLinesFor(rs.exec.stderr, files, activeId) : []), [rs.exec.status, rs.exec.stderr, rs.exec.fileId, activeId, files]);

  // ── fatal / loading ──
  if (rs.fatal) {
    return (
      <div className="flex min-h-full flex-col bg-subtle">
        <header className="flex h-14 items-center px-5"><Logo to="/app" /></header>
        <main className="flex flex-1 items-center justify-center px-4 pb-24">
          <div className="max-w-sm rounded-lg border bg-background p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">{rs.fatal.status === 404 ? 'Room not found' : 'No access to this room'}</h1>
            <p role="alert" className="mt-2 text-sm text-muted-foreground">{rs.fatal.message}</p>
            <Link to="/app"><Button className="mt-5">Back to your rooms</Button></Link>
          </div>
        </main>
      </div>
    );
  }
  if (!data || !room) return <FullPageSpinner label="Opening room…" />;

  const asideBase = 'flex-col bg-background';
  const asideCls = (open: boolean, side: 'l' | 'r') =>
    cn(asideBase, open ? 'flex' : 'hidden', isDesktop ? cn('relative shrink-0', side === 'l' ? 'w-60 border-r' : 'w-80 border-l') : cn('fixed bottom-0 top-14 z-40 w-[min(20rem,85vw)] shadow-lg', side === 'l' ? 'left-0 border-r' : 'right-0 border-l'));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar
        room={room} role={role} members={data.members} online={rs.online} meId={meId} conn={rs.conn} wire={wire} offline={offline} lastSaved={rs.lastSaved}
        activeFile={activeFile} canEdit={canEdit} leftOpen={leftOpen} rightOpen={rightOpen}
        onToggleLeft={() => { setLeftOpen((v) => !v); if (!isDesktop) setRightOpen(false); }}
        onToggleRight={() => { setRightOpen((v) => !v); if (!isDesktop) setLeftOpen(false); }}
        onLanguage={(language) => activeFile && api.patch(`/rooms/${roomId}/files/${activeFile.id}`, { language }).then(() => rs.reloadRoom()).catch((e) => toast((e as Error).message, 'error'))}
        onInvite={() => setInviteOpen(true)} onSettings={() => setSettingsOpen(true)} onLeave={() => setConfirm('leave')}
      />

      {(rs.conn !== 'live' || offline) && (
        <div className="flex items-center gap-2 border-b bg-warning/10 px-4 py-1.5 text-[13px]" role="status">
          <WifiOff className="h-4 w-4 shrink-0 text-warning" />
          <span>{offline ? 'You’re offline.' : rs.conn === 'connecting' ? 'Connecting to the room…' : 'Connection lost — reconnecting.'} Your edits stay in this tab and sync automatically when you’re back.</span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {!isDesktop && (leftOpen || rightOpen) && <div className="fixed inset-0 top-14 z-30 bg-black/60" onClick={() => { setLeftOpen(false); setRightOpen(false); }} aria-hidden />}

        <aside className={asideCls(leftOpen, 'l')} aria-label="File explorer">
          <FileExplorer roomId={roomId} files={files} activeId={activeId} canEdit={canEdit} dialog={fileDialog} setDialog={setFileDialog}
            onOpen={openFile} onCollapse={() => setLeftOpen(false)}
            onCreated={async (id) => { const d = await rs.reloadRoom(); if (d?.files.some((f) => f.id === id && f.kind === 'file')) openFile(id); }}
            onDeleted={(ids) => { setOpenTabs((t) => t.filter((x) => !ids.includes(x))); void rs.reloadRoom(); void rs.reloadAnnotations(); }} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-stretch border-b bg-subtle" role="tablist" aria-label="Open files">
            <div className="flex min-w-0 flex-1 overflow-x-auto">
              {openTabs.map((id) => {
                const f = files.find((x) => x.id === id);
                if (!f) return null;
                const active = id === activeId;
                return (
                  <div key={id} className={cn('group flex shrink-0 items-center gap-1.5 border-r pl-3 pr-1.5 text-[13px]', active ? 'border-t-2 border-t-primary bg-background' : 'border-t-2 border-t-transparent text-muted-foreground hover:bg-muted/60')}>
                    <button role="tab" aria-selected={active} className="flex items-center gap-1.5" onClick={() => setActiveId(id)}>
                      <LangBadge id={f.language} size={16} />
                      <span className={cn(active && 'font-medium text-foreground')}>{f.name}</span>
                      {unsynced.has(id) && <span className="h-2 w-2 rounded-full bg-warning" title="Unsynced changes — they’ll sync when you’re reconnected" aria-label="Unsynced changes" />}
                    </button>
                    <button className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => closeTab(id)} aria-label={`Close ${f.name}`}><X className="h-3.5 w-3.5" /></button>
                  </div>
                );
              })}
            </div>
            {!canEdit && <span className="flex shrink-0 items-center gap-1.5 border-l px-3 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" />View only</span>}
          </div>

          <CodeEditor
            roomId={roomId} me={{ id: meId, displayName: me!.displayName, color: me!.color }} files={files} openTabs={openTabs} activeId={activeId} canEdit={canEdit}
            annotations={rs.annotations} errorLines={errorLines} reveal={reveal}
            onGutterLine={onGutterLine} onAnnotationGlyph={showThread} onCursorLine={setCursorLine}
            onUnsynced={(id, v) => setUnsynced((s) => { const n = new Set(s); v ? n.add(id) : n.delete(id); return n; })}
            onWire={setWire} onRun={() => void runRef.current()} onNewFile={() => setFileDialog({ kind: 'create', type: 'file' })}
          />

          <BottomPanel
            exec={rs.exec} files={files} activeFile={activeFile} starterName="" runnerName={runnerName}
            canRun={!runBlockedReason} canStop={canStop} execEnabled={data.execEnabled} runBlockedReason={running ? null : runBlockedReason}
            stdin={stdin} setStdin={setStdin} collapsed={bottomCollapsed} setCollapsed={setBottomCollapsed}
            height={bottomHeight} setHeight={setBottomHeight} maxHeight={Math.round(window.innerHeight * 0.65)}
            tab={bottomTab} setTab={setBottomTab} onRun={() => void run()} onStop={() => void stop()} onClear={rs.clearOutput} onJump={jump}
          />
        </main>

        <aside className={asideCls(rightOpen, 'r')} aria-label="Collaboration">
          <RightPanel
            roomId={roomId} meId={meId} role={role} members={data.members} files={files} activeFileId={activeId} cursorLine={cursorLine}
            annotations={rs.annotations} authors={rs.authors} activity={rs.activity} messages={rs.messages} online={rs.online} unreadChat={unreadChat} onSentChat={rs.addMessage} composer={composer} setComposer={setComposer}
            focus={focus} tab={rightTab} setTab={setRightTab} onJump={jump} onCollapse={() => setRightOpen(false)}
          />
        </aside>
      </div>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} url={inviteUrl} code={room.code} roomName={room.name} />
      <RoomSettings
        open={settingsOpen} onClose={() => setSettingsOpen(false)} room={room} role={role} meId={meId} members={data.members} online={rs.online}
        inviteUrl={inviteUrl} onCopyInvite={copyInvite}
        onLeave={() => { setSettingsOpen(false); setConfirm('leave'); }} onDelete={() => { setSettingsOpen(false); setConfirm('delete'); }}
      />
      <ConfirmDialog open={confirm === 'leave'} title="Leave this room?" body="You’ll lose access until someone sends you the invite link again." confirmLabel="Leave room" danger onClose={() => setConfirm(null)}
        onConfirm={async () => { try { await api.post(`/rooms/${roomId}/leave`); nav('/app', { replace: true }); } catch (e) { toast((e as Error).message, 'error'); setConfirm(null); } }} />
      <ConfirmDialog open={confirm === 'delete'} title={`Delete “${room.name}”?`} body="This permanently deletes the room, all files, annotations, and run history for everyone. This can’t be undone." confirmLabel="Delete room" danger onClose={() => setConfirm(null)}
        onConfirm={async () => { try { await api.del(`/rooms/${roomId}`); nav('/app', { replace: true }); } catch (e) { toast((e as Error).message, 'error'); setConfirm(null); } }} />
    </div>
  );
}
