/**
 * ArchiveProvider 工厂 — 归档逻辑纯 JS,平台无关,直接缓存单例.
 */
import type { ArchiveProvider } from './types';
import { ZipArchiveProvider } from './zip-provider';
import { TarArchiveProvider, isTarPath } from './tar-provider';

class ArchiveRouter implements ArchiveProvider {
  private zip = new ZipArchiveProvider();
  private tar = new TarArchiveProvider();
  list(path: string) { return (isTarPath(path) ? this.tar : this.zip).list(path); }
  compress(request: import('@tabula/bridge').CompressRequest) { return (isTarPath(request.destination) ? this.tar : this.zip).compress(request); }
  extract(request: import('@tabula/bridge').ExtractRequest) { return (isTarPath(request.archive) ? this.tar : this.zip).extract(request); }
  async getJob(id: string) { const result = await this.tar.getJob(id); return result.ok ? result : this.zip.getJob(id); }
  async cancelJob(id: string) { const result = await this.tar.getJob(id); return result.ok ? this.tar.cancelJob(id) : this.zip.cancelJob(id); }
  onJobUpdate(listener: Parameters<ArchiveProvider['onJobUpdate']>[0]) { const a = this.zip.onJobUpdate(listener), b = this.tar.onJobUpdate(listener); return () => { a(); b(); }; }
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
