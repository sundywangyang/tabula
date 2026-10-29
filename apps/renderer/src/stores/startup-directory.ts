import { useFileStore } from './file-store';

/** The pane can start loading as soon as the restored layout mounts. */
export async function ensureStartupDirectory(paneId: string, path: string): Promise<void> {
  if (path === 'trash:///' || useFileStore.getState().panes[paneId]?.currentPath === path) return;
  await useFileStore.getState().loadDir(paneId, path);
}
