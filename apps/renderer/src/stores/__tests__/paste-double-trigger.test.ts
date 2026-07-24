/**
 * Paste double-trigger regression test
 *
 * Bug: Ctrl+C 复制时 toast 弹 2 次;Ctrl+V 粘贴时(尤其是切换 pane 后)并发两次
 *      performBulk,第二次失败(目标已存在)。
 *
 * 根因: FileList.tsx 组件级 onKeyDown + App.tsx 全局 keydown listener 都绑定了
 *      Ctrl+C/X/V。React 合成事件 preventDefault 不阻止原生事件冒泡到 window,
 *      所以两个 handler 各跑一次。
 *
 * 修复: 移除 FileList 中的 Ctrl+C/X/V 处理,让 App.tsx 全局 handler 作为唯一来源。
 *      (同 G006 的 Space 处理思路。)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = apps/renderer/src/stores/__tests__/
// target    = apps/renderer/src/features/file-list/FileList.tsx
// 相对: __dirname/../../features/file-list/FileList.tsx
const fileListSrc = readFileSync(
  join(__dirname, '..', '..', 'features', 'file-list', 'FileList.tsx'),
  'utf-8',
);

describe('Ctrl+C/X/V 单 handler 回归', () => {
  it('FileList.tsx 不应再处理 Ctrl+C', () => {
    // 修复后:FileList 不含 isMeta && key === 'c' 块
    expect(fileListSrc).not.toMatch(/isMeta[\s\S]{0,80}['"]c['"]\s*\|\|\s*path\s*===\s*['"]C['"]/);
  });

  it('FileList.tsx 不应再处理 Ctrl+X', () => {
    expect(fileListSrc).not.toMatch(/isMeta[\s\S]{0,80}['"]x['"]\s*\|\|\s*path\s*===\s*['"]X['"]/);
  });

  it('FileList.tsx 不应再处理 Ctrl+V', () => {
    expect(fileListSrc).not.toMatch(/isMeta[\s\S]{0,80}['"]v['"]\s*\|\|\s*path\s*===\s*['"]V['"]/);
  });

  it('FileList.tsx 应仍处理 Ctrl+A 全选(file-list 局部)', () => {
    expect(fileListSrc).toMatch(/isMeta[\s\S]{0,80}['"]a['"]\s*\|\|\s*path\s*===\s*['"]A['"]/);
  });
});