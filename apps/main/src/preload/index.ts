/**
 * Preload 脚本
 *
 * 通过 contextBridge 暴露白名单 API 给渲染进程。
 * 渲染进程通过 `window.tabula.xxx` 调用。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type { TabulaAPI } from '@tabula/bridge';

// 事件订阅封装
function makeEvents() {
  return {
    on<T = unknown>(channel: string, listener: (payload: T) => void): () => void {
      const wrapped = (_e: IpcRendererEvent, payload: T) => listener(payload);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
    off(channel: string, listener: (...args: any[]) => void): void {
      ipcRenderer.removeListener(channel, listener);
    },
  };
}

/**
 * 主进程主动 push 的事件通道(send 方向);contextBridge 这边走 events.on 统一订阅。
 * 下面 PERF_PUSH_CHANNELS 列出来,perf.onMemorySample 自动用这个列表路由。
 */
const PERF_PUSH_CHANNELS: readonly string[] = [IpcChannels.PERF_MEMORY_SAMPLE];

const api: TabulaAPI = {
  app: {
    version: () => ipcRenderer.invoke(IpcChannels.APP_VERSION),
    ready: () => ipcRenderer.invoke(IpcChannels.APP_READY),
    openDevTools: () => ipcRenderer.invoke(IpcChannels.APP_OPEN_DEVTOOLS),
    reload: () => ipcRenderer.invoke(IpcChannels.APP_RELOAD),
  },

  platform: {
    get: () => ipcRenderer.invoke(IpcChannels.PLATFORM_GET),
    defaultRootPath: () => ipcRenderer.invoke(IpcChannels.PLATFORM_DEFAULT_ROOT),
  },

  // P7 启动屏
  splash: {
    ready: () => {
      ipcRenderer.send(IpcChannels.SPLASH_READY);
      return Promise.resolve();
    },
    onProgress: (listener) => {
      const wrapped = (_e: IpcRendererEvent, payload: { progress: number; message: string }) =>
        listener(payload);
      ipcRenderer.on(IpcChannels.SPLASH_PROGRESS, wrapped);
      return () => ipcRenderer.removeListener(IpcChannels.SPLASH_PROGRESS, wrapped);
    },
  },

  // P7 自动更新
  update: {
    check: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD),
    install: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL),
    getStatus: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATUS),
    onAvailable: (listener) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped = (_e: IpcRendererEvent, payload: any) => listener(payload);
      ipcRenderer.on(IpcChannels.UPDATE_AVAILABLE, wrapped);
      return () => ipcRenderer.removeListener(IpcChannels.UPDATE_AVAILABLE, wrapped);
    },
    onNotAvailable: (listener) => {
      const wrapped = () => listener();
      ipcRenderer.on(IpcChannels.UPDATE_NOT_AVAILABLE, wrapped);
      return () => ipcRenderer.removeListener(IpcChannels.UPDATE_NOT_AVAILABLE, wrapped);
    },
    onDownloadProgress: (listener) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped = (_e: IpcRendererEvent, payload: any) => listener(payload);
      ipcRenderer.on(IpcChannels.UPDATE_DOWNLOAD_PROGRESS, wrapped);
      return () => ipcRenderer.removeListener(IpcChannels.UPDATE_DOWNLOAD_PROGRESS, wrapped);
    },
    onDownloaded: (listener) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped = (_e: IpcRendererEvent, payload: any) => listener(payload);
      ipcRenderer.on(IpcChannels.UPDATE_DOWNLOADED, wrapped);
      return () => ipcRenderer.removeListener(IpcChannels.UPDATE_DOWNLOADED, wrapped);
    },
    onError: (listener) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped = (_e: IpcRendererEvent, payload: any) => listener(payload);
      ipcRenderer.on(IpcChannels.UPDATE_ERROR, wrapped);
      return () => ipcRenderer.removeListener(IpcChannels.UPDATE_ERROR, wrapped);
    },
  },

  // P7 错误日志
  log: {
    getPaths: () => ipcRenderer.invoke(IpcChannels.LOG_GET_PATHS),
    openDir: () => ipcRenderer.invoke(IpcChannels.LOG_OPEN_DIR),
    getLines: (opts) => ipcRenderer.invoke(IpcChannels.LOG_GET_LINES, opts),
    write: (level, message) => {
      // 走 IPC 推给主进程 log:entry 接收 → installLogSink() 写 renderer.log
      ipcRenderer.send(IpcChannels.LOG_ENTRY, {
        level,
        message,
        source: 'renderer',
        timestamp: Date.now(),
      });
      return Promise.resolve();
    },
    onEntry: (listener) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped = (_e: IpcRendererEvent, payload: any) => listener(payload);
      ipcRenderer.on(IpcChannels.LOG_ENTRY, wrapped);
      return () => ipcRenderer.removeListener(IpcChannels.LOG_ENTRY, wrapped);
    },
  },

  // P7 性能埋点 (sibling p7-perf)
  perf: {
    report: (event) => ipcRenderer.invoke(IpcChannels.PERF_REPORT, event),
    snapshot: () => ipcRenderer.invoke(IpcChannels.PERF_SNAPSHOT),
    getStartupTimings: () => ipcRenderer.invoke(IpcChannels.PERF_STARTUP_TIMES),
    getMemorySamples: (limit) => ipcRenderer.invoke(IpcChannels.PERF_MEMORY_SAMPLE, limit),
    onMemorySample: (listener) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped = (_e: IpcRendererEvent, payload: any) => listener(payload);
      ipcRenderer.on(IpcChannels.PERF_MEMORY_SAMPLE, wrapped);
      return () => ipcRenderer.removeListener(IpcChannels.PERF_MEMORY_SAMPLE, wrapped);
    },
  },

  fs: {
    listDir: (p) => ipcRenderer.invoke(IpcChannels.FS_LIST_DIR, p),
    readFile: (p, enc) => ipcRenderer.invoke(IpcChannels.FS_READ_FILE, p, enc),
    writeFile: (p, data) => ipcRenderer.invoke(IpcChannels.FS_WRITE_FILE, p, data),
    delete: (paths, useTrash) => ipcRenderer.invoke(IpcChannels.FS_DELETE, paths, useTrash),
    rename: (oldPath, newPath) => ipcRenderer.invoke(IpcChannels.FS_RENAME, oldPath, newPath),
    move: (req) => ipcRenderer.invoke(IpcChannels.FS_MOVE, req),
    copy: (req) => ipcRenderer.invoke(IpcChannels.FS_COPY, req),
    mkdir: (p, name) => ipcRenderer.invoke(IpcChannels.FS_MKDIR, p, name),
    exists: (p) => ipcRenderer.invoke(IpcChannels.FS_EXISTS, p),
    stat: (p) => ipcRenderer.invoke(IpcChannels.FS_STAT, p),
    pickDirectory: () => ipcRenderer.invoke(IpcChannels.FS_PICK_DIRECTORY),
    pickFile: (opts) => ipcRenderer.invoke(IpcChannels.FS_PICK_FILE, opts),
    showInFolder: (p) => ipcRenderer.invoke(IpcChannels.FS_SHOW_IN_FOLDER, p),
    openPath: (p) => ipcRenderer.invoke(IpcChannels.FS_OPEN_PATH, p),
    listDrives: () => ipcRenderer.invoke(IpcChannels.FS_LIST_DRIVES),
    trashList: () => ipcRenderer.invoke(IpcChannels.FS_TRASH_LIST),
    trashRestore: (itemPath, originalPath) =>
      ipcRenderer.invoke(IpcChannels.FS_TRASH_RESTORE, itemPath, originalPath),
    trashEmpty: () => ipcRenderer.invoke(IpcChannels.FS_TRASH_EMPTY),
    search: (req) => ipcRenderer.invoke(IpcChannels.FS_SEARCH, req),
    getThumbnail: (p) => ipcRenderer.invoke(IpcChannels.FS_GET_THUMBNAIL, p),
    getDirSize: (p) => ipcRenderer.invoke(IpcChannels.FS_GET_DIR_SIZE, p),
    writeClipboard: (text) => ipcRenderer.invoke(IpcChannels.FS_WRITE_CLIPBOARD, text),
    openWithDialog: (p) => ipcRenderer.invoke(IpcChannels.FS_OPEN_WITH_DIALOG, p),
  },

  tabs: {
    open: (t) => ipcRenderer.invoke(IpcChannels.TABS_OPEN, t),
    close: (id) => ipcRenderer.invoke(IpcChannels.TABS_CLOSE, id),
    activate: (id) => ipcRenderer.invoke(IpcChannels.TABS_ACTIVATE, id),
    move: (id, target, idx) => ipcRenderer.invoke(IpcChannels.TABS_MOVE, id, target, idx),
    list: () => ipcRenderer.invoke(IpcChannels.TABS_LIST),
  },

  panes: {
    split: (id, dir) => ipcRenderer.invoke(IpcChannels.PANES_SPLIT, id, dir),
    merge: (id) => ipcRenderer.invoke(IpcChannels.PANES_MERGE, id),
    focus: (id) => ipcRenderer.invoke(IpcChannels.PANES_FOCUS, id),
    getLayout: () => ipcRenderer.invoke(IpcChannels.PANES_LAYOUT_GET),
    setLayout: (layout) => ipcRenderer.invoke(IpcChannels.PANES_LAYOUT_SET, layout),
  },

  windows: {
    open: (initialPath) => ipcRenderer.invoke(IpcChannels.WIN_OPEN, initialPath),
    openWithTab: (req) => ipcRenderer.invoke(IpcChannels.WIN_OPEN_WITH_TAB, req),
    getBootPath: () => ipcRenderer.invoke(IpcChannels.WIN_GET_BOOT_PATH),
    close: (id) => ipcRenderer.invoke(IpcChannels.WIN_CLOSE, id),
    closeCurrent: () => ipcRenderer.invoke(IpcChannels.WIN_CLOSE_CURRENT),
    minimize: () => ipcRenderer.invoke(IpcChannels.WIN_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IpcChannels.WIN_MAXIMIZE),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.WIN_IS_MAXIMIZED),
    list: () => ipcRenderer.invoke(IpcChannels.WIN_LIST),
    focus: (id) => ipcRenderer.invoke(IpcChannels.WIN_FOCUS, id),
  },

  extensions: {
    list: () => ipcRenderer.invoke(IpcChannels.EXT_LIST),
    enable: (id) => ipcRenderer.invoke(IpcChannels.EXT_ENABLE, id),
    disable: (id) => ipcRenderer.invoke(IpcChannels.EXT_DISABLE, id),
    install: (path) => ipcRenderer.invoke(IpcChannels.EXT_INSTALL, path),
    uninstall: (id) => ipcRenderer.invoke(IpcChannels.EXT_UNINSTALL, id),
    invokeCommand: (cmd, ...args) => ipcRenderer.invoke(IpcChannels.EXT_INVOKE_COMMAND, cmd, args),
    getPanels: () => ipcRenderer.invoke(IpcChannels.EXT_GET_PANELS),
    onPanelData: (cb: (data: { panelId: string; extensionId: string; payload: unknown }) => void) => {
      const listener = (_e: IpcRendererEvent, data: { panelId: string; extensionId: string; payload: unknown }) => cb(data);
      ipcRenderer.on(IpcChannels.EXT_PANEL_DATA, listener);
      return () => ipcRenderer.removeListener(IpcChannels.EXT_PANEL_DATA, listener);
    },
  },

  config: {
    get: (k) => ipcRenderer.invoke(IpcChannels.CFG_GET, k),
    set: (k, v) => ipcRenderer.invoke(IpcChannels.CFG_SET, k, v),
    all: () => ipcRenderer.invoke(IpcChannels.CFG_ALL),
  },

  // P7 快捷键 (sibling p7-shortcuts)
  shortcuts: {
    getAll: () => ipcRenderer.invoke(IpcChannels.SHORTCUTS_GET_ALL),
    getBindings: () => ipcRenderer.invoke(IpcChannels.SHORTCUTS_GET_BINDINGS),
    setBinding: (commandId, combo) =>
      ipcRenderer.invoke(IpcChannels.SHORTCUTS_SET_BINDING, commandId, combo),
    resetAll: () => ipcRenderer.invoke(IpcChannels.SHORTCUTS_RESET_ALL),
  },

  // P7 v1 收口:命令执行(供命令面板 Ctrl+Shift+P 调用)
  commands: {
    run: (commandId, args) =>
      ipcRenderer.invoke(IpcChannels.COMMANDS_RUN, commandId, args ?? []),
  },

  events: makeEvents(),
};

contextBridge.exposeInMainWorld('tabula', api);
