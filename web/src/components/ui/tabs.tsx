import * as React from 'react';
import * as T from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;

export const TabsList = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof T.List>) => (
  <T.List className={cn('flex items-center gap-1', className)} {...props} />
);

export const TabsTrigger = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof T.Trigger>) => (
  <T.Trigger
    className={cn(
      'relative inline-flex h-9 items-center gap-1.5 px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
      'data-[state=active]:text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100',
      className,
    )}
    {...props}
  />
);

export const TabsContent = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof T.Content>) => (
  <T.Content className={cn('focus-visible:outline-none', className)} {...props} />
);
