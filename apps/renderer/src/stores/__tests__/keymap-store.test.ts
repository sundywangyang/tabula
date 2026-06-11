/**
 * keymap-store 单测。
 *
 *覆盖:
 * - isSameCombo几种 case(通过间接测试):两个 null相等 / 一 null 一 combo不等 /
 * ctrl/meta/shift差异不等 /全部匹配相等
 * - hydrate成功路径:从 window.tabula.shortcuts.getAll / getBindings拉到数据,
 * bindings + customized Set填充
 * - hydrate失败路径:异常被吞掉,loading=false, hydrated=true
 * - setBinding成功:bindings Map更新,当与 defaultCombo 不同时加入 customized,
 * 与 defaultCombo 相同时从 customized移除
 * - setBinding失败:CONFLICT错误存到 lastError(用 conflict.conflictingTitle),函数返回 false
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
import { installTabulaMock } from './setup';
import { useKeymapStore } from '../keymap-store';
import type { CommandSpec, KeyCombo, ShortcutBinding } from '@tabula/bridge';

//辅助:构造一个 CommandSpec
const c = (id: string, defaultCombo: KeyCombo | null): CommandSpec => ({
 id,
 title: id,
 category: 'test',
 defaultCombo,
 reserved: false,
});

//辅助:构造一个 ShortcutBinding
const b = (commandId: string, combo: KeyCombo | null, customized = false): ShortcutBinding => ({
 commandId,
 combo,
 customized,
});

describe('keymap-store', () => {
 beforeEach(() => {
 // 重置 store state(zustand 模块单例跨 case共享)
 useKeymapStore.setState({
 commands: [],
 bindings: new Map(),
 customized: new Set(),
 hydrated: false,
 loading: false,
 lastError: null,
 });
 });

 it('默认值符合预期', () => {
 const s = useKeymapStore.getState();
 expect(s.commands).toEqual([]);
 expect(s.bindings.size).toBe(0);
 expect(s.customized.size).toBe(0);
 expect(s.hydrated).toBe(false);
 expect(s.loading).toBe(false);
 expect(s.lastError).toBe(null);
 });

 describe('isSameCombo(间接覆盖)', () => {
 //我们通过 setBinding 在 customized Set 里加入/移除 commandId 来验证
 // isSameCombo 的各种 case。详细矩阵用单元函数式 assert。

 it('两 null → 不加入 customized(视为相同)', async () => {
 installTabulaMock();
 const cmds = [c('cmd.no-default', null)];
 const bindings = [b('cmd.no-default', null, false)];

 await useKeymapStore.getState().hydrate();
 useKeymapStore.setState({ commands: cmds, bindings: new Map([['cmd.no-default', null]]), customized: new Set() });

 await useKeymapStore.getState().setBinding('cmd.no-default', null);
 expect(useKeymapStore.getState().customized.has('cmd.no-default')).toBe(false);
 });

 it('同 default → 不加入 customized', async () => {
 const cmds = [c('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 const bindings = [b('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false)];

 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: bindings,
 });
 await useKeymapStore.getState().hydrate();
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(false);

 // 重设回默认
 await useKeymapStore.getState().setBinding('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false });
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(false);
 });

 it('ctrl差异 → 加入 customized', async () => {
 const cmds = [c('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 const bindings = [b('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false)];

 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: bindings,
 });
 await useKeymapStore.getState().hydrate();

 //改成 no-ctrl
 await useKeymapStore.getState().setBinding('cmd.x', { key: 'p', ctrl: false, alt: false, shift: false, meta: false });
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(true);
 });

 it('shift差异 → 加入 customized', async () => {
 const cmds = [c('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 const bindings = [b('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false)];

 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: bindings,
 });
 await useKeymapStore.getState().hydrate();

 await useKeymapStore.getState().setBinding('cmd.x', { key: 'p', ctrl: true, alt: false, shift: true, meta: false });
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(true);
 });

 it('alt差异 → 加入 customized', async () => {
 const cmds = [c('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 const bindings = [b('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false)];

 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: bindings,
 });
 await useKeymapStore.getState().hydrate();

 await useKeymapStore.getState().setBinding('cmd.x', { key: 'p', ctrl: true, alt: true, shift: false, meta: false });
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(true);
 });

 it('meta差异 → 加入 customized', async () => {
 const cmds = [c('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 const bindings = [b('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false)];

 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: bindings,
 });
 await useKeymapStore.getState().hydrate();

 await useKeymapStore.getState().setBinding('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: true });
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(true);
 });

 it('key差异 → 加入 customized', async () => {
 const cmds = [c('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 const bindings = [b('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false)];

 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: bindings,
 });
 await useKeymapStore.getState().hydrate();

 await useKeymapStore.getState().setBinding('cmd.x', { key: 'q', ctrl: true, alt: false, shift: false, meta: false });
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(true);
 });

 it('从 customized状态重设回 default → 从 customized Set移除', async () => {
 const cmds = [c('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 const bindings = [b('cmd.x', { key: 'q', ctrl: true, alt: false, shift: false, meta: false }, true)];

 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: bindings,
 });
 await useKeymapStore.getState().hydrate();
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(true);

 //改回 default
 await useKeymapStore.getState().setBinding('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false });
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(false);
 });

 it('setBinding combo = null → 从 customized移除', async () => {
 const cmds = [c('cmd.x', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 const bindings = [b('cmd.x', { key: 'q', ctrl: true, alt: false, shift: false, meta: false }, true)];

 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: bindings,
 });
 await useKeymapStore.getState().hydrate();
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(true);

 await useKeymapStore.getState().setBinding('cmd.x', null);
 expect(useKeymapStore.getState().customized.has('cmd.x')).toBe(false);
 expect(useKeymapStore.getState().bindings.get('cmd.x')).toBeNull();
 });
 });

 describe('hydrate', () => {
 it('成功路径:填充 commands / bindings / customized', async () => {
 const cmds = [
 c('cmd.a', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }),
 c('cmd.b', { key: 'q', ctrl: true, alt: false, shift: false, meta: false }),
 c('cmd.c', null),
 ];
 const bindings = [
 b('cmd.a', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false),
 b('cmd.b', { key: 'x', ctrl: true, alt: false, shift: false, meta: false }, true), // 自定义
 b('cmd.c', null, false),
 ];

 installTabulaMock({ shortcutsGetAll: cmds, shortcutsGetBindings: bindings });
 await useKeymapStore.getState().hydrate();

 const s = useKeymapStore.getState();
 expect(s.commands).toEqual(cmds);
 expect(s.bindings.get('cmd.a')!.key).toBe('p');
 expect(s.bindings.get('cmd.b')!.key).toBe('x');
 expect(s.bindings.get('cmd.c')).toBeNull();
 expect(s.customized.has('cmd.a')).toBe(false);
 expect(s.customized.has('cmd.b')).toBe(true);
 expect(s.customized.has('cmd.c')).toBe(false);
 expect(s.hydrated).toBe(true);
 expect(s.loading).toBe(false);
 });

  it('失败路径:异常被吞掉,loading=false', async () => {
    installTabulaMock({
      shortcutsGetAll: () => Promise.reject(new Error('IPC down')),
      shortcutsGetBindings: () => Promise.reject(new Error('IPC down')),
    });
    await useKeymapStore.getState().hydrate();
    const s = useKeymapStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.loading).toBe(false);
  });
 });

 describe('setBinding失败路径', () => {
 it('CONFLICT错误 → lastError 含 conflict.conflictingTitle,返回 false', async () => {
 const cmds = [c('cmd.a', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: [b('cmd.a', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false)],
 shortcutsSetBinding: async () => ({
 ok: false,
 error: {
 code: 'CONFLICT',
 message: 'occupied',
 conflict: {
 commandId: 'cmd.a',
 combo: { key: 'p', ctrl: true, alt: false, shift: false, meta: false },
 conflictingCommandId: 'cmd.b',
 conflictingTitle: '另开标签',
 },
 },
 }),
 });
 await useKeymapStore.getState().hydrate();

 const ok = await useKeymapStore.getState().setBinding('cmd.a', { key: 'p', ctrl: true, alt: false, shift: false, meta: false });
 expect(ok).toBe(false);
 expect(useKeymapStore.getState().lastError).toContain('另开标签');
 });

 it('非 CONFLICT错误 → lastError 用 error.message,返回 false', async () => {
 const cmds = [c('cmd.a', null)];
 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: [b('cmd.a', null, false)],
 shortcutsSetBinding: async () => ({
 ok: false,
 error: { code: 'INVALID_COMBO', message: 'bad combo' },
 }),
 });
 await useKeymapStore.getState().hydrate();

 const ok = await useKeymapStore.getState().setBinding('cmd.a', { key: 'p', ctrl: true, alt: false, shift: false, meta: false });
 expect(ok).toBe(false);
 expect(useKeymapStore.getState().lastError).toBe('bad combo');
 });
 });

 describe('setBinding成功路径', () => {
 it('更新 bindings Map + customized Set', async () => {
 const cmds = [c('cmd.a', { key: 'p', ctrl: true, alt: false, shift: false, meta: false })];
 installTabulaMock({
 shortcutsGetAll: cmds,
 shortcutsGetBindings: [b('cmd.a', { key: 'p', ctrl: true, alt: false, shift: false, meta: false }, false)],
 });
 await useKeymapStore.getState().hydrate();

 const ok = await useKeymapStore.getState().setBinding('cmd.a', { key: 'f5', ctrl: false, alt: false, shift: false, meta: false });
 expect(ok).toBe(true);
 expect(useKeymapStore.getState().bindings.get('cmd.a')!.key).toBe('f5');
 expect(useKeymapStore.getState().customized.has('cmd.a')).toBe(true);
 expect(useKeymapStore.getState().lastError).toBe(null);
 });
 });

 describe('refresh / resetAll', () => {
 it('resetAll调 shortcuts.resetAll + refresh', async () => {
 const mock = installTabulaMock();
 useKeymapStore.setState({ commands: [c('cmd.a', null)], bindings: new Map(), customized: new Set() });

 await useKeymapStore.getState().resetAll();
 expect(mock.shortcuts.resetAll).toHaveBeenCalledTimes(1);
 // resetAll → refresh → shortcuts.getAll/getBindings也会被调
 expect(mock.shortcuts.getAll).toHaveBeenCalled();
 });
 });
});
