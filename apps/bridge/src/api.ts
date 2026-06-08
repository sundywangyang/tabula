/**
 * 通过 contextBridge 暴露给渲染进程的主进程 API 类型定义。
 */
import type {
  AppConfig,
  AppWindowState,
  CommandSpec,
  DownloadProgress,
  DriveInfo,
  ExtensionManifest,
  ExtensionPanel,
  FileTypeFilter,
  FsEntry,
  KeyCombo,
  LayoutNode,
  ListDirResult,
  LogEntry,
  LogLevel,
  LogPaths,
  MemorySample,
  MoveOrCopyRequest,
  OpenWithTabRequest,
  PerfEvent,
  PerfReport,
  Result,
  SearchRequest,
  SearchResult,
  SetBindingResult,
  ShortcutBinding,
  SplitDirection,
  StartupTimings,
  Tab,
  TrashListResult,
  UpdateInfo,
  UpdateStatus,
} from './types';

export interface TabulaAPI {
  // 系统
  app: {
    version(): Promise<string>;
    ready(): Promise<void>;
    openDevTools(): Promise<void>;
    reload(): Promise<void>;
  };

  // 性能埋点 (P7 v1)
  perf: {
    /** 渲染端上报一条埋点(主进程聚合) */
    report(event: PerfEvent): Promise<void>;
    /** 拉取完整性能报告(启动耗时 / 事件 / 内存 / IPC 计数) */
    snapshot(): Promise<PerfReport>;
    /** 拉取启动阶段计时 */
    getStartupTimings(): Promise<StartupTimings>;
    /** 拉取最近 N 条内存采样 */
    getMemorySamples(limit?: number): Promise<MemorySample[]>;
    /** 订阅主进程推送的内存采样(每 10s 一条) */
    onMemorySample(listener: (sample: MemorySample) => void): () => void;
  };

  // P7 启动屏
  splash: {
    /** 渲染端启动完成后调用,通知主进程关闭 splash window */
    ready(): Promise<void>;
    /** 主进程主动推: progress 0-100 */
    onProgress(listener: (status: { progress: number; message: string }) => void): () => void;
  };

  // P7 自动更新
  update: {
    /** 触发一次检查(开发模式 / 平台不支持时立即返回 state='disabled') */
    check(): Promise<UpdateStatus>;
    /** 用户同意后开始下载(available 状态之后) */
    download(): Promise<UpdateStatus>;
    /** 下载完成后,退出并安装(用户点了"立即更新") */
    install(): Promise<void>;
    /** 拉取当前状态 */
    getStatus(): Promise<UpdateStatus>;
    /** 事件订阅(返回取消函数) */
    onAvailable(listener: (info: UpdateInfo) => void): () => void;
    onNotAvailable(listener: () => void): () => void;
    onDownloadProgress(listener: (p: DownloadProgress) => void): () => void;
    onDownloaded(listener: (info: UpdateInfo) => void): () => void;
    onError(listener: (err: { message: string }) => void): () => void;
  };

  // P7 错误日志
  log: {
    /** 取日志文件路径(main.log / renderer.log / 目录) */
    getPaths(): Promise<LogPaths>;
    /** 在系统文件管理器中打开日志目录 */
    openDir(): Promise<void>;
    /** 读最近 N 行(默认 200) */
    getLines(opts?: { source?: 'main' | 'renderer'; limit?: number }): Promise<string[]>;
    /** 渲染端写一条日志(走 electron-log, 写 renderer.log) */
    write(level: LogLevel, message: string): Promise<void>;
    /** 实时订阅日志流(主进程 + 渲染进程的 log:entry 事件) */
    onEntry(listener: (entry: LogEntry) => void): () => void;
  };

