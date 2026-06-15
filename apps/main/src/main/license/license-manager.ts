/**
 * 许可证管理器 (P-License v1 骨架)
 *
 * 职责:
 * - 启动时 init LicenseService(从 store 加载缓存)
 * - 暴露 verify / getStatus / clear 三个 IPC 出口
 * - 状态变化时向所有 renderer 窗口广播 LICENSE_STATUS_CHANGED
 *
 * 为什么单独分一层(而不是直接用 LicenseService):
 * - LicenseService 是纯逻辑(无 IPC、无 electron)
 * - LicenseManager 负责"接到 renderer 请求 → 翻译成 service 调用 → 广播变化"
 * - 后续接 UI 时,renderer 拿到 status 不需要轮询,push 即时
 */
import { BrowserWindow } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type { LicenseInfo, LicenseResult, LicenseVerifyResult } from '@tabula/bridge';
import { licenseService } from './license-service';

class LicenseManager {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    licenseService.init();
    this.initialized = true;
  }

  /** 主动拉取当前状态 — 失败时 NOT_ACTIVATED */
  getStatus(): LicenseResult<LicenseInfo> {
    this.init();
    const info = licenseService.getCurrent();
    if (!info || info.status === 'inactive') {
      return { ok: false, error: { code: 'NOT_ACTIVATED', message: 'No license activated' } };
    }
    return { ok: true, data: info };
  }

  /** 用户输入 key,验证并广播 */
  async verify(key: string): Promise<LicenseVerifyResult> {
    this.init();
    const result = await licenseService.verify(key);
    // 状态变化广播(成功时也广播,renderer 拉新值)
    this.broadcastStatus();
    return result;
  }

  /** 注销 + 广播 */
  async clear(): Promise<LicenseResult<void>> {
    this.init();
    licenseService.clear();
    this.broadcastStatus();
    return { ok: true, data: undefined };
  }

  private broadcastStatus(): void {
    const info = licenseService.getCurrent();
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannels.LICENSE_STATUS_CHANGED, info);
        }
      } catch {
        // ignore
      }
    }
  }
}

export const licenseManager = new LicenseManager();
