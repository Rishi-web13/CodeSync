import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} aria-label="Loading" />;

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Spinner className="h-5 w-5" />
      {label && <span>{label}</span>}
    </div>
  );
}
