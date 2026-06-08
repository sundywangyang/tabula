/**
 * IPC 通道常量
 *
 * 命名规范: `<domain>:<action>` 全部小写,冒号分隔。
 * - `fs:*`       文件系统
 * - `tabs:*`     标签
 * - `panes:*`    窗格
 * - `win:*`      窗口
 * - `ext:*`      扩展
 * - `cfg:*`      配置/设置
 * - `app:*`      应用
 * - `splash:*`   P7 启动屏
 * - `update:*`   P7 自动更新
 * - `log:*`      P7 错误日志
 */
export const IpcChannels = {
  // 文件系统
  FS_LIST_DIR: 'fs:list-dir',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_DELETE: 'fs:delete',
  FS_RENAME: 'fs:rename',
  FS_MOVE: 'fs:move',
  FS_COPY: 'fs:copy',
  FS_MKDIR: 'fs:mkdir',
  FS_EXISTS: 'fs:exists',
  FS_STAT: 'fs:stat',
  FS_PICK_DIRECTORY: 'fs:pick-directory',
  FS_PICK_FILE: 'fs:pick-file',
  FS_SHOW_IN_FOLDER: 'fs:show-in-folder',
  FS_OPEN_PATH: 'fs:open-path',
  FS_LIST_DRIVES: 'fs:list-drives',
  FS_TRASH_LIST: 'fs:trash-list',
  FS_TRASH_RESTORE: 'fs:trash-restore',
  FS_TRASH_EMPTY: 'fs:trash-empty',
  FS_SEARCH: 'fs:search',

  // 标签
  TABS_OPEN: 'tabs:open',
  TABS_CLOSE: 'tabs:close',
  TABS_ACTIVATE: 'tabs:activate',
  TABS_MOVE: 'tabs:move',
  TABS_LIST: 'tabs:list',

  // 窗格
  PANES_SPLIT: 'panes:split',
  PANES_MERGE: 'panes:merge',
  PANES_FOCUS: 'panes:focus',
  PANES_LAYOUT_GET: 'panes:layout-get',
  PANES_LAYOUT_SET: 'panes:layout-set',

  // 窗口
  WIN_OPEN: 'win:open',
  WIN_OPEN_WITH_TAB: 'win:open-with-tab',   // P2 v2:拖出 tab 到新窗口
  WIN_GET_BOOT_PATH: 'win:get-boot-path',   // P2 v2:新窗口启动时询问初始路径
  WIN_CLOSE: 'win:close',
  WIN_LIST: 'win:list',
  WIN_FOCUS: 'win:focus',

  // 扩展
  EXT_LIST: 'ext:list',
  EXT_ENABLE: 'ext:enable',
  EXT_DISABLE: 'ext:disable',
  EXT_INSTALL: 'ext:install',
  EXT_UNINSTALL: 'ext:uninstall',
  EXT_INVOKE_COMMAND: 'ext:invoke-command',
  EXT_GET_PANELS: 'ext:get-panels',

  // 配置
  CFG_GET: 'cfg:get',
  CFG_SET: 'cfg:set',
  CFG_ALL: 'cfg:all',

  // 快捷键 (P7 v1)
  SHORTCUTS_GET_ALL: 'shortcuts:get-all',
  SHORTCUTS_GET_BINDINGS: 'shortcuts:get-bindings',
  SHORTCUTS_SET_BINDING: 'shortcuts:set-binding',
  SHORTCUTS_RESET_ALL: 'shortcuts:reset-all',

  // 应用
  APP_READY: 'app:ready',
  APP_VERSION: 'app:version',
  APP_OPEN_DEVTOOLS: 'app:open-devtools',
  APP_RELOAD: 'app:reload',

  // 性能埋点 (P7 v1)
  PERF_REPORT: 'perf:report',            // 渲染端 → 主进程上报埋点
  PERF_SNAPSHOT: 'perf:snapshot',        // 主进程 → 渲染端拉取当前快照
  PERF_MEMORY_SAMPLE: 'perf:memory-sample', // 主进程推 → 渲染端(10s 周期)
  PERF_STARTUP_TIMES: 'perf:startup-times', // 渲染端拉取启动阶段耗时

  // P7 启动屏
  SPLASH_READY: 'splash:ready',              // 渲染端通知主进程: 我可以显示了
  SPLASH_PROGRESS: 'splash:progress',        // 主进程 → 渲染端: 进度 0-100 + 标签
  SPLASH_MESSAGE: 'splash:message',          // 主进程 → 渲染端: 状态文本

  // P7 自动更新
  UPDATE_CHECK: 'update:check',              // 触发一次更新检查
  UPDATE_DOWNLOAD: 'update:download',        // 触发下载(已发现新版本时)
  UPDATE_INSTALL: 'update:install',          // 退出并安装(已下载完成时)
  UPDATE_GET_STATUS: 'update:get-status',    // 取当前状态
  // 事件: 主进程 → 渲染端
  UPDATE_AVAILABLE: 'update:available',      // 推: { version, releaseDate, releaseNotes? }
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  UPDATE_DOWNLOAD_PROGRESS: 'update:download-progress',  // { percent, transferred, total }
  UPDATE_DOWNLOADED: 'update:downloaded',    // 推: { version }
  UPDATE_ERROR: 'update:error',              // 推: { message }

  // P7 错误日志
  LOG_GET_PATHS: 'log:get-paths',            // → { main, renderer, dir }
  LOG_OPEN_DIR: 'log:open-dir',              // 在文件管理器中打开 logs 目录
  LOG_GET_LINES: 'log:get-lines',            // 读最近 N 行(渲染端做"近期错误"展示)
  // 事件: 主进程 → 渲染端
  LOG_ENTRY: 'log:entry',                    // 推: { level, message, source: 'main'|'renderer', timestamp }
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
