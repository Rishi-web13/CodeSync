import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { FullPageSpinner } from '@/components/ui/spinner';

interface AuthState { session: Session | null; me: Me | null; loading: boolean; signOut: () => Promise<void> }
const Ctx = createContext<AuthState>({ session: null, me: null, loading: true, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setMe(null); setLoading(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load the server-side profile whenever the signed-in user changes.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.get<Me>('/me')
      .then((m) => !cancelled && setMe(m))
      .catch(() => !cancelled && setMe({ id: userId, email: session?.user.email ?? null, displayName: session?.user.email?.split('@')[0] ?? 'You', color: '#4f46e5', avatarUrl: null }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [userId]);

  const signOut = async () => { await supabase.auth.signOut(); };
  return <Ctx.Provider value={{ session, me, loading, signOut }}>{children}</Ctx.Provider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, me, loading } = useAuth();
  const loc = useLocation();
  if (loading || (session && !me)) return <FullPageSpinner label="Loading your workspace…" />;
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
