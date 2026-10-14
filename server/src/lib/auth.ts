import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from './supabase.js';
import { HttpError } from './http.js';

export interface AuthUser {
  id: string;
  email: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

const cache = new Map<string, { user: AuthUser; exp: number }>();
const TTL_MS = 60_000;

/** Verify a Supabase access token. Results are cached briefly to avoid a round-trip per request. */
export async function verifyToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    cache.delete(token);
    return null;
  }
  const user = { id: data.user.id, email: data.user.email ?? null };
  cache.set(token, { user, exp: Date.now() + TTL_MS });
  if (cache.size > 5000) for (const [k, v] of cache) if (v.exp < Date.now()) cache.delete(k);
  return user;
}

export async function authHook(req: FastifyRequest, _reply: FastifyReply) {
  if (req.method === 'OPTIONS' || req.url === '/health') return;
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = await verifyToken(token);
  if (!user) throw new HttpError(401, 'You need to sign in to continue.');
  await ensureProfile(user);
  req.user = user;
}

// Users created before the schema's trigger existed (or if it failed) still get a profile row.
const ensured = new Set<string>();
async function ensureProfile(user: AuthUser) {
  if (ensured.has(user.id)) return;
  const { data } = await db.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (!data) {
    const palette = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#9333ea', '#db2777', '#2563eb'];
    await db.from('profiles').insert({
      id: user.id,
      display_name: (user.email ?? 'Anonymous').split('@')[0],
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  }
  ensured.add(user.id);
}

// ── profile lookup (small cache) ──
export interface Profile {
  id: string;
  displayName: string;
  color: string;
  avatarUrl: string | null;
}
const profileCache = new Map<string, { p: Profile; exp: number }>();

export async function getProfiles(ids: string[]): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = profileCache.get(id);
    if (hit && hit.exp > Date.now()) out.set(id, hit.p);
    else missing.push(id);
  }
  if (missing.length) {
    const { data } = await db.from('profiles').select('id, display_name, color, avatar_url').in('id', missing);
    for (const r of data ?? []) {
      const p: Profile = { id: r.id, displayName: r.display_name, color: r.color, avatarUrl: r.avatar_url };
      profileCache.set(r.id, { p, exp: Date.now() + 5 * 60_000 });
      out.set(r.id, p);
    }
  }
  return out;
}

export async function getProfile(id: string): Promise<Profile> {
  const p = (await getProfiles([id])).get(id);
  return p ?? { id, displayName: 'Someone', color: '#6b7280', avatarUrl: null };
}
