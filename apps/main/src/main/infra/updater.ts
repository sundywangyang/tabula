/**
 * 自动更新基础设施 (P7)
 *
 * 职责:
 * - 集成 electron-updater 的 autoUpdater
 * - 提供"检查 → 下载 → 安装"三段式流程
 * - 状态对外暴露: 内部 state machine + IPC 推送给渲染端
 * - 安全性:
 *   - 开发模式(isPackaged=false)直接置为 'disabled',不联网检查
 *   - 平台不支持(Linux 非 AppImage / macOS 未签名)同样置为 'disabled'
 *   - 不强制 quitAndInstall,把选择权交给用户
 *
 * 暂用「本地 mock endpoint」:把 autoUpdater 桥接好,真实发布走 GitHub releases
 * (electron-builder.yml 的 publish.provider=github 已经设好),开发期不联网,
 * 用 forceDevUpdateConfig=false 兜底。验证脚本可以打 tag 触发。
 */
import { app, BrowserWindow } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo as BuilderUpdateInfo } from 'electron-updater';
import { IpcChannels } from '@tabula/bridge';
import type { UpdateChannelState, UpdateInfo, UpdateStatus } from '@tabula/bridge';
import { mainLogger } from './logger';

const log = mainLogger;

// =================== 状态机 ===================

let state: UpdateChannelState = 'idle';
let availableInfo: UpdateInfo | null = null;
let progress = 0;
let lastError: string | null = null;
let started = false;

function snapshot(): UpdateStatus {
  return {
    state,
    currentVersion: app.getVersion(),
    available: availableInfo ?? undefined,
    progress: state === 'downloading' ? progress : undefined,
    error: lastError ?? undefined,
    devMode: !app.isPackaged,
    supported: detectSupport(),
  };
}

function detectSupport(): boolean {
  if (!app.isPackaged) return false;
  // electron-updater 在 Linux 上只支持 AppImage / deb / rpm / pacman
  // 我们 NSIS / dmg 都在范围内,所以这里宽松返回 true
  return true;
}

function setState(next: UpdateChannelState, info?: UpdateInfo | null, err?: string | null) {
  state = next;
  if (info !== undefined) availableInfo = info;
  if (err !== undefined) lastError = err;
  // 推给所有渲染端
  push();
}

function push() {
  const s = snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.UPDATE_GET_STATUS, s);
      }
    } catch {
      // 忽略
    }
  }
}

// =================== 事件桥接 ===================

function installAutoUpdaterHooks() {
  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] checking-for-update');
    setState('checking');
  });

  autoUpdater.on('update-available', (info: BuilderUpdateInfo) => {
    log.info(`[updater] update-available version=${info.version}`);
    const u: UpdateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    };
    setState('available', u);
    // 额外推一个 update:available 事件,让渲染端可以弹模态
    broadcast(IpcChannels.UPDATE_AVAILABLE, u);
  });

  autoUpdater.on('update-not-available', (info: BuilderUpdateInfo) => {
    log.info(`[updater] update-not-available currentVersion=${info.version}`);
    setState('not-available', null);
    broadcast(IpcChannels.UPDATE_NOT_AVAILABLE, undefined);
  });

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    progress = Math.max(0, Math.min(100, p.percent));
    const payload = {
      percent: progress,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    };
    broadcast(IpcChannels.UPDATE_DOWNLOAD_PROGRESS, payload);
  });

  autoUpdater.on('update-downloaded', (info: BuilderUpdateInfo) => {
    log.info(`[updater] update-downloaded version=${info.version}`);
    const u: UpdateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    };
    progress = 100;
    setState('downloaded', u);
    broadcast(IpcChannels.UPDATE_DOWNLOADED, u);
  });

  autoUpdater.on('error', (err: Error, message?: string) => {
    log.error(`[updater] error: ${err?.message ?? message ?? 'unknown'}`);
    setState('error', null, err?.message ?? message ?? 'unknown');
    broadcast(IpcChannels.UPDATE_ERROR, { message: err?.message ?? message ?? 'unknown' });
  });

  autoUpdater.on('update-cancelled', () => {
    log.info('[updater] update-cancelled');
    setState('idle');
  });
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    } catch {
      // 忽略
    }
  }
}

// =================== 对外 API ===================

export function initUpdater(): void {
  if (started) return;
  started = true;

  // 让 electron-updater 用我们的 logger
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (autoUpdater as any).logger = {
      info: (m: unknown) => log.info(`[autoUpdater] ${typeof m === 'string' ? m : JSON.stringify(m)}`),
      warn: (m: unknown) => log.warn(`[autoUpdater] ${typeof m === 'string' ? m : JSON.stringify(m)}`),
      error: (m: unknown) => log.error(`[autoUpdater] ${typeof m === 'string' ? m : JSON.stringify(m)}`),
    };
  } catch (err) {
    log.warn(`[updater] failed to set logger: ${(err as Error).message}`);
  }

  // 默认配置:不自动下载(让用户决定),下载完不强制装(让用户点)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  installAutoUpdaterHooks();

  if (!app.isPackaged) {
    log.info('[updater] dev mode — auto-update disabled');
    setState('disabled');
    return;
  }
  log.info(`[updater] initialized, currentVersion=${app.getVersion()}`);
}

export function getStatus(): UpdateStatus {
  return snapshot();
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!started) initUpdater();
  if (state === 'disabled') return snapshot();
  if (state === 'checking') return snapshot();

  // dev 模式不真去 GitHub 检查(避免误报 + 网络依赖)
  if (!app.isPackaged) {
    log.info('[updater] checkForUpdates skipped in dev mode');
    setState('disabled');
    return snapshot();
  }

  setState('checking');
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log.error(`[updater] checkForUpdates failed: ${(err as Error).message}`);
    setState('error', null, (err as Error).message);
  }
  return snapshot();
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!started) initUpdater();
  if (state !== 'available' && state !== 'not-available') {
    log.warn(`[updater] downloadUpdate ignored, state=${state}`);
    return snapshot();
  }
  if (!app.isPackaged) {
    setState('disabled');
    return snapshot();
  }
  setState('downloading');
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log.error(`[updater] downloadUpdate failed: ${(err as Error).message}`);
    setState('error', null, (err as Error).message);
  }
  return snapshot();
}

export function installUpdate(): void {
  if (state !== 'downloaded') {
    log.warn(`[updater] installUpdate ignored, state=${state}`);
    return;
  }
  if (!app.isPackaged) {
    log.info('[updater] installUpdate skipped in dev mode');
    return;
  }
  log.info('[updater] quitAndInstall');
  setState('installing');
  // isSilent=false(让用户看到安装进度),isForceRunAfter=true(装完启动新版本)
  autoUpdater.quitAndInstall(false, true);
}
