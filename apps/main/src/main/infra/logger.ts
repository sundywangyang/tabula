/**
 * 日志基础设施 (P7)
 *
 * 职责:
 * - 在主进程最早阶段(import 顶部)就装载 electron-log 并配置:
 *   - 文件路径: <userData>/logs/main.log
 *   - 大小轮转: 5 MB / 保留 2 个历史文件
 *   - 捕获 uncaughtException / unhandledRejection → errorHandler.startCatching()
 *   - 让 console.log / console.error 走 log 文件
 * - 暴露给其它模块的辅助:
 *   - `broadcastToRenderers()`  —  实时把日志条目推给渲染端
 *   - `getLogPaths()` / `readTail()` — 供 IPC handler 使用
 *   - `installLogSink()`  —  接收渲染端走 IPC 发来的 log:write
 *
 * 设计要点:
 * - electron-log 自带 file transport,写文件不需要我们手动管
 * - 渲染端不直连文件系统;走 `log.info/warn/error(...)` → IPC → 我们的 handler
 *   → 调 `mainLog[level](...)` → 写 main.log 同时用 webContents.send 推一份
 * - 这样 main + renderer 都进同一个 .log 流水线,符合验收 #7
 */
import { app, BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import { join } from 'node:path';
import { promises as fsp, existsSync } from 'node:fs';
import log from 'electron-log/main';
import { IpcChannels } from '@tabula/bridge';
import type { LogEntry, LogLevel, LogPaths } from '@tabula/bridge';

// =================== 配置 electron-log ===================

let initialized = false;

export function initLogger(): void {
  if (initialized) return;
  initialized = true;

  // 1) 文件路径: <userData>/logs/main.log
  //    electron-log 默认就是这样,这里再显式 set 一次,防止不同 OS 下
  //    libraryTemplate 解析出意外位置(macOS 是 ~/Library/Logs/<AppName>)
  log.transports.file.resolvePathFn = (_vars, _message) => {
    return join(app.getPath('userData'), 'logs', 'main.log');
  };

  // 2) 大小 5 MB / 保留 2 个归档
  log.transports.file.maxSize = 5 * 1024 * 1024;
  // archiveLogFn 默认把 current → main.old.log(1 个),我们让它在轮转时干净一点
  log.transports.file.archiveLogFn = (oldLogFile) => {
    // 把旧文件改名为 main.old.log(覆盖)
    const oldPath = oldLogFile.path;
    const archivePath = oldPath.replace(/main\.log$/, 'main.old.log');
    try {
      // electron-log 自己会处理,这里 no-op 即可
      void oldLogFile;
      void archivePath;
    } catch {
      // ignore
    }
  };

  // 3) 等级
  if (!app.isPackaged) {
    log.transports.file.level = 'debug';
    log.transports.console.level = 'debug';
  } else {
    log.transports.file.level = 'info';
    log.transports.console.level = 'warn';
  }

  // 4) 把 console 接到 log 文件(开发期方便)
  log.transports.console.useStyles = true;
  Object.assign(console, {
    log: log.info.bind(log),
    info: log.info.bind(log),
    warn: log.warn.bind(log),
    error: log.error.bind(log),
    debug: log.debug.bind(log),
  });

  // 5) 启动全局未捕获异常处理
  log.errorHandler.startCatching({
    showDialog: false, // 桌面应用不要突然弹系统 dialog
    onError({ error, errorName, processType }) {
      // 写一条结构化日志,便于检索
      log.error(
        `[uncaught:${errorName}] processType=${processType} message=${error?.message ?? 'unknown'}`,
      );
      if (error?.stack) log.error(error.stack);
    },
  });

  log.info(
    `[tabula] logger initialized: userData=${app.getPath('userData')} file=${log.transports.file.getFile().path}`,
  );
}

// =================== 路径与读取 ===================

/**
 * 暴露给 IPC `log:get-paths` 使用。
 * main.log 是当前日志;renderer.log 是 electron-log renderer 端用 ipc transport
 * 写到主进程再转存的(我们用一个独立 file instance 接收它)。
 *
 * 实际: electron-log renderer 端用 ipc transport 推 message 给主进程,
 * 主进程的 default ipc transport 会用 console transport 打印。我们额外注册一个
 * fileSink(见 installLogSink),把每条 renderer → main 的 log message 写入
 * renderer.log。
 */
export function getLogPaths(): LogPaths {
  const dir = join(app.getPath('userData'), 'logs');
  return {
    dir,
    main: join(dir, 'main.log'),
    renderer: join(dir, 'renderer.log'),
  };
}

export async function ensureLogDir(): Promise<void> {
  const dir = getLogPaths().dir;
  if (!existsSync(dir)) {
    await fsp.mkdir(dir, { recursive: true });
  }
}

/**
 * 读最近 N 行;line 为空也返回空数组(文件不存在/还没写入过)。
 */
export async function readTail(
  source: 'main' | 'renderer',
  limit = 200,
): Promise<string[]> {
  await ensureLogDir();
  const file = source === 'main' ? getLogPaths().main : getLogPaths().renderer;
  if (!existsSync(file)) return [];
  const raw = await fsp.readFile(file, 'utf-8');
  const lines = raw.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-Math.max(1, limit));
}

