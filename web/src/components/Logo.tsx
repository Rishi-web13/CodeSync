import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="5" fill="none" stroke="hsl(var(--border))" strokeWidth="2" />
      <path d="M12 11l-5 5 5 5M20 11l5 5-5 5" fill="none" stroke="hsl(var(--primary))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ to = '/', className, text = true }: { to?: string; className?: string; text?: boolean }) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2 rounded-md font-mono font-semibold tracking-tight', className)} aria-label="CodeSync home">
      <LogoMark />
      {text && <span className="text-[14px]">codesync</span>}
    </Link>
  );
}
