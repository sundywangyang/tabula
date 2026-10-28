import { beforeEach, describe, expect, it } from 'vitest';
import '../layout-store';
import { useFileStore } from '../file-store';
import { buildViewRows, entriesInBox, gridColumnCount } from '../../features/file-list/view-layout';
import { installTabulaMock } from './setup';
import type { FsEntry } from '@tabula/bridge';
const entry = (name: string) => ({ name, path: '/files/' + name, ext: '.' + name.split('.').pop(), isDirectory: false, isFile: true, isSymlink: false, size: 1, mtime: 1, atime: 1, ctime: 1, birthtime: 1, mode: 0o644 } as FsEntry);
const entries = [entry('a.txt'), entry('b.js'), entry('c.txt')];
beforeEach(() => { installTabulaMock(); useFileStore.setState({ sortBy: 'name', sortDir: 'asc', showHidden: false, panes: { p: { currentPath: '/files', entries, selectedPaths: new Set([entries[0].path]), cursorPath: entries[0].path, lastClickedPath: entries[0].path, groupBy: 'type', viewMode: 'details', searchQuery: '', loading: false, error: null, breadcrumb: [], renameTarget: null, searchOpen: false } } }); });
describe('grouped selection and type filtering', () => {
  it('keyboard and range selections follow the order rendered by groups', () => {
    useFileStore.getState().moveCursor('p', 1, 1); expect(useFileStore.getState().panes.p.cursorPath).toBe(entries[2].path);
    useFileStore.getState().selectOne('p', entries[0].path); useFileStore.getState().rangeSelect('p', entries[2].path);
    expect([...useFileStore.getState().panes.p.selectedPaths]).toEqual([entries[0].path, entries[2].path]);
  });
  it('rubber-band includes group headers in geometry while selecting files only', () => {
    const rows = buildViewRows([entries[0], entries[2]], 'type');
    expect(entriesInBox(rows, { left: 10, right: 500, top: 36, bottom: 100 }, 600)).toEqual([entries[0].path, entries[2].path]);
    expect(entriesInBox(rows, { left: 0, right: 600, top: 0, bottom: 28 }, 600)).toEqual([]);
  });
  it('grid layout and hit testing follow thumbnail sizes and group boundaries', () => {
    const rows = buildViewRows(entries, 'type', 3, 176);
    expect(rows.map(row => row.top)).toEqual([0, 28, 204, 232]);
    expect(entriesInBox(rows, { left: 8, right: 100, top: 232, bottom: 400 }, 600, 3)).toEqual([entries[1].path]);
  });
  it('fits grid columns to narrow panes and hit tests the single-column padding', () => {
    expect(gridColumnCount(100, 64)).toBe(1);
    expect(gridColumnCount(240, 64)).toBe(2);
    expect(gridColumnCount(1000, 64)).toBe(8);
    expect(gridColumnCount(240, 160)).toBe(1);
    const rows = buildViewRows([entries[0]], 'none', 1, 112);
    expect(entriesInBox(rows, { left: 0, right: 7, top: 0, bottom: 112 }, 100, 1, true)).toEqual([]);
    expect(entriesInBox(rows, { left: 8, right: 10, top: 0, bottom: 112 }, 100, 1, true)).toEqual([entries[0].path]);
  });
  it('filtering constrains all selection operations', () => {
    useFileStore.getState().setFileType('p', 'code'); useFileStore.getState().selectAll('p');
    expect([...useFileStore.getState().panes.p.selectedPaths]).toEqual([entries[1].path]);
    useFileStore.getState().selectInvert('p'); expect(useFileStore.getState().panes.p.selectedPaths.size).toBe(0);
  });
  it('persists thumbnail size and clamps unsupported values', () => {
    useFileStore.getState().setThumbnailSize(120); expect(useFileStore.getState().thumbnailSize).toBe(120);
    useFileStore.getState().setThumbnailSize(1000); expect(useFileStore.getState().thumbnailSize).toBe(160);
  });
});
