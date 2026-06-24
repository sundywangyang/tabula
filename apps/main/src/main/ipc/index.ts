/**
 * IPC 路由注册
 *
 * 所有 ipcMain.handle 集中在这里,主进程 API 入口。
 */
import { ipcMain, dialog, shell, app, clipboard } from 'electron';
import { promises as fs } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { IpcChannels } from '@tabula/bridge';
import type {
  AppConfig,
  FsChecksumRequest,
  FsCreateSymlinkRequest,
  FsErrorCode,
  FsSetPermissionsRequest,
  UpdateStatus,
} from '@tabula/bridge';
import { handleSetPermissions, handleCreateSymlink, handleChecksum } from './handlers';
import type { WindowManager } from '../window/window-manager';
import * as fsService from '../fs/filesystem';
import * as trashService from '../fs/trash';
import * as dirSizeService from '../fs/dir-size';
import { getThumbnail } from '../fs/thumbnail';
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
import { dispatchRunCommand } from '../keymap/command-dispatcher';
import { getWindowProvider } from '../providers/window';
import { getShellProvider } from '../providers/shell';
import { archiveManager } from '../archive/archive-manager';
import * as tagsStore from '../store/tags-store';
import { undoManager } from '../undo/undo-manager';
import type { CompressRequest, ExtractRequest } from '@tabula/bridge';

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

  // =================== Platform ===================
  ipcMain.handle(IpcChannels.PLATFORM_GET, () => {
    const id = process.platform;
    if (id === 'win32') return 'windows';
    if (id === 'darwin') return 'macos';
    return 'linux';
  });
  ipcMain.handle(IpcChannels.PLATFORM_DEFAULT_ROOT, () => getWindowProvider().getDefaultRootPath());

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
  ipcMain.handle(IpcChannels.FS_MOVE, (_e, req) => {
    // eslint-disable-next-line no-console
    console.error('[ipc] FS_MOVE req=', req);
    return fsService.move(req);
  });
  ipcMain.handle(IpcChannels.FS_COPY, async (_e, req) => {
    // Inline copy to avoid any req object mutation edge cases
    const sources: string[] = req.sources;
    const destination: string = req.destination;
    const overwrite: boolean = req.overwrite ?? false;
    // eslint-disable-next-line no-console
    console.error('[ipc-cp] sources=', sources, 'destination=', destination);
    for (const src of sources) {
      const dest = join(destination, basename(src));
      // eslint-disable-next-line no-console
      console.error('[ipc-cp] copying', src, '->', dest);
      try {
        await fs.cp(src, dest, { recursive: true, force: overwrite });
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        // eslint-disable-next-line no-console
        console.error('[ipc-cp] ERROR:', e.code, e.message);
        return { ok: false, error: { code: e.code ?? 'UNKNOWN', message: e.message, path: src } };
      }
    }
    return { ok: true, data: undefined };
  });
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

  // =================== Dir size (G016: 后台异步 + 取消) ===================
  ipcMain.handle(IpcChannels.FS_GET_DIR_SIZE, (_e, p: string) =>
    dirSizeService.handleGetDirSize(p),
  );
  ipcMain.handle(IpcChannels.FS_CANCEL_DIR_SIZE, (_e, id: string) =>
    dirSizeService.handleCancelDirSize(id),
  );

  // =================== Clipboard (new) ===================
  ipcMain.handle(IpcChannels.FS_WRITE_CLIPBOARD, (_e, text: string) => {
    clipboard.writeText(text);
  });

  // =================== Open With (new) ===================
  ipcMain.handle(IpcChannels.FS_OPEN_WITH_DIALOG, async (_e, p: string) => {
    const win = ctx.windowManager.getMainWindow();
    if (!win) return;

    const result = await dialog.showOpenDialog(win, {
      title: '选择要使用的程序',
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return;
    const program = result.filePaths[0];

    // 平台特定 spawn 走 platform adapter
    return getShellProvider().openWith(p, program);
  });

  // 「另存为」对话框(用于压缩时用户指定 zip 路径和文件名)
  ipcMain.handle(IpcChannels.FS_SAVE_DIALOG, async (e, opts?: {
    title?: string;
    defaultPath?: string;
    filters?: Electron.FileFilter[];
  }) => {
    const win = ctx.windowManager.getWindow(e.sender.id.toString()) ?? ctx.windowManager.getMainWindow();
    const result = await dialog.showSaveDialog(win!, {
      title: opts?.title ?? '保存文件',
      defaultPath: opts?.defaultPath,
      filters: opts?.filters ?? [{ name: 'ZIP 压缩文件', extensions: ['zip'] }],
    });
    return result.canceled ? null : result.filePath;
  });

  // =================== Set Permissions (G010: 锁定/解锁) ===================
  // Windows: fs.chmod 0o444/0o644 走 ReadOnly bit;Unix: 标准 POSIX 模式位
  ipcMain.handle(IpcChannels.FS_SET_PERMISSIONS, (_e, req: FsSetPermissionsRequest) =>
    handleSetPermissions(req, chmod),
  );

  // =================== Create Symlink (G011: 创建快捷方式) ===================
  // Windows: junction(目录)/ file symlink(文件);Unix: dir / file
  ipcMain.handle(IpcChannels.FS_CREATE_SYMLINK, (_e, req: FsCreateSymlinkRequest) =>
    handleCreateSymlink(req),
  );

  // =================== Checksum (G015: SHA-256 / SHA-1 / MD5) ===================
  // 流式 createReadStream + crypto.createHash,大文件友好
  ipcMain.handle(IpcChannels.FS_CHECKSUM, (_e, req: FsChecksumRequest) =>
    handleChecksum(req),
  );

  // =================== Thumbnail (P7 v1) ===================
  ipcMain.handle(IpcChannels.FS_GET_THUMBNAIL, (_e, p: string) => {
    return getThumbnail(p);
  });

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
  // 关闭当前窗口（渲染进程自己调用）
  ipcMain.handle(IpcChannels.WIN_CLOSE_CURRENT, (e) => {
    const win = ctx.windowManager.getWindow(e.sender.id.toString()) ?? ctx.windowManager.getMainWindow();
    win?.close();
  });
  ipcMain.handle(IpcChannels.WIN_MINIMIZE, (e) => {
    const win = ctx.windowManager.getWindow(e.sender.id.toString()) ?? ctx.windowManager.getMainWindow();
    win?.minimize();
  });
  ipcMain.handle(IpcChannels.WIN_MAXIMIZE, (e) => {
    const win = ctx.windowManager.getWindow(e.sender.id.toString()) ?? ctx.windowManager.getMainWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle(IpcChannels.WIN_IS_MAXIMIZED, (e) => {
    const win = ctx.windowManager.getWindow(e.sender.id.toString()) ?? ctx.windowManager.getMainWindow();
    return win?.isMaximized() ?? false;
  });
  ipcMain.handle(IpcChannels.WIN_LIST, () => {
    return ctx.windowManager.getAllWindows().map((w) => w.id.toString());
  });
  ipcMain.handle(IpcChannels.WIN_FOCUS, (_e, id: string) => {
    ctx.windowManager.getWindow(id)?.focus();
  });

  // =================== Extensions (P6) ===================
  ipcMain.handle(IpcChannels.EXT_LIST, () => extensionHost.list());
  ipcMain.handle(IpcChannels.EXT_ENABLE, (_e, id: string) => extensionHost.enable(id));
  ipcMain.handle(IpcChannels.EXT_DISABLE, (_e, id: string) => extensionHost.disable(id));
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

  // =================== P7 v1 收口:命令执行 (Ctrl+Shift+P 命令面板) ===================
  // 渲染端命令面板 / 其它来源请求执行一条内置命令;主进程校验合法性后,
  // 通过 `commands:run-command` 事件把命令 id 推回发起方所在的渲染窗口。
  // 实际命令体在渲染端(`runCommandById` 统一执行),这样保持「单一来源」
  // — 同一份命令体既被 keydown handler 触发,也被命令面板触发。
  ipcMain.handle(
    IpcChannels.COMMANDS_RUN,
    (evt, commandId: string, args?: unknown[]) =>
      dispatchRunCommand(evt, commandId, args),
  );

  // =================== P7 Perf ===================
  // 仅注册 IPC handler,内存采样定时器由 main/index.ts bootstrap 单独启动
  // (避免 IPC 注册被混入定时器副作用,也便于 perf 模块职责单一)
  registerPerfIpcHandlers(ctx);

  // =================== Shell:打开系统终端 ===================
  ipcMain.handle(IpcChannels.SHELL_OPEN_TERMINAL, async (_e, path: string) => {
    return getShellProvider().openTerminal(path);
  });

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

  // =================== Tags (G008: 文件标记) ===================
  ipcMain.handle(IpcChannels.TAGS_GET, (_e, path: string) => tagsStore.getTags(path));
  ipcMain.handle(IpcChannels.TAGS_SET, (_e, path: string, tags: string[]) => {
    tagsStore.setTags(path, tags);
  });
  ipcMain.handle(IpcChannels.TAGS_ADD, (_e, path: string, tag: string) => {
    tagsStore.addTag(path, tag);
  });
  ipcMain.handle(IpcChannels.TAGS_REMOVE, (_e, path: string, tag: string) => {
    tagsStore.removeTag(path, tag);
  });

  // =================== Undo / Redo (G012) ===================
  // 弹栈 → 执行 op.undo() → 推到 redo 栈。
  // 空栈时返回 { ok: true, data: null }(渲染端 Ctrl+Z 没东西时静默 noop)。
  // op.undo() 抛错 → 包成 IO_ERROR Result。
  ipcMain.handle(IpcChannels.UNDO_UNDO, async () => {
    try {
      const op = await undoManager.undo();
      return {
        ok: true,
        data: op ? { id: op.id, label: op.label, timestamp: op.timestamp } : null,
      };
    } catch (err) {
      const e = err as Error;
      return { ok: false, error: { code: 'IO_ERROR', message: e.message } };
    }
  });
  ipcMain.handle(IpcChannels.UNDO_REDO, async () => {
    try {
      const op = await undoManager.redo();
      return {
        ok: true,
        data: op ? { id: op.id, label: op.label, timestamp: op.timestamp } : null,
      };
    } catch (err) {
      const e = err as Error;
      return { ok: false, error: { code: 'IO_ERROR', message: e.message } };
    }
  });
  ipcMain.handle(IpcChannels.UNDO_GET_STACK, async () => {
    return { ok: true, data: undoManager.getStack() };
  });
}
