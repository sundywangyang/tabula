/**
 * 启动屏 (P7 Splash)
 *
 * 职责:
 * - 在主进程 bootstrap 阶段创建一个小窗口(无 frame,居中,固定大小)
 * - 加载一个内联 HTML(避免污染 renderer 产物)
 * - 提供 `setProgress(progress, message)` 实时把阶段信息推到 splash
 * - 提供 `closeSplash()` 给 bootstrap 在主窗口 ready 后调用
 * - 提供 `waitForRendererReady()` 由渲染端主动 `splash:ready` 通知(双保险)
 *
 * 不阻塞主进程超过 2s 的保证:
 * - 创建 splash 是同步 BrowserWindow ctor(< 100ms)
 * - 加载 splash.html 是异步的,但不 await(交给 Electron 自己拉)
 * - bootstrap 走"创建 splash → 创建主窗口(异步加载)→ 等主窗口 ready-to-show → 关闭 splash"路径
 */
import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcChannels } from '@tabula/bridge';
import type { SplashStatus } from '@tabula/bridge';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SPLASH_WIDTH = 480;
const SPLASH_HEIGHT = 280;

const SPLASH_HTML = /* html */ `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" />
    <title>Tabula</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #1a1a1f;
        --bg-elev: #22232a;
        --fg: #e6e6ec;
        --fg-dim: #a8a8b3;
        --accent: #6366f1;
      }
      html, body { height: 100%; margin: 0; padding: 0; }
      body {
        background: linear-gradient(135deg, #1a1a1f 0%, #22232a 100%);
        color: var(--fg);
        font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        user-select: none;
      }
      .splash {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 18px;
        padding: 32px 40px;
        width: 100%;
        box-sizing: border-box;
      }
      .logo {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 32px;
        font-weight: 600;
        letter-spacing: 0.5px;
      }
      .logo-mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        background: var(--accent);
        border-radius: 10px;
        color: #fff;
        font-size: 26px;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
        animation: pulse 2.4s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4); }
        50% { transform: scale(1.05); box-shadow: 0 6px 18px rgba(99, 102, 241, 0.6); }
      }
      .version {
        font-size: 12px;
        color: var(--fg-dim);
        font-weight: 400;
        margin-left: 4px;
      }
      .spinner {
        width: 36px;
        height: 36px;
        border: 3px solid rgba(255, 255, 255, 0.1);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .progress-track {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 2px;
        overflow: hidden;
        position: relative;
      }
      .progress-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, var(--accent), #a855f7);
        border-radius: 2px;
        transition: width 0.25s ease;
      }
      .progress-track.indeterminate .progress-fill {
        width: 30%;
        position: absolute;
        animation: indeterminate 1.6s ease-in-out infinite;
      }
      @keyframes indeterminate {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }
      .message {
        font-size: 13px;
        color: var(--fg-dim);
        text-align: center;
        min-height: 18px;
        line-height: 1.4;
      }
      .tip {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.35);
        margin-top: 6px;
      }
      body.fade-out { opacity: 0; transition: opacity 220ms ease; }
    </style>
  </head>
  <body>
    <div class="splash">
      <div class="logo">
        <span class="logo-mark">▣</span>
        <span>Tabula</span>
        <span class="version" id="version">v…</span>
      </div>
      <div class="spinner" aria-label="loading"></div>
      <div class="progress-track indeterminate" id="track">
        <div class="progress-fill" id="fill"></div>
      </div>
      <div class="message" id="msg">正在准备…</div>
      <div class="tip">v1 打磨版 · 由 Electron 驱动</div>
    </div>
    <script>
      (function () {
        var fill = document.getElementById('fill');
        var track = document.getElementById('track');
        var msg = document.getElementById('msg');
        var versionEl = document.getElementById('version');
        var api = window.tabulaSplash;
        if (!api) {
          // 极端情况:preload 没装上
          return;
        }
        api.onProgress(function (status) {
          if (status && typeof status.progress === 'number') {
            track.classList.remove('indeterminate');
            fill.style.width = Math.max(0, Math.min(100, status.progress)) + '%';
          } else {
            track.classList.add('indeterminate');
          }
          if (status && status.message) {
            msg.textContent = status.message;
          }
        });
        api.onMessage(function (payload) {
          if (payload && payload.message) {
            msg.textContent = payload.message;
          }
        });
        // splash 自身绘制完成就告诉主进程
        window.addEventListener('load', function () {
          // 注入版本号(由 main 通过 executeJavaScript 注入;这里给个 fallback)
          setTimeout(function () {
            try { api.markReady(); } catch (e) {}
          }, 30);
        });
      })();
    </script>
  </body>
</html>`;

let splashWindow: BrowserWindow | null = null;
let readyResolver: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

function resolveSplashPreloadPath(): string {
  // dev / build 后,out 结构是:
  //   out/main/index.js
  //   out/preload/index.js
  //   out/preload/splash-preload.js  (multi-entry in electron.vite.config.ts)
  // 所以从 __dirname (out/main) 走 ../preload/splash-preload.js
  return join(__dirname, '../preload/splash-preload.js');
}

export function createSplash(): BrowserWindow {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow;
  }

  splashWindow = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    backgroundColor: '#1a1a1f',
    webPreferences: {
      preload: resolveSplashPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  splashWindow.setMenu(null);

  // ready promise
  readyPromise = new Promise<void>((resolve) => {
    readyResolver = resolve;
  });

  // 把 SPLASH_HTML 用 data: URL 加载,完全绕开文件系统
  // 不用 loadFile + 临时文件,因为某些环境(沙箱、daemon 改 TEMP)会失败
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML);
  splashWindow.loadURL(dataUrl).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[splash] loadURL failed:', err);
  });

  // ready-to-show → 显示并注入版本号
  splashWindow.once('ready-to-show', () => {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    splashWindow.show();
    splashWindow.webContents
      .executeJavaScript(
        `(function(){
          try {
            var el = document.getElementById('version');
            if (el) el.textContent = 'v' + ${JSON.stringify(app.getVersion())};
          } catch(e) {}
        })();`,
        true,
      )
      .catch(() => {
        // 忽略
      });
  });

  return splashWindow;
}

export function getSplash(): BrowserWindow | null {
  return splashWindow;
}

/**
 * 更新 splash 上的进度/消息。
 * progress: 0-100 数字;若传 undefined,走 indeterminate spinner
 */
export function setProgress(progress: number | undefined, message: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const status: SplashStatus = { progress, message };
  splashWindow.webContents.send(IpcChannels.SPLASH_PROGRESS, status);
}

export function setMessage(message: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.send(IpcChannels.SPLASH_MESSAGE, { message });
}

/** 由渲染端在 main window 真正"显示"后调用,主动通知 main 关闭 splash */
export function markRendererReady(): void {
  if (readyResolver) {
    readyResolver();
    readyResolver = null;
  }
}

export function waitForRendererReady(): Promise<void> {
  return readyPromise ?? Promise.resolve();
}

export function closeSplash(): void {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  try {
    splashWindow.webContents
      .executeJavaScript(`document.body.classList.add('fade-out');`, true)
      .catch(() => {
        // 忽略
      });
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      splashWindow = null;
    }, 240);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[splash] close failed:', err);
    try {
      splashWindow?.close();
    } catch {
      // ignore
    }
    splashWindow = null;
  }
}
