import { langOf } from '@/lib/languages';
import { hexToRgba } from '@/lib/utils';

/** Compact language-coloured badge used as the file icon. */
export function LangBadge({ id, size = 20 }: { id: string; size?: number }) {
  const l = langOf(id);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] font-mono font-semibold leading-none"
      style={{ width: size, height: size, fontSize: size * 0.4, color: l.color, background: hexToRgba(l.color, 0.12) }}
      aria-hidden
    >
      {l.badge}
    </span>
  );
}
