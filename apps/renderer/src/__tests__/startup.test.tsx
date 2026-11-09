/** 启动时等待主题和平台缓存,避免首帧显示错误主题或窗口按钮。 */
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
  initPlatform: vi.fn(),
  render: vi.fn(),
  createRoot: vi.fn(),
}));
vi.mock('../App', () => ({ App: () => null }));
vi.mock('../stores/theme-store', () => ({ useThemeStore: { getState: () => ({ hydrate: mocks.hydrate }) } }));
vi.mock('../platform-cache', () => ({ initPlatformCache: mocks.initPlatform }));
vi.mock('react-dom/client', () => ({ default: { createRoot: mocks.createRoot } }));

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('waits for both startup dependencies before mounting the first React tree', async () => {
  let finishTheme!: () => void;
  let finishPlatform!: () => void;
  mocks.hydrate.mockReturnValue(new Promise<void>((resolve) => { finishTheme = resolve; }));
  mocks.initPlatform.mockReturnValue(new Promise<void>((resolve) => { finishPlatform = resolve; }));
  mocks.createRoot.mockReturnValue({ render: mocks.render });
  document.body.innerHTML = '<div id="root"></div>';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../main');

  expect(mocks.hydrate).toHaveBeenCalledOnce();
  expect(mocks.initPlatform).toHaveBeenCalledOnce();
  expect(mocks.createRoot).not.toHaveBeenCalled();
  finishTheme();
  await Promise.resolve();
  expect(mocks.render).not.toHaveBeenCalled();
  finishPlatform();
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
});
