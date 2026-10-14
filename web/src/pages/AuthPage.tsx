import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/config';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/auth/AuthProvider';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'That email and password don’t match. Check them and try again.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists. Sign in instead.';
  if (m.includes('email not confirmed')) return 'Confirm your email first — we sent you a link when you signed up.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('fetch')) return 'Can’t reach the authentication service. Check your connection.';
  return message;
}

export default function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const [params] = useSearchParams();
  const next = params.get('next') && params.get('next')!.startsWith('/') ? params.get('next')! : '/app';
  const nav = useNavigate();
  const { session } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  if (session) return <Navigate to={next} replace />;

  const validate = () => {
    const e: Record<string, string> = {};
    if (signup && !name.trim()) e.name = 'Enter your name so teammates recognize you.';
    if (!email.trim()) e.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) e.email = 'That doesn’t look like a valid email address.';
    if (!password) e.password = 'Enter your password.';
    else if (signup && password.length < 8) e.password = 'Use at least 8 characters.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    setNotice(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: `${window.location.origin}${next}` },
        });
        if (error) throw error;
        if (!data.session) setNotice(`We sent a confirmation link to ${email.trim()}. Open it to finish creating your account.`);
        else nav(next, { replace: true });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        nav(next, { replace: true });
      }
    } catch (err) {
      setFormError(friendly((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const github = async () => {
    setFormError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: `${window.location.origin}${next}` } });
    if (error) setFormError(friendly(error.message));
  };

  return (
    <div className="flex min-h-full flex-col bg-subtle">
      <header className="flex h-14 items-center px-5"><Logo /></header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:pt-16">
        <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{signup ? 'Create your account' : 'Sign in to CodeSync'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{signup ? 'Start debugging with your team in a minute.' : 'Welcome back.'}</p>

          {!isSupabaseConfigured && (
            <div className="mt-4 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[13px]" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>Supabase isn’t configured. Copy <code className="font-mono text-xs">web/.env.example</code> to <code className="font-mono text-xs">web/.env</code> and add your project URL and anon key.</span>
            </div>
          )}

          <Button className="mt-5 w-full" onClick={github} disabled={!isSupabaseConfigured}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" /></svg>
            Continue with GitHub
          </Button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>

          <form onSubmit={submit} noValidate className="space-y-4">
            {signup && (
              <Field label="Name" htmlFor="name" error={errors.name}>
                <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
              </Field>
            )}
            <Field label="Email" htmlFor="email" error={errors.email}>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
            </Field>
            <Field label="Password" htmlFor="password" error={errors.password} hint={signup && !errors.password ? 'At least 8 characters.' : undefined}>
              <Input id="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
            </Field>

            {formError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{formError}</p>}
            {notice && <p role="status" className="rounded-md bg-primary-soft px-3 py-2 text-[13px]">{notice}</p>}

            <Button type="submit" variant="primary" className="w-full" disabled={busy || !isSupabaseConfigured}>
              {busy && <Spinner className="text-primary-foreground" />}
              {signup ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {signup ? 'Already have an account? ' : 'New to CodeSync? '}
            <Link className="font-medium text-primary hover:underline" to={`${signup ? '/signin' : '/signup'}?next=${encodeURIComponent(next)}`}>
              {signup ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
