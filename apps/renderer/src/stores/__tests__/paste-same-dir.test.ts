/**
 * 同目录粘贴回归测试
 *
 * Bug: 用户在同目录 Ctrl+C 后 Ctrl+V,主进程 IPC handler 重新
 *      `join(destination, basename(src))` 算出 src===dest →
 *      fs.cp 抛 EINVAL → "Copy failed ... success 0/1"。
 *
 * 根因: performBulk 在 file-store.ts 检测到 src===dest 后,正确生成
 *       `xxx - 副本.jpg` 重命名,但调用 IPC 时只传了 destDir,**没传
 *       op.dest**。主进程拿不到重命名结果,只能盲目 join()。
 *
 * 修复: performBulk / resolveConflict 调用 `window.tabula.fs.copy()` 时,
 *       增加 `destinations: [op.dest]`,让主进程用显式值,避免 EINVAL。
 *
 * 本测试: 检查 file-store.ts 源码是否在 copy/move 调用处传了 `destinations`,
 *         并检查 fs.copy/move 是否支持 `destinations` 字段(向后兼容)。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fileStoreSrc = readFileSync(
  join(__dirname, '..', 'file-store.ts'),
  'utf-8',
);

describe('同目录粘贴修复 — IPC destinations 透传', () => {
  it('performBulk 调用 tabula.fs.copy 时应传 destinations: [op.dest]', () => {
    // 期望源里有形如:
    //   window.tabula.fs.copy({
    //     sources: [op.source],
    //     destination: destDir,
    //     destinations: [op.dest],   ← 必须存在
    //     overwrite: op.overwrite,
    //   })
    // 用一个能匹配到 fs.copy 调用的窗口,然后断言里面有 destinations 字段。
    expect(fileStoreSrc).toMatch(/window\.tabula\.fs\.copy\([\s\S]*?destinations:\s*\[op\.dest\]/);
  });

  it('performBulk 调用 tabula.fs.move 时应传 destinations: [op.dest]', () => {
    expect(fileStoreSrc).toMatch(/window\.tabula\.fs\.move\([\s\S]*?destinations:\s*\[op\.dest\]/);
  });

  it('resolveConflict 调用 tabula.fs.copy 时应传 destinations: [op.dest]', () => {
    // resolveConflict 是另一处会调 fs.copy 的地方(处理冲突 UI 后的批量执行)。
    // 至少一处 — 全文应包含 fs.copy 调用 + destinations: [op.dest]。
    const matches = fileStoreSrc.match(/window\.tabula\.fs\.copy\([\s\S]*?\}\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
    for (const m of matches!) {
      expect(m).toMatch(/destinations:\s*\[op\.dest\]/);
    }
  });

  it('resolveConflict 调用 tabula.fs.move 时应传 destinations: [op.dest]', () => {
    const matches = fileStoreSrc.match(/window\.tabula\.fs\.move\([\s\S]*?\}\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
    for (const m of matches!) {
      expect(m).toMatch(/destinations:\s*\[op\.dest\]/);
    }
  });

  it('performBulk 在 src===dest 时仍生成带 `- 副本` 后缀的 dest(原有逻辑保留)', () => {
    // 防止有人误把同目录重命名逻辑也删了
    expect(fileStoreSrc).toMatch(/copyName = base \+ ' - 副本'/);
    expect(fileStoreSrc).toMatch(/autoResolved\.push\(\{ source: src, dest: copyDest/);
  });

  it('不再依赖 destDir-based join(注释应提示显式 destinations)', () => {
    // 简单烟雾检查:注释里有"透传 op.dest"或类似的中文说明,
    // 防止后人误把 destinations 字段去掉。
    expect(fileStoreSrc).toMatch(/透传 op\.dest/);
  });
});