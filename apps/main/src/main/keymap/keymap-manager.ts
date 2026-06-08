/**
 * 快捷键管理器 (P7 v1)
 *
 * 负责:
 * - 启动时从 electron-store 加载用户覆盖(`shortcutsV1`)
 * - 合并「用户覆盖」+「默认绑定」,对外暴露当前生效视图
 * - 持久化:用户通过 UI 改动 → 写回 store
 * - 冲突检测:同一 combo 不可被两个命令同时占用(命令自己的默认 combo 不算冲突)
 * - 系统保留组合(由 command-catalog.HARD_RESERVED 提供)不可被任何命令占用
 * - 预留:ext-host 后续注册的命令可与本表合并(本里程碑先只支持内置命令)
 */
import Store from 'electron-store';
import type { CommandSpec, KeyCombo, SetBindingResult, ShortcutBinding, ShortcutErrorCode } from '@tabula/bridge';
import { getAllCommands, isSameCombo, isReservedCombo, parseKeyCombo } from './command-catalog';

const PERSIST_KEY = 'shortcutsV1';

/** 用户覆盖的存储格式 */
type UserOverrides = Record<string, string | null>;

/** 把 KeyCombo 序列化成稳定字符串(用于持久化 key) */
function comboToString(c: KeyCombo): string {
  const mods: string[] = [];
  if (c.ctrl) mods.push('Ctrl');
  if (c.alt) mods.push('Alt');
  if (c.shift) mods.push('Shift');
  if (c.meta) mods.push('Meta');
  return [...mods, c.key].join('+');
}

function prettyCombo(c: KeyCombo): string {
  return comboToString(c);
}

function makeErr(code: ShortcutErrorCode, message: string): SetBindingResult {
  return { ok: false, error: { code, message } };
}

/** 当前 keymap 的内存表示(id → combo) */
type ResolvedMap = Map<string, KeyCombo | null>;

class KeymapManager {
  private store: Store<{ shortcutsV1: UserOverrides }> | null = null;
  private resolved: ResolvedMap = new Map();
  private specById: Map<string, CommandSpec> = new Map();

  /**
   * 初始化:加载用户覆盖,合并默认绑定到内存
   * 必须在 app.whenReady() 之后调用
   */
  init(specs: CommandSpec[]): void {
    this.specById = new Map(specs.map((s) => [s.id, s]));
    if (!this.store) {
      this.store = new Store<{ shortcutsV1: UserOverrides }>({
        name: 'tabula-config',
        defaults: { shortcutsV1: {} },
      });
    }
    const overrides = this.store.get(PERSIST_KEY) ?? {};
    this.rebuild(overrides);
  }

  /** 重新从用户覆盖构建 resolved map */
  private rebuild(overrides: UserOverrides): void {
    const out: ResolvedMap = new Map();
    for (const [id, spec] of this.specById) {
      const userVal = overrides[id];
      if (userVal === undefined) {
        // 用户没动 → 用默认
        out.set(id, spec.defaultCombo);
      } else if (userVal === null) {
        // 用户显式解绑
        out.set(id, null);
      } else {
        // 尝试解析,失败则回退到默认
        const parsed = parseKeyCombo(userVal);
        out.set(id, parsed ?? spec.defaultCombo);
      }
    }
    this.resolved = out;
  }

  /** 获取所有命令元信息 */
  getAllCommands(): CommandSpec[] {
    return Array.from(this.specById.values());
  }

  /** 获取当前所有生效绑定 */
  getBindings(): ShortcutBinding[] {
    const out: ShortcutBinding[] = [];
    for (const [id, spec] of this.specById) {
      const combo = this.resolved.get(id) ?? null;
      const isCustom = combo !== null && !isSameCombo(combo, spec.defaultCombo);
      out.push({
        commandId: id,
        combo,
        customized: isCustom,
      });
    }
    return out;
  }

  /**
   * 设置单个命令的绑定。
   * - combo = null:显式解绑(允许,只要不是 reserved 命令)
   * - 不允许的命令 id:返回 UNKNOWN_COMMAND
   * - 系统保留命令(reserved=true):返回 RESERVED_COMMAND
   * - 系统保留组合:返回 RESERVED_COMBO
   * - 冲突:返回 CONFLICT(包含 conflict 信息)
   * - 解析失败:返回 INVALID_COMBO
   */
  setBinding(commandId: string, combo: KeyCombo | null): SetBindingResult {
    const spec = this.specById.get(commandId);
    if (!spec) {
      return makeErr('UNKNOWN_COMMAND', `未知命令: ${commandId}`);
    }
    if (spec.reserved) {
      return makeErr('RESERVED_COMMAND', `命令 ${spec.id} 是系统保留命令,不可修改`);
    }
    // null:显式解绑
    if (combo === null) {
      this.applyAndPersist(commandId, null);
      return { ok: true, data: { commandId, combo: null } };
    }
    // 合法性
    if (!combo.key) {
      return makeErr('INVALID_COMBO', '无效的键组合(缺少主键)');
    }
    if (isReservedCombo(combo)) {
      return makeErr('RESERVED_COMBO', `键组合被系统保留,不可绑定: ${prettyCombo(combo)}`);
    }
    // 冲突:扫描其它命令,看 resolved combo 是否和当前 combo 相同
    for (const [otherId, otherCombo] of this.resolved) {
      if (otherId === commandId) continue;
      if (otherCombo === null) continue;
      if (isSameCombo(otherCombo, combo)) {
        const otherSpec = this.specById.get(otherId);
        return {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: `键组合已被「${otherSpec?.title ?? otherId}」占用`,
            conflict: {
              commandId,
              combo,
              conflictingCommandId: otherId,
              conflictingTitle: otherSpec?.title ?? otherId,
            },
          },
        };
      }
    }
    this.applyAndPersist(commandId, combo);
    return { ok: true, data: { commandId, combo } };
  }

  /** 重置所有用户覆盖 → 全部回到默认 */
  resetAll(): void {
    if (!this.store) return;
    this.store.set(PERSIST_KEY, {});
    this.rebuild({});
  }

  private applyAndPersist(commandId: string, combo: KeyCombo | null): void {
    if (!this.store) return;
    this.resolved.set(commandId, combo);
    // 读取现有覆盖,更新一条
    const overrides = this.store.get(PERSIST_KEY) ?? {};
    if (combo === null) {
      overrides[commandId] = null;
    } else {
      overrides[commandId] = comboToString(combo);
    }
    this.store.set(PERSIST_KEY, overrides);
  }
}

// 单例(主进程共用)
let instance: KeymapManager | null = null;

export function getKeymapManager(): KeymapManager {
  if (!instance) instance = new KeymapManager();
  return instance;
}

/** 应用启动时调用,做一次 init(供 index.ts 调) */
export function initKeymap(specs?: CommandSpec[]): void {
  // 不传 specs 时,自动用内置命令目录(避免外部必须 import command-catalog,
  // 也防止在传入 `km.getAllCommands()` 这类未 init 实例方法时返回空)
  const finalSpecs = specs && specs.length > 0 ? specs : getAllCommands();
  getKeymapManager().init(finalSpecs);
}
