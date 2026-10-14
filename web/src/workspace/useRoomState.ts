import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { WS_URL } from '@/lib/config';
import { getAccessToken } from '@/lib/supabase';
import type { ActivityEvent, Annotation, ChatMessage, ExecState, ExecutionRecord, Person, RoomPayload } from '@/lib/types';

export type ConnState = 'connecting' | 'live' | 'reconnecting';
export interface Fatal { status: number; message: string }

const IDLE: ExecState = { id: null, status: 'idle', startedBy: null, startedAt: null, fileId: null, filePath: null, stdout: '', stderr: '', logs: [], exitCode: null, durationMs: null };

/**
 * Loads a room and keeps it live over the JSON event socket.
 * Document text/cursors are NOT handled here — that is Yjs (see CodeEditor).
 * The server broadcasts small "changed" hints and this hook refetches; after every
 * reconnect it refetches everything, so missed events can never leave the UI stale.
 */
export function useRoomState(roomId: string, meId: string) {
  const [data, setData] = useState<RoomPayload | null>(null);
  const [fatal, setFatal] = useState<Fatal | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [authors, setAuthors] = useState<Record<string, Person>>({});
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [conn, setConn] = useState<ConnState>('connecting');
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [exec, setExec] = useState<ExecState>(IDLE);
  const [focusAnnotation, setFocusAnnotation] = useState<{ id: string; nonce: number } | null>(null);

  const dataRef = useRef<RoomPayload | null>(null);
  dataRef.current = data;
  const nameOf = useCallback((id: string | null) => dataRef.current?.members.find((m) => m.userId === id)?.displayName ?? 'Someone', []);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setFatal({ status: e.status, message: e.message });
  }, []);

  const reloadRoom = useCallback(async () => {
    try {
      const d = await api.get<RoomPayload>(`/rooms/${roomId}`);
      setData(d);
      setOnline((prev) => (prev.size ? prev : new Set(d.online)));
      return d;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [roomId, fail]);

  const reloadAnnotations = useCallback(async () => {
    try {
      const r = await api.get<{ annotations: Annotation[]; authors: Record<string, Person> }>(`/rooms/${roomId}/annotations`);
      setAnnotations(r.annotations);
      setAuthors(r.authors);
    } catch (e) { fail(e); }
  }, [roomId, fail]);

  const loadActivity = useCallback(async () => {
    try {
      const r = await api.get<{ events: ActivityEvent[] }>(`/rooms/${roomId}/activity`);
      setActivity(r.events);
    } catch (e) { fail(e); }
  }, [roomId, fail]);

  const loadChat = useCallback(async () => {
    try {
      const r = await api.get<{ messages: ChatMessage[] }>(`/rooms/${roomId}/messages`);
      setMessages(r.messages);
    } catch (e) { fail(e); }
  }, [roomId, fail]);

  const loadLastRun = useCallback(async () => {
    try {
      const { executions } = await api.get<{ executions: ExecutionRecord[] }>(`/rooms/${roomId}/executions`);
      const last = executions[0];
      if (!last) return;
      setExec((cur) => {
        if (cur.status === 'running') return cur; // live stream wins
        return {
          ...IDLE, id: last.id, status: last.status, startedBy: last.startedBy, fileId: last.fileId,
          startedAt: new Date(last.createdAt).getTime(), stdout: last.stdout, stderr: last.stderr,
          exitCode: last.exitCode, durationMs: last.durationMs,
          logs: [
            ...(last.stdout ? [{ ts: new Date(last.createdAt).getTime(), kind: 'stdout' as const, text: last.stdout }] : []),
            ...(last.stderr ? [{ ts: new Date(last.createdAt).getTime(), kind: 'stderr' as const, text: last.stderr }] : []),
          ],
        };
      });
    } catch { /* non-critical */ }
  }, [roomId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([reloadRoom(), reloadAnnotations(), loadActivity(), loadChat()]);
  }, [reloadRoom, reloadAnnotations, loadActivity, loadChat]);

  // Initial load
  useEffect(() => {
    setData(null); setFatal(null); setAnnotations([]); setActivity([]); setMessages([]); setExec(IDLE);
    void refreshAll();
    void loadLastRun();
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event socket with reconnect
  useEffect(() => {
    if (fatal) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let everOpened = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let debounce: Record<string, ReturnType<typeof setTimeout>> = {};
    const soon = (key: string, fn: () => void) => { clearTimeout(debounce[key]); debounce[key] = setTimeout(fn, 120); };

    const handle = (msg: any) => {
      switch (msg.type) {
        case 'presence': setOnline(new Set<string>(msg.online)); break;
        case 'members:changed': case 'room:updated': case 'files:changed': soon('room', () => void reloadRoom()); break;
        case 'annotations:changed':
          soon('ann', () => void reloadAnnotations().then(() => msg.focus && setFocusAnnotation({ id: msg.focus, nonce: Date.now() })));
          break;
        case 'activity': setActivity((a) => (a.some((e) => e.id === msg.event.id) ? a : [msg.event, ...a].slice(0, 100))); break;
        case 'chat:message': setMessages((m) => (m.some((x) => x.id === msg.message.id) ? m : [...m, msg.message].slice(-300))); break;
        case 'doc:saved': setLastSaved(new Date(msg.at).getTime()); break;
        case 'removed': setFatal({ status: 403, message: 'You were removed from this room by its owner.' }); break;
        case 'room:deleted': setFatal({ status: 404, message: 'This room was deleted by its owner.' }); break;
        case 'exec:start': {
          const e = msg.execution;
          setExec({
            id: e.id, status: 'running', startedBy: e.startedBy, startedAt: new Date(e.startedAt).getTime(), fileId: e.fileId, filePath: e.filePath,
            stdout: '', stderr: '', exitCode: null, durationMs: null,
            logs: [{ ts: Date.now(), kind: 'system', text: `${nameOf(e.startedBy)} started ${e.filePath} (${e.language})` }, { ts: Date.now(), kind: 'system', text: `$ ${e.command}` }],
          });
          break;
        }
        case 'exec:chunk':
          setExec((s) => (s.id !== msg.id ? s : {
            ...s,
            stdout: msg.stream === 'stdout' ? s.stdout + msg.data : s.stdout,
            stderr: msg.stream === 'stderr' ? s.stderr + msg.data : s.stderr,
            logs: [...s.logs, { ts: msg.ts, kind: msg.stream, text: msg.data }],
          }));
          break;
        case 'exec:end':
          setExec((s) => (s.id !== msg.id ? s : {
            ...s, status: msg.status, exitCode: msg.exitCode, durationMs: msg.durationMs,
            logs: [...s.logs, { ts: Date.now(), kind: 'system', text: `Process exited with code ${msg.exitCode} after ${msg.durationMs} ms` }],
          }));
          break;
      }
    };

    const connect = async () => {
      if (closed) return;
      setConn(everOpened ? 'reconnecting' : 'connecting');
      const token = await getAccessToken();
      if (closed || !token) return;
      ws = new WebSocket(`${WS_URL}/rt/${roomId}?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        setConn('live');
        const wasReconnect = everOpened;
        everOpened = true;
        attempt = 0;
        if (wasReconnect) { void refreshAll(); void loadLastRun(); }
      };
      ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
      ws.onclose = () => {
        if (closed) return;
        setConn(everOpened ? 'reconnecting' : 'connecting');
        attempt++;
        // After a few failed attempts check whether we lost access (REST gives a precise reason).
        if (attempt >= 2) void reloadRoom();
        timer = setTimeout(connect, Math.min(500 * 2 ** attempt, 8000));
      };
    };
    void connect();
    const onOnline = () => { if (ws?.readyState !== WebSocket.OPEN) { clearTimeout(timer); void connect(); } };
    window.addEventListener('online', onOnline);

    return () => {
      closed = true;
      clearTimeout(timer);
      Object.values(debounce).forEach(clearTimeout);
      window.removeEventListener('online', onOnline);
      ws?.close();
    };
  }, [roomId, fatal === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearOutput = useCallback(() => {
    setExec((s) => (s.status === 'running' ? { ...s, stdout: '', stderr: '', logs: [] } : IDLE));
  }, []);

  const me = useMemo(() => data?.members.find((m) => m.userId === meId) ?? null, [data, meId]);

  const addMessage = useCallback((m: ChatMessage) => setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m])), []);

  return { data, fatal, messages, addMessage, annotations, authors, activity, online, conn, lastSaved, exec, me, focusAnnotation, reloadRoom, reloadAnnotations, clearOutput };
}
