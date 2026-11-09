/** 配置无法载入时继续运行,且不覆盖原配置文件。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  saved: {} as Record<string, unknown>,
  defaults: {} as Record<string, unknown>,
}));
vi.mock('electron', () => ({ app: { getPath: () => '/test-user-data' } }));
vi.mock('electron-store', () => ({
  default: class {
    constructor(options: { defaults: Record<string, unknown> }) {
      mocks.construct(options);
      mocks.defaults = options.defaults;
    }
    get store() { return mocks.read(); }
    set(key: string, value: unknown) { mocks.write(key, value); }
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.saved = { theme: 'dark', accentColor: '#6366f1' };
  mocks.defaults = {};
  mocks.construct.mockReset();
  mocks.read.mockReset().mockImplementation(() => ({ ...mocks.defaults, ...mocks.saved }));
  mocks.write.mockReset().mockImplementation((key: string, value: unknown) => { mocks.saved[key] = value; });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('configuration storage', () => {
  it('preserves saved preferences and persists edits when storage is readable', async () => {
    const config = await import('../config');
    expect(await config.loadConfig()).toMatchObject({ theme: 'dark', accentColor: '#6366f1' });
    config.setConfig('theme', 'light');
    expect(config.getConfig('theme')).toBe('light');
    expect(mocks.write).toHaveBeenCalledWith('theme', 'light');
    expect(mocks.construct).toHaveBeenCalledWith(expect.objectContaining({ clearInvalidConfig: false }));
  });

  it('continues with system defaults after construction fails without retrying or writing the file', async () => {
    mocks.construct.mockImplementation(() => { throw new SyntaxError('invalid JSON'); });
    const config = await import('../config');
    await expect(config.loadConfig()).resolves.toMatchObject({ theme: 'system', extensionsDir: join('/test-user-data', 'extensions') });
    config.setConfig('theme', 'light');
    config.setConfig('accentColor', '#ffff00');
    expect(config.getAllConfig()).toMatchObject({ theme: 'light', accentColor: '#ffff00' });
    expect(config.getConfig('theme')).toBe('light');
    expect(mocks.construct).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('keeps subsequent reads and writes in memory if reading an existing store fails', async () => {
    mocks.read.mockImplementation(() => { throw new Error('file unreadable'); });
    const config = await import('../config');
    await config.loadConfig();
    config.setConfig('showHidden', true);
    expect(config.getConfig('showHidden')).toBe(true);
    expect(config.getConfig('theme')).toBe('system');
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('keeps the requested edit for this run when persistence fails', async () => {
    const config = await import('../config');
    await config.loadConfig();
    mocks.write.mockImplementation(() => { throw new Error('read-only storage'); });
    expect(() => config.setConfig('theme', 'light')).not.toThrow();
    config.setConfig('showHidden', true);
    expect(config.getAllConfig()).toMatchObject({ theme: 'light', showHidden: true });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.saved.theme).toBe('dark');
  });
});
