/**
 * 通过 contextBridge 暴露给渲染进程的主进程 API 类型定义。
 */
import type {
  AppConfig,
  AppWindowState,
  ArchiveError,
  ArchiveInfo,
  ArchiveProgress,
  CommandSpec,
  CompressRequest,
  DirSizeResult,
  DownloadProgress,
  DriveInfo,
  ExtensionManifest,
  ExtensionPanel,
  ExtractRequest,
  FileTypeFilter,
  FsEntry,
  FsChecksumRequest,
  FsChecksumResult,
  FsCreateSymlinkRequest,
  FsSetPermissionsRequest,
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
  RunCommandResult,
  SearchRequest,
  SearchResult,
  SetBindingResult,
  ShortcutBinding,
  SplitDirection,
  StartupTimings,
  Tab,
  ThumbnailResult,
  TrashListResult,
  UndoOperationInfo,
  UndoStackSnapshot,
  UpdateInfo,
  UpdateStatus,
} from './types';

/** G008: tags API */
export interface TagsApi {
  /** 取某路径的标签列表(无则返回空数组) */
  get(path: string): Promise<string[]>;
  /** 覆盖设置某路径的标签列表 */
  set(path: string, tags: string[]): Promise<void>;
  /** 添加单个标签(重复忽略) */
  add(path: string, tag: string): Promise<void>;
  /** 移除单个标签 */
  remove(path: string, tag: string): Promise<void>;
}

export type PlatformType = 'windows' | 'macos' | 'linux';

export interface TabulaAPI {
  // 系统
  app: {
    version(): Promise<string>;
    ready(): Promise<void>;
    openDevTools(): Promise<void>;
    reload(): Promise<void>;
  };

