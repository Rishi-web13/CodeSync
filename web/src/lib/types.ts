export type Role = 'owner' | 'editor' | 'viewer';

export interface Me { id: string; email: string | null; displayName: string; color: string; avatarUrl: string | null }
export interface Room { id: string; code: string; name: string; defaultLanguage: string; ownerId: string; runnerId: string | null; createdAt: string }
export interface RoomSummary extends Room { role: Role }
export interface Member { userId: string; role: Role; joinedAt: string; displayName: string; color: string; avatarUrl: string | null }
export interface FileNode { id: string; parentId: string | null; kind: 'file' | 'folder'; name: string; language: string; updatedAt: string }
export interface RoomPayload {
  room: Room; role: Role; members: Member[]; online: string[]; files: FileNode[]; execEnabled: boolean; activeExecutionId: string | null;
}
export interface Person { displayName: string; color: string; avatarUrl: string | null }
export interface Reply { id: string; authorId: string; body: string; createdAt: string }
export interface Annotation {
  id: string; fileId: string; line: number; authorId: string; body: string; resolved: boolean;
  resolvedBy: string | null; resolvedAt: string | null; createdAt: string; replies: Reply[];
}
export interface ActivityEvent { id: string; type: string; userId: string | null; data: Record<string, any>; createdAt: string }
export interface ExecutionRecord {
  id: string; fileId: string | null; startedBy: string | null; language: string; status: 'running' | 'completed' | 'failed';
  exitCode: number | null; durationMs: number | null; stdout: string; stderr: string; createdAt: string;
}

export type ExecStatus = 'idle' | 'running' | 'completed' | 'failed';
export interface LogEntry { ts: number; kind: 'system' | 'stdout' | 'stderr'; text: string }
export interface ExecState {
  id: string | null; status: ExecStatus; startedBy: string | null; startedAt: number | null; fileId: string | null;
  filePath: string | null; stdout: string; stderr: string; logs: LogEntry[]; exitCode: number | null; durationMs: number | null;
}

export interface ChatMessage { id: string; authorId: string | null; body: string; createdAt: string }
