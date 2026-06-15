/**
 * 扩展宿主主类
 *
 * 职责：
 * - 启动/管理 ext-host 子进程
 * - 插件发现与激活
 * - 贡献点注册（命令/面板/预览器）
 * - IPC 入口（ext:list/enable/disable/install/uninstall/invoke-command）
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { IpcChannels } from '@tabula/bridge';
import type { ExtensionManifest } from '@tabula/bridge';
import type { Result } from '@tabula/bridge';
import { JsonRpcChannel } from './json-rpc-channel';
import { discoverExtensions, installExtension, uninstallExtension } from './plugin-discovery';
import { ActivationManager } from './activation-manager';
import { ExtHostMethods, MainHostMethods } from './json-rpc-types';

// 贡献点注册表
interface ContributionRegistry {
  commands: Map<string, { extensionId: string; handler: (...args: unknown[]) => unknown }>;
  panels: Map<string, { extensionId: string; title: string; icon?: string; location: string }>;
  previewers: Map<string, { extensionId: string; extension?: string; mimeType?: string; priority: number }>;
}

export class ExtensionHost {
  private rpcChannel: JsonRpcChannel;
  private activationManager: ActivationManager;
  private registry: ContributionRegistry = {
    commands: new Map(),
    panels: new Map(),
    previewers: new Map(),
  };

  /** 已发现的插件列表（内存） */
  private discovered: ExtensionManifest[] = [];
  private _initialized = false;

  constructor() {
    this.rpcChannel = new JsonRpcChannel();
    this.activationManager = new ActivationManager();
  }

  get initialized(): boolean {
    return this._initialized;
  }

  // ==================== 生命周期 ====================

  /**
   * 初始化扩展宿主
   * - 扫描插件目录
   * - 启动 ext-host 子进程
   * - 注册主进程通知处理器
   */
  async init(userExtensionsDir: string): Promise<void> {
    if (this._initialized) return;

    console.log('[tabula] extension host: initializing...');

    // 1. 发现插件
    const devMode = !app.isPackaged;
    this.discovered = await discoverExtensions(userExtensionsDir, devMode);
    console.log(`[tabula] extension host: discovered ${this.discovered.length} extensions`);

    // 2. 启动子进程
    this.rpcChannel.start();

    // 3. 注册通知处理器（接收 ext-host → 主进程的贡献点注册通知）
    this.rpcChannel.onNotification((method, params) => {
      this.handleExtHostNotification(method, params);
    });

    // 4. 初始化 ext-host（传递插件列表）
    await this.rpcChannel.request<void>(ExtHostMethods.INITIALIZE, {
      extensions: this.discovered,
      userExtensionsDir,
    });

    this._initialized = true;
    console.log('[tabula] extension host: initialized');
  }

  /**
   * 优雅关闭
   */
  dispose(): void {
    this.rpcChannel.stop();
    this._initialized = false;
  }

  // ==================== IPC 入口 ====================

  /** ext:list */
  list(): ExtensionManifest[] {
    return this.discovered.map((ext) => ({
      ...ext,
      enabled: ext.enabled,
    }));
  }

  /** ext:enable */
  async enable(id: string): Promise<Result<void>> {
    const ext = this.discovered.find((e) => e.id === id);
    if (!ext) return { ok: false, error: { code: 'ENOENT', message: `Extension not found: ${id}` } };
    ext.enabled = true;
    // 重新激活（如果之前已激活过）
    if (this.activationManager.isActivated(id)) {
      await this.activationManager.activate(ext, this.rpcChannel);
    }
    return { ok: true, data: undefined };
  }

  /** ext:disable */
  async disable(id: string): Promise<Result<void>> {
    const ext = this.discovered.find((e) => e.id === id);
    if (!ext) return { ok: false, error: { code: 'ENOENT', message: `Extension not found: ${id}` } };
    ext.enabled = false;
    // 停用
    await this.activationManager.deactivate(id, this.rpcChannel);
    return { ok: true, data: undefined };
  }

  /** ext:install */
  async install(
    sourcePath: string,
    userExtensionsDir: string,
  ): Promise<ExtensionManifest> {
    const manifest = await installExtension(sourcePath, userExtensionsDir);
    this.discovered.push(manifest);
    return manifest;
  }

  /** ext:uninstall */
  async uninstall(id: string, userExtensionsDir: string): Promise<void> {
    const ext = this.discovered.find((e) => e.id === id);
    if (!ext) throw new Error(`Extension not found: ${id}`);
    if (ext.builtin) throw new Error(`Cannot uninstall builtin extension: ${id}`);

    await this.activationManager.deactivate(id, this.rpcChannel);
    await uninstallExtension(id, userExtensionsDir);
    this.discovered = this.discovered.filter((e) => e.id !== id);
  }

  /** ext:invoke-command */
  async invokeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    // 命令 handler 实际存在 ext-host 子进程的 commandHandlers map 里
    // (REGISTER_COMMAND 只发元信息通知,handler 留在子进程)。
    // 直接转发到 ext-host,ext-host 会处理 "Command not found" 错误。
    return this.rpcChannel.request(ExtHostMethods.INVOKE_COMMAND, { command, args });
  }

  // ==================== Startup 激活 ====================

  /**
   * app ready 后调用：激活所有 onStartup 插件
   */
  async activateOnStartup(): Promise<void> {
    if (!this._initialized) return;
    const enabled = this.discovered.filter((e) => e.enabled);
    await this.activationManager.activateOnStartup(enabled, this.rpcChannel);
  }

  // ==================== 通知处理 ====================

  private handleExtHostNotification(method: string, params?: unknown): void {
    switch (method) {
      case MainHostMethods.REGISTER_COMMAND: {
        const p = params as { command: string; extensionId: string };
        // 命令由 ext-host 内部处理，主进程只记录元信息
        console.log(`[ext-host] command registered: ${p.command} by ${p.extensionId}`);
        break;
      }
      case MainHostMethods.REGISTER_PANEL: {
        const p = params as { id: string; extensionId: string; title: string; icon?: string; location: string };
        this.registry.panels.set(p.id, {
          extensionId: p.extensionId,
          title: p.title,
          icon: p.icon,
          location: p.location,
        });
        console.log(`[ext-host] panel registered: ${p.id} by ${p.extensionId}`);
        break;
      }
      case MainHostMethods.REGISTER_PREVIEWER: {
        const p = params as { id: string; extensionId: string; extension?: string; mimeType?: string; priority: number };
        this.registry.previewers.set(p.id, {
          extensionId: p.extensionId,
          extension: p.extension,
          mimeType: p.mimeType,
          priority: p.priority ?? 0,
        });
        console.log(`[ext-host] previewer registered: ${p.id} by ${p.extensionId}`);
        break;
      }
      case MainHostMethods.EXTENSION_ACTIVATED: {
        const p = params as { id: string };
        console.log(`[ext-host] extension activated notification: ${p.id}`);
        break;
      }
      case MainHostMethods.PANEL_DATA: {
        // ext-host 推送的面板数据 → 广播到所有 renderer 窗口
        const p = params as { panelId: string; extensionId: string; payload: unknown };
        console.log(`[ext-host] panel data: ${p.panelId} from ${p.extensionId}`);
        for (const win of BrowserWindow.getAllWindows()) {
          try {
            if (!win.isDestroyed()) {
              win.webContents.send(IpcChannels.EXT_PANEL_DATA, p);
            }
          } catch {
            // 忽略坏掉的目标
          }
        }
        break;
      }
      case MainHostMethods.ERROR: {
        const p = params as { id?: string; message: string };
        console.error(`[ext-host] extension error: ${p.id ?? 'unknown'}: ${p.message}`);
        break;
      }
      default:
        console.log(`[ext-host] unknown notification: ${method}`, params);
    }
  }

  // ==================== 注册表查询 ====================

  getRegisteredCommands(): Array<{ command: string; extensionId: string }> {
    return Array.from(this.registry.commands.entries()).map(([command, entry]) => ({
      command,
      extensionId: entry.extensionId,
    }));
  }

  getRegisteredPanels(): Array<{ id: string; extensionId: string; title: string; icon?: string; location: string }> {
    return Array.from(this.registry.panels.entries()).map(([id, entry]) => ({
      id,
      extensionId: entry.extensionId,
      title: entry.title,
      icon: entry.icon,
      location: entry.location,
    }));
  }
}

// ==================== 单例导出 ====================

export const extensionHost = new ExtensionHost();

/** 初始化入口（由 main/index.ts bootstrap 调用） */
export async function initExtensionHost(): Promise<void> {
  if (extensionHost.initialized) return;

  const userExtensionsDir = join(app.getPath('userData'), 'extensions');
  await extensionHost.init(userExtensionsDir);

  // app ready 后激活 startup 插件
  if (app.isReady()) {
    await extensionHost.activateOnStartup();
  } else {
    app.whenReady().then(() => extensionHost.activateOnStartup());
  }
}
