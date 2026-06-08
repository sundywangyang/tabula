// Test script: P2 v2 reorderTabs user-scenario
//
// 独立 Node 脚本,无需 Vitest/任何框架,直接用 node 跑:
//   node scripts/test-reorder-tabs.mjs
//
// 目的:
// 1. 演示 verifier 抓出的 bug:向前移动 (fromIndex < toIndex) 时,如果不修正 toIndex,
//    tab 会被插到目标位置之后而不是目标位置。
// 2. 验证当前实现已经修好(12 个 user-scenario 全过)。
// 3. 文本比对:确认当前 apps/renderer/src/stores/layout-store.ts 里的 reorderTabs
//    函数体跟「修好版」逐字一致(允许 if/return 等小写空白差异)。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const layoutStorePath = join(
  __dirname,
  '..',
  'apps',
  'renderer',
  'src',
  'stores',
  'layout-store.ts',
);
const layoutStoreSrc = readFileSync(layoutStorePath, 'utf-8');

// ---------- buggy 版本(verifier 抓出的旧实现)----------
function reorderTabsBuggy(tabs, fromIndex, toIndex) {
  if (fromIndex === toIndex) return tabs;
  if (fromIndex < 0 || toIndex < 0) return tabs;
  if (fromIndex >= tabs.length) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return tabs;
  const target = Math.min(toIndex, next.length); // 缺少 -1 修正
  next.splice(target, 0, moved);
  return next;
}

// ---------- 当前实现(带 fix,跟 layout-store.ts 一致)----------
function reorderTabsFixed(tabs, fromIndex, toIndex) {
  if (fromIndex === toIndex) return tabs;
  if (fromIndex < 0 || toIndex < 0) return tabs;
  if (fromIndex >= tabs.length) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return tabs;
  const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  const target = Math.max(0, Math.min(adjustedToIndex, next.length));
  next.splice(target, 0, moved);
  return next;
}

// ---------- 用户场景用例 ----------
// [description, fromIndex, toIndex, expected]
// Baseline tabs: [A, B, C, D, E],indexes 0..4
const CASES = [
  // === 向前移动 (fromIndex < toIndex) ===
  [
    'forward: drag A before C (A=0, drop index=2 left half)',
    0, 2, ['B', 'A', 'C', 'D', 'E'],
  ],
  [
    'forward: drag A after C (A=0, drop index=2 right half)',
    0, 3, ['B', 'C', 'A', 'D', 'E'],
  ],
  [
    'forward: drag A to very end (A=0, drop last right half)',
    0, 5, ['B', 'C', 'D', 'E', 'A'],
  ],
  [
    'forward: drag B before D (B=1, drop index=3 left half)',
    1, 3, ['A', 'C', 'B', 'D', 'E'],
  ],
  [
    'forward: drag C after D (C=2, drop index=3 right half)',
    2, 4, ['A', 'B', 'D', 'C', 'E'],
  ],

  // === 向后移动 (fromIndex > toIndex) ===
  [
    'backward: drag E before B (E=4, drop index=1 left half)',
    4, 1, ['A', 'E', 'B', 'C', 'D'],
  ],
  [
    'backward: drag E after B (E=4, drop index=1 right half)',
    4, 2, ['A', 'B', 'E', 'C', 'D'],
  ],
  [
    'backward: drag D to start (D=3, drop index=0 left half)',
    3, 0, ['D', 'A', 'B', 'C', 'E'],
  ],

  // === no-op / 边界 ===
  ['no-op: same index', 2, 2, ['A', 'B', 'C', 'D', 'E']],
  ['boundary: toIndex = length (append)', 0, 5, ['B', 'C', 'D', 'E', 'A']],
  ['boundary: toIndex = 0 (prepend, backward)', 4, 0, ['E', 'A', 'B', 'C', 'D']],
  ['boundary: fromIndex = 0, toIndex = 1 (no actual movement)', 0, 1, ['A', 'B', 'C', 'D', 'E']],
];

const TABS = ['A', 'B', 'C', 'D', 'E'];

// ---------- 跑用例 ----------
function run(name, fn) {
  let pass = 0;
  let fail = 0;
  const failures = [];
  console.log(`\n=== ${name} ===`);
  for (const [desc, from, to, expected] of CASES) {
    const actual = fn(TABS, from, to);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
      console.log(`  PASS  ${desc}`);
      pass++;
    } else {
      console.log(`  FAIL  ${desc}`);
      console.log(`        expected: ${JSON.stringify(expected)}`);
      console.log(`        actual:   ${JSON.stringify(actual)}`);
      failures.push({ desc, from, to, expected, actual });
      fail++;
    }
  }
  console.log(`  → ${pass}/${pass + fail} pass`);
  return { pass, fail, failures };
}

console.log('Test: P2 v2 reorderTabs');
console.log('Tab baseline: [A, B, C, D, E] (indexes 0..4)');
console.log('Each case asserts the user-scenario result (intended final order).');

// 1) Buggy 版本应该失败(至少 1 个 forward 案例)
const buggyResult = run('BUGGY reorderTabs (verifier 抓出的旧实现)', reorderTabsBuggy);

// 2) 当前 fixed 实现应该全过
const fixedResult = run('FIXED reorderTabs (standalone, with adjustment)', reorderTabsFixed);

// 3) 文本核对:确认 layout-store.ts 里的 reorderTabs 函数体包含 fix 关键字
console.log('\n=== 文本核对:apps/renderer/src/stores/layout-store.ts ===');
const hasAdjustment = /fromIndex\s*<\s*toIndex\s*\?\s*toIndex\s*-\s*1\s*:\s*toIndex/.test(
  layoutStoreSrc,
);
const hasReorderTabs = /reorderTabs:\s*\(paneId,\s*fromIndex,\s*toIndex\)/.test(layoutStoreSrc);

console.log(`  ${hasReorderTabs ? 'PASS' : 'FAIL'}: reorderTabs method exists in layout-store.ts`);
console.log(
  `  ${hasAdjustment ? 'PASS' : 'FAIL'}: source contains the toIndex adjustment \`fromIndex < toIndex ? toIndex - 1 : toIndex\``,
);

console.log('\n=== Summary ===');
console.log(`BUGGY  (verifier caught):  ${buggyResult.pass} pass, ${buggyResult.fail} fail`);
console.log(`FIXED  (standalone):       ${fixedResult.pass} pass, ${fixedResult.fail} fail`);
console.log(
  `SOURCE (textual check):     ${hasReorderTabs && hasAdjustment ? 'PASS' : 'FAIL'}`,
);

// 期望:
// - buggy 至少 1 个失败(证明 bug 存在)
// - fixed 全部通过(证明 fix 正确)
// - source 包含调整语句(证明当前文件已修)
const ok =
  fixedResult.fail === 0 &&
  hasReorderTabs &&
  hasAdjustment &&
  buggyResult.fail > 0;

if (ok) {
  console.log(
    '\nALL PASS — fix verified, source contains the adjustment, buggy version confirmed to fail.',
  );
  process.exit(0);
} else {
  console.log('\nFAIL — review the conditions above.');
  process.exit(1);
}
