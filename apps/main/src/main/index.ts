/**
 * Tabula 主进程入口
 *
 * 职责:
 * - 启动时创建主窗口
 * - 注册全局 IPC 路由
 * - 处理应用生命周期
 * - 单实例锁
 * - P7: 启动屏 + 自动更新 + 错误日志的 wiring
 */
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { WindowManager } from './window/window-manager';
import { registerIpcHandlers } from './ipc';
import { getWindowProvider } from './providers/window';
import { loadConfig } from './store/config';
import { initExtensionHost } from './ext-host/extension-host';
import { initLogger } from './infra/logger';
import {
  createSplash,
  setProgress as setSplashProgress,
  setMessage as setSplashMessage,
  closeSplash,
  getSplash,
} from './infra/splash';
import { initUpdater, checkForUpdates } from './infra/updater'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { initKeymap } from './keymap/keymap-manager';
import { markWhenReady, markWindowReady, markExtHostReady, startMemorySampling } from './perf/perf-service';

const isDev = !app.isPackaged;

let windowManager: WindowManager | null = null;

// P2-regression probe: external test orchestrator sets TABULA_REMOTE_DEBUG=1
// to expose the renderer over CDP for Playwright connectOverCDP.
// Zero cost when unset (no flag pushed, no port bound).
if (process.env.TABULA_REMOTE_DEBUG === '1') {
  const port = Number(process.env.TABULA_REMOTE_DEBUG_PORT) || 9223;
  // eslint-disable-next-line no-console
  console.error(`[main] TABULA_REMOTE_DEBUG enabled, --remote-debugging-port=${port}`);
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
}

// P7: 把 logger 装在所有其它模块 import 之前的最早阶段,
// 这样后面任何 throw 都能被 log 捕获(尽管 TS 解析的顺序是静态的,
// 实际 Electron 运行时 app.whenReady 之前的 console.* 也走 log)。
initLogger();

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  const win = windowManager?.getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

async function bootstrap() {
  await app.whenReady();
  markWhenReady();

  // macOS: BrowserWindow 的 icon option 在 macOS 上无效 (dock 用 Info.plist CFBundleIconFile)
  // 必须在 dev 模式手动 setIcon, 否则 dock 显示旧/默认 icon
  // macOS 下由 WindowProvider 内部处理 (Windows/Linux no-op)
  // 路径用 app.getAppPath() 而非手算 __dirname/../.. (dev 模式下 import.meta.url 指向
  // 源码位置而非编译产物, 手算层级容易错)
  const appRoot = app.getAppPath();
  const dockIcon = isDev
    ? join(appRoot, 'build-assets', 'icon', 'Tabula.icns')
    : join(process.resourcesPath, 'resources', 'Tabula.icns');
  getWindowProvider().setDockIcon(dockIcon);

  // P7: 启动屏(splash)
  // 必须在主窗口创建之前,这样用户不会看到空白
  createSplash();
  setSplashMessage('正在准备 Tabula…');

  // 加载配置
  setSplashProgress(15, '正在读取用户配置…');
  const config = await loadConfig();

  // 初始化扩展宿主(后台进程)
  setSplashProgress(35, '正在发现扩展…');
  await initExtensionHost();
  markExtHostReady();

  // 创建窗口管理器
  setSplashProgress(60, '正在构建主窗口…');
  windowManager = new WindowManager({ isDev });
  const mainWindow = windowManager.createMainWindow({ initialPath: undefined });
  // eslint-disable-next-line no-console
  console.error('[main] mainWindow created, webContents id:', mainWindow.webContents.id);

  // 注册所有 IPC
  setSplashProgress(80, '正在注册系统服务…');
  registerIpcHandlers({ windowManager });

  // P7: 启动 perf 内存采样定时器(独立于 IPC 注册,职责分离)
  // 关键路径上的后台 timer,setInterval + unref,不阻塞进程退出
  startMemorySampling();

  // P7: 初始化快捷键(必须先于 IPC 内部用 initKeymap 派发的 handler 注册,
  // 实际 registerShortcutsHandlers 内部已读 store,所以这里读时机一致)
  // 注意:initKeymap() 内部会用内置命令目录,不传 specs 也行
  initKeymap();

  // 监听主窗口 ready-to-show → 关闭 splash
  let splashClosed = false;
  const tryCloseSplash = () => {
    if (splashClosed) return;
    splashClosed = true;
    setSplashProgress(100, '准备就绪');
    // 给 splash 一个短暂的"完成"停留,然后平滑淡出
    setTimeout(() => {
      closeSplash();
    }, 220);
  };

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    tryCloseSplash();
    markWindowReady();
  });

  // 容错: 如果 5s 内主窗口还没 ready,强制关 splash(不能让 splash 卡死 UI)
  setTimeout(() => {
    if (getSplash()) {
      // 还没关
      tryCloseSplash();
    }
  }, 5000);

  // 捕获 renderer console 输出到 main stderr(打包后没有 DevTools,只能这样看)
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    // eslint-disable-next-line no-console
    console.error(`[console-msg] level=${level} msg=${message} line=${line}`);
  });

  // 监听 renderer crash
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    // eslint-disable-next-line no-console
    console.error('[main] renderer-process-gone:', details.reason, details.exitCode);
  });

  // P7 debug: 'crashed' 是 BrowserWindow 的事件,不是 webContents — 已通过 render-process-gone 覆盖。
  // (修复 P1 排查时误加的 invalid event listener)

  // 监听页面加载事件
  mainWindow.webContents.on('did-finish-load', () => {
    // eslint-disable-next-line no-console
    console.error('[main] did-finish-load fired');
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    // eslint-disable-next-line no-console
    console.error('[main] did-fail-load:', errorCode, errorDescription);
  });
  mainWindow.webContents.on('did-frame-finish-load', (event, isMainFrame) => {
    // eslint-disable-next-line no-console
    console.error(`[main] did-frame-finish-load (mainFrame=${isMainFrame})`);
  });
  mainWindow.webContents.on('did-stop-loading', () => {
    // eslint-disable-next-line no-console
    console.error('[main] did-stop-loading');
  });

  // 开发环境: 打开 devtools
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // P7: 主窗口显示后,异步触发一次更新检查(不阻塞 UI)
  // 用 setImmediate 把"窗口显示"和"网络请求"解耦
  // NOTE: 暂时禁用,等 GitHub releases 配好再开 — 现在缺 app-update.yml 会弹错误 dialog
  // 挡住主 UI。改:用户手动从菜单"关于"里点"检查更新"才触发。
  // setImmediate(() => {
  //   setTimeout(() => {
  //     initUpdater();
  //     void checkForUpdates().catch(() => {
  //       // 失败已由 updater 内部 log
  //     });
  //   }, 1500);
  // });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager?.createMainWindow({});
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('web-contents-created', (_, contents) => {
  // 安全策略: 禁止窗口内跳转打开新窗口,统一用系统浏览器
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 禁止导航到非允许的域
  contents.on('will-navigate', (event, url) => {
    const allowed = ['localhost', '127.0.0.1', 'file://'];
    if (!allowed.some((p) => url.startsWith(p))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[tabula] bootstrap failed:', err);
  app.exit(1);
});
