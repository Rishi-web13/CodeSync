import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageCircle, SendHorizonal } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ChatMessage, Member } from '@/lib/types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/toast';

interface Props {
  roomId: string;
  meId: string;
  members: Member[];
  online: Set<string>;
  messages: ChatMessage[];
  onSent: (m: ChatMessage) => void;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date();
  const diff = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export default function ChatPanel({ roomId, meId, members, online, messages, onSent }: Props) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const person = (id: string | null) => members.find((m) => m.userId === id) ?? { displayName: 'Former member', color: '#6b7280', avatarUrl: null };

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { message } = await api.post<{ message: ChatMessage }>(`/rooms/${roomId}/messages`, { body });
      onSent(message);
      setText('');
      stick.current = true;
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  let lastDay = '';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
        {online.size} online · {members.length} member{members.length === 1 ? '' : 's'}
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3"
        role="log"
        aria-live="polite"
        aria-label="Room chat"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
      >
        {messages.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <MessageCircle className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">No messages yet</p>
            <p className="mx-auto mt-1 max-w-[16rem] text-[13px] text-muted-foreground">Say hi to everyone in this room. Messages are visible to all members.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const mine = m.authorId === meId;
            const who = person(m.authorId);
            const day = dayLabel(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            const grouped = !showDay && prev && prev.authorId === m.authorId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
            return (
              <div key={m.id}>
                {showDay && <div className="my-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{day}</div>}
                <div className={cn('flex gap-2', mine && 'flex-row-reverse', grouped ? 'mt-0.5' : 'mt-2')}>
                  {grouped ? <span className="w-7 shrink-0" /> : <Avatar name={who.displayName} color={who.color} src={who.avatarUrl} size={28} online={m.authorId ? online.has(m.authorId) : undefined} />}
                  <div className={cn('flex min-w-0 max-w-[85%] flex-col', mine && 'items-end')}>
                    {!grouped && (
                      <div className="mb-0.5 flex items-baseline gap-1.5 text-xs">
                        <span className="font-medium">{mine ? 'You' : who.displayName}</span>
                        <span className="text-muted-foreground">{clock(m.createdAt)}</span>
                      </div>
                    )}
                    <p className={cn('whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-[13px] leading-snug', mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{m.body}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="shrink-0 border-t p-2.5">
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={text}
            maxLength={2000}
            placeholder="Message the room…"
            aria-label="Message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          />
          <Button variant="primary" size="icon" className="h-9 w-9 shrink-0" disabled={!text.trim() || busy} onClick={send} aria-label="Send message">
            {busy ? <Spinner className="text-primary-foreground" /> : <SendHorizonal className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
      </div>
    </div>
  );
}
