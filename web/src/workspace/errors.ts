import type { FileNode } from '@/lib/types';

export interface Segment { text: string; fileId?: string; line?: number }

/** Full path (a/b/c.ext) for every file, built from the folder tree. */
export function buildPaths(files: FileNode[]): Map<string, string> {
  const byId = new Map(files.map((f) => [f.id, f]));
  const out = new Map<string, string>();
  for (const f of files) {
    const parts = [f.name];
    let cur = f;
    for (let i = 0; i < 20 && cur.parentId; i++) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      cur = parent;
    }
    out.set(f.id, parts.join('/'));
  }
  return out;
}

const GENERIC = /(?:\/work\/)?((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/g;
const PYTHON = /File "(?:\/work\/)?([^"]+)", line (\d+)/g;

interface Ref { start: number; end: number; path: string; line: number }

/** Split stderr into lines, turning file:line references into clickable segments. */
export function parseErrors(stderr: string, files: FileNode[]): Segment[][] {
  const paths = buildPaths(files);
  const idByPath = new Map<string, string>();
  const idByName = new Map<string, string>();
  for (const [id, p] of paths) {
    idByPath.set(p, id);
    idByName.set(p.split('/').pop()!, id);
  }
  const resolve = (p: string) => idByPath.get(p) ?? idByName.get(p.split('/').pop()!);

  return stderr.replace(/\n$/, '').split('\n').map((line) => {
    const refs: Ref[] = [];
    for (const re of [PYTHON, GENERIC]) {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        if (!resolve(m[1])) continue;
        const start = m.index, end = m.index + m[0].length;
        if (refs.some((r) => start < r.end && end > r.start)) continue; // don't overlap
        refs.push({ start, end, path: m[1], line: Number(m[2]) });
      }
    }
    refs.sort((a, b) => a.start - b.start);
    const segs: Segment[] = [];
    let pos = 0;
    for (const r of refs) {
      if (r.start > pos) segs.push({ text: line.slice(pos, r.start) });
      segs.push({ text: line.slice(r.start, r.end), fileId: resolve(r.path), line: r.line });
      pos = r.end;
    }
    if (pos < line.length || segs.length === 0) segs.push({ text: line.slice(pos) });
    return segs;
  });
}

/** Line numbers referenced in a given file (used to tint lines in the editor). */
export function errorLinesFor(stderr: string, files: FileNode[], fileId: string | null): number[] {
  if (!fileId || !stderr) return [];
  const lines = new Set<number>();
  for (const segs of parseErrors(stderr, files)) for (const s of segs) if (s.fileId === fileId && s.line) lines.add(s.line);
  return [...lines];
}
