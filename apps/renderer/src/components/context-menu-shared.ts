/**
 * G008: ContextMenu early-return 谓词(共享模块,便于单元测试)。
 *
 * 背景:
 *  - 用户在右键菜单点「移除标签 (n)」时,事件 handler 会同时:
 *    1) dispatch `tabula:remove-tag` → ContextMenu 内部 listener 把它转成
 *       `setTagDialog({ mode: 'remove', path, existingTags })`(React state)。
 *    2) 调 `hideGlobalMenu()` → `setGlobalState({ ..., visible: false })`(也是
 *       React state)。
 *  - React 把两次 setState 合并到同一个 commit。如果 ContextMenu 在 commit 时
 *    走 `if (!visible || !paneId) return null;`,那么整个返回树(包括
 *    `{tagDialog && <InputDialog>}`)都被卸载 → 用户看到「没立即弹窗,下次右键
 *    才弹出」。
 *
 * 修复:
 *  - 仅当「菜单不可见 / paneId 缺失」**且** 没有需要渲染的 dialog 时,才返回
 *    null。把这个谓词抽到独立模块,免得单元测试要导入整个 ContextMenu 触发
 *    zustand store 初始化。
 */
export interface ShouldReturnNullArgs {
  visible: boolean;
  paneId: string | null;
  hasTagDialog: boolean;
  hasSymlinkDialog: boolean;
}

export function shouldContextMenuReturnNull(args: ShouldReturnNullArgs): boolean {
  const menuHidden = !args.visible || !args.paneId;
  const anyDialogOpen = args.hasTagDialog || args.hasSymlinkDialog;
  return menuHidden && !anyDialogOpen;
}