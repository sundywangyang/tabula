/**
 * ArchiveProvider 工厂 — 归档逻辑纯 JS,平台无关,直接缓存单例.
 */
import type { ArchiveProvider } from './types';
import { ZipArchiveProvider } from './zip-provider';
import { TarArchiveProvider, isTarPath } from './tar-provider';
import { RarArchiveProvider } from './rar-provider';

class ArchiveRouter implements ArchiveProvider {
  private zip = new ZipArchiveProvider();
  private tar = new TarArchiveProvider();
  private rar = new RarArchiveProvider();
  list(path: string) { return (/\.rar$/i.test(path) ? this.rar : isTarPath(path) ? this.tar : this.zip).list(path); }
  compress(request: import('@tabula/bridge').CompressRequest) { return (isTarPath(request.destination) ? this.tar : this.zip).compress(request); }
  extract(request: import('@tabula/bridge').ExtractRequest) { return (/\.rar$/i.test(request.archive) ? this.rar : isTarPath(request.archive) ? this.tar : this.zip).extract(request); }
  async getJob(id: string) { for (const provider of [this.rar, this.tar, this.zip]) { const result = await provider.getJob(id); if (result.ok) return result; } return { ok: false as const, error: { code: 'JOB_NOT_FOUND' as const, message: '找不到任务' } }; }
  async cancelJob(id: string) { for (const provider of [this.rar, this.tar, this.zip]) { if ((await provider.getJob(id)).ok) return provider.cancelJob(id); } return { ok: false as const, error: { code: 'JOB_NOT_FOUND' as const, message: '找不到任务' } }; }
  onJobUpdate(listener: Parameters<ArchiveProvider['onJobUpdate']>[0]) { const stops = [this.zip, this.tar, this.rar].map(provider => provider.onJobUpdate(listener)); return () => stops.forEach(stop => stop()); }
}

let _instance: ArchiveProvider | null = null;

export function getArchiveProvider(): ArchiveProvider {
  if (_instance) return _instance;
  _instance = new ArchiveRouter();
  return _instance;
}

/** 测试 / 特殊场景: 强制覆盖 */
export function setArchiveProviderForTesting(p: ArchiveProvider | null): void {
  _instance = p;
}

export type { ArchiveProvider } from './types';
