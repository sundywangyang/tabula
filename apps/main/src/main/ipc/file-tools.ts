import { ipcMain } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import { FileToolsService } from '../services/file-tools';
import * as tagsStore from '../store/tags-store';
import { mapError, ok } from '../fs/result';
import type { IpcContext } from './context';

export function registerFileToolsHandlers(ctx: IpcContext) {
  const tools = new FileToolsService(progress => {
    for (const window of ctx.windowManager.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IpcChannels.TOOLS_PROGRESS, progress);
  });
  ipcMain.handle(IpcChannels.TOOLS_RUN, (_event, method, input) => tools.run(method, input));

}

export function registerTagHandlers() {
  // =================== Tags (G008: 文件标记) ===================
  const tagsResult = (operation: () => unknown) => { try { return ok(operation()); } catch (error) { return mapError(error); } };
  ipcMain.handle(IpcChannels.TAGS_GET, (_e, path: string) => tagsResult(() => tagsStore.getTags(path)));
  ipcMain.handle(IpcChannels.TAGS_SET, (_e, path: string, tags: string[]) => {
    return tagsResult(() => tagsStore.setTags(path, tags));
  });
  ipcMain.handle(IpcChannels.TAGS_ADD, (_e, path: string, tag: string) => {
    return tagsResult(() => tagsStore.addTag(path, tag));
  });
  ipcMain.handle(IpcChannels.TAGS_REMOVE, (_e, path: string, tag: string) => {
    return tagsResult(() => tagsStore.removeTag(path, tag));
  });

}
