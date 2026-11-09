/** 同一配置文件无法读取时,快捷键也回退到本次运行的内存状态。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandSpec, KeyCombo } from '@tabula/bridge';

const mocks = vi.hoisted(() => ({ construct: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock('electron-store', () => ({
  default: class {
    constructor(options: unknown) { mocks.construct(options); }
    get(key: string) { return mocks.get(key); }
    set(key: string, value: unknown) { mocks.set(key, value); }
  },
}));

const combo = (key: string): KeyCombo => ({ key, ctrl: true, alt: true, shift: false, meta: false });
const specs: CommandSpec[] = [{ id: 'test.action', title: 'Test', category: 'Test', defaultCombo: combo('j'), reserved: false }];

beforeEach(() => {
  vi.resetModules();
  mocks.construct.mockReset();
  mocks.get.mockReset().mockReturnValue({});
  mocks.set.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('shortcut configuration fallback', () => {
  it('uses default shortcuts when the shared configuration is corrupt and keeps later edits in memory', async () => {
    mocks.construct.mockImplementation(() => { throw new SyntaxError('invalid JSON'); });
    const { initKeymap, getKeymapManager } = await import('../../keymap/keymap-manager');
    expect(() => initKeymap(specs)).not.toThrow();
    const keymap = getKeymapManager();
    expect(keymap.getBindings()[0]?.combo).toEqual(combo('j'));
    expect(keymap.setBinding('test.action', combo('k')).ok).toBe(true);
    initKeymap(specs);
    expect(keymap.getBindings()[0]?.combo).toEqual(combo('k'));
    keymap.resetAll();
    expect(keymap.getBindings()[0]?.combo).toEqual(combo('j'));
    expect(mocks.construct).toHaveBeenCalledOnce();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('falls back when reading an already constructed store fails', async () => {
    mocks.get.mockImplementation(() => { throw new Error('unreadable'); });
    const { initKeymap, getKeymapManager } = await import('../../keymap/keymap-manager');
    initKeymap(specs);
    const keymap = getKeymapManager();
    expect(keymap.setBinding('test.action', null).ok).toBe(true);
    expect(keymap.getBindings()[0]?.combo).toBeNull();
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('retains shortcut edits after a write failure without retrying the original file', async () => {
    const { initKeymap, getKeymapManager } = await import('../../keymap/keymap-manager');
    initKeymap(specs);
    mocks.set.mockImplementation(() => { throw new Error('read-only storage'); });
    const keymap = getKeymapManager();
    expect(keymap.setBinding('test.action', combo('k')).ok).toBe(true);
    expect(keymap.getBindings()[0]?.combo).toEqual(combo('k'));
    keymap.setBinding('test.action', null);
    initKeymap(specs);
    expect(keymap.getBindings()[0]?.combo).toBeNull();
    expect(mocks.set).toHaveBeenCalledOnce();
  });
});
