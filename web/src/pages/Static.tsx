import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-full bg-background">
      <header className="border-b"><div className="mx-auto flex h-14 max-w-3xl items-center px-5"><Logo /></div></header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-8 space-y-8 text-[15px] leading-relaxed [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:max-w-prose [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_kbd]:rounded [&_kbd]:border [&_kbd]:bg-muted [&_kbd]:px-1.5 [&_kbd]:font-mono [&_kbd]:text-xs">{children}</div>
      </main>
    </div>
  );
}

export function DocsPage() {
  return (
    <Page title="Documentation">
      <section><h2>Rooms and invites</h2><p>Create a room from your dashboard. Use <strong>Invite</strong> in the top bar to copy a link; anyone who opens it while signed in joins as an editor. The owner can change anyone’s role to view-only, remove them, or delete the room under <strong>Room settings</strong>.</p></section>
      <section><h2>Editing together</h2><p>Every file is a shared document. Edits merge automatically, and you’ll see collaborators’ cursors and selections. A dot on a tab means that file has edits that haven’t reached the server yet — usually because you’re offline. They sync when you reconnect.</p></section>
      <section><h2>Annotations</h2><p>Click a line number to leave a comment on that line. Threads show in the right panel; click one to jump to its line. Resolve a thread when it’s handled, reopen it if it comes back. Annotations are attached to a line number, so if code above them is inserted or deleted they can point at a neighbouring line — resolve and re-create them if that happens.</p></section>
      <section><h2>Running code</h2><p>Only the room’s <strong>runner</strong> can start a run (the owner by default, transferable in settings). The program runs in an isolated container with no network access, limited memory and CPU, and a time limit. Output, errors, and the console log appear for everyone in the room. Use the <strong>Input</strong> box in the bottom panel to provide standard input.</p>
        <ul><li>JavaScript, TypeScript, Python, Java, C, C++, Go, and Ruby can run.</li><li>Other languages are editable but not runnable.</li><li>Java runs the file you have open as a single-file program.</li></ul></section>
      <section><h2>Keyboard shortcuts</h2><ul><li><kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd> runs the current file (if you’re the runner).</li><li><kbd>Ctrl/⌘</kbd> + <kbd>B</kbd> toggles the file sidebar.</li><li><kbd>Ctrl/⌘</kbd> + <kbd>J</kbd> toggles the output panel.</li></ul></section>
    </Page>
  );
}

export function PrivacyPage() {
  return (
    <Page title="Privacy">
      <section><h2>What we store</h2><p>Your account (name, email, avatar), the rooms you belong to, the files and annotations in those rooms, and the results of code runs. Live cursor positions are never stored.</p></section>
      <section><h2>Who can see it</h2><p>Only members of a room can read its contents. Rooms are private and joined by invite link. Room owners can remove members at any time.</p></section>
      <section><h2>Running code</h2><p>Code you run executes in a short-lived container without network access. The container and its files are deleted when the run ends.</p></section>
      <section><h2>Deleting data</h2><p>Deleting a room permanently removes its files, annotations, and run history.</p></section>
    </Page>
  );
}