  /** 平台检测 (渲染进程调用) */
  platform: {
    /** 当前平台: windows | macos | linux */
    get(): Promise<PlatformType>;
    /** 默认根路径: Windows 'C:\Users' | Unix '/' */
    defaultRootPath(): Promise<string>;
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
    /**
     * P7 v1: 取图片缩略图(主进程自带 LRU 缓存)。
     * 非图片 / 损坏文件 / 过大文件 → 返回 ok=false + 错误码。
     * dataUrl 可直接 `<img src=...>`,CSP 已放行 `data:`。
     */
    getThumbnail(path: string): Promise<Result<ThumbnailResult>>;
    /** 计算目录递归大小（异步，后台执行） */
    getDirSize(path: string): Promise<Result<DirSizeResult>>;
    /** 写文本到系统剪贴板 */
    writeClipboard(text: string): Promise<void>;
    /** 显示 Windows「打开方式」对话框并用用户选择的程序打开文件 */
    openWithDialog(path: string): Promise<void>;
    /**
     * 弹系统「另存为」对话框,用户选路径后返回;取消返回 null。
     * 用于压缩时让用户指定输出文件名和位置。
     */
    saveDialog(opts?: {
      title?: string;
      defaultPath?: string;
      filters?: Electron.FileFilter[];
    }): Promise<string | null>;
    /**
     * G010: 设置文件只读/可写 权限。
     * - readonly=true → chmod 0o444 (Windows: FS ReadOnly bit)
     * - readonly=false → chmod 0o644 (Windows: 清除 ReadOnly bit)
     */
    setPermissions(req: FsSetPermissionsRequest): Promise<Result<void>>;
    /**
     * G011: 创建符号链接 / 快捷方式。
     * - Windows: 对目录使用 NTFS junction(无需管理员),对文件使用 file symlink
     * - Unix: 标准 symlink
     * 成功返回 linkPath(写入的链接绝对路径)。
     */
    createSymlink(req: FsCreateSymlinkRequest): Promise<Result<string>>;
    /**
     * G015: 流式计算文件哈希 (sha256/sha1/md5)。大文件友好(createReadStream)。
     * - 失败时返回 `ok=false` + IO_ERROR 错误码(ENOENT / EACCES 透传)。
     * - `size` 取自 statSync;`durationMs` 是整段耗时。
     */
    checksum(req: FsChecksumRequest): Promise<Result<FsChecksumResult>>;
    /**
     * G012: 撤销最近一次可逆操作。
     * - 空栈时返回 `ok=true` + `data=null`,不抛错
     * - 内部 op.undo() 抛错时返回 `ok=false` + 错误码
     */
    undo(): Promise<Result<UndoOperationInfo | null>>;
    /**
     * G012: 重做最近一次被撤销的操作。
     * - 空 redo 栈时返回 `ok=true` + `data=null`
     */
    redo(): Promise<Result<UndoOperationInfo | null>>;
    /**
     * G012: 拉取 undo/redo 两栈的当前快照(只读,给 UI 展示)。
     */
    getUndoStack(): Promise<Result<UndoStackSnapshot>>;
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
    enable(id: string): Promise<Result<void>>;
    disable(id: string): Promise<Result<void>>;
    install(path: string): Promise<Result<ExtensionManifest>>;
    uninstall(id: string): Promise<void>;
    invokeCommand(command: string, ...args: unknown[]): Promise<unknown>;
    getPanels(): Promise<ExtensionPanel[]>;
    /** 订阅 ext-host 推送的 panel 数据(主进程→renderer) */
    onPanelData(
      cb: (data: { panelId: string; extensionId: string; payload: unknown }) => void,
    ): () => void;
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

  // 命令执行 (P7 v1 收口)
  commands: {
    /**
     * 请求主进程派发一条内置命令。
     * - 主进程会在 COMMAND_CATALOG 中校验,合法时通过 `commands:run-command`
     *   事件推回请求方所在的渲染窗口,渲染端由 `runCommandById` 真正执行。
     * - 命令不存在时立刻返回 `ok=false`(`UNKNOWN_COMMAND`)。
     */
    run(commandId: string, args?: unknown[]): Promise<RunCommandResult>;
  };

  // 事件订阅(主进程 → 渲染进程)
  events: {
    on<T = unknown>(channel: string, listener: (payload: T) => void): () => void;
    off(channel: string, listener: (...args: any[]) => void): void;
  };

  // Shell:在指定路径打开系统终端
  shell: {
    /**
     * 在指定目录打开一个系统终端。
     * - Windows: PowerShell
     * - macOS: Terminal.app
     * - Linux: 尝试常见终端(x-terminal-emulator / gnome-terminal / konsole / xterm)
     */
    openTerminal(path: string): Promise<Result<void>>;
  };

  // 归档 (压缩 / 解压)
  archive: {
    /**
     * 列出归档内全部 entry(同步,无副作用)。
     * 当前仅支持 zip 格式;zip 损坏 / 加密 / 不存在 → ok=false。
     */
    list(archivePath: string): Promise<Result<ArchiveInfo, ArchiveError>>;
    /**
     * 启动一个压缩任务。立即返回 jobId,实际工作在后台执行,
     * 通过 `onJobUpdate` 推送 `ArchiveProgress`,最终 phase = done。
     */
    compress(req: CompressRequest): Promise<Result<{ jobId: string }, ArchiveError>>;
    /**
     * 启动一个解压任务。立即返回 jobId,实际工作在后台执行,
     * 通过 `onJobUpdate` 推送 `ArchiveProgress`,最终 phase = done。
     */
    extract(req: ExtractRequest): Promise<Result<{ jobId: string }, ArchiveError>>;
    /** 拉取任务当前状态(用于 UI 主动查询 / 刷新) */
    getJob(jobId: string): Promise<Result<ArchiveProgress, ArchiveError>>;
    /** 取消正在执行的任务;终态 phase = cancelled */
    cancelJob(jobId: string): Promise<Result<void, ArchiveError>>;
    /** 订阅主进程推送的进度事件;返回取消订阅函数 */
    onJobUpdate(listener: (progress: ArchiveProgress) => void): () => void;
  };

  // G008: 标签 (文件标记)
  tags: TagsApi;
}

declare global {
  interface Window {
    tabula: TabulaAPI;
  }
}

export {};
