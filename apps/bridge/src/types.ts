/**
 * 跨进程共享类型
 * 任何在主进程和渲染进程之间传递的对象都从这里导出。
 */

// =================== 文件系统 ===================

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  mtime: number;     // ms since epoch
  atime: number;
  ctime: number;
  birthtime: number;
  ext: string;       // 包含点,小写,目录为空字符串
}

export interface ListDirResult {
  path: string;
  entries: FsEntry[];
  total: number;
}

export type FsErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'EEXIST'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'EBUSY'
  | 'UNKNOWN';

export interface FsError {
  code: FsErrorCode;
  message: string;
  path?: string;
}

export interface MoveOrCopyRequest {
  sources: string[];
  destination: string;
  overwrite?: boolean;
}

/** 回收站条目 (P3) */
export interface TrashEntry {
  /** 回收站中的物理路径(唯一标识) */
  itemPath: string;
  /** 原始路径(可能为 null 表示无法解析) */
  originalPath: string | null;
  /** 文件名(从 originalPath 或 itemPath 解析) */
  name: string;
  /** 删除时间戳(ms since epoch;0 表示未知) */
  deletedTime: number;
  /** 文件大小(字节) */
  size: number;
  /** 是否为文件夹 */
  isDirectory: boolean;
}

export interface TrashListResult {
  entries: TrashEntry[];
  total: number;
}

/** P4 v1: 递归搜索请求参数 */
export interface SearchRequest {
  /** 搜索根目录 */
  path: string;
  /** 搜索关键词(模糊匹配) */
  query: string;
  /** 最大返回条数 */
  maxResults: number;
  /** 文件类型过滤(可选) */
  fileType?: FileTypeFilter;
  /** 递归深度限制(默认 3) */
  maxDepth?: number;
}

/** P4 v1: 文件类型过滤 */
export type FileTypeFilter = 'all' | 'image' | 'document' | 'code' | 'archive';

/** P4 v1: 搜索结果条目 */
export interface SearchHit {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  /** 匹配分数(越高越相关) */
  score: number;
  /** 匹配类型: exact=精确, prefix=前缀, substring=子串, fuzzy=模糊 */
  matchType: 'exact' | 'prefix' | 'substring' | 'fuzzy';
}

/** P4 v1: 搜索结果 */
export interface SearchResult {
  entries: SearchHit[];
  total: number;
  /** 搜索用时(ms) */
  elapsedMs: number;
  /** 是否被截断 */
  truncated: boolean;
}

/** 目录大小统计结果 */
export interface DirSizeResult {
  /** 字节 */
  size: number;
  /** 文件数 */
  fileCount: number;
  /** 目录数 */
  dirCount: number;
  /** 计算耗时(ms) */
  elapsedMs: number;
}

/** 驱动器 / 盘符 (P5: 侧边栏「此电脑」section) */
export interface DriveInfo {
  /** 挂载点,Windows 下形如 `C:\\` / `D:\\`;POSIX 下形如 `/` */
  mount: string;
  /** 盘符/卷标(人类可读) */
  label: string;
  /** 字节;0 = 未知 */
  totalBytes: number;
  /** 字节;0 = 未知 */
  freeBytes: number;
  type: 'fixed' | 'removable' | 'network' | 'cdrom' | 'unknown';
  /** 文件系统类型(可选项,Mac/Linux 才有;Windows 留空) */
  fsType?: string;
}

// =================== 标签 ===================

export type TabType = 'folder' | 'preview' | 'plugin-view';

export interface Tab {
  id: string;
  type: TabType;
  path?: string;             // folder 类型
  pluginId?: string;         // plugin-view 类型
  viewType?: string;
  viewState?: Record<string, unknown>;
  title: string;
  icon?: string;
  pinned: boolean;
  closable: boolean;
  history: string[];
  historyIndex: number;
  dirty?: boolean;
}

// =================== 窗格布局 ===================

export type LayoutNode =
  | {
      type: 'split';
      /** P2 v2: 唯一 id,用于 split-handle 拖动时定位节点做 setSplitSizes。
       *  旧版 (P0/P1 早期) 持久化数据可能没有 id,hydrate 时用 makeSplitId() 回填。 */
      id?: string;
      dir: 'horizontal' | 'vertical';
      sizes: number[];   // 0-100, 比例
      children: LayoutNode[];
    }
  | {
      type: 'pane';
      id: string;
      tabs: Tab[];
      activeTabId: string | null;
    };

