import * as React from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuSeparator = () => <M.Separator className="my-1 h-px bg-border" />;

export function DropdownMenuContent({ className, align = 'end', ...props }: React.ComponentPropsWithoutRef<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-[11rem] rounded-md border bg-background p-1 text-sm shadow-md animate-pop-in', className)}
        {...props}
      />
    </M.Portal>
  );
}

export function DropdownMenuItem({ className, danger, ...props }: React.ComponentPropsWithoutRef<typeof M.Item> & { danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed',
        danger ? 'text-danger data-[highlighted]:bg-danger-soft' : 'data-[highlighted]:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <M.Label className={cn('px-2 py-1 text-xs text-muted-foreground', className)} {...props} />;
}
