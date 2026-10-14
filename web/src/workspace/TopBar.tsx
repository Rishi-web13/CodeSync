import { Link } from 'react-router-dom';
import { Link2, LogOut, MoreHorizontal, PanelLeft, PanelRight, Settings, WifiOff } from 'lucide-react';
import { LANGUAGES } from '@/lib/languages';
import type { FileNode, Member, Room, Role } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';
import { LogoMark } from '@/components/Logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { ConnState } from './useRoomState';
import type { WireStatus } from './CodeEditor';

interface Props {
  room: Room;
  role: Role;
  members: Member[];
  online: Set<string>;
  meId: string;
  conn: ConnState;
  wire: WireStatus;
  offline: boolean;
  lastSaved: number | null;
  activeFile: FileNode | null;
  canEdit: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onLanguage: (lang: string) => void;
  onInvite: () => void;
  onSettings: () => void;
  onLeave: () => void;
}

export default function TopBar(p: Props) {
  const live = p.conn === 'live' && p.wire !== 'disconnected' && !p.offline;
  const label = p.offline ? 'Offline' : live ? 'Live' : p.conn === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  const sorted = [...p.members].sort((a, b) => Number(p.online.has(b.userId)) - Number(p.online.has(a.userId)) || a.displayName.localeCompare(b.displayName));
  const shown = sorted.slice(0, 5);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-3">
      <Button variant="ghost" size="icon" onClick={p.onToggleLeft} aria-label={p.leftOpen ? 'Hide file sidebar' : 'Show file sidebar'} aria-pressed={p.leftOpen} title="Toggle files (Ctrl/⌘+B)">
        <PanelLeft className="h-4 w-4" />
      </Button>
      <Link to="/app" className="flex items-center rounded-md" aria-label="Back to your rooms" title="Back to your rooms"><LogoMark size={22} /></Link>
      <span className="hidden h-5 w-px bg-border sm:block" />
      <h1 className="min-w-0 max-w-[40vw] truncate text-sm font-medium sm:max-w-xs" title={p.room.name}>{p.room.name}</h1>

      <Select
        className="ml-1 h-8 w-[7.5rem] text-[13px] sm:w-[8.5rem]"
        aria-label="Language of the current file"
        value={p.activeFile?.language ?? ''}
        disabled={!p.activeFile || !p.canEdit}
        onChange={(e) => p.onLanguage(e.target.value)}
        title={p.activeFile ? 'Change the language of this file any time' : 'Open a file to set its language'}
      >
        {!p.activeFile && <option value="">Language</option>}
        {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </Select>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex" role="status" aria-live="polite">
          {p.offline ? <WifiOff className="h-3.5 w-3.5 text-danger" /> : <span className={cn('h-2 w-2 rounded-full', live ? 'bg-success' : 'animate-pulse bg-warning')} />}
          <span className={cn(live ? 'text-foreground' : p.offline ? 'text-danger' : 'text-warning')}>{label}</span>
          {live && p.lastSaved && <span className="hidden xl:inline">· Saved {timeAgo(p.lastSaved)}</span>}
        </span>
        <span className="flex items-center lg:hidden" role="status" aria-label={label} title={label}>
          <span className={cn('h-2 w-2 rounded-full', live ? 'bg-success' : p.offline ? 'bg-danger' : 'animate-pulse bg-warning')} />
        </span>

        <button className="flex items-center rounded-full" onClick={p.onSettings} aria-label={`${p.members.length} members. Open room settings`} title="Collaborators">
          <span className="flex -space-x-1.5">
            {shown.map((m) => (
              <Avatar key={m.userId} name={m.displayName + (m.userId === p.meId ? ' (you)' : '')} color={m.color} src={m.avatarUrl} size={28} online={p.online.has(m.userId)} ring className={cn(!p.online.has(m.userId) && 'opacity-60')} />
            ))}
            {sorted.length > shown.length && (
              <span className="z-10 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-medium ring-2 ring-background">+{sorted.length - shown.length}</span>
            )}
          </span>
        </button>

        <Button variant="primary" size="sm" onClick={p.onInvite} title="Copy invite link"><Link2 className="h-4 w-4" /><span className="hidden sm:inline">Invite</span></Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Room menu"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={p.onSettings}><Settings className="h-4 w-4" />Room settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger disabled={p.role === 'owner'} onSelect={p.onLeave} title={p.role === 'owner' ? 'Owners can’t leave — delete the room from settings' : undefined}>
              <LogOut className="h-4 w-4" />Leave room
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" onClick={p.onToggleRight} aria-label={p.rightOpen ? 'Hide collaboration panel' : 'Show collaboration panel'} aria-pressed={p.rightOpen}>
          <PanelRight className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
