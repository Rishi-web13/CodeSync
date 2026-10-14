import { cn, initials } from '@/lib/utils';

export function Avatar({ name, color, src, size = 28, online, className, ring }: {
  name: string; color: string; src?: string | null; size?: number; online?: boolean; className?: string; ring?: boolean;
}) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)} title={name} style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt={name} className={cn('h-full w-full rounded-full object-cover', ring && 'ring-2 ring-background')} />
      ) : (
        <span
          className={cn('flex h-full w-full items-center justify-center rounded-full font-semibold text-white', ring && 'ring-2 ring-background')}
          style={{ background: color, fontSize: Math.max(9, size * 0.38) }}
          aria-label={name}
        >
          {initials(name)}
        </span>
      )}
      {online !== undefined && (
        <span
          className={cn('absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full ring-2 ring-background', online ? 'bg-success' : 'bg-muted-foreground/40')}
          aria-label={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  );
}
