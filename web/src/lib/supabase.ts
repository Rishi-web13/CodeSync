import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

// Placeholder values keep the app renderable when env vars are missing; the UI shows a setup notice instead.
export const supabase = createClient(SUPABASE_URL ?? 'http://localhost:54321', SUPABASE_ANON_KEY ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
