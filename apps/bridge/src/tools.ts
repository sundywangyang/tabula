import type { Result } from './types';

export type FileTypeCategory = 'all' | 'image' | 'document' | 'code' | 'archive' | 'audio' | 'video' | 'folder';
export interface ScanRequest { root: string; jobId: string; includeHidden?: boolean; maxDepth?: number }
export interface ContentHit { path: string; name: string; line: number; snippet: string }
export interface ScanResult<T> { items: T[]; warnings: string[]; cancelled: boolean; truncated: boolean }
export interface DuplicateGroup { hash: string; size: number; paths: string[] }
export interface FileActivity { id: string; timestamp: number; operation: string; phase: 'do' | 'undo' | 'redo'; paths: string[]; destinations?: string[] }
export interface LinkInfo { path: string; kind: 'symlink' | 'junction' | 'hardlink' | 'file' | 'directory'; target?: string; links: number; inode: string }
export interface NetworkRequest { protocol: 'smb' | 'nfs'; server: string; share: string; drive?: string; username?: string; password?: string }
export interface NetworkMount { path: string; remote: string; protocol: 'smb' | 'nfs' }
export interface ToolProgress { jobId: string; scanned: number; matched: number; currentPath: string }
export interface ToolMethods {
  contentSearch: { input: ScanRequest & { query: string; caseSensitive?: boolean }; output: ScanResult<ContentHit> };
  duplicates: { input: ScanRequest; output: ScanResult<DuplicateGroup> };
  cancel: { input: { jobId: string }; output: void };
  history: { input: { path?: string; limit?: number }; output: FileActivity[] };
  linkInfo: { input: { path: string }; output: LinkInfo };
  createLink: { input: { target: string; path: string; kind: 'symlink' | 'hardlink' }; output: LinkInfo };
  retargetLink: { input: { path: string; target: string }; output: LinkInfo };
  connect: { input: NetworkRequest; output: NetworkMount };
  mounts: { input: undefined; output: NetworkMount[] };
  disconnect: { input: { path: string }; output: void };
  folderIcon: { input: { path: string; image?: string; reset?: boolean }; output: string | null };
  folderIcons: { input: { paths: string[] }; output: Record<string, string> };
  defaultApplication: { input: { path: string }; output: { opened: boolean; message: string } };
}
export interface FileToolsApi {
  run<K extends keyof ToolMethods>(method: K, input: ToolMethods[K]['input']): Promise<Result<ToolMethods[K]['output']>>;
  onProgress(listener: (progress: ToolProgress) => void): () => void;
}
