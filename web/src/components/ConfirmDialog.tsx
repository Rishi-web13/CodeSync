import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';

export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onClose }: {
  open: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={title} description={body}>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            {busy && <Spinner className="text-primary-foreground" />}{confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
