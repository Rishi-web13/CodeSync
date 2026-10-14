import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; message: string }
const Ctx = createContext<{ toast: (message: string, kind?: Kind) => void }>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((message: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto flex items-start gap-2.5 rounded-md border bg-background p-3 text-sm shadow-md animate-pop-in', t.kind === 'error' && 'border-danger/30')}>
            {t.kind === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : null}
            <span className="flex-1">{t.message}</span>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
