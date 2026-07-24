/**
 * splitPane 行为:新 pane 继承父 pane active tab 的 path
 *
 * 第二轮修复背景:
 * — 旧实现 splitPane 创建新 pane 时,新 tab 只有 id/type/title/pinned/closable/history
 *   字段,**没有 path**。
 * — PaneView 的 loadDir effect 命中 `if (!activeTabPath) return`,永不触发 loadDir。
 * — `panes[freshPaneId].currentPath` 恒为 `''`。
 * — 即使 FileList 的 onMouseDown handler 修好了(用 closest 检测),
 *   `if (otherPath && otherPath !== currentPath)` 守卫仍因 `''` falsy 短路,
 *   "分区后点空白切 pane" 功能还是失效。
 *
 * 修复:splitPane 应该:
 * 1. 读出父 pane active tab 的 path
 * 2. 新 tab 的 `path` 字段继承过来
 * 3. 新 tab 的 title 继承 basename(path)(没 path 时回退 '新窗格')
 * 4. 新 tab 的 history 初始为 `[inheritedPath]`, historyIndex = 0
 * 5. split 完成后,如果 inheritedPath 非空,主动调 useFileStore.loadDir 让
 *    panes[freshPaneId].currentPath 立刻有值。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = apps/renderer/src/stores/__tests__/
// target    = apps/renderer/src/stores/layout-store.ts
const layoutStoreSrc = readFileSync(
  join(__dirname, '..', 'layout-store.ts'),
  'utf-8',
);

// 取出 splitPane 函数体(从 splitPane: (paneId, dir) => { 到下一个顶层 mutator 前)
// 用粗匹配,允许内部格式调整;只要关键语义在里面就行。
// — 边界:以 `},\n\n      mergePane:` 作为终止(下一个 mutator 在 6 空格缩进处开始)
const splitPaneBodyMatch = layoutStoreSrc.match(
  /splitPane:\s*\(paneId,\s*dir\)\s*=>\s*\{[\s\S]*?\},\s*\n\s*mergePane:/,
);
const splitPaneBody = splitPaneBodyMatch ? splitPaneBodyMatch[0] : '';

describe('splitPane — 新 pane 继承父 pane active tab 的 path', () => {
  it('layout-store.ts 应有 splitPane mutator', () => {
    expect(splitPaneBody.length).toBeGreaterThan(0);
  });

  it('splitPane 应读取父 pane active tab 的 path(inheritedPath)', () => {
    // 期望: const oldActiveTab = oldPane.tabs.find(... activeTabId)
    //       const inheritedPath: string | undefined = oldActiveTab?.path;
    expect(splitPaneBody).toMatch(/oldActiveTab/);
    expect(splitPaneBody).toMatch(/inheritedPath/);
    expect(splitPaneBody).toMatch(/inheritedPath[\s\S]{0,40}=\s*oldActiveTab\?\.\s*path/);
  });

  it('splitPane 新 tab 应继承 path 字段(否则 PaneView loadDir 永不触发)', () => {
    // 期望在新 tab 对象字面量里: path: inheritedPath,
    expect(splitPaneBody).toMatch(/path:\s*inheritedPath/);
  });

  it('splitPane 新 tab 的 title 应基于 path 派生 basename,有 path 时不显示 "新窗格"', () => {
    // 期望: const inheritedTitle = inheritedPath ? basenameOf(inheritedPath) : '新窗格'
    //       newPane.tabs[0].title = inheritedTitle
    // — basenameOf 工具函数已存在于 layout-store.ts:946
    expect(splitPaneBody).toMatch(/title:\s*inheritedTitle/);
    expect(splitPaneBody).toMatch(/basenameOf\(inheritedPath\)/);
    expect(splitPaneBody).toMatch(/['"]新窗格['"]/);
  });

  it('splitPane 新 tab 的 history/historyIndex 应基于 inheritedPath 初始化', () => {
    // 期望: history: inheritedPath ? [inheritedPath] : []
    //       historyIndex: inheritedPath ? 0 : -1
    expect(splitPaneBody).toMatch(/history:\s*inheritedPath/);
    expect(splitPaneBody).toMatch(/historyIndex:\s*inheritedPath/);
  });

  it('splitPane 完成后,inheritedPath 非空时应主动 loadDir 新 pane', () => {
    // 期望: if (inheritedPath) { void useFileStore.getState().loadDir(freshPaneId, inheritedPath) }
    // — 让 panes[freshPaneId].currentPath 立刻有值,这样后面点击空白切 pane 时
    //   `otherPath && otherPath !== currentPath` 守卫才能通过。
    expect(splitPaneBody).toMatch(/if\s*\(\s*inheritedPath\s*\)/);
    expect(splitPaneBody).toMatch(/useFileStore\.getState\(\)\.loadDir\(/);
    expect(splitPaneBody).toMatch(/loadDir\(\s*freshPaneId,\s*inheritedPath\s*\)/);
  });

  it('splitPane 应始终 ensurePane(无论是否有 inheritedPath)', () => {
    // 防御:保证 file-store 里有 panes[freshPaneId] 的数据空壳
    expect(splitPaneBody).toMatch(/useFileStore\.getState\(\)\.ensurePane\(\s*freshPaneId\s*\)/);
  });
});