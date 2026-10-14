import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { copyText } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  url: string;
  code: string;
  roomName: string;
}

export default function InviteDialog({ open, onClose, url, code, roomName }: Props) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [manual, setManual] = useState(false);
  const copy = async (what: 'link' | 'code') => {
    const ok = await copyText(what === 'link' ? url : code);
    if (!ok) { setManual(true); document.getElementById(what === 'link' ? 'invite-link' : 'invite-code')?.focus(); return; }
    setManual(false);
    setCopied(what);
    setTimeout(() => setCopied(null), 1800);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Invite to this room" description={`Anyone with this link can join “${roomName}” after signing in.`}>
        <div className="space-y-4">
          <div>
            <label htmlFor="invite-link" className="text-[13px] font-medium">Invite link</label>
            <div className="mt-1.5 flex gap-2">
              <Input id="invite-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button variant="primary" onClick={() => void copy('link')}>{copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === 'link' ? 'Copied' : 'Copy'}</Button>
            </div>
          </div>
          <div>
            <label htmlFor="invite-code" className="text-[13px] font-medium">Room code</label>
            <div className="mt-1.5 flex gap-2">
              <Input id="invite-code" readOnly value={code} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm tracking-widest" />
              <Button onClick={() => void copy('code')}>{copied === 'code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === 'code' ? 'Copied' : 'Copy'}</Button>
            </div>
            {manual && <p role="status" className="mt-1.5 text-xs text-warning">Your browser blocked automatic copying. The text is selected, so press Ctrl+C (⌘+C on Mac).</p>}
            <p className="mt-1.5 text-xs text-muted-foreground">They can also choose “Join a Room” on the dashboard and paste the code.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
