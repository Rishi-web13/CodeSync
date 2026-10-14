import { useEffect, useState } from 'react';
import { Check, Copy, Play, UserMinus } from 'lucide-react';
import { api } from '@/lib/api';
import { LANGUAGES } from '@/lib/languages';
import type { Member, Room, Role } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  room: Room;
  role: Role;
  meId: string;
  members: Member[];
  online: Set<string>;
  inviteUrl: string;
  onCopyInvite: () => void;
  onDelete: () => void;
  onLeave: () => void;
}

export default function RoomSettings(p: Props) {
  const { toast } = useToast();
  const owner = p.role === 'owner';
  const [name, setName] = useState(p.room.name);
  const [lang, setLang] = useState(p.room.defaultLanguage);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => { if (p.open) { setName(p.room.name); setLang(p.room.defaultLanguage); setNameError(null); } }, [p.open, p.room.name, p.room.defaultLanguage]);

  const dirty = name.trim() !== p.room.name || lang !== p.room.defaultLanguage;
  const save = async () => {
    if (!name.trim()) return setNameError('Enter a room name.');
    setSaving(true); setNameError(null);
    try {
      await api.patch(`/rooms/${p.room.id}`, { name: name.trim(), defaultLanguage: lang });
      toast('Room updated', 'success');
    } catch (e) { setNameError((e as Error).message); } finally { setSaving(false); }
  };

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setPending(key);
    try { await fn(); toast(ok, 'success'); } catch (e) { toast((e as Error).message, 'error'); } finally { setPending(null); }
  };

  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent title="Room settings" className="max-w-lg" description={owner ? 'Manage the room, its collaborators, and who can run code.' : 'Only the room owner can change these settings.'}>
        <div className="space-y-6">
          <section className="space-y-3">
            <Field label="Room name" htmlFor="rs-name" error={nameError}>
              <Input id="rs-name" value={name} disabled={!owner} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />
            </Field>
            <Field label="Default language" htmlFor="rs-lang" hint="Applies to new rooms’ starter file; existing files keep their own language.">
              <Select id="rs-lang" className="w-full" value={lang} disabled={!owner} onChange={(e) => setLang(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </Select>
            </Field>
            {owner && <div className="flex justify-end"><Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>{saving && <Spinner className="text-primary-foreground" />}Save changes</Button></div>}
          </section>

          <section>
            <h3 className="text-[13px] font-medium">Invite link</h3>
            <div className="mt-1.5 flex gap-2">
              <Input readOnly value={p.inviteUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Invite link" />
              <Button onClick={p.onCopyInvite}><Copy className="h-4 w-4" />Copy</Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Room code: <span className="font-mono text-foreground">{p.room.code}</span>. Anyone with the link can join as an editor.</p>
          </section>

          <section>
            <h3 className="text-[13px] font-medium">Collaborators ({p.members.length})</h3>
            <ul className="mt-2 divide-y rounded-md border">
              {p.members.map((m) => {
                const isRunner = p.room.runnerId === m.userId;
                const self = m.userId === p.meId;
                return (
                  <li key={m.userId} className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
                    <Avatar name={m.displayName} color={m.color} src={m.avatarUrl} size={28} online={p.online.has(m.userId)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.displayName}{self && <span className="font-normal text-muted-foreground"> (you)</span>}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {m.role === 'owner' ? 'Owner' : m.role === 'viewer' ? 'View only' : 'Editor'}
                        {isRunner && <span className="inline-flex items-center gap-1 rounded bg-primary-soft px-1.5 py-px text-[11px] font-medium text-primary"><Play className="h-2.5 w-2.5 fill-current" />Runner</span>}
                      </p>
                    </div>
                    {owner && m.role !== 'owner' && (
                      <div className="flex items-center gap-1.5">
                        <Select className="h-8 text-[13px]" aria-label={`Role for ${m.displayName}`} value={m.role} disabled={pending === `role:${m.userId}`}
                          onChange={(e) => act(`role:${m.userId}`, () => api.patch(`/rooms/${p.room.id}/members/${m.userId}`, { role: e.target.value }), 'Role updated')}>
                          <option value="editor">Editor</option>
                          <option value="viewer">View only</option>
                        </Select>
                        <Button size="sm" disabled={isRunner || m.role === 'viewer' || pending === `run:${m.userId}`} title={m.role === 'viewer' ? 'View-only members can’t run code' : isRunner ? 'Already the runner' : 'Let this person run code'}
                          onClick={() => act(`run:${m.userId}`, () => api.post(`/rooms/${p.room.id}/runner`, { userId: m.userId }), `${m.displayName} can now run code`)}>
                          Make runner
                        </Button>
                        <Button size="icon" variant="ghost" className="hover:text-danger" aria-label={`Remove ${m.displayName}`} title="Remove from room" disabled={pending === `rm:${m.userId}`}
                          onClick={() => { if (confirm(`Remove ${m.displayName} from this room?`)) void act(`rm:${m.userId}`, () => api.del(`/rooms/${p.room.id}/members/${m.userId}`), `${m.displayName} was removed`); }}>
                          <UserMinus className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {m.role === 'owner' && !isRunner && owner && (
                      <Button size="sm" disabled={pending === `run:${m.userId}`} onClick={() => act(`run:${m.userId}`, () => api.post(`/rooms/${p.room.id}/runner`, { userId: m.userId }), 'You can run code again')}>Make runner</Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-xs text-muted-foreground">Only the runner can start code execution. Everyone sees the results live.</p>
          </section>

          <section className={cn('rounded-md border border-danger/30 p-3')}>
            <h3 className="text-[13px] font-medium text-danger">{owner ? 'Delete room' : 'Leave room'}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{owner ? 'Permanently deletes the room, its files, annotations, and run history for everyone.' : 'You’ll lose access until someone sends you the invite link again.'}</p>
            <Button variant="danger" size="sm" className="mt-2.5" onClick={owner ? p.onDelete : p.onLeave}>{owner ? 'Delete room…' : 'Leave room…'}</Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
