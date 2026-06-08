/**
 * 插件激活管理器
 *
 * 职责：
 * - 管理激活状态
 * - 按 activationEvents 触发激活
 * - 调用插件的 activate() 函数
 */
import { join } from 'node:path';
import type { ExtensionManifest } from '@tabula/bridge';
import type { JsonRpcChannel } from './json-rpc-channel';
import { ExtHostMethods } from './json-rpc-types';

export interface ActivatedExtension {
  manifest: ExtensionManifest;
  subscriptions: unknown[]; // ExtensionContext.subscriptions 里的 disposable
}

export class ActivationManager {
  /** 插件 ID → 激活状态 */
  private activated = new Map<string, ActivatedExtension>();

  getActivated(id: string): ActivatedExtension | undefined {
    return this.activated.get(id);
  }

  isActivated(id: string): boolean {
    return this.activated.has(id);
  }

  /**
   * 激活单个插件
   */
  async activate(
    manifest: ExtensionManifest,
    rpcChannel: JsonRpcChannel,
  ): Promise<void> {
    if (this.activated.has(manifest.id)) return;

    console.log(`[ext-host] activating extension: ${manifest.id} (${manifest.version})`);

    // 通过 JSON-RPC 告诉 ext-host 子进程加载并激活此插件
    await rpcChannel.request<void>('$activateExtension', {
      id: manifest.id,
      mainPath: manifest.main,
      rootPath: manifest.path,
    });

    // 注册命令（从 contributions 里提取，发给主进程）
    if (manifest.contributes?.commands) {
      for (const cmd of manifest.contributes.commands) {
        // 这些命令会在 ext-host 那边被真正注册
        // 主进程收到 mainHost.registerCommand 通知后，在这里记录
      }
    }

    this.activated.set(manifest.id, {
      manifest,
      subscriptions: [],
    });

    console.log(`[ext-host] extension activated: ${manifest.id}`);
  }

  /**
   * 停用插件（dispose subscriptions）
   */
  async deactivate(id: string, rpcChannel: JsonRpcChannel): Promise<void> {
    if (!this.activated.has(id)) return;

    console.log(`[ext-host] deactivating extension: ${id}`);

    try {
      await rpcChannel.request('$deactivateExtension', { id });
    } catch (err) {
      console.error(`[ext-host] error deactivating ${id}:`, err);
    }

    this.activated.delete(id);
  }

  /**
   * 检查插件是否匹配某个 activation event
   */
  matchesActivationEvent(
    activationEvents: string[],
    event: string,
  ): boolean {
    for (const ae of activationEvents) {
      // 支持通配符和前缀匹配
      if (ae === '*' || ae === event) return true;
      if (ae === 'onStartup') return true; // special: always matches
      if (ae.startsWith('onCommand:')) {
        const cmd = ae.slice('onCommand:'.length);
        if (event === `onCommand:${cmd}`) return true;
      }
      if (ae.startsWith('onFileSystem:')) {
        const scheme = ae.slice('onFileSystem:'.length);
        if (event === `onFileSystem:${scheme}`) return true;
      }
    }
    return false;
  }

  /**
   * 触发 startup 激活（app ready 时调用）
   * 所有声明了 onStartup 的插件此时激活
   */
  async activateOnStartup(
    extensions: ExtensionManifest[],
    rpcChannel: JsonRpcChannel,
  ): Promise<void> {
    const startupExtensions = extensions.filter((ext) =>
      ext.enabled &&
      ext.activationEvents.some(
        (ae) => ae === '*' || ae === 'onStartup',
      ),
    );

    console.log(`[ext-host] activating ${startupExtensions.length} startup extensions`);
    await Promise.allSettled(
      startupExtensions.map((ext) => this.activate(ext, rpcChannel)),
    );
  }
}
