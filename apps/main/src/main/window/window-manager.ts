/**
 * 窗口管理器
 *
 * 负责:
 * - 主窗口的创建/恢复
 * - 多窗口支持(预留)
 * - 窗口状态持久化
 *
 * 平台差异(icon / titleBarStyle / autoHideMenuBar)统一从 platform adapter 取。
 */
import { BrowserWindow, shell, app, screen } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WindowBounds } from '@tabula/bridge';
import { getPlatform } from '../platform';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface CreateWindowOptions {
  initialPath?: string;
  bounds?: WindowBounds;
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private windows = new Map<string, BrowserWindow>();
  /** P2 v2: 通过 openWithTab 开窗时记下路径,渲染进程启动后取回 */
  private bootPathByWindow = new Map<string, string>();
  private isDev: boolean;

  constructor(opts: { isDev: boolean }) {
    this.isDev = opts.isDev;
  }

  createMainWindow(opts: CreateWindowOptions): BrowserWindow {
    const display = screen.getPrimaryDisplay();
    const defaultBounds: WindowBounds = {
      width: Math.min(1440, display.workAreaSize.width - 100),
      height: Math.min(900, display.workAreaSize.height - 100),
      x: undefined,
      y: undefined,
    };
    const bounds = { ...defaultBounds, ...opts.bounds };

    // 平台 chrome(icon / titleBarStyle / autoHideMenuBar)统一从 platform adapter 取
    const platform = getPlatform();
    const iconPath = platform.window.getIconPath({
      isDev: this.isDev,
      resourcesPath: process.resourcesPath,
      appRoot: __dirname,
    });

    const win = new BrowserWindow({
      ...bounds,
      minWidth: 800,
      minHeight: 500,
      show: false,            // 先隐藏,准备好再显示(避免白闪)
      frame: false,           // 自定义标题栏(现代化)
      titleBarStyle: platform.window.titleBarStyle,
      backgroundColor: '#1a1a1f',
      autoHideMenuBar: platform.window.autoHideMenuBar,
      icon: iconPath,
      webPreferences: {
        preload: this.resolvePreload(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,        // preload 需要 fs,先关掉;后续可收紧
        webSecurity: true,
        spellcheck: false,
      },
    });

    win.once('ready-to-show', () => {
      win.show();
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 加载 URL
    if (this.isDev && process.env.ELECTRON_RENDERER_URL) {
      // eslint-disable-next-line no-console
      console.error('[wm] loading dev URL:', process.env.ELECTRON_RENDERER_URL);
      win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      const htmlPath = join(__dirname, '../renderer/index.html');
      // eslint-disable-next-line no-console
      console.error('[wm] loading file:', htmlPath);
      win.loadFile(htmlPath);
    }

    this.mainWindow = win;
    this.windows.set(win.id.toString(), win);

    // P2 v2: 记住 boot 路径
    if (opts.initialPath) {
      this.bootPathByWindow.set(win.id.toString(), opts.initialPath);
    }

    win.on('closed', () => {
      this.windows.delete(win.id.toString());
      this.bootPathByWindow.delete(win.id.toString());
      if (this.mainWindow === win) this.mainWindow = null;
    });

    return win;
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  getWindow(id: string): BrowserWindow | null {
    return this.windows.get(id) ?? null;
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values());
  }

  /** P2 v2: 取回 openWithTab 传入的初始路径;取完即删 */
  getInitialPath(windowId: string): string | null {
    const p = this.bootPathByWindow.get(windowId) ?? null;
    if (p) this.bootPathByWindow.delete(windowId);
    return p;
  }

  private resolvePreload(): string {
    // dev: __dirname 解析到 out/main,preload 在 out/preload
    return join(__dirname, '../preload/index.js');
  }
}
