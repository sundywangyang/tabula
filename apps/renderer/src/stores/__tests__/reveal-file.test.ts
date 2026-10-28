import { beforeEach, expect, it } from 'vitest';
import { seedFiles } from './file-fixtures';
import { useFileStore } from '../file-store';
import { useLayoutStore } from '../layout-store';
beforeEach(async () => { await seedFiles(); });
it('reveals the file and preserves selection without a trailing separator in the tab title', async () => {
  await useFileStore.getState().revealInPane('p', 'C:\\target\\a.txt');
  expect(useFileStore.getState().panes.p.currentPath).toBe('C:\\target');
  expect([...useFileStore.getState().panes.p.selectedPaths]).toEqual(['C:\\target\\a.txt']);
  const pane = useLayoutStore.getState().rootLayout;
  expect(pane.type === 'pane' && pane.tabs[0].title).toBe('target');
});
