/**
 * Lets the floating assistant see what is going on in the workspace (current file text, last run output)
 * and apply a fix, without threading props through the whole app. The workspace and editor register
 * themselves here while a room is open.
 */
export interface AssistantCode { name: string; language: string; text: string; output?: string }

class Bridge {
  getText: (() => string) | null = null;
  getFile: (() => { name: string; language: string } | null) | null = null;
  getOutput: (() => string) | null = null;
  canEdit: (() => boolean) | null = null;
  applyText: ((text: string) => boolean) | null = null;
  private subs = new Set<() => void>();

  /** Subscribe to local typing in the editor. Returns an unsubscribe function. */
  onEdit(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  notifyEdit() { this.subs.forEach((cb) => cb()); }

  /** True while a file is open in a room. */
  get ready() { return !!(this.getText && this.getFile && this.getFile()); }

  snapshot(): AssistantCode | null {
    const file = this.getFile?.();
    if (!file || !this.getText) return null;
    const output = this.getOutput?.() || undefined;
    return { name: file.name, language: file.language, text: this.getText(), output: output ? output.slice(-4000) : undefined };
  }
}
export const assistantBridge = new Bridge();
