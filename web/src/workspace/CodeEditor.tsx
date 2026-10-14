import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { assistantBridge } from '@/lib/assistantBridge';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { FilePlus2 } from 'lucide-react';
import { monaco } from '@/lib/monaco';
import { WS_URL } from '@/lib/config';
import { getAccessToken, supabase } from '@/lib/supabase';
import type { Annotation, FileNode } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

interface Entry {
  fileId: string;
  doc: Y.Doc;
  provider: WebsocketProvider;
  model: monaco.editor.ITextModel;
  binding: MonacoBinding;
  unsynced: boolean;
}

export type WireStatus = 'connected' | 'connecting' | 'disconnected';

interface Props {
  roomId: string;
  me: { id: string; displayName: string; color: string };
  files: FileNode[];
  openTabs: string[];
  activeId: string | null;
  canEdit: boolean;
  annotations: Annotation[];
  errorLines: number[];
  reveal: { fileId: string; line: number; nonce: number } | null;
  onGutterLine: (fileId: string, line: number) => void;
  onAnnotationGlyph: (annotationId: string) => void;
  onCursorLine: (line: number) => void;
  onUnsynced: (fileId: string, unsynced: boolean) => void;
  onWire: (status: WireStatus) => void;
  onRun: () => void;
  onNewFile: () => void;
}

const tabSize = (lang: string) => (lang === 'python' || lang === 'java' || lang === 'cpp' || lang === 'c' || lang === 'php' ? 4 : 2);

