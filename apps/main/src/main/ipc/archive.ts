import { ipcMain } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type { CompressRequest, ExtractRequest } from '@tabula/bridge';
import { archiveManager } from '../archive/archive-manager';

export function registerArchiveHandlers() {
  // =================== Archive (压缩 / 解压) ===================
  ipcMain.handle(IpcChannels.ARCHIVE_LIST, async (_e, archivePath: string) => {
    return archiveManager.list(archivePath);
  });
  ipcMain.handle(IpcChannels.ARCHIVE_COMPRESS, async (_e, req: CompressRequest) => {
    return archiveManager.compress(req);
  });
  ipcMain.handle(IpcChannels.ARCHIVE_EXTRACT, async (_e, req: ExtractRequest) => {
    return archiveManager.extract(req);
  });
  ipcMain.handle(IpcChannels.ARCHIVE_GET_JOB, async (_e, jobId: string) => {
    return archiveManager.getJob(jobId);
  });
  ipcMain.handle(IpcChannels.ARCHIVE_CANCEL_JOB, async (_e, jobId: string) => {
    return archiveManager.cancelJob(jobId);
  });
  // 注: ARCHIVE_JOB_UPDATE 推送由 archive-manager 在订阅 provider 时自动发到所有窗口,
  // 不在这里 register handler(那是渲染端 subscribe 的 channel)

}
