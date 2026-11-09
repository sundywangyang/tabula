/** Address-bar completion must produce a path that can be opened and completed further. */
import { posix, win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileStore } from '../file-store';
import { useLayoutStore } from '../layout-store';
import { entry, seedFiles } from './file-fixtures';

let mock: Awaited<ReturnType<typeof seedFiles>>;
const store = () => useFileStore.getState();

beforeEach(async () => {
  vi.useFakeTimers();
  mock = await seedFiles();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function directories(paths: typeof posix, tree: Record<string, string[]>) {
  mock.fs.listDir.mockImplementation(async (path) => {
    const canonical = paths.resolve(path);
    const names = tree[canonical];
    if (!names) throw new Error(`Directory does not exist: ${path}`);
    return {
      ok: true,
      data: {
        path,
        entries: names.map((name) => ({ ...entry(paths.join(canonical, name)), isDirectory: true, isFile: false, ext: '' })),
        total: names.length,
      },
    };
  });
}

async function complete(value: string) {
  store().setPathBarValue(value);
  store().completePathBar();
  await Promise.resolve();
}

async function expectNavigation(path: string) {
  await store().submitPathBar();
  expect(store().pathBarOpen).toBe(false);
  expect(store().pathBarError).toBeNull();
  expect(store().panes.p.currentPath).toBe(path);
  const pane = useLayoutStore.getState().getActivePane();
  expect(pane?.type === 'pane' && pane.tabs.find((tab) => tab.id === pane.activeTabId)?.path).toBe(path);
}

describe('address-bar directory completion', () => {
  it.each([
    { input: '/Us', base: '/', name: 'Users', expected: '/Users/' },
    { input: '/Users/fa', base: '/Users', name: 'fafa', expected: '/Users/fafa/' },
  ])('opens the single POSIX completion for $input', async ({ input, base, name, expected }) => {
    directories(posix, { [base]: [name], [posix.resolve(expected)]: [] });
    store().openPathBar('p');
    await complete(input);
    expect(store().pathBarValue).toBe(expected);
    await expectNavigation(expected);
  });

  it('continues completing nested POSIX directories before opening them', async () => {
    directories(posix, {
      '/': ['Users'],
      '/Users': ['fafa'],
      '/Users/fafa': ['Documents'],
      '/Users/fafa/Documents': [],
    });
    store().openPathBar('p');
    await complete('/Us');
    await complete(store().pathBarValue + 'fa');
    await complete(store().pathBarValue + 'Doc');
    expect(store().pathBarValue).toBe('/Users/fafa/Documents/');
    await expectNavigation('/Users/fafa/Documents/');
  });

  it.each([
    { input: 'C:\\Us', base: 'C:\\', expected: 'C:\\Users\\' },
    { input: '\\\\server\\share\\Us', base: '\\\\server\\share\\', expected: '\\\\server\\share\\Users\\' },
  ])('preserves Windows separators when completing $input', async ({ input, base, expected }) => {
    directories(win32, { [base]: ['Users'], [win32.resolve(expected)]: [] });
    store().openPathBar('p');
    await complete(input);
    expect(store().pathBarValue).toBe(expected);
    await expectNavigation(expected);
  });
});