  // 文件系统
  fs: {
    listDir(path: string): Promise<Result<ListDirResult>>;
    readFile(path: string, encoding?: 'utf-8' | 'binary'): Promise<Result<string | ArrayBuffer>>;
    writeFile(path: string, data: string | ArrayBuffer): Promise<Result<void>>;
    delete(paths: string[], useTrash?: boolean): Promise<Result<void>>;
    rename(oldPath: string, newPath: string): Promise<Result<void>>;
    move(req: MoveOrCopyRequest): Promise<Result<void>>;
    copy(req: MoveOrCopyRequest): Promise<Result<void>>;
    mkdir(path: string, name?: string): Promise<Result<string>>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<Result<FsEntry>>;
    pickDirectory(): Promise<string | null>;
    pickFile(opts?: { multi?: boolean; filters?: Electron.FileFilter[] }): Promise<string | string[] | null>;
    showInFolder(path: string): Promise<void>;
    openPath(path: string): Promise<void>;
    listDrives(): Promise<DriveInfo[]>;
    /** P3 v1: 列出回收站内容 */
    trashList(): Promise<Result<TrashListResult>>;
    /** P3 v1: 从回收站恢复文件 */
    trashRestore(itemPath: string, originalPath?: string): Promise<Result<void>>;
    /** P3 v1: 清空回收站 */
    trashEmpty(): Promise<Result<void>>;
    /** P4 v1: 递归搜索文件(按文件名模糊匹配) */
    search(req: SearchRequest): Promise<Result<SearchResult>>;
  };

  // 标签
  tabs: {
    open(tab: Omit<Tab, 'id'>): Promise<Tab>;
    close(tabId: string): Promise<void>;
    activate(tabId: string): Promise<void>;
    move(tabId: string, targetPaneId: string, index: number): Promise<void>;
    list(): Promise<Tab[]>;
  };

  // 窗格
  panes: {
    split(paneId: string, dir: SplitDirection): Promise<LayoutNode>;
    merge(paneId: string): Promise<LayoutNode | null>;
    focus(paneId: string): Promise<void>;
    getLayout(): Promise<LayoutNode>;
    setLayout(layout: LayoutNode): Promise<void>;
  };

  // 窗口
  windows: {
    open(initialPath?: string): Promise<string>;
    /** P2 v2: 拖出 tab 到新窗口;新窗口启动后会自动打开 initialPath */
    openWithTab(req: OpenWithTabRequest): Promise<string>;
    /** P2 v2: 新窗口启动时调用,获取由 openWithTab 传入的初始路径 */
    getBootPath(): Promise<string | null>;
    close(windowId: string): Promise<void>;
    closeCurrent(): Promise<void>;
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    isMaximized(): Promise<boolean>;
    list(): Promise<AppWindowState[]>;
    focus(windowId: string): Promise<void>;
  };

  // 扩展
  extensions: {
    list(): Promise<ExtensionManifest[]>;
    enable(id: string): Promise<void>;
    disable(id: string): Promise<void>;
    install(path: string): Promise<Result<ExtensionManifest>>;
    uninstall(id: string): Promise<void>;
    invokeCommand(command: string, ...args: unknown[]): Promise<unknown>;
    getPanels(): Promise<ExtensionPanel[]>;
  };

  // 配置
  config: {
    get<K extends keyof AppConfig>(key: K): Promise<AppConfig[K]>;
    set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void>;
    all(): Promise<AppConfig>;
  };

  // 快捷键 (P7 v1)
  shortcuts: {
    /** 列出所有可自定义命令(主进程内置) */
    getAll(): Promise<CommandSpec[]>;
    /** 获取当前生效的绑定(用户覆盖 > 默认) */
    getBindings(): Promise<ShortcutBinding[]>;
    /**
     * 设置单个命令的绑定。`combo = null` 表示清除绑定。
     * 失败时返回 `Result.error` 包含 `code` 和 `conflict` 信息。
     */
    setBinding(commandId: string, combo: KeyCombo | null): Promise<SetBindingResult>;
    /** 重置所有用户自定义,恢复默认绑定 */
    resetAll(): Promise<void>;
  };

  // 事件订阅(主进程 → 渲染进程)
  events: {
    on<T = unknown>(channel: string, listener: (payload: T) => void): () => void;
    off(channel: string, listener: (...args: any[]) => void): void;
  };
}

declare global {
  interface Window {
    tabula: TabulaAPI;
  }
}

export {};
