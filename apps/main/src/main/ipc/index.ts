/**
 * IPC 路由注册
 *
 * 所有 ipcMain.handle 集中在这里,主进程 API 入口。
 */
import { ipcMain, dialog, shell, app } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type { AppConfig, FsErrorCode, UpdateStatus } from '@tabula/bridge';
import type { WindowManager } from '../window/window-manager';
import * as fsService from '../fs/filesystem';
import * as trashService from '../fs/trash';
import { getConfig, setConfig, getAllConfig } from '../store/config';
import { extensionHost } from '../ext-host/extension-host';
import { getLogPaths, readTail, installLogSink } from '../infra/logger';
import { closeSplash, markRendererReady } from '../infra/splash';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getStatus as getUpdaterStatus,
} from '../infra/updater';
import { registerShortcutsHandlers } from './shortcuts';
import {
  registerPerfIpcHandlers,
} from '../perf/perf-service';

export interface IpcContext {
  windowManager: WindowManager;
}

export function registerIpcHandlers(ctx: IpcContext) {
  // =================== App ===================
  ipcMain.handle(IpcChannels.APP_VERSION, () => app.getVersion());
  ipcMain.handle(IpcChannels.APP_READY, () => true);
  ipcMain.handle(IpcChannels.APP_OPEN_DEVTOOLS, () => {
    ctx.windowManager.getMainWindow()?.webContents.openDevTools({ mode: 'detach' });
  });
  ipcMain.handle(IpcChannels.APP_RELOAD, () => {
    ctx.windowManager.getMainWindow()?.webContents.reload();
  });

  // =================== FS ===================
  ipcMain.handle(IpcChannels.FS_LIST_DIR, (_e, p: string) => {
  // eslint-disable-next-line no-console
  console.error('[ipc] FS_LIST_DIR path=', p);
  return fsService.listDir(p).then((r) => {
    // eslint-disable-next-line no-console
    console.error('[ipc] FS_LIST_DIR result ok=', r.ok, 'count=', r.ok ? r.data.entries.length : 'n/a');
    return r;
  });
});
  ipcMain.handle(IpcChannels.FS_READ_FILE, (_e, p: string, enc?: 'utf-8' | 'binary') =>
    fsService.readFile(p, enc),
  );
  ipcMain.handle(IpcChannels.FS_WRITE_FILE, (_e, p: string, data: string | ArrayBuffer) =>
    fsService.writeFile(p, data),
  );
  ipcMain.handle(IpcChannels.FS_DELETE, (_e, paths: string[], useTrash?: boolean) =>
    fsService.deletePaths(paths, useTrash),
  );
  ipcMain.handle(IpcChannels.FS_RENAME, (_e, oldPath: string, newPath: string) =>
    fsService.rename(oldPath, newPath),
  );
  ipcMain.handle(IpcChannels.FS_MOVE, (_e, req) => fsService.move(req));
  ipcMain.handle(IpcChannels.FS_COPY, (_e, req) => fsService.copy(req));
  ipcMain.handle(IpcChannels.FS_MKDIR, (_e, p: string, name?: string) =>
    fsService.mkdir(p, name),
  );
  ipcMain.handle(IpcChannels.FS_EXISTS, (_e, p: string) => fsService.exists(p));
  ipcMain.handle(IpcChannels.FS_STAT, (_e, p: string) => fsService.stat(p));

  ipcMain.handle(IpcChannels.FS_PICK_DIRECTORY, async (e) => {
    const win = ctx.windowManager.getWindow(e.sender.id.toString()) ?? ctx.windowManager.getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.FS_PICK_FILE, async (e, opts) => {
    const win = ctx.windowManager.getWindow(e.sender.id.toString()) ?? ctx.windowManager.getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: opts?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: opts?.filters,
    });
    if (result.canceled) return null;
    return opts?.multi ? result.filePaths : result.filePaths[0];
  });
  ipcMain.handle(IpcChannels.FS_SHOW_IN_FOLDER, (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.handle(IpcChannels.FS_OPEN_PATH, (_e, p: string) => shell.openPath(p));
  ipcMain.handle(IpcChannels.FS_LIST_DRIVES, () => fsService.listDrives());

  // =================== Trash (P3 v1) ===================
  ipcMain.handle(IpcChannels.FS_TRASH_LIST, () => trashService.trashList());
  ipcMain.handle(IpcChannels.FS_TRASH_RESTORE, (_e, itemPath: string, originalPath?: string) =>
    trashService.trashRestore(itemPath, originalPath),
  );
  ipcMain.handle(IpcChannels.FS_TRASH_EMPTY, () => trashService.trashEmpty());

  // =================== Search (P4 v1) ===================
  ipcMain.handle(IpcChannels.FS_SEARCH, (_e, req) => fsService.search(req));

  // =================== Tabs (P0 桩) ===================
  ipcMain.handle(IpcChannels.TABS_OPEN, () => {
    return null; // TODO: P2 实现
  });
  ipcMain.handle(IpcChannels.TABS_CLOSE, () => null);
  ipcMain.handle(IpcChannels.TABS_ACTIVATE, () => null);
  ipcMain.handle(IpcChannels.TABS_MOVE, () => null);
  ipcMain.handle(IpcChannels.TABS_LIST, () => []);

  // =================== Panes (P0 桩) ===================
  ipcMain.handle(IpcChannels.PANES_SPLIT, () => null);
  ipcMain.handle(IpcChannels.PANES_MERGE, () => null);
  ipcMain.handle(IpcChannels.PANES_FOCUS, () => null);
  ipcMain.handle(IpcChannels.PANES_LAYOUT_GET, () => null);
  ipcMain.handle(IpcChannels.PANES_LAYOUT_SET, () => null);

  // =================== Windows ===================
  ipcMain.handle(IpcChannels.WIN_OPEN, (_e, initialPath?: string) => {
    const win = ctx.windowManager.createMainWindow({ initialPath });
    return win.id.toString();
  });
  // P2 v2: 拖出 tab 到新窗口
  ipcMain.handle(IpcChannels.WIN_OPEN_WITH_TAB, (_e, req: { initialPath: string; title?: string }) => {
    const win = ctx.windowManager.createMainWindow({ initialPath: req.initialPath });
    if (req.title) {
      win.setTitle(req.title);
    }
    return win.id.toString();
  });
  // P2 v2: 新窗口启动时由渲染进程询问初始路径
  ipcMain.handle(IpcChannels.WIN_GET_BOOT_PATH, (e) => {
    return ctx.windowManager.getInitialPath(e.sender.id.toString());
  });
  ipcMain.handle(IpcChannels.WIN_CLOSE, (_e, id: string) => {
    ctx.windowManager.getWindow(id)?.close();
  });
  ipcMain.handle(IpcChannels.WIN_LIST, () => {
    return ctx.windowManager.getAllWindows().map((w) => w.id.toString());
  });
  ipcMain.handle(IpcChannels.WIN_FOCUS, (_e, id: string) => {
    ctx.windowManager.getWindow(id)?.focus();
  });

  // =================== Extensions (P6) ===================
  ipcMain.handle(IpcChannels.EXT_LIST, () => extensionHost.list());
  ipcMain.handle(IpcChannels.EXT_ENABLE, async (_e, id: string) => {
    await extensionHost.enable(id);
  });
  ipcMain.handle(IpcChannels.EXT_DISABLE, async (_e, id: string) => {
    await extensionHost.disable(id);
  });
  ipcMain.handle(IpcChannels.EXT_INSTALL, async (_e, sourcePath: string) => {
    try {
      const userExtensionsDir = getConfig('extensionsDir');
      const manifest = await extensionHost.install(sourcePath, userExtensionsDir);
      return { ok: true, data: manifest };
    } catch (err) {
      const error = err as Error;
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: error.message } };
    }
  });
  ipcMain.handle(IpcChannels.EXT_UNINSTALL, async (_e, id: string) => {
    const userExtensionsDir = getConfig('extensionsDir');
    await extensionHost.uninstall(id, userExtensionsDir);
  });
  ipcMain.handle(IpcChannels.EXT_INVOKE_COMMAND, async (_e, command: string, args: unknown[]) => {
    return extensionHost.invokeCommand(command, ...(args ?? []));
  });
  ipcMain.handle(IpcChannels.EXT_GET_PANELS, () => extensionHost.getRegisteredPanels());

  // =================== Config ===================
  ipcMain.handle(IpcChannels.CFG_GET, (_e, key: keyof AppConfig) => getConfig(key));
  ipcMain.handle(IpcChannels.CFG_SET, (_e, key: keyof AppConfig, value: unknown) =>
    setConfig(key, value as never),
  );
  ipcMain.handle(IpcChannels.CFG_ALL, () => getAllConfig());

  // =================== P7 Splash ===================
  ipcMain.on(IpcChannels.SPLASH_READY, () => {
    // 渲染端(splash 自身)首次渲染完成,标记 ready
    markRendererReady();
    // 同时关闭 splash(若主窗口已经 ready-to-show 过)
    closeSplash();
  });

  // =================== P7 Update ===================
  ipcMain.handle(IpcChannels.UPDATE_CHECK, async (): Promise<UpdateStatus> => {
    return checkForUpdates();
  });
  ipcMain.handle(IpcChannels.UPDATE_DOWNLOAD, async (): Promise<UpdateStatus> => {
    return downloadUpdate();
  });
  ipcMain.handle(IpcChannels.UPDATE_INSTALL, () => {
    installUpdate();
  });
  ipcMain.handle(IpcChannels.UPDATE_GET_STATUS, (): UpdateStatus => {
    return getUpdaterStatus();
  });

  // =================== P7 Log ===================
  // 安装渲染端 → 主进程的 log:entry 接收(写 renderer.log + 推给所有窗口)
  installLogSink();

  ipcMain.handle(IpcChannels.LOG_GET_PATHS, () => getLogPaths());
  ipcMain.handle(IpcChannels.LOG_OPEN_DIR, async () => {
    const dir = getLogPaths().dir;
    // shell.openPath 在文件不存在时返回 error string,正常情况返回 ''
    return shell.openPath(dir);
  });
  ipcMain.handle(
    IpcChannels.LOG_GET_LINES,
    async (_e, opts?: { source?: 'main' | 'renderer'; limit?: number }) => {
      const source = opts?.source ?? 'main';
      const limit = opts?.limit ?? 200;
      return readTail(source, limit);
    },
  );
  // 注: IpcChannels.LOG_ENTRY 走 installLogSink() 注册(在 installLogSink 内)

  // =================== P7 Shortcuts ===================
  registerShortcutsHandlers();

  // =================== P7 Perf ===================
  // 仅注册 IPC handler,内存采样定时器由 main/index.ts bootstrap 单独启动
  // (避免 IPC 注册被混入定时器副作用,也便于 perf 模块职责单一)
  registerPerfIpcHandlers(ctx);
}
