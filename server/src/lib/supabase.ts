import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/** Service-role client. Server-side only: it bypasses RLS, so every route must authorize explicitly. */
export const db = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function dbFail(error: { message: string; code?: string } | null, fallback = 'Database error'): never {
  console.error('[db]', error);
  throw new Error(error?.message ?? fallback);
}
