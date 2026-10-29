import { beforeEach, describe, expect, it } from 'vitest';
import { runCommandById } from '../../command-dispatcher';
import { useFileStore } from '../file-store';
import { useLayoutStore } from '../layout-store';
import { seedFiles } from './file-fixtures';

beforeEach(async () => { await seedFiles(); useLayoutStore.setState({ closedTabs: [] }); });

describe('navigation', () => {
  it('navigates to the parent and leaves drive and UNC roots alone', async () => {
    const layout = useLayoutStore.getState();
    await layout.pane.navigate('p', 'C:\\parent\\child');
    runCommandById('navigation.parent');
    expect(useLayoutStore.getState().getActivePane()).toMatchObject({ tabs: [{ path: 'C:\\parent' }] });
    await layout.pane.navigate('p', 'C:\\');
    runCommandById('navigation.parent');
    expect(useLayoutStore.getState().getActivePane()).toMatchObject({ tabs: [{ path: 'C:\\' }] });
    await layout.pane.navigate('p', '\\\\server\\share');
    runCommandById('navigation.parent');
    expect(useLayoutStore.getState().getActivePane()).toMatchObject({ tabs: [{ path: '\\\\server\\share' }] });
  });

  it('restores the closed tab with its navigation history, including after its pane disappears', async () => {
    const layout = useLayoutStore.getState();
    await layout.pane.navigate('p', 'C:\\second');
    const closed = useLayoutStore.getState().getActivePane();
    if (!closed || closed.type !== 'pane') throw new Error('expected pane');
    const expected = closed.tabs[0];
    layout.pane.closeTab('p', expected.id);
    runCommandById('tab.reopen');
    const reopened = useLayoutStore.getState().getActivePane();
    if (!reopened || reopened.type !== 'pane') throw new Error('expected pane');
    expect(reopened.activeTabId).toBe(expected.id);
    expect(reopened.tabs.find(tab => tab.id === expected.id)).toEqual(expected);
    expect(useLayoutStore.getState().closedTabs).toEqual([]);
  });
});
