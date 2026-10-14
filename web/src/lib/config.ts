const trim = (s: string) => s.replace(/\/+$/, '');
export const API_URL = trim(import.meta.env.VITE_API_URL ?? 'http://localhost:4000');
export const WS_URL = API_URL.replace(/^http/, 'ws');
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
