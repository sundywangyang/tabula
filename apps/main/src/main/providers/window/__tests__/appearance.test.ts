/** 启动主题优先级和配置失败时的系统回退。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nativeTheme: { shouldUseDarkColors: false },
  config: {} as Record<string, unknown>,
  getConfig: vi.fn(),
}));
vi.mock('electron', () => ({ nativeTheme: mocks.nativeTheme }));
vi.mock('../../../store/config', () => ({ getConfig: mocks.getConfig }));
import { getWindowAppearance } from '../appearance';

beforeEach(() => {
  mocks.nativeTheme.shouldUseDarkColors = false;
  mocks.config = {};
  mocks.getConfig.mockReset().mockImplementation((key: string) => mocks.config[key]);
});

describe('startup window appearance', () => {
  it.each([false, true])('follows system darkness %s with a new configuration', (dark) => {
    mocks.nativeTheme.shouldUseDarkColors = dark;
    expect(getWindowAppearance()).toMatchObject({
      theme: dark ? 'dark' : 'light',
      background: dark ? '#1e1e1e' : '#ffffff',
      accent: '#007aff',
    });
  });

  it.each(['light', 'dark'] as const)('keeps the saved %s preference instead of the system', (theme) => {
    mocks.nativeTheme.shouldUseDarkColors = theme === 'light';
    mocks.config = { theme, accentColor: '#6366f1' };
    expect(getWindowAppearance()).toMatchObject({ theme, accent: '#6366f1' });
  });

  it('does not insert non-hex configuration content into the splash document', () => {
    mocks.config = { accentColor: '</style><script>bad()</script>' };
    expect(getWindowAppearance().accent).toBe('#007aff');
  });

  it('uses the system palette if configuration cannot be read', () => {
    mocks.nativeTheme.shouldUseDarkColors = true;
    mocks.getConfig.mockImplementation(() => { throw new Error('configuration unavailable'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getWindowAppearance()).toMatchObject({ theme: 'dark', background: '#1e1e1e' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
