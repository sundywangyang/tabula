import type { FsEntry } from '@tabula/bridge';

/** 全局单例:模块级 state,所有 ContextMenu 实例共享 */
export interface GlobalState {
  paneId: string | null;
  entry: FsEntry | null;
  visible: boolean;
  pos: { x: number; y: number; };
}

export let globalState: GlobalState = {
  paneId: null,
  entry: null,
  visible: false,
  pos: { x: 0, y: 0 },
};

export const registration = { active: false };

export const globalSubscribers = new Set<() => void>();

export function setGlobalState(next: GlobalState) {
  globalState = next;
  globalSubscribers.forEach((fn) => fn());
}

export function hideGlobalMenu() {
  if (!globalState.visible) return;
  setGlobalState({ ...globalState, visible: false });
}