export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneState {
  id: string;
  active: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

// =================== 窗口 ===================

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface AppWindowState {
  id: string;
  bounds: WindowBounds;
  maximized: boolean;
  rootLayout: LayoutNode;
  activePaneId: string;
}

/** P2 v2: 拖出 tab 到新窗口时的入参 */
export interface OpenWithTabRequest {
  initialPath: string;
  title?: string;
}

// =================== 扩展 ===================

export interface ExtensionManifest {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  publisher?: string;
  main: string;
  engines: { app: string };
  activationEvents: string[];
  contributes: ExtensionContributions;
  path: string;          // 本地路径
  enabled: boolean;
  builtin: boolean;
}

/** 运行时扩展面板(注册到侧边栏) */
export interface ExtensionPanel {
  id: string;
  extensionId: string;
  title: string;
  icon?: string;
  location: 'left' | 'right' | 'bottom';
}

export interface ExtensionContributions {
  commands?: CommandContribution[];
  panels?: PanelContribution[];
  previewers?: PreviewerContribution[];
  views?: ViewContribution[];
  themes?: ThemeContribution[];
  keybindings?: KeybindingContribution[];
}

export interface CommandContribution {
  command: string;
  title: string;
  category?: string;
  icon?: string;
  when?: string;
}

export interface PanelContribution {
  id: string;
  title: string;
  icon?: string;
  location: 'left' | 'right' | 'bottom';
  when?: string;
}

export interface PreviewerContribution {
  id: string;
  scheme?: string;
  extension?: string;
  mimeType?: string;
  priority?: number;
}

export interface ViewContribution {
  id: string;
  name: string;
  when?: string;
}

export interface ThemeContribution {
  id: string;
  label: string;
  type: 'light' | 'dark' | 'hc';
}

export interface KeybindingContribution {
  command: string;
  key: string;
  when?: string;
  mac?: string;
  win?: string;
  linux?: string;
}

// =================== 配置 ===================

export interface AppConfig {
  theme: 'light' | 'dark' | 'system';
  accentColor?: string;
  language: 'zh-CN' | 'en-US' | string;
  showHidden: boolean;
  showExtensions: boolean;
  defaultView: 'list' | 'grid' | 'details';
  sortBy: 'name' | 'size' | 'mtime' | 'type';
  sortDir: 'asc' | 'desc' | null;
  confirmDelete: boolean;
  openInNewTab: boolean;
  extensionsDir: string;
}

// =================== 快捷键 (P7 v1) ===================

/** 规范化后的键组合。用于 IPC 跨进程传递 + 持久化。 */
export interface KeyCombo {
  /** 主键的小写名称(`p` / `f5` / `arrowup` / `delete` / `enter` / `escape` 等) */
  key: string;
  /** Ctrl 修饰键(Windows/Linux 下等价于 Meta) */
  ctrl: boolean;
  /** Alt / Option 修饰键 */
  alt: boolean;
  /** Shift 修饰键 */
  shift: boolean;
  /** Meta 修饰键(macOS 的 Cmd;Windows/Linux 下与 Ctrl 重合,作为补充信息) */
  meta: boolean;
}

/** 可自定义的命令元信息。 */
export interface CommandSpec {
  /** 命令 id,如 `file.open` */
  id: string;
  /** 显示名,如「打开选中项」 */
  title: string;
  /** 分类,如「文件 / 标签 / 窗格 / 视图 / 设置」,用于在设置页分组 */
  category: string;
  /** 默认键组合(由主进程内置,不可改) */
  defaultCombo: KeyCombo | null;
  /** 描述(可选) */
  description?: string;
  /** 是否为系统保留命令(返回 null 即不可改) */
  reserved: boolean;
}

/** 当前生效绑定(commandId → combo;用户未改时即 defaultCombo) */
export interface ShortcutBinding {
  commandId: string;
  /** 当前生效组合(null 表示未绑定) */
  combo: KeyCombo | null;
  /** 是否为用户自定义(否则是默认值) */
  customized: boolean;
}

/** 冲突信息:setBinding 失败时返回 */
export interface ShortcutConflict {
  /** 想绑定的 commandId */
  commandId: string;
  /** 尝试使用的组合 */
  combo: KeyCombo;
  /** 已被哪个命令占用 */
  conflictingCommandId: string;
  /** 已被占用命令的标题(给 UI 直接显示) */
  conflictingTitle: string;
}

/** 跨进程快捷键错误码(扩展 FsErrorCode) */
export type ShortcutErrorCode =
  | 'UNKNOWN_COMMAND'
  | 'RESERVED_COMMAND'
  | 'RESERVED_COMBO'
  | 'CONFLICT'
  | 'INVALID_COMBO'
  | 'UNKNOWN';

export interface ShortcutError {
  code: ShortcutErrorCode;
  message: string;
  conflict?: ShortcutConflict;
}

/** setBinding 的返回:成功 ok,失败时携带冲突/错误码 */
export type SetBindingResult =
  | { ok: true; data: { commandId: string; combo: KeyCombo | null } }
  | { ok: false; error: ShortcutError };


// =================== 命令执行 (P7 v1 收口) ===================

/** P7 v1 收口:运行一条内置命令 */
export interface RunCommandInput {
  /** 命令 id(如 `file.open`) */
  commandId: string;
  /** 透传给命令的可选参数(预留,目前内置命令不消费) */
  args?: unknown[];
}

/** 运行结果。命令不存在 / 已被用户禁用时返回 ok=false + 错误码 */
export type RunCommandErrorCode = 'UNKNOWN_COMMAND' | 'UNKNOWN';

export interface RunCommandError {
  code: RunCommandErrorCode;
  message: string;
}

export type RunCommandResult =
  | { ok: true; data: { commandId: string } }
  | { ok: false; error: RunCommandError };


// =================== IPC 响应包装 ===================

export type Result<T> = { ok: true; data: T } | { ok: false; error: FsError };

/** 缩略图结果(主进程 → 渲染端) */
export interface ThumbnailResult {
  /** base64 data URL(已 resize 到 ~128px,可直接 `<img src=...>`) */
  dataUrl: string;
  /** 输出 mime,通常是 image/jpeg */
  mime: string;
  /** 原图尺寸(像素) */
  width: number;
  height: number;
  /** 缩略图尺寸(像素) */
  thumbWidth: number;
  thumbHeight: number;
  /** 文件 mtime(用于渲染端缓存失效判定) */
  mtime: number;
  /** 文件大小(字节) */
  size: number;
}

// =================== 性能埋点 (P7 v1) ===================

/** 一条埋点(渲染端 → 主进程) */
export interface PerfEvent {
  /** 阶段:startup / first-paint / list-render / scroll / ipc-call */
  phase: 'startup' | 'first-paint' | 'list-render' | 'scroll' | 'ipc-call' | 'app';
  /** 子事件名,例如 `fs:list-dir`、`pane-render` */
  name: string;
  /** 耗时 ms(可选) */
  durationMs?: number;
  /** 附加 metadata(条目数、错误码等) */
  meta?: Record<string, string | number | boolean>;
  /** 上报时间戳(ms since epoch) */
  ts: number;
}

/** 启动阶段计时(主进程记录,渲染进程拉取) */
export interface StartupTimings {
  /** app.whenReady 触发时刻(ms since process start 相对值) */
  whenReadyMs: number;
  /** 主窗口创建完成(ready-to-show 触发)时刻 */
  windowReadyMs: number;
  /** 扩展宿主初始化完成 */
  extHostReadyMs: number;
  /** 渲染端首屏 paint 完成 */
  firstPaintMs: number;
  /** 进程启动 → 首屏可交互总耗时(估算) */
  totalMs: number;
}

/** 进程内存快照(主进程采样) */
export interface MemorySample {
  /** 采样时间戳 */
  ts: number;
  /** 主进程 rss(MB) */
  mainRss: number;
  /** 主进程 heapUsed(MB) */
  mainHeapUsed: number;
  /** 渲染进程 rss(MB),如可取(Windows 任务管理器值近似) */
  rendererRss: number;
  /** 渲染进程 heapUsed(MB) */
  rendererHeapUsed: number;
}

/** 性能报告(主进程聚合) */
export interface PerfReport {
  startup: StartupTimings;
  /** 最近 200 条埋点 */
  events: PerfEvent[];
  /** 最近 200 条内存采样 */
  memory: MemorySample[];
  /** 累计 IPC 调用次数(按 channel) */
  ipcCallCount: Record<string, number>;
}

// =================== P7 启动屏 ===================

/** 启动屏对外的状态消息(主进程 → 渲染端 splash) */
export interface SplashStatus {
  /** 0-100,undefined 表示未知(纯 indeterminate spinner) */
  progress?: number;
  /** 当前阶段的标签,如"正在加载扩展…" */
  message: string;
}

// =================== P7 自动更新 ===================

export type UpdateChannelState =
  | 'idle'           // 初始
  | 'checking'       // 正在检查
  | 'available'      // 发现了新版本
  | 'not-available'  // 检查完成,没有新版本
  | 'downloading'    // 正在下载
  | 'downloaded'     // 下载完成,等待用户重启安装
  | 'installing'     // 用户已点"立即更新",正在退出
  | 'error'          // 出错
  | 'disabled';      // 当前环境(开发模式 / 平台不支持)下不检查

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export interface UpdateStatus {
  state: UpdateChannelState;
  currentVersion: string;
  available?: UpdateInfo;
  /** 0-100 */
  progress?: number;
  /** 错误信息(state === 'error' 时) */
  error?: string;
  /** 是否为开发模式(dev / unpackaged 走 disabled 状态) */
  devMode: boolean;
  /** 平台是否支持自动更新(macOS 需签名、Linux AppImage 才支持,Windows 全支持) */
  supported: boolean;
}

export interface DownloadProgress {
  percent: number;        // 0-100
  transferred: number;    // 字节
  total: number;          // 字节
  bytesPerSecond: number;
}

// =================== P7 错误日志 ===================

export interface LogPaths {
  /** 日志目录绝对路径(<userData>/logs) */
  dir: string;
  /** 主进程日志文件 */
  main: string;
  /** 渲染进程日志文件 */
  renderer: string;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** 'main' or 'renderer' */
  source: 'main' | 'renderer';
  /** ms since epoch */
  timestamp: number;
}
