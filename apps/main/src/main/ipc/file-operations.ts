import { IpcChannels } from '@tabula/bridge';
import type { FileOperations } from '../fs/operations';

type Handle = (channel: string, listener: (event: any, ...args: any[]) => unknown) => void;

/** Shared by the real IPC registration and integration tests. */
export function registerFileOperationHandlers(handle: Handle, operations: FileOperations): void {
  handle(IpcChannels.FS_WRITE_FILE, (_event, path, data) => operations.writeFile(path, data));
  handle(IpcChannels.FS_DELETE, (_event, paths, useTrash) => operations.delete(paths, useTrash));
  handle(IpcChannels.FS_RENAME, (_event, oldPath, newPath) => operations.rename(oldPath, newPath));
  handle(IpcChannels.FS_BATCH_RENAME, (_event, items) => operations.batchRename(items));
  handle(IpcChannels.FS_COPY, (_event, request) => operations.copy(request));
  handle(IpcChannels.FS_MOVE, (_event, request) => operations.move(request));
  handle(IpcChannels.FS_MKDIR, (_event, path, name) => operations.mkdir(path, name));
}
