import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, MessageSquarePlus, PanelRightClose, RotateCcw, Trash2, CornerDownRight } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo, cn, formatDuration } from '@/lib/utils';
import type { ActivityEvent, Annotation, ChatMessage, FileNode, Member, Person, Role } from '@/lib/types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/toast';
import ChatPanel from './ChatPanel';

export interface Composer { fileId: string; line: number }

interface Props {
  roomId: string;
  meId: string;
  role: Role;
  members: Member[];
  files: FileNode[];
  activeFileId: string | null;
  cursorLine: number;
  annotations: Annotation[];
  authors: Record<string, Person>;
  activity: ActivityEvent[];
  messages: ChatMessage[];
  online: Set<string>;
  unreadChat: number;
  onSentChat: (m: ChatMessage) => void;
  composer: Composer | null;
  setComposer: (c: Composer | null) => void;
  focus: { id: string; nonce: number } | null;
  tab: string;
  setTab: (t: string) => void;
  onJump: (fileId: string, line: number) => void;
  onCollapse: () => void;
}

export default function RightPanel(p: Props) {
  const fileName = (id: string) => p.files.find((f) => f.id === id)?.name ?? 'deleted file';
  const person = (id: string | null): Person => {
    if (!id) return { displayName: 'Someone', color: '#6b7280', avatarUrl: null };
    const m = p.members.find((x) => x.userId === id);
    return m ?? p.authors[id] ?? { displayName: 'Someone', color: '#6b7280', avatarUrl: null };
  };
  const openCount = p.annotations.filter((a) => !a.resolved).length;

  return (
    <Tabs value={p.tab} onValueChange={p.setTab} className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b pl-1.5 pr-3">
        <TabsList>
          <TabsTrigger value="annotations">Annotations{openCount > 0 && <span className="rounded-full bg-primary-soft px-1.5 text-[11px] text-primary">{openCount}</span>}</TabsTrigger>
          <TabsTrigger value="chat">Chat{p.unreadChat > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground" aria-label={`${p.unreadChat} unread`}>{p.unreadChat > 9 ? '9+' : p.unreadChat}</span>}</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={p.onCollapse} aria-label="Collapse panel" title="Collapse panel"><PanelRightClose className="h-4 w-4" /></Button>
      </div>
      <TabsContent value="annotations" className="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col">
        <Annotations {...p} fileName={fileName} person={person} />
      </TabsContent>
      <TabsContent value="chat" className="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col">
        <ChatPanel roomId={p.roomId} meId={p.meId} members={p.members} online={p.online} messages={p.messages} onSent={p.onSentChat} />
      </TabsContent>
      <TabsContent value="activity" className="min-h-0 flex-1 overflow-y-auto">
        <Activity events={p.activity} person={person} fileName={fileName} onJump={p.onJump} files={p.files} members={p.members} />
      </TabsContent>
    </Tabs>
  );
}

// ───────────────────────── Annotations ─────────────────────────
function Annotations(p: Props & { fileName: (id: string) => string; person: (id: string | null) => Person }) {
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const list = useMemo(
    () => p.annotations
      .filter((a) => (filter === 'all' ? true : filter === 'open' ? !a.resolved : a.resolved))
      .sort((a, b) => a.fileId.localeCompare(b.fileId) || a.line - b.line || a.createdAt.localeCompare(b.createdAt)),
    [p.annotations, filter],
  );
  const activeFile = p.files.find((f) => f.id === p.activeFileId && f.kind === 'file');

  // Focused thread must be visible even if filtered out.
  useEffect(() => {
    if (!p.focus) return;
    const a = p.annotations.find((x) => x.id === p.focus!.id);
    if (a && ((filter === 'open' && a.resolved) || (filter === 'resolved' && !a.resolved))) setFilter('all');
  }, [p.focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex rounded-md bg-muted p-0.5 text-xs" role="group" aria-label="Filter annotations">
          {(['open', 'resolved', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={cn('rounded px-2 py-1 font-medium capitalize text-muted-foreground', filter === f && 'bg-background text-foreground shadow-sm')}>{f}</button>
          ))}
        </div>
        <Button size="sm" variant="ghost" disabled={!activeFile} onClick={() => activeFile && p.setComposer({ fileId: activeFile.id, line: p.cursorLine })} title={activeFile ? `Annotate line ${p.cursorLine}` : 'Open a file first'}>
          <MessageSquarePlus className="h-4 w-4" />Line {p.cursorLine}
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {p.composer && <NewThread {...p} composer={p.composer} />}
        {list.length === 0 && !p.composer ? (
          <div className="px-3 py-10 text-center">
            <MessageSquarePlus className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">{filter === 'resolved' ? 'No resolved threads' : filter === 'open' ? 'No open annotations' : 'No annotations yet'}</p>
            <p className="mx-auto mt-1 max-w-[16rem] text-[13px] text-muted-foreground">Click a line number in the editor to leave a note on that line.</p>
          </div>
        ) : (
          list.map((a) => <Thread key={a.id} a={a} {...p} />)
        )}
      </div>
    </>
  );
}

function NewThread(p: Props & { composer: Composer; fileName: (id: string) => string }) {
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), [p.composer.fileId, p.composer.line]);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/rooms/${p.roomId}/annotations`, { fileId: p.composer.fileId, line: p.composer.line, body: body.trim() });
      p.setComposer(null);
      p.setTab('annotations');
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };

  return (
    <div className="rounded-md border border-primary/40 bg-background p-2.5 ring-2 ring-primary/10">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>New annotation on <span className="font-mono text-foreground">{p.fileName(p.composer.fileId)}:{p.composer.line}</span></span>
      </div>
      <Textarea ref={ref} rows={3} value={body} maxLength={2000} placeholder="What should the team look at here?" onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } if (e.key === 'Escape') p.setComposer(null); }} />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" onClick={() => p.setComposer(null)}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!body.trim() || busy} onClick={submit}>{busy && <Spinner className="text-primary-foreground" />}Comment</Button>
      </div>
    </div>
  );
}

function Thread({ a, ...p }: { a: Annotation } & Props & { fileName: (id: string) => string; person: (id: string | null) => Person }) {
  const { toast } = useToast();
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  const author = p.person(a.authorId);
  const canDelete = a.authorId === p.meId || p.role === 'owner';

  useEffect(() => {
    if (p.focus?.id !== a.id) return;
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
  }, [p.focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const sendReply = () => run(async () => {
    if (!reply.trim()) return;
    await api.post(`/rooms/${p.roomId}/annotations/${a.id}/replies`, { body: reply.trim() });
    setReply(''); setReplying(false);
  });

  return (
    <div ref={ref} className={cn('rounded-md border bg-background transition-shadow', a.resolved && 'bg-subtle', flash && 'ring-2 ring-primary/40')}>
      <button className="flex w-full items-center gap-2 border-b px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/50" onClick={() => p.onJump(a.fileId, a.line)} title="Jump to this line">
        <span className="font-mono text-foreground">{p.fileName(a.fileId)}:{a.line}</span>
        {a.resolved && <span className="ml-auto inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" />Resolved</span>}
      </button>
      <div className="space-y-3 p-2.5">
        <Message person={author} at={a.createdAt} body={a.body} dim={a.resolved} />
        {a.replies.map((r) => <Message key={r.id} person={p.person(r.authorId)} at={r.createdAt} body={r.body} dim={a.resolved} />)}
        {replying && (
          <div>
            <Textarea autoFocus rows={2} value={reply} maxLength={2000} placeholder="Reply…" onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void sendReply(); } if (e.key === 'Escape') setReplying(false); }} />
            <div className="mt-1.5 flex justify-end gap-2">
              <Button size="sm" onClick={() => { setReplying(false); setReply(''); }}>Cancel</Button>
              <Button size="sm" variant="primary" disabled={!reply.trim() || busy} onClick={sendReply}>Reply</Button>
            </div>
          </div>
        )}
        {!replying && (
          <div className="flex items-center gap-1 border-t pt-2">
            <Button size="sm" variant="ghost" onClick={() => setReplying(true)}><CornerDownRight className="h-3.5 w-3.5" />Reply</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.patch(`/rooms/${p.roomId}/annotations/${a.id}`, { resolved: !a.resolved }))}>
              {a.resolved ? <><RotateCcw className="h-3.5 w-3.5" />Reopen</> : <><CheckCircle2 className="h-3.5 w-3.5" />Resolve</>}
            </Button>
            {canDelete && (
              <Button size="sm" variant="ghost" className="ml-auto hover:text-danger" disabled={busy} aria-label="Delete thread" title="Delete thread"
                onClick={() => { if (confirm('Delete this thread and its replies?')) void run(() => api.del(`/rooms/${p.roomId}/annotations/${a.id}`)); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Message({ person, at, body, dim }: { person: Person; at: string; body: string; dim?: boolean }) {
  return (
    <div className="flex gap-2">
      <Avatar name={person.displayName} color={person.color} src={person.avatarUrl} size={22} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium">{person.displayName}</span>
          <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={at} title={new Date(at).toLocaleString()}>{timeAgo(at)}</time>
        </div>
        <p className={cn('mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug', dim && 'text-muted-foreground')}>{body}</p>
      </div>
    </div>
  );
}

// ───────────────────────── Activity ─────────────────────────
function Activity({ events, person, fileName, onJump, files, members }: {
  events: ActivityEvent[]; person: (id: string | null) => Person; fileName: (id: string) => string;
  onJump: (fileId: string, line: number) => void; files: FileNode[]; members: Member[];
}) {
  if (events.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">Activity will show up here as people join, edit, comment, and run code.</p>;
  const target = (id?: string) => members.find((m) => m.userId === id)?.displayName ?? 'someone';

  const describe = (e: ActivityEvent): { text: string; jump?: [string, number] } => {
    const d = e.data;
    const fileExists = (id?: string) => !!id && files.some((f) => f.id === id);
    switch (e.type) {
      case 'room_created': return { text: 'created the room' };
      case 'member_joined': return { text: 'joined the room' };
      case 'member_left': return { text: 'left the room' };
      case 'member_removed': return { text: `removed ${target(d.targetUserId)} from the room` };
      case 'online': return { text: 'came online' };
      case 'file_created': return { text: `created ${d.kind === 'folder' ? 'folder' : 'file'} ${d.fileName}` };
      case 'file_deleted': return { text: `deleted ${d.fileName}` };
      case 'file_renamed': return { text: `renamed ${d.from} to ${d.fileName}` };
      case 'edited': return { text: `edited ${d.fileName}` };
      case 'annotation_created': return { text: `commented on ${d.fileName}:${d.line}`, jump: fileExists(d.fileId) ? [d.fileId, d.line] : undefined };
      case 'annotation_resolved': return { text: `resolved a thread on ${fileExists(d.fileId) ? fileName(d.fileId) : 'a file'}:${d.line}`, jump: fileExists(d.fileId) ? [d.fileId, d.line] : undefined };
      case 'annotation_reopened': return { text: `reopened a thread on ${fileExists(d.fileId) ? fileName(d.fileId) : 'a file'}:${d.line}`, jump: fileExists(d.fileId) ? [d.fileId, d.line] : undefined };
      case 'run_started': return { text: `ran ${d.fileName}` };
      case 'run_finished': return { text: `${d.fileName} ${d.status === 'completed' ? 'completed' : `failed (exit ${d.exitCode})`} in ${formatDuration(d.durationMs ?? 0)}` };
      case 'runner_changed': return { text: `gave run access to ${target(d.targetUserId)}` };
      case 'role_changed': return { text: `set ${target(d.targetUserId)} to ${d.role === 'viewer' ? 'view only' : 'editor'}` };
      case 'room_renamed': return { text: `renamed the room to “${d.name}”` };
      default: return { text: e.type.replace(/_/g, ' ') };
    }
  };

  return (
    <ol className="space-y-0.5 p-2">
      {events.map((e) => {
        const who = person(e.userId);
        const { text, jump } = describe(e);
        const Row = jump ? 'button' : 'div';
        return (
          <li key={e.id}>
            <Row className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left', jump && 'hover:bg-muted')} {...(jump ? { onClick: () => onJump(jump[0], jump[1]) } : {})}>
              <Avatar name={who.displayName} color={who.color} src={who.avatarUrl} size={20} className="mt-0.5" />
              <span className="min-w-0 flex-1 text-[13px] leading-snug">
                <span className="font-medium">{e.type === 'run_finished' ? '' : who.displayName} </span>
                <span className="text-muted-foreground">{text}</span>
                <time className="block text-[11px] text-muted-foreground/80" dateTime={e.createdAt}>{timeAgo(e.createdAt)}</time>
              </span>
            </Row>
          </li>
        );
      })}
    </ol>
  );
}