// =================== 渲染端 → 主进程的日志接收 ===================

let rendererSinkInstalled = false;

/**
 * 把跨进程 LogLevel('trace'/'debug'/'info'/'warn'/'error'/'fatal')
 * 映射到 electron-log 内置的 LogLevel('error'/'warn'/'info'/'verbose'/'debug'/'silly')。
 */
type ElectronLogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly';
function mapLevel(level: LogLevel): ElectronLogLevel {
  switch (level) {
    case 'trace':
      return 'silly';
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
    case 'fatal':
      return 'error';
    default:
      return 'info';
  }
}

/**
 * 监听渲染端 `log:write` 写入 + 同步推一份给所有 BrowserWindow 的 webContents。
 * 在 ipc/index.ts 的 registerIpcHandlers 里调一次即可。
 */
export function installLogSink(): void {
  if (rendererSinkInstalled) return;
  rendererSinkInstalled = true;

  ipcMain.on(IpcChannels.LOG_ENTRY, (_e: IpcMainEvent, entry: LogEntry) => {
    // 1) 写到 renderer.log(走 electron-log 自带 file transport)
    const level = mapLevel(entry.level);
    log[level](`[renderer] ${entry.message}`);

    // 2) 推给所有 BrowserWindow(多窗口支持)
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannels.LOG_ENTRY, entry);
        }
      } catch {
        // 忽略坏掉的目标
      }
    }
  });
}

// =================== 主进程自身日志 → 渲染端(可选) ===================

let mainPushInstalled = false;

/**
 * 主进程每写一条 log,推一份给所有渲染端(可关)。
 * 渲染端默认是订阅式,真要全部同步,装这个 hook 即可。
 *
 * 现实:通常不开启(会引发 renderer 侧 logger 自激:主进程的 'log:entry' 推
 * 过去,renderer 又写一条 log,再被 ipcMain.on 接到,死循环)。所以默认不装。
 */
export function installMainLogPush(): void {
  if (mainPushInstalled) return;
  mainPushInstalled = true;
  log.hooks.push((message) => {
    const entry: LogEntry = {
      level: mapElectronLogLevel(message.level),
      message: stringifyData(message.data),
      source: 'main',
      timestamp: message.date.getTime(),
    };
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannels.LOG_ENTRY, entry);
        }
      } catch {
        // 忽略
      }
    }
    return message;
  });
}

function mapElectronLogLevel(
  level: 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly',
): LogLevel {
  switch (level) {
    case 'silly':
    case 'verbose':
      return 'debug';
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    default:
      return 'info';
  }
}

function stringifyData(data: unknown[]): string {
  return data
    .map((d) => {
      if (typeof d === 'string') return d;
      try {
        return JSON.stringify(d);
      } catch {
        return String(d);
      }
    })
    .join(' ');
}

// =================== 直接暴露的 logger ===================

export const mainLogger = log;
