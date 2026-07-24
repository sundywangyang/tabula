/**
 * 文件列表空白处点击 — **focus-only**:聚焦当前 pane + 清选中;不改 currentPath
 *
 * 行为(第六轮,用户最终决策):
 * - 单 pane:保留原 clearSelection 行为
 * - 多 pane:点击空白仅 focus 当前 pane + clearSelection,**不切目录**
 *
 * 历史轮次(均为错误方向,已 revert):
 * - 第二轮:closest('.file-list-row') / closest('.file-list-header') 替代 e.target !== e.currentTarget
 * - 第三轮:显式 focusPane 防御冒泡中断(handleBodyMouseDown 旧 stopPropagation)
 * - 第四轮:切 pane + pendingSwitchRef 协调橡皮筋 race
 * - 第五轮:用 navigate 同步 activeTab.path,避免 refocus 时 useEffect revert
 * - **第六轮**:用户决定 revert 第四/五轮的切目录逻辑,**focus-only**
 *
 * 这里用源代码正则做静态回归测试,避免对 FileList 组件做 RTL/jsdom 集成测试
 * (组件依赖 react-virtual + 大量 store,集成测试 ROI 不高)。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = apps/renderer/src/stores/__tests__/
// target    = apps/renderer/src/features/file-list/FileList.tsx
const fileListSrc = readFileSync(
  join(__dirname, '..', '..', 'features', 'file-list', 'FileList.tsx'),
  'utf-8',
);

describe('点空白区域 — focus-only:聚焦 + 清选中,不切目录', () => {
  it('FileList.tsx 应 import useLayoutStore', () => {
    expect(fileListSrc).toMatch(
      /import\s*\{[^}]*useLayoutStore[^}]*\}\s*from\s*['"]\.\.\/\.\.\/stores\/layout-store['"]/,
    );
  });

  it('FileList.tsx 应抽出 handleBlankAreaMouseDown 作为统一 handler(useCallback)', () => {
    expect(fileListSrc).toMatch(/handleBlankAreaMouseDown\s*=\s*useCallback\(/);
  });

  it('FileList.tsx 应只处理鼠标左键(e.button === 0)', () => {
    expect(fileListSrc).toMatch(/e\.button\s*!==\s*0/);
  });

  it('FileList.tsx 空白点击应排除 row 内部(closest 命中 row → 跳过)', () => {
    // 第二轮修复:用 closest('.file-list-row') 替代 e.target !== e.currentTarget
    expect(fileListSrc).toMatch(/closest\(['"]\.file-list-row['"]\)/);
  });

  it('FileList.tsx 空白点击应排除 column header(closest 命中 header → 跳过,不被排序点击误触发切 pane)', () => {
    expect(fileListSrc).toMatch(/closest\(['"]\.file-list-header['"]\)/);
  });

  it('FileList.tsx handleBlankAreaMouseDown 中不应再用 e.target !== e.currentTarget 判空白', () => {
    // 旧实现: handler 第一行 `if (e.target !== e.currentTarget) return`
    // 这是结构性 bug(根 div 没 padding,e.target 永远不等于 currentTarget)。
    const blankHandlerMatch = fileListSrc.match(
      /handleBlankAreaMouseDown\s*=\s*useCallback\([\s\S]*?\},\s*\[/,
    );
    const blankBody = blankHandlerMatch ? blankHandlerMatch[0] : '';
    expect(blankBody.length).toBeGreaterThan(0);
    expect(blankBody).not.toMatch(/e\.target\s*!==\s*e\.currentTarget/);
    expect(blankBody).not.toMatch(/e\.target\s*===\s*e\.currentTarget/);
  });

  it('FileList.tsx handleBlankAreaMouseDown 应显式调 focusPane(paneId)(防御冒泡中断)', () => {
    // 第三轮修复:不依赖 PaneView onMouseDown 冒泡,显式 focusPane 同步生效。
    const blankHandlerMatch = fileListSrc.match(
      /handleBlankAreaMouseDown\s*=\s*useCallback\([\s\S]*?\},\s*\[/,
    );
    const blankBody = blankHandlerMatch ? blankHandlerMatch[0] : '';
    expect(blankBody.length).toBeGreaterThan(0);
    expect(blankBody).toMatch(/useLayoutStore\.getState\(\)\.pane\.focusPane\(\s*paneId\s*\)/);
  });

  it('FileList.tsx handleBlankAreaMouseDown focusPane 前应先检查 activePaneId !== paneId', () => {
    // 避免无意义的 setState(已经是焦点时跳过)
    const blankHandlerMatch = fileListSrc.match(
      /handleBlankAreaMouseDown\s*=\s*useCallback\([\s\S]*?\},\s*\[/,
    );
    const blankBody = blankHandlerMatch ? blankHandlerMatch[0] : '';
    expect(blankBody).toMatch(/activePaneId\s*!==\s*paneId/);
  });

  it('FileList.tsx handleBlankAreaMouseDown 应调 clearSelection(paneId)(无论单 / 多 pane)', () => {
    // 第六轮:focus-only,清选中是核心动作
    const blankHandlerMatch = fileListSrc.match(
      /handleBlankAreaMouseDown\s*=\s*useCallback\([\s\S]*?\},\s*\[/,
    );
    const blankBody = blankHandlerMatch ? blankHandlerMatch[0] : '';
    expect(blankBody).toMatch(/clearSelection\(paneId\)/);
  });

  it('FileList.tsx handleBlankAreaMouseDown **不应** 再调 getAllPaneIds / navigate / loadDir / pendingSwitchRef(第六轮 focus-only 核心)', () => {
    // 第四/五轮切目录的逻辑已 revert。这些是 user 决定的 focus-only 行为
    // 的反向断言:任何切目录残留都会被立刻抓到。
    const blankHandlerMatch = fileListSrc.match(
      /handleBlankAreaMouseDown\s*=\s*useCallback\([\s\S]*?\},\s*\[/,
    );
    const blankBody = blankHandlerMatch ? blankHandlerMatch[0] : '';
    expect(blankBody.length).toBeGreaterThan(0);
    expect(blankBody).not.toMatch(/getAllPaneIds/);
    expect(blankBody).not.toMatch(/\.navigate\(/);
    expect(blankBody).not.toMatch(/\.loadDir\(/);
    expect(blankBody).not.toMatch(/pendingSwitchRef/);
  });

  it('FileList.tsx 应把 handleBlankAreaMouseDown 用在 main branch 和 empty branch 两处', () => {
    const matches = fileListSrc.match(/onMouseDown=\{handleBlankAreaMouseDown\}/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('FileList.tsx main branch(有 entries)应保留 .file-list-body 上的 handleBodyMouseDown(橡皮筋)', () => {
    expect(fileListSrc).toMatch(/handleBodyMouseDown\s*=\s*useCallback\(/);
    expect(fileListSrc).toMatch(/onBodyMouseDown=\{handleBodyMouseDown\}/);
  });

  it('FileList.tsx handleBodyMouseDown 不应再调 e.stopPropagation()(第三轮修复)', () => {
    const bodyHandlerMatch = fileListSrc.match(
      /handleBodyMouseDown\s*=\s*useCallback\([\s\S]*?\},\s*\[\]/,
    );
    const bodyBody = bodyHandlerMatch ? bodyHandlerMatch[0] : '';
    expect(bodyBody.length).toBeGreaterThan(0);
    expect(bodyBody).not.toMatch(/e\.stopPropagation\(/);
  });

  it('FileList.tsx handleBodyMouseDown 应保留 e.preventDefault()(防文本选择)', () => {
    const bodyHandlerMatch = fileListSrc.match(
      /handleBodyMouseDown\s*=\s*useCallback\([\s\S]*?\},\s*\[\]/,
    );
    const bodyBody = bodyHandlerMatch ? bodyHandlerMatch[0] : '';
    expect(bodyBody).toMatch(/e\.preventDefault\(/);
  });

  it('FileList.tsx mouseup 应简化(没有 drag → clearSelection;有 drag → selectRect)', () => {
    // 第六轮:移除 pending 处理。mouseup 行为回到「橡皮筋专用」状态。
    const onUpMatch = fileListSrc.match(
      /const onUp = \(e: MouseEvent\) => \{[\s\S]*?selectRect\(paneId, paths\);[\s\S]*?\};/,
    );
    const onUpBody = onUpMatch ? onUpMatch[0] : '';
    expect(onUpBody.length).toBeGreaterThan(0);
    expect(onUpBody).toMatch(/clearSelection\(paneId\)/);
    expect(onUpBody).not.toMatch(/pendingSwitchRef/);
    expect(onUpBody).not.toMatch(/\.navigate\(/);
    expect(onUpBody).not.toMatch(/loadDir\(pending/);
  });

  it('FileList.tsx 应**不再**有 pendingSwitchRef(第六轮移除)', () => {
    // 第四轮为协调橡皮筋 race 引入;第六轮 focus-only 后不再需要
    expect(fileListSrc).not.toMatch(/pendingSwitchRef/);
  });
});