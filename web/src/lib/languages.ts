export interface Lang { id: string; label: string; ext: string; runnable: boolean; badge: string; color: string }

// Mirrors server/src/lib/languages.ts (the server is authoritative for what can run).
export const LANGUAGES: Lang[] = [
  { id: 'javascript', label: 'JavaScript', ext: 'js', runnable: true, badge: 'JS', color: '#ca8a04' },
  { id: 'typescript', label: 'TypeScript', ext: 'ts', runnable: true, badge: 'TS', color: '#2563eb' },
  { id: 'python', label: 'Python', ext: 'py', runnable: true, badge: 'PY', color: '#0e7490' },
  { id: 'java', label: 'Java', ext: 'java', runnable: true, badge: 'JV', color: '#c2410c' },
  { id: 'cpp', label: 'C++', ext: 'cpp', runnable: true, badge: 'C+', color: '#4f46e5' },
  { id: 'c', label: 'C', ext: 'c', runnable: true, badge: 'C', color: '#475569' },
  { id: 'go', label: 'Go', ext: 'go', runnable: true, badge: 'GO', color: '#0891b2' },
  { id: 'ruby', label: 'Ruby', ext: 'rb', runnable: true, badge: 'RB', color: '#dc2626' },
  { id: 'rust', label: 'Rust', ext: 'rs', runnable: false, badge: 'RS', color: '#9a3412' },
  { id: 'php', label: 'PHP', ext: 'php', runnable: false, badge: 'PH', color: '#6d28d9' },
  { id: 'sql', label: 'SQL', ext: 'sql', runnable: false, badge: 'SQ', color: '#0f766e' },
  { id: 'shell', label: 'Shell', ext: 'sh', runnable: false, badge: 'SH', color: '#15803d' },
  { id: 'html', label: 'HTML', ext: 'html', runnable: false, badge: 'HT', color: '#ea580c' },
  { id: 'css', label: 'CSS', ext: 'css', runnable: false, badge: 'CS', color: '#2563eb' },
  { id: 'json', label: 'JSON', ext: 'json', runnable: false, badge: '{}', color: '#a16207' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', runnable: false, badge: 'YM', color: '#be123c' },
  { id: 'markdown', label: 'Markdown', ext: 'md', runnable: false, badge: 'MD', color: '#475569' },
  { id: 'plaintext', label: 'Plain text', ext: 'txt', runnable: false, badge: 'TX', color: '#6b7280' },
];
export const LANG = new Map(LANGUAGES.map((l) => [l.id, l]));
export const langOf = (id: string): Lang => LANG.get(id) ?? LANG.get('plaintext')!;
