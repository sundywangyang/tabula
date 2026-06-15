/**
 * 许可证服务 (P-License v1 骨架)
 *
 * 负责:
 * - 调远端验证 license key(目前 hardcoded mock,真实接入时只换 URL 即可)
 * - 持久化最后一次验证结果到 electron-store
 * - 提供 fingerprint(本机标识,dev 期间用于观察机器迁移)
 *
 * 设计原则:
 * - 接口签名是终态的 — 接真实后端时只需替换 `verifyRemote` 内部实现
 * - mock 与真实实现并列共存,通过 `MOCK_URL` 切换
 * - 不抛跨进程异常(交给上层 LicenseManager 包成 Result)
 */
import https from 'node:https';
import Store from 'electron-store';
import { hostname, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import type {
  LicenseError,
  LicenseInfo,
  LicensePlan,
  LicenseStatus,
  LicenseVerifyResult,
} from '@tabula/bridge';

/** Mock 端点 — 真实接入时替换为生产 URL */
const MOCK_URL = '';
const REQUEST_TIMEOUT_MS = 10_000;

/** 持久化 schema(单独一个 store 文件,不污染 tabula-config) */
interface LicenseStoreSchema {
  info: LicenseInfo;
  fingerprint: string;
  rawKey: string;
}

function makeEmptyInfo(): LicenseInfo {
  return {
    status: 'inactive',
    plan: 'free',
    expiresAt: null,
    maskedKey: null,
    daysUntilExpiry: null,
  };
}

/**
 * 本机指纹 — 当前用 hostname + username + userData 路径 hash 出一个稳定字符串。
 * 注意:这不是安全边界(用户能改 hostname),只是 dev 期间观察"同一台机器"用。
 */
export function computeFingerprint(): string {
  const raw = `${hostname()}|${userInfo().username}|${process.platform}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** key 脱敏:前 4 + ... + 后 4(key 长度 ≤ 8 时返回 '****') */
export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function daysBetween(now: Date, future: Date): number {
  return Math.max(0, Math.floor((future.getTime() - now.getTime()) / 86_400_000));
}

export class LicenseService {
  private store: Store<LicenseStoreSchema> | null = null;
  /** 当前内存里的 LicenseInfo(每次 verify/clear 更新,startup 从 store 加载) */
  private current: LicenseInfo = makeEmptyInfo();
  private currentRawKey = '';
  private fingerprint = '';

  /** 启动时调用一次:加载 store、读取缓存 */
  init(): void {
    this.store = new Store<LicenseStoreSchema>({ name: 'tabula-license' });
    this.fingerprint = computeFingerprint();
    const cached = this.store.get('info');
    if (cached && cached.status) {
      this.current = this.refreshDerived(cached);
    } else {
      this.current = makeEmptyInfo();
    }
    this.currentRawKey = this.store.get('rawKey') ?? '';
    // 启动时如果状态是 active 但 expiresAt 早已过期 → 自动降级为 expired
    if (this.current.status === 'active' && this.current.expiresAt) {
      if (new Date(this.current.expiresAt).getTime() < Date.now()) {
        this.current = { ...this.current, status: 'expired', daysUntilExpiry: 0 };
        this.persist();
      }
    }
  }

  /** 给上层用,只读 */
  getCurrent(): LicenseInfo {
    return this.current;
  }

  getFingerprint(): string {
    return this.fingerprint;
  }

  /**
   * 验证入口。
   * v1 骨架:走 hardcoded mock;v2 把这个函数体换成 https 调用即可,签名不变。
   */
  async verify(key: string): Promise<LicenseVerifyResult> {
    if (!key || !key.trim()) {
      return { ok: false, error: { code: 'INVALID_LICENSE', message: 'License key 不能为空' } };
    }
    const trimmed = key.trim();

    // ---- v1 mock 分支 ----
    // 真实接入时,删除这个 if,改调 verifyRemote(trimmed)
    if (MOCK_URL) {
      return this.verifyRemote(trimmed);
    }
    return this.verifyMock(trimmed);
  }

  /**
   * 真实接入占位。骨架阶段不会被调用,但保留签名,后续替换 mock 时不破坏接口。
   */
  private async verifyRemote(key: string): Promise<LicenseVerifyResult> {
    return new Promise<LicenseVerifyResult>((resolve) => {
      const url = new URL(MOCK_URL);
      const body = JSON.stringify({ key, fingerprint: this.fingerprint });
      const req = https.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          let chunks = '';
          res.on('data', (c) => (chunks += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 500) {
              resolve({ ok: false, error: { code: 'SERVER_ERROR', message: `HTTP ${res.statusCode}` } });
              return;
            }
            try {
              const parsed = JSON.parse(chunks);
              if (parsed.ok) {
                resolve({ ok: true, data: parsed.data as LicenseInfo });
              } else {
                resolve({ ok: false, error: parsed.error as LicenseError });
              }
            } catch {
              resolve({ ok: false, error: { code: 'UNKNOWN', message: 'Failed to parse server response' } });
            }
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Request timed out' } });
      });
      req.on('error', (err) => {
        resolve({ ok: false, error: { code: 'NETWORK_ERROR', message: err.message } });
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * v1 mock:几个固定 key 命中不同场景。
   *  - 'test-valid'   → active,plan=pro,30 天后过期
   *  - 'test-expired' → expired
   *  - 'test-invalid' → INVALID_LICENSE
   *  - 其他           → INVALID_LICENSE
   */
  private async verifyMock(key: string): Promise<LicenseVerifyResult> {
    // 模拟一点点网络延迟,让 verify 看起来像真的
    await new Promise((r) => setTimeout(r, 100));

    if (key === 'test-valid') {
      const expires = new Date(Date.now() + 30 * 86_400_000);
      const info: LicenseInfo = {
        status: 'active',
        plan: 'pro',
        expiresAt: expires.toISOString(),
        maskedKey: maskKey(key),
        daysUntilExpiry: daysBetween(new Date(), expires),
      };
      this.current = info;
      this.currentRawKey = key;
      this.persist();
      return { ok: true, data: info };
    }

    if (key === 'test-expired') {
      const info: LicenseInfo = {
        status: 'expired',
        plan: 'pro',
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
        maskedKey: maskKey(key),
        daysUntilExpiry: 0,
      };
      // 过期状态不入缓存(不占用有效 slot)
      this.current = makeEmptyInfo();
      this.currentRawKey = '';
      this.persist();
      return { ok: false, error: { code: 'EXPIRED', message: 'License has expired' } };
    }

    // test-invalid + 其他任意字符串
    return { ok: false, error: { code: 'INVALID_LICENSE', message: `Invalid license key: ${maskKey(key)}` } };
  }

  /** 注销 */
  clear(): void {
    this.current = makeEmptyInfo();
    this.currentRawKey = '';
    this.persist();
  }

  // =================== 内部 ===================

  private refreshDerived(info: LicenseInfo): LicenseInfo {
    if (info.status === 'active' && info.expiresAt) {
      const days = daysBetween(new Date(), new Date(info.expiresAt));
      return { ...info, daysUntilExpiry: days };
    }
    return info;
  }

  private persist(): void {
    if (!this.store) return;
    this.store.set('info', this.current);
    this.store.set('rawKey', this.currentRawKey);
    this.store.set('fingerprint', this.fingerprint);
  }
}

export const licenseService = new LicenseService();
