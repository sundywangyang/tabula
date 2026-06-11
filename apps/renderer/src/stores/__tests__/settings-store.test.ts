/**
 * settings-store 单测。
 *
 *覆盖:
 * - hydrate 用空 config → 所有字段走默认值,hdrated=true。
 * - hydrate 用部分 config → undefined字段走 fallback,有效字段被采用,
 * 并且 theme-store 也被同步(mode + accent)。
 * - 各 setter 调用后:
 * - state立即更新(同步)
 * - window.tabula.config.set 被以正确 (key, value) 调用
 */
import { describe, expect, it, vi } from 'vitest';
import './setup';
import { installTabulaMock } from './setup';
import { useSettingsStore } from '../settings-store';
import { useThemeStore } from '../theme-store';

describe('settings-store', () => {
 it('默认值符合预期', () => {
 const s = useSettingsStore.getState();
 expect(s.theme).toBe('system');
 expect(s.accentColor).toBe('#6366f1');
 expect(s.showHidden).toBe(false);
 expect(s.showExtensions).toBe(true);
 expect(s.sortBy).toBe('name');
 expect(s.sortDir).toBe('asc');
 expect(s.confirmDelete).toBe(true);
 expect(s.language).toBe('zh-CN');
 expect(s.hydrated).toBe(false);
 });

 it('hydrate 用空 config →全部走默认值, hydrated=true', async () => {
 const mock = installTabulaMock({ configAll: {} });
 await useSettingsStore.getState().hydrate();

 const s = useSettingsStore.getState();
 expect(s.theme).toBe('system');
 expect(s.accentColor).toBe('#6366f1');
 expect(s.showHidden).toBe(false);
 expect(s.showExtensions).toBe(true);
 expect(s.sortBy).toBe('name');
 expect(s.sortDir).toBe('asc');
 expect(s.confirmDelete).toBe(true);
 expect(s.language).toBe('zh-CN');
 expect(s.hydrated).toBe(true);
 expect(mock.config.all).toHaveBeenCalledTimes(1);
 });

 it('hydrate 用部分 config → undefined字段走 fallback,有效字段被采用', async () => {
 installTabulaMock({
 configAll: {
 theme: 'dark',
 accentColor: '#10b981',
 //其它字段故意省略,验证 fallback路径
 },
 });
 await useSettingsStore.getState().hydrate();

 const s = useSettingsStore.getState();
 expect(s.theme).toBe('dark');
 expect(s.accentColor).toBe('#10b981');
 // fallback路径
 expect(s.showHidden).toBe(false);
 expect(s.showExtensions).toBe(true);
 expect(s.sortBy).toBe('name');
 expect(s.language).toBe('zh-CN');
 expect(s.hydrated).toBe(true);
 });

 it('hydrate 会同步 mode + accent 到 theme-store', async () => {
 installTabulaMock({
 configAll: { theme: 'light', accentColor: '#ec4899' },
 });
 // 先重置 theme-store(其它测试可能改了它)
 useThemeStore.setState({ mode: 'system', accentColor: '#6366f1' });

 await useSettingsStore.getState().hydrate();

 const t = useThemeStore.getState();
 expect(t.mode).toBe('light');
 expect(t.accentColor).toBe('#ec4899');
 });

 it('setTheme同步更新 state +调 config.set("theme", v)', () => {
 const mock = installTabulaMock();
 useSettingsStore.getState().setTheme('dark');

 expect(useSettingsStore.getState().theme).toBe('dark');
 expect(mock.config.set).toHaveBeenCalledWith('theme', 'dark');
 });

 it('setAccent同步更新 state +调 config.set("accentColor", v)', () => {
 const mock = installTabulaMock();
 useSettingsStore.getState().setAccent('#f97316');

 expect(useSettingsStore.getState().accentColor).toBe('#f97316');
 expect(mock.config.set).toHaveBeenCalledWith('accentColor', '#f97316');
 });

 it('每个 boolean / enum setter都会触发对应 config.set 调用', () => {
 const mock = installTabulaMock();

 useSettingsStore.getState().setShowHidden(true);
 useSettingsStore.getState().setShowExtensions(false);
 useSettingsStore.getState().setSortBy('mtime');
 useSettingsStore.getState().setSortDir('desc');
 useSettingsStore.getState().setConfirmDelete(false);
 useSettingsStore.getState().setLanguage('en-US');

 expect(useSettingsStore.getState().showHidden).toBe(true);
 expect(useSettingsStore.getState().showExtensions).toBe(false);
 expect(useSettingsStore.getState().sortBy).toBe('mtime');
 expect(useSettingsStore.getState().sortDir).toBe('desc');
 expect(useSettingsStore.getState().confirmDelete).toBe(false);
 expect(useSettingsStore.getState().language).toBe('en-US');

 expect(mock.config.set).toHaveBeenCalledWith('showHidden', true);
 expect(mock.config.set).toHaveBeenCalledWith('showExtensions', false);
 expect(mock.config.set).toHaveBeenCalledWith('sortBy', 'mtime');
 expect(mock.config.set).toHaveBeenCalledWith('sortDir', 'desc');
 expect(mock.config.set).toHaveBeenCalledWith('confirmDelete', false);
 expect(mock.config.set).toHaveBeenCalledWith('language', 'en-US');
 });

 it('config.set reject 时不抛错(try/catch包裹)', async () => {
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 installTabulaMock({
 configSet: async () => {
 throw new Error('IPC down');
 },
 });
 // 不应 throw
 expect(() => useSettingsStore.getState().setTheme('dark')).not.toThrow();
 // 给 persist一点 tick 让 await reject 进入 catch
 await new Promise((r) => setTimeout(r,0));
 expect(warnSpy).toHaveBeenCalled();
 });
});