const cssString = (s: string) => s.replace(/[\\"]/g, '\\$&').replace(/[\n\r]/g, ' ');

export default function CodeEditor(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const entries = useRef(new Map<string, Entry>());
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const errorDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const [synced, setSynced] = useState<Set<string>>(new Set());
  const props = useRef(p);
  props.current = p;
  const filesRef = useRef(p.files);
  filesRef.current = p.files;

  // ── Create the single Monaco editor ──
  useEffect(() => {
    const editor = monaco.editor.create(host.current!, {
      theme: 'debugroom-dark',
      model: null,
      automaticLayout: true,
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Menlo, monospace",
      fontSize: 13,
      lineHeight: 21,
      minimap: { enabled: false },
      glyphMargin: true,
      folding: true,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      padding: { top: 8, bottom: 8 },
      autoIndent: 'full',
      formatOnPaste: false,
      bracketPairColorization: { enabled: true },
      fixedOverflowWidgets: true,
      smoothScrolling: true,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      readOnlyMessage: { value: 'You have view-only access in this room.' },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });
    editorRef.current = editor;
    decorations.current = editor.createDecorationsCollection();
    errorDecos.current = editor.createDecorationsCollection();

    // Click a line number (or the marker beside it) to annotate / open that thread.
    editor.onMouseDown((e) => {
      const t = e.target.type;
      const line = e.target.position?.lineNumber;
      const id = editor.getModel() && [...entries.current.values()].find((en) => en.model === editor.getModel())?.fileId;
      if (!line || !id) return;
      if (t === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) props.current.onGutterLine(id, line);
      else if (t === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const a = props.current.annotations.find((x) => x.fileId === id && x.line === line);
        if (a) props.current.onAnnotationGlyph(a.id); else props.current.onGutterLine(id, line);
      }
    });
    editor.onDidChangeCursorPosition((e) => props.current.onCursorLine(e.position.lineNumber));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => props.current.onRun());

    // Let the AI assistant read the open file and (with confirmation) apply a fix. Only LOCAL typing notifies it,
    // so a teammate's edits never trigger your checks.
    assistantBridge.getText = () => editor.getModel()?.getValue() ?? '';
    assistantBridge.canEdit = () => props.current.canEdit;
    assistantBridge.applyText = (text: string) => {
      const model = editor.getModel();
      if (!model || !props.current.canEdit) return false;
      editor.pushUndoStop();
      editor.executeEdits('assistant-fix', [{ range: model.getFullModelRange(), text }]);
      editor.pushUndoStop();
      return true;
    };
    editor.onKeyDown((e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey && e.keyCode !== monaco.KeyCode.Shift && e.keyCode !== monaco.KeyCode.Ctrl && e.keyCode !== monaco.KeyCode.Alt) assistantBridge.notifyEdit(); });
    editor.onDidPaste(() => assistantBridge.notifyEdit());

    return () => {
      assistantBridge.getText = null; assistantBridge.applyText = null; assistantBridge.canEdit = null;
      for (const e of entries.current.values()) disposeEntry(e);
      entries.current.clear();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // ── Keep a Yjs document + provider + Monaco model for every open tab ──
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let cancelled = false;
    (async () => {
      const token = (await getAccessToken()) ?? '';
      if (cancelled) return;
      for (const id of p.openTabs) {
        if (entries.current.has(id)) continue;
        const file = filesRef.current.find((f) => f.id === id && f.kind === 'file');
        if (!file) continue;
        const doc = new Y.Doc();
        const provider = new WebsocketProvider(`${WS_URL}/yjs`, `${p.roomId}/${id}`, doc, { params: { token }, disableBc: true });
        provider.awareness.setLocalStateField('user', { name: p.me.displayName, color: p.me.color });
        const ytext = doc.getText('content');
        const model = monaco.editor.createModel('', file.language, monaco.Uri.parse(`inmemory://debugroom/${p.roomId}/${id}/${file.name}`));
        model.updateOptions({ tabSize: tabSize(file.language), insertSpaces: file.language !== 'go' });
        const binding = new MonacoBinding(ytext, model, new Set([editor]), provider.awareness);
        const entry: Entry = { fileId: id, doc, provider, model, binding, unsynced: false };
        entries.current.set(id, entry);

        const setUnsynced = (v: boolean) => {
          if (entry.unsynced === v) return;
          entry.unsynced = v;
          props.current.onUnsynced(id, v);
        };
        doc.on('update', (_u: Uint8Array, origin: unknown) => {
          if (origin !== provider && (!provider.wsconnected || !provider.synced)) setUnsynced(true);
        });
        provider.on('sync', (isSynced: boolean) => {
          if (!isSynced) return;
          setUnsynced(false);
          setSynced((s) => (s.has(id) ? s : new Set(s).add(id)));
        });
        provider.on('status', ({ status }: { status: WireStatus }) => {
          if (props.current.activeId === id) props.current.onWire(status);
        });
        provider.awareness.on('change', rebuildCursorStyles);
        // Attach immediately if this is the file the user is looking at.
        if (props.current.activeId === id) {
          editor.setModel(model);
          props.current.onWire(provider.wsconnected ? 'connected' : 'connecting');
        }
      }
      // Dispose tabs that were closed.
      for (const [id, entry] of [...entries.current]) {
        if (!p.openTabs.includes(id)) {
          disposeEntry(entry);
          entries.current.delete(id);
          setSynced((s) => { const n = new Set(s); n.delete(id); return n; });
        }
      }
      rebuildCursorStyles();
    })();
    return () => { cancelled = true; };
  }, [p.openTabs.join(','), p.files.map((f) => f.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fresh tokens for reconnects (access tokens expire hourly).
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) return;
      for (const e of entries.current.values()) e.provider.params.token = session.access_token;
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // ── Show the active file ──
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const entry = p.activeId ? entries.current.get(p.activeId) : undefined;
    if (entry && editor.getModel() !== entry.model) editor.setModel(entry.model);
    if (entry) p.onWire(entry.provider.wsconnected ? 'connected' : 'connecting');
    if (!entry && !p.activeId) editor.setModel(null);
  }, [p.activeId, p.openTabs.length, synced.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Language / permissions
  useEffect(() => {
    for (const e of entries.current.values()) {
      const f = p.files.find((x) => x.id === e.fileId);
      if (f && e.model.getLanguageId() !== f.language) {
        monaco.editor.setModelLanguage(e.model, f.language);
        e.model.updateOptions({ tabSize: tabSize(f.language), insertSpaces: f.language !== 'go' });
      }
    }
  }, [p.files]);
  useEffect(() => { editorRef.current?.updateOptions({ readOnly: !p.canEdit }); }, [p.canEdit]);

  // ── Annotation markers ──
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !p.activeId) { decorations.current?.clear(); return; }
    const byLine = new Map<number, Annotation[]>();
    for (const a of p.annotations) if (a.fileId === p.activeId) byLine.set(a.line, [...(byLine.get(a.line) ?? []), a]);
    const max = model.getLineCount();
    decorations.current?.set(
      [...byLine].filter(([line]) => line <= max).map(([line, list]) => {
        const open = list.some((a) => !a.resolved);
        return {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: open ? 'dr-line-open' : 'dr-line-resolved',
            glyphMarginClassName: open ? 'dr-glyph-open' : 'dr-glyph-resolved',
            glyphMarginHoverMessage: { value: `${list.length} annotation${list.length > 1 ? 's' : ''}${open ? '' : ' (resolved)'} — click to open` },
          },
        };
      }),
    );
  }, [p.annotations, p.activeId, synced.size]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    errorDecos.current?.set(
      p.errorLines.filter((l) => l <= model.getLineCount()).map((l) => ({ range: new monaco.Range(l, 1, l, 1), options: { isWholeLine: true, className: 'dr-error-line' } })),
    );
  }, [p.errorLines, p.activeId, synced.size]);

  // ── Jump to a line ──
  useEffect(() => {
    const r = p.reveal;
    const editor = editorRef.current;
    if (!r || !editor || r.fileId !== p.activeId) return;
    const model = editor.getModel();
    if (!model) return;
    const line = Math.min(r.line, model.getLineCount());
    editor.revealLineInCenter(line, monaco.editor.ScrollType.Smooth);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
    const flash = editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'dr-line-flash' } }]);
    const t = setTimeout(() => flash.clear(), 1500);
    return () => clearTimeout(t);
  }, [p.reveal?.nonce, p.activeId, synced.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = p.activeId ? entries.current.get(p.activeId) : undefined;
  const loading = !!p.activeId && !synced.has(p.activeId);
  void active;

  return (
    <div className="relative min-h-0 flex-1 bg-background">
      <div ref={host} className="absolute inset-0" />
      {!p.activeId && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
          <FilePlus2 className="h-6 w-6 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">No file open</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">Open a file from the explorer{p.canEdit ? ', or create a new one to start writing code together.' : '.'}</p>
          </div>
          {p.canEdit && <Button variant="primary" size="sm" onClick={p.onNewFile}>New file</Button>}
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground" role="status">
          <Spinner /> Loading file…
        </div>
      )}
    </div>
  );

  function disposeEntry(e: Entry) {
    e.binding.destroy();
    e.provider.destroy();
    e.doc.destroy();
    e.model.dispose();
  }

  /** Colour each collaborator's remote cursor and selection (y-monaco emits per-client class names). */
  function rebuildCursorStyles() {
    let css = '';
    for (const e of entries.current.values()) {
      e.provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === e.doc.clientID || !state.user) return;
        const { name, color } = state.user as { name: string; color: string };
        css += `.yRemoteSelection-${clientId}{background-color:${color};}`;
        css += `.yRemoteSelectionHead-${clientId}{border-color:${color};}`;
        css += `.yRemoteSelectionHead-${clientId}::after{content:"${cssString(name)}";background:${color};}`;
      });
    }
    let el = document.getElementById('dr-cursor-styles') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'dr-cursor-styles';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }
}
