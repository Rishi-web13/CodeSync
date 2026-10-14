import { useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FilePlus, FolderPlus, MoreHorizontal, PanelLeftClose, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { langOf } from '@/lib/languages';
import type { FileNode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LangBadge } from '@/components/LangBadge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/toast';

type Dlg = { kind: 'create'; type: 'file' | 'folder' } | { kind: 'rename'; file: FileNode } | { kind: 'delete'; file: FileNode } | null;

export interface ExplorerHandle { openCreate: (type: 'file' | 'folder') => void }

interface Props {
  roomId: string;
  files: FileNode[];
  activeId: string | null;
  canEdit: boolean;
  dialog: Dlg;
  setDialog: (d: Dlg) => void;
  onOpen: (id: string) => void;
  onCreated: (id: string) => Promise<void>;
  onDeleted: (ids: string[]) => void;
  onCollapse: () => void;
}
export type { Dlg };

export default function FileExplorer({ roomId, files, activeId, canEdit, dialog, setDialog, onOpen, onCreated, onDeleted, onCollapse }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const children = useMemo(() => {
    const m = new Map<string | null, FileNode[]>();
    for (const f of files) m.set(f.parentId, [...(m.get(f.parentId) ?? []), f]);
    for (const list of m.values()) list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
    return m;
  }, [files]);

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const renderLevel = (parent: string | null, depth: number) =>
    (children.get(parent) ?? []).map((f) => {
      const isFolder = f.kind === 'folder';
      const open = expanded.has(f.id);
      return (
        <li key={f.id}>
          <div
            className={cn('group flex h-7 items-center rounded-md pr-1 text-[13px] hover:bg-muted', activeId === f.id && 'bg-primary-soft font-medium text-foreground', isFolder && selectedFolder === f.id && 'bg-muted')}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => { if (isFolder) { toggle(f.id); setSelectedFolder(f.id); } else onOpen(f.id); }}
              aria-expanded={isFolder ? open : undefined}
            >
              {isFolder ? (
                <>
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  {open ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </>
              ) : (
                <><span className="w-3.5 shrink-0" /><LangBadge id={f.language} /></>
              )}
              <span className="truncate">{f.name}</span>
            </button>
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`Actions for ${f.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'rename', file: f })}><Pencil className="h-4 w-4" />Rename</DropdownMenuItem>
                  <DropdownMenuItem danger onSelect={() => setDialog({ kind: 'delete', file: f })}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {isFolder && open && (
            <ul>
              {renderLevel(f.id, depth + 1)}
              {!(children.get(f.id)?.length) && <li className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: 30 + depth * 12 }}>Empty folder</li>}
            </ul>
          )}
        </li>
      );
    });

  const createParent = selectedFolder && files.some((f) => f.id === selectedFolder) ? selectedFolder : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-[13px] font-medium">Files</span>
        <div className="flex items-center">
          {canEdit && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDialog({ kind: 'create', type: 'file' })} aria-label="New file" title="New file"><FilePlus className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDialog({ kind: 'create', type: 'folder' })} aria-label="New folder" title="New folder"><FolderPlus className="h-4 w-4" /></Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCollapse} aria-label="Collapse sidebar" title="Collapse sidebar"><PanelLeftClose className="h-4 w-4" /></Button>
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label="Project files" onClick={(e) => { if (e.target === e.currentTarget) setSelectedFolder(null); }}>
        {files.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No files yet.{canEdit ? ' Use the + button to create one.' : ''}</p>
        ) : (
          <ul>{renderLevel(null, 0)}</ul>
        )}
      </nav>
      <NameDialog roomId={roomId} dialog={dialog} setDialog={setDialog} parentId={createParent} files={files} onCreated={onCreated} onDeleted={onDeleted} />
    </div>
  );
}

function NameDialog({ roomId, dialog, setDialog, parentId, files, onCreated, onDeleted }: {
  roomId: string; dialog: Dlg; setDialog: (d: Dlg) => void; parentId: string | null; files: FileNode[];
  onCreated: (id: string) => Promise<void>; onDeleted: (ids: string[]) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<Dlg>(null);
  if (dialog !== seed) { setSeed(dialog); setName(dialog?.kind === 'rename' ? dialog.file.name : ''); setError(null); setBusy(false); }

  const close = () => setDialog(null);
  const parentName = parentId ? files.find((f) => f.id === parentId)?.name : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
    setBusy(true); setError(null);
    try {
      if (dialog.kind === 'create') {
        const { file } = await api.post<{ file: FileNode }>(`/rooms/${roomId}/files`, { name: name.trim(), kind: dialog.type, parentId });
        await onCreated(file.id);
        if (dialog.type === 'file') { /* opened by onCreated */ }
      } else if (dialog.kind === 'rename') {
        await api.patch(`/rooms/${roomId}/files/${dialog.file.id}`, { name: name.trim() });
      } else if (dialog.kind === 'delete') {
        const doomed = [dialog.file.id];
        for (let grew = true; grew; ) { grew = false; for (const f of files) if (f.parentId && doomed.includes(f.parentId) && !doomed.includes(f.id)) { doomed.push(f.id); grew = true; } }
        await api.del(`/rooms/${roomId}/files/${dialog.file.id}`);
        onDeleted(doomed);
        toast(`Deleted ${dialog.file.name}`, 'success');
      }
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!dialog) return <Dialog open={false}><span /></Dialog>;
  const del = dialog.kind === 'delete';
  const title = dialog.kind === 'create' ? (dialog.type === 'folder' ? 'New folder' : 'New file') : dialog.kind === 'rename' ? 'Rename' : `Delete ${dialog.file.kind}`;

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent title={title} description={dialog.kind === 'create' ? `Will be created ${parentName ? `in ${parentName}/` : 'at the project root'}.` : del ? undefined : undefined}>
        <form onSubmit={submit} noValidate className="space-y-4">
          {del ? (
            <p className="text-sm">
              Delete <strong>{dialog.file.name}</strong>{dialog.file.kind === 'folder' ? ' and everything inside it' : ''} for everyone in this room? Annotations on {dialog.file.kind === 'folder' ? 'these files' : 'this file'} will be deleted too. This can’t be undone.
              {error && <span role="alert" className="mt-2 block text-danger">{error}</span>}
            </p>
          ) : (
            <Field label="Name" htmlFor="file-name" error={error} hint={dialog.kind === 'create' && dialog.type === 'file' ? 'The extension sets the language, e.g. utils.py' : undefined}>
              <Input id="file-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={64} aria-invalid={!!error} placeholder={dialog.kind === 'create' && dialog.type === 'file' ? 'utils.js' : undefined} />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant={del ? 'danger' : 'primary'} disabled={busy || (!del && !name.trim())}>
              {busy && <Spinner className="text-primary-foreground" />}
              {del ? 'Delete' : dialog.kind === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const fileLabel = (f: FileNode) => `${f.name} (${langOf(f.language).label})`;
