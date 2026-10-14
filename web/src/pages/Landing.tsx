import { Link, useNavigate } from 'react-router-dom';
import { MessageSquareText, Pencil, ShieldCheck, Github } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { useAuth } from '@/auth/AuthProvider';

const GITHUB_URL = (import.meta.env.VITE_GITHUB_URL as string | undefined) ?? 'https://github.com';

export default function Landing() {
  const { session } = useAuth();
  const nav = useNavigate();
  const go = (action: 'create' | 'join') => nav(session ? `/app?action=${action}` : `/signin?next=${encodeURIComponent(`/app?action=${action}`)}`);

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="flex items-center gap-1 text-sm" aria-label="Main">
            <a href="#features" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground sm:block">Features</a>
            <a href="#how" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground sm:block">How it works</a>
            <button onClick={() => window.dispatchEvent(new Event('codesync:open-assistant'))} className="rounded-md px-3 py-1.5 font-medium text-primary hover:bg-primary-soft">Ask AI</button>
            {session ? (
              <Button size="sm" variant="secondary" onClick={() => nav('/app')}>Open app</Button>
            ) : (
              <Link to="/signin" className="rounded-md px-3 py-1.5 font-medium hover:bg-muted">Sign in</Link>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pb-10 pt-16 sm:pt-24">
          <h1 className="max-w-2xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">Debug together. Solve faster.<span className="cs-cursor" aria-hidden /></h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            A shared coding workspace where your team can edit, execute, and debug code in real time.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" variant="primary" onClick={() => go('create')}>Create a Room</Button>
            <Button size="lg" onClick={() => go('join')}>Join a Room</Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-20">
          <ProductPreview />
        </section>

        <section id="features" className="border-t bg-subtle">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-3">
            {[
              { icon: Pencil, title: 'Real-time Editing', body: 'Everyone types in the same file. Changes merge automatically, and you can see each person’s cursor and selection as they work.' },
              { icon: MessageSquareText, title: 'Live Code Annotations', body: 'Click a line number to start a thread on that exact line. Reply, resolve, and jump straight back to the code.' },
              { icon: ShieldCheck, title: 'Secure Execution', body: 'Code runs in an isolated container with no network, strict memory and CPU limits, and a timeout. Everyone sees the output as it streams.' },
            ].map((f) => (
              <div key={f.title}>
                <f.icon className="h-5 w-5 text-primary" aria-hidden />
                <h2 className="mt-3 text-[15px] font-semibold">{f.title}</h2>
                <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {[
              ['Create a room', 'Name it, pick a language, and you get a private room with an invite link.'],
              ['Invite your team', 'Share the link. Teammates join from their browser — no install.'],
              ['Debug, annotate, run', 'Edit together, leave notes on suspicious lines, and run the code for everyone to see.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium text-muted-foreground">{i + 1}</span>
                <div>
                  <h3 className="text-sm font-semibold">{t}</h3>
                  <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground">
          <Logo className="text-foreground" />
          <nav className="flex gap-5" aria-label="Footer">
            <a className="inline-flex items-center gap-1.5 hover:text-foreground" href={GITHUB_URL} target="_blank" rel="noreferrer"><Github className="h-4 w-4" />GitHub</a>
            <Link className="hover:text-foreground" to="/docs">Documentation</Link>
            <Link className="hover:text-foreground" to="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** Static illustration of the workspace. It is a picture, not live data. */
function ProductPreview() {
  const code = [
    ['function', ' parsePrice(input) {'],
    ['  ', 'const', ' value = parseFloat(input);'],
    ['  ', 'return', ' value * 100;'],
    ['}'],
    [''],
    ['const', ' total = items.map(i => parsePrice(i.price))'],
    ['  .reduce((a, b) => a + b);'],
    ['console.log(', '"total:"', ', total);'],
  ];
  const kw = new Set(['function', 'const', 'return']);
  return (
    <figure aria-label="Illustration of the CodeSync workspace" className="overflow-hidden rounded-lg border bg-background">
      <div className="flex h-11 items-center justify-between border-b px-3">
        <div className="flex items-center gap-3 text-[13px]">
          <Logo text={false} className="[&_svg]:h-5 [&_svg]:w-5" />
          <span className="font-medium">API Bug Investigation</span>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-success" />Live</span>
        </div>
        <div className="flex -space-x-1.5">
          <Avatar name="Maya Chen" color="#4f46e5" size={24} ring />
          <Avatar name="Dev Patel" color="#059669" size={24} ring />
          <Avatar name="Sam Ortiz" color="#d97706" size={24} ring />
        </div>
      </div>
      <div className="grid md:grid-cols-[1fr_260px]">
        <div className="min-w-0 border-b font-mono text-[13px] leading-6 md:border-b-0 md:border-r">
          <div className="flex border-b bg-subtle text-xs text-muted-foreground">
            <span className="border-r border-t-2 border-t-primary bg-background px-3 py-1.5 text-foreground">pricing.js</span>
            <span className="px-3 py-1.5">cart.js</span>
          </div>
          <div className="py-2">
            {code.map((parts, i) => (
              <div key={i} className={`flex ${i === 2 ? 'bg-primary/[0.07]' : ''}`}>
                <span className="w-8 shrink-0 select-none pr-2 text-right text-xs text-muted-foreground/60">{i + 1}</span>
                <span className="w-4 shrink-0">{i === 2 && <span className="mt-2 block h-2.5 w-2.5 rounded-[3px] bg-primary" />}</span>
                <span className="whitespace-pre overflow-hidden text-ellipsis">
                  {parts.map((p, j) => (
                    <span key={j} className={kw.has(p.trim()) ? 'text-primary' : p.startsWith('"') ? 'text-success' : ''}>{p}</span>
                  ))}
                  {i === 2 && <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-[#059669]" />}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-3 text-[13px]">
          <p className="text-xs font-medium text-muted-foreground">Annotations</p>
          <div className="mt-2 rounded-md border p-2.5">
            <div className="flex items-center gap-2">
              <Avatar name="Dev Patel" color="#059669" size={20} />
              <span className="font-medium">Dev Patel</span>
              <span className="text-xs text-muted-foreground">pricing.js:3</span>
            </div>
            <p className="mt-1.5 leading-snug">This turns “19.99” into 1999.0000000000002. Round before returning.</p>
            <div className="mt-2 flex items-center gap-2 border-t pt-2">
              <Avatar name="Maya Chen" color="#4f46e5" size={20} />
              <span className="text-muted-foreground">Good catch — fixing now.</span>
            </div>
          </div>
        </div>
      </div>
      <div className="border-t bg-subtle px-3 py-2 font-mono text-xs">
        <span className="font-sans font-medium text-muted-foreground">Output</span>
        <span className="ml-3 text-muted-foreground">total: 3997.0000000000005</span>
        <span className="float-right font-sans text-success">Completed · 84 ms</span>
      </div>
    </figure>
  );
}
