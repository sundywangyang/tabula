/**
 * ArchiveProvider 工厂 — 归档逻辑纯 JS,平台无关,直接缓存单例.
 */
import type { ArchiveProvider } from './types';
import { ZipArchiveProvider } from './zip-provider';

let _instance: ArchiveProvider | null = null;

export function getArchiveProvider(): ArchiveProvider {
  if (_instance) return _instance;
  _instance = new ZipArchiveProvider();
  return _instance;
}

/** 测试 / 特殊场景: 强制覆盖 */
export function setArchiveProviderForTesting(p: ArchiveProvider | null): void {
  _instance = p;
}

export type { ArchiveProvider } from './types';