/**
 * G008 tag-dialog unmount bug: 防回归单测。
 *
 * 背景:
 *  - 用户在右键菜单点「移除标签 (n)」时,事件 handler 会同时:
 *    1) dispatch `tabula:remove-tag` → ContextMenu 内部 listener 把它转成
 *       `setTagDialog({ mode: 'remove', path, existingTags })`(React state)。
 *    2) 调 `hideGlobalMenu()` → `setGlobalState({ ..., visible: false })`(也是
 *       React state)。
 *  - React 把两次 setState 合并到同一个 commit。如果 ContextMenu 在 commit 时
 *    走 `if (!globalState.visible || !globalState.paneId) return null;`,
 *    那么整个返回树(包括 `{tagDialog && <InputDialog>}`)都被卸载 → 用户看到
 *    「没立即弹窗,下次右键才弹出」。
 *
 * 修复:
 *  - 抽出 `shouldContextMenuReturnNull({ visible, paneId, hasTagDialog,
 *    hasSymlinkDialog })` 纯函数,改为「菜单隐藏 **且** 没有 dialog 才返回
 *    null」。
 *
 * 本测试只覆盖纯函数 `shouldContextMenuReturnNull`,不依赖 React/IPC;行为契约:
 *  - 全空 → 返回 true(早期 null)
 *  - 只有菜单可见 → false(渲染菜单)
 *  - 菜单已隐藏但 dialog 仍开 → false(必须渲染 dialog)
 */
import { describe, expect, it } from 'vitest';
import { shouldContextMenuReturnNull } from '../context-menu-shared';

describe('ContextMenu.shouldContextMenuReturnNull (G008)', () => {
  it('菜单不可见且无 dialog → 返回 true(应早返 null)', () => {
    expect(
      shouldContextMenuReturnNull({
        visible: false,
        paneId: null,
        hasTagDialog: false,
        hasSymlinkDialog: false,
      }),
    ).toBe(true);
  });

  it('菜单不可见但 tagDialog 已开 → 返回 false(必须渲染 dialog)', () => {
    expect(
      shouldContextMenuReturnNull({
        visible: false,
        paneId: 'pane-1',
        hasTagDialog: true,
        hasSymlinkDialog: false,
      }),
    ).toBe(false);
  });

  it('菜单不可见但 symlinkDialog 已开 → 返回 false(必须渲染 dialog)', () => {
    expect(
      shouldContextMenuReturnNull({
        visible: false,
        paneId: 'pane-1',
        hasTagDialog: false,
        hasSymlinkDialog: true,
      }),
    ).toBe(false);
  });

  it('菜单可见且 paneId 存在 → 返回 false(渲染菜单)', () => {
    expect(
      shouldContextMenuReturnNull({
        visible: true,
        paneId: 'pane-1',
        hasTagDialog: false,
        hasSymlinkDialog: false,
      }),
    ).toBe(false);
  });

  it('菜单可见但 paneId 缺失 → 返回 true(数据不完整,早返 null)', () => {
    expect(
      shouldContextMenuReturnNull({
        visible: true,
        paneId: null,
        hasTagDialog: false,
        hasSymlinkDialog: false,
      }),
    ).toBe(true);
  });

  it('G008 场景:hideGlobalMenu 之后 tagDialog 仍为 remove 模式 → 返回 false', () => {
    // 模拟 bug 报告里的状态机:
    //   1) 用户右键打开菜单 → visible=true, paneId='pane-1'
    //   2) 用户点「移除标签」→ dispatchEvent('tabula:remove-tag') + hideGlobalMenu()
    //   3) React 把 setTagDialog({mode:'remove', ...}) 与 setGlobalState({visible:false})
    //      一起 commit → 进入本次判断
    //   4) 修复前:`!visible || !paneId` 为 true → return null,dialog 被一起卸载
    //      修复后:`menuHidden && !anyDialogOpen` 为 false → 继续渲染,dialog 可见
    //
    // 演示「修复前会怎样」:用 runtime 变量,避免 TypeScript 把 !'pane-1' 当成
    // 「永远 truthy」编译警告。
    const visible = false;
    const paneId: string | null = 'pane-1';
    const beforeFix = !visible || !paneId; // true
    expect(beforeFix).toBe(true);

    // 实际调用新谓词,期望 false(dialog 必须保持可见)
    const afterFix = shouldContextMenuReturnNull({
      visible: false,
      paneId: 'pane-1',
      hasTagDialog: true, // mode: 'remove'
      hasSymlinkDialog: false,
    });
    expect(afterFix).toBe(false);
  });

  it('菜单隐藏 + 两个 dialog 同时打开(理论上不会发生,但要保守) → 返回 false', () => {
    expect(
      shouldContextMenuReturnNull({
        visible: false,
        paneId: 'pane-1',
        hasTagDialog: true,
        hasSymlinkDialog: true,
      }),
    ).toBe(false);
  });
});