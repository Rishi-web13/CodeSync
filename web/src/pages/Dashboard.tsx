import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, LogOut, Plus, KeyRound, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { LANGUAGES, langOf } from '@/lib/languages';
import { extractRoomCode, timeAgo } from '@/lib/utils';
import type { RoomSummary } from '@/lib/types';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, Input, Select } from '@/components/ui/input';
import { Spinner, FullPageSpinner } from '@/components/ui/spinner';
import { LangBadge } from '@/components/LangBadge';
import { useAuth } from '@/auth/AuthProvider';

export default function Dashboard() {
  const { me, signOut } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const action = params.get('action');

  useEffect(() => {
    api.get<{ rooms: RoomSummary[] }>('/rooms').then((r) => setRooms(r.rooms)).catch((e: ApiError) => setError(e.message));
  }, []);

  const close = () => setParams({}, { replace: true });

  return (
    <div className="min-h-full bg-subtle">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-5">
          <Logo to="/app" />
          {me && (
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-full" aria-label="Account menu"><Avatar name={me.displayName} color={me.color} src={me.avatarUrl} size={30} /></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{me.email ?? me.displayName}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={async () => { await signOut(); nav('/'); }}><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Your rooms</h1>
            <p className="mt-1 text-sm text-muted-foreground">Rooms you own or have joined.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setParams({ action: 'join' })}><KeyRound className="h-4 w-4" />Join a Room</Button>
            <Button variant="primary" onClick={() => setParams({ action: 'create' })}><Plus className="h-4 w-4" />Create a Room</Button>
          </div>
        </div>

        <div className="mt-6">
          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger">{error}</p>
          ) : !rooms ? (
            <FullPageSpinner />
          ) : rooms.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-background px-6 py-14 text-center">
              <Users className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
              <h2 className="mt-3 text-[15px] font-semibold">No rooms yet</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Create a room and send the invite link to a teammate, or join one with a code.</p>
              <Button className="mt-5" variant="primary" onClick={() => setParams({ action: 'create' })}>Create your first room</Button>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border bg-background">
              {rooms.map((r) => (
                <li key={r.id}>
                  <button onClick={() => nav(`/room/${r.id}`)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/60">
                    <LangBadge id={r.defaultLanguage} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{langOf(r.defaultLanguage).label} · {r.role === 'owner' ? 'Owner' : r.role === 'viewer' ? 'View only' : 'Editor'} · created {timeAgo(r.createdAt)}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <CreateRoomDialog open={action === 'create'} onClose={close} />
      <JoinRoomDialog open={action === 'join'} onClose={close} />
    </div>
  );
}

function CreateRoomDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter a room name.');
    setBusy(true); setError(null);
    try {
      const { room } = await api.post<{ room: { id: string } }>('/rooms', { name: name.trim(), language });
      nav(`/room/${room.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Create a room" description="Rooms are private. Only people with your invite link can join.">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Room name" htmlFor="room-name" error={error}>
            <Input id="room-name" autoFocus placeholder="API Bug Investigation" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={!!error} />
          </Field>
          <Field label="Default language" htmlFor="room-lang" hint="Used for the first file. You can add files in any language later.">
            <Select id="room-lang" className="w-full" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy && <Spinner className="text-primary-foreground" />}Create room</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function JoinRoomDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = extractRoomCode(value);
    if (code.length < 4) return setError('Paste an invite link or enter a room code.');
    setBusy(true); setError(null);
    try {
      const { room } = await api.post<{ room: { id: string } }>('/rooms/join', { code });
      nav(`/room/${room.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Join a room" description="Paste the invite link you were sent, or type the room code.">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Invite link or code" htmlFor="join-code" error={error}>
            <Input id="join-code" autoFocus placeholder="K7QM2XPA" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy && <Spinner className="text-primary-foreground" />}Join room</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
