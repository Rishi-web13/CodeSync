import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { FullPageSpinner } from '@/components/ui/spinner';

export default function JoinPage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.post<{ room: { id: string } }>('/rooms/join', { code })
      .then(({ room }) => !cancelled && nav(`/room/${room.id}`, { replace: true }))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [code, nav]);

  return (
    <div className="flex min-h-full flex-col bg-subtle">
      <header className="flex h-14 items-center px-5"><Logo /></header>
      <main className="flex flex-1 items-center justify-center px-4 pb-24">
        {error ? (
          <div className="max-w-sm rounded-lg border bg-background p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">Couldn’t join this room</h1>
            <p role="alert" className="mt-2 text-sm text-muted-foreground">{error}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Link to="/app"><Button>Back to your rooms</Button></Link>
            </div>
          </div>
        ) : (
          <FullPageSpinner label="Joining room…" />
        )}
      </main>
    </div>
  );
}
