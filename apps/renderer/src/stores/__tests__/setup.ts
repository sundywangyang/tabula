/**
 * Vitest 单测共享 setup。
 *
 *用途:
 * - 每个 test 文件 `import './setup'` 后,在每个 test跑前会:
 *1. 清掉 `window.tabula`(如果之前挂过 mock),重置 DOM 属性。
 *2. 提供一个 `makeTabulaMock(overrides)`工厂,生成符合
 * IPC契约的 window.tabula mock(未提供的方法会返回
 *合理的 default 值,而非抛错)。
 *
 * 设计原则:
 * - mock 不假设任何具体实现;测试只在每个 case 里覆盖自己关心的字段。
 * - 所有 mock 函数用 vi.fn() 创建,以便在 case 内用
 * `expect(fn).toHaveBeenCalledWith(...)` 做断言。
 * - 不修改 vitest.config.ts 的 setupFiles字段:显式 import
 *反而更清晰,测试文件不需要全局副作用。
 */
import { afterEach, beforeEach, vi } from 'vitest';

// =================== DOM 重置 ===================

/**清除 root元素上由 theme-store / settings-store写入的副作用。 */
function resetDom(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  // jsdom 默认的 <head>/<body> 是空,无需清 children。
}

// =================== tabula mock工厂 ===================

/** 简单 KeyCombo 形状(与 bridge KeyCombo 字段一致,测试里不依赖 bridge 类型) */
export interface TestKeyCombo {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** 测试用的 command shape(对应 CommandSpec) */
export interface TestCommandSpec {
  id: string;
  title: string;
  category: string;
  defaultCombo: TestKeyCombo | null;
  description?: string;
  reserved: boolean;
}

/** 测试用的 binding shape(对应 ShortcutBinding) */
export interface TestShortcutBinding {
  commandId: string;
  combo: TestKeyCombo | null;
  customized: boolean;
}

/** setBinding 返回值 */
export type TestSetBindingResult =
  | { ok: true; data: { commandId: string; combo: unknown } }
  | { ok: false; error: { code: string; message: string; conflict?: unknown } };

/** 允许一个字段既可以是「值」也可以是「返回该值的函数」
 * (让测试可以传 `configAll: () => { throw ... }` 来模拟 IPC down) */
type OrFactory<T> = T | (() => T | Promise<T>);

export interface TabulaMockOptions {
  /** config.all() 的返回值(覆盖整个 AppConfig) */
  configAll?: OrFactory<Record<string, unknown>>;
  /** config.get(key) 的固定返回值映射 */
  configGet?: Record<string, unknown>;
  /** config.set 的自定义实现(默认 vi.fn() resolve) */
  configSet?: (key: string, value: unknown) => Promise<void>;
  /** shortcuts.getAll() 返回的命令列表 */
  shortcutsGetAll?: OrFactory<TestCommandSpec[]>;
  /** shortcuts.getBindings() 返回的当前绑定列表 */
  shortcutsGetBindings?: OrFactory<TestShortcutBinding[]>;
  /** shortcuts.setBinding 的自定义实现 */
  shortcutsSetBinding?: (
    commandId: string,
    combo: TestKeyCombo | null,
  ) => Promise<TestSetBindingResult>;
  /** shortcuts.resetAll 的自定义实现 */
  shortcutsResetAll?: () => Promise<void>;
}

/** 统一解析「值或工厂」字段 */
async function resolveOrFactory<T>(v: OrFactory<T> | undefined, fallback: T): Promise<T> {
  if (v === undefined) return fallback;
  if (typeof v === 'function') {
    // 用 () => void 而不是直接调,确保 (() => Promise<T> | T) 都能编译
    const fn = v as () => T | Promise<T>;
    return await fn();
  }
  return v;
}

/**
 *构造一个挂在 window.tabula 上的 mock 对象,挂到 globalThis.window 上。
 *
 * 返回的 mock本身以及它的每个子对象都暴露给测试,便于:
 * -改 mockSetBinding.mockReturnValueOnce(...) 让单次返回失败
 * -调 mockSetBinding.mock.calls校验参数
 */
export function makeTabulaMock(opts: TabulaMockOptions = {}) {
  const configGetCalls: Array<{ key: string }> = [];
  const configSetCalls: Array<{ key: string; value: unknown }> = [];

  const configAll = vi.fn<(key?: string) => Promise<Record<string, unknown>>>(
    async () => resolveOrFactory(opts.configAll, {}),
  );
  const configGet = vi.fn<(key: string) => Promise<unknown>>(async (key: string) => {
    configGetCalls.push({ key });
    if (opts.configGet && Object.prototype.hasOwnProperty.call(opts.configGet, key)) {
      return opts.configGet[key];
    }
    // 默认:返回 undefined(让 hydrate走 fallback 默认值)
    return undefined;
  });
  const configSet = vi.fn<(key: string, value: unknown) => Promise<void>>(
    async (key: string, value: unknown) => {
      configSetCalls.push({ key, value });
      if (opts.configSet) {
        return opts.configSet(key, value);
      }
    },
  );

  const shortcutsGetAll = vi.fn<() => Promise<TestCommandSpec[]>>(async () =>
    resolveOrFactory(opts.shortcutsGetAll, []),
  );
  const shortcutsGetBindings = vi.fn<() => Promise<TestShortcutBinding[]>>(async () =>
    resolveOrFactory(opts.shortcutsGetBindings, []),
  );
  const shortcutsSetBinding = vi.fn<
    (commandId: string, combo: TestKeyCombo | null) => Promise<TestSetBindingResult>
  >(async (commandId, combo) => {
    if (opts.shortcutsSetBinding) {
      return opts.shortcutsSetBinding(commandId, combo);
    }
    return { ok: true as const, data: { commandId, combo } };
  });
  const shortcutsResetAll = vi.fn<() => Promise<void>>(async () => {
    if (opts.shortcutsResetAll) {
      return opts.shortcutsResetAll();
    }
  });

  const mock = {
    config: { all: configAll, get: configGet, set: configSet },
    shortcuts: {
      getAll: shortcutsGetAll,
      getBindings: shortcutsGetBindings,
      setBinding: shortcutsSetBinding,
      resetAll: shortcutsResetAll,
    },
    //暴露给测试侧的引用,便于按需覆盖或断言
    __configGetCalls: configGetCalls,
    __configSetCalls: configSetCalls,
  };

  return mock;
}

/**
 * 把 mock 对象挂到 jsdom 的 window.tabula 上。
 *
 *重要:mock 是一个 fresh object,每次 `installTabulaMock()`都会
 *替换 window.tabula 的整个引用,避免上一次 test 的实现残留。
 */
export function installTabulaMock(opts: TabulaMockOptions = {}) {
  const mock = makeTabulaMock(opts);
  // 直接赋值:window.tabula 在 main进程 preload 里被设为一个 frozen 对象,
  // 但 jsdom 里没有冻结,赋值可以正常工作。
  (window as unknown as { tabula: unknown }).tabula = mock;
  return mock;
}

/**卸载 mock,把 window.tabula置回 undefined,让 hydrate走 fallback。 */
export function uninstallTabulaMock(): void {
  (window as unknown as { tabula: unknown | undefined }).tabula = undefined;
}

// =================== 自动注册:每个 test 前重置 ===================

beforeEach(() => {
  resetDom();
  uninstallTabulaMock();
});

afterEach(() => {
  resetDom();
  uninstallTabulaMock();
  vi.restoreAllMocks();
});
