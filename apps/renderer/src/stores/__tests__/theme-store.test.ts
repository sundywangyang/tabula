/**
 * theme-store 单测。
 *
 *覆盖:
 * - 默认主题跟随系统,缺省重点色为 Finder 蓝。
 * - hydrate 用空 config →走 fallback, effective=dark,
 * DOM的 data-theme 与重点色在首次 render 前就绪。
 * - hydrate 用 config.theme=light → effective=light, DOM的 data-theme=light
 * - setMode同步更新 state + DOM data-theme + config.set("theme", mode)
 * - setAccent同步更新 state + DOM --accent + config.set("accentColor", color)
 * - setEffective 只改 effective,不写 config(内部用)
 * - resolveSystem:matchMedia 返回 dark → effective=dark
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './setup';
import { installTabulaMock } from './setup';
import { useThemeStore } from '../theme-store';

describe('theme-store', () => {
 beforeEach(() => {
 //重置 store + DOM(setup.ts 在 beforeEach 已清,但也确保 store 是初始状态)
 useThemeStore.setState({
 mode: 'system',
 effective: 'dark',
 accentColor: '#007aff',
 hydrated: false,
 });
 });
 afterEach(() => vi.unstubAllGlobals());

 it('默认值符合预期', () => {
 const s = useThemeStore.getState();
 expect(s.mode).toBe('system');
 expect(s.effective).toBe('dark');
 expect(s.accentColor).toBe('#007aff');
 expect(s.hydrated).toBe(false);
 });

 describe('hydrate', () => {
 it('空 config →全部 fallback, effective=dark, DOM data-theme=dark', async () => {
 installTabulaMock({ configAll: {} });
 await useThemeStore.getState().hydrate();

 const s = useThemeStore.getState();
 expect(s.mode).toBe('system');
 expect(s.accentColor).toBe('#007aff');
 expect(s.effective).toBe('dark');
 expect(s.hydrated).toBe(true);
 // DOM副作用
 expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
 expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#007aff');
 });

 it('config.theme=light → mode=light, effective=light, DOM data-theme=light', async () => {
 installTabulaMock({ configAll: { theme: 'light', accentColor: '#10b981' } });
 await useThemeStore.getState().hydrate();

 const s = useThemeStore.getState();
 expect(s.mode).toBe('light');
 expect(s.effective).toBe('light');
 expect(s.accentColor).toBe('#10b981');
 expect(document.documentElement.getAttribute('data-theme')).toBe('light');
 expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#10b981');
 });

 it('config.theme=system + matchMedia dark → effective=dark', async () => {
 // jsdom 默认 matchMedia 不存在,但 resolveSystem 在没 matchMedia 时返回 'dark'
 installTabulaMock({ configAll: { theme: 'system' } });
 await useThemeStore.getState().hydrate();
 expect(useThemeStore.getState().effective).toBe('dark');
 });

 it('hydrate失败:异常被吞掉, hydrated=true, fallback写入 DOM', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installTabulaMock({
      configAll: () => Promise.reject(new Error('IPC down')),
    });
 // 不应 throw
 await expect(useThemeStore.getState().hydrate()).resolves.toBeUndefined();
 const s = useThemeStore.getState();
 expect(s.hydrated).toBe(true);
 // fallback写入 DOM
 expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
 expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#007aff');
 // console.warn 被 catch 调用
 expect(warnSpy).toHaveBeenCalled();
 expect(warnSpy.mock.calls[0]![0]).toContain('theme-store');
 });
 });

 describe('startup compatibility', () => {
 it('a new configuration follows a light system without persisting a replacement preference', async () => {
   vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
   const mock = installTabulaMock({ configAll: {} });
   await useThemeStore.getState().hydrate();
   expect(useThemeStore.getState()).toMatchObject({ mode: 'system', effective: 'light', accentColor: '#007aff' });
   expect(document.documentElement.dataset.theme).toBe('light');
   expect(mock.config.set).not.toHaveBeenCalled();
 });

 it('preserves a saved dark theme and the previous custom purple on a light system', async () => {
   vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
   const mock = installTabulaMock({ configAll: { theme: 'dark', accentColor: '#6366f1' } });
   await useThemeStore.getState().hydrate();
   expect(useThemeStore.getState()).toMatchObject({ mode: 'dark', effective: 'dark', accentColor: '#6366f1' });
   expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#6366f1');
   expect(mock.config.set).not.toHaveBeenCalled();
 });

 it('reveals the light system theme even if reading configuration fails', async () => {
   vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
   const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
   installTabulaMock({ configAll: () => Promise.reject(new Error('IPC down')) });
   await useThemeStore.getState().hydrate();
   expect(useThemeStore.getState()).toMatchObject({ mode: 'system', effective: 'light', hydrated: true });
   expect(document.documentElement.dataset.theme).toBe('light');
   warn.mockRestore();
 });

 it.each([
   ['#ffff00', '#000000'],
   ['#ffffff', '#000000'],
   ['#222222', '#ffffff'],
   ['#6366f1', '#000000'],
   ['#007aff', '#000000'],
 ])('keeps text legible on the custom accent %s', (accent, foreground) => {
   installTabulaMock();
   useThemeStore.getState().setAccent(accent!);
   expect(document.documentElement.style.getPropertyValue('--accent-contrast')).toBe(foreground);
 });

 it.each([
   ['#007aff', '#006ee6', '#ffffff'],
   ['#ffff00', '#e6e600', '#000000'],
   ['#222222', '#1f1f1f', '#ffffff'],
   ['#6366f1', '#595cd9', '#ffffff'],
 ])('derives a legible selection from %s without changing the saved accent', (accent, background, foreground) => {
   const mock = installTabulaMock();
   useThemeStore.getState().setAccent(accent!);
   expect(document.documentElement.style.getPropertyValue('--selection-bg')).toBe(background);
   expect(document.documentElement.style.getPropertyValue('--selection-fg')).toBe(foreground);
   expect(document.documentElement.style.getPropertyValue('--accent')).toBe(accent);
   expect(mock.config.set).toHaveBeenCalledWith('accentColor', accent);
 });
 });

 describe('setMode', () => {
 it('setMode("light") → state.mode/有效更新 + DOM data-theme=light', () => {
 installTabulaMock();
 useThemeStore.getState().setMode('light');
 expect(useThemeStore.getState().mode).toBe('light');
 expect(useThemeStore.getState().effective).toBe('light');
 expect(document.documentElement.getAttribute('data-theme')).toBe('light');
 });

 it('setMode("dark") → state.mode/有效更新 + DOM data-theme=dark', () => {
 installTabulaMock();
 useThemeStore.getState().setMode('dark');
 expect(useThemeStore.getState().mode).toBe('dark');
 expect(useThemeStore.getState().effective).toBe('dark');
 expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
 });

 it('setMode("system") + jsdom 无 matchMedia → effective=dark', () => {
 installTabulaMock();
 useThemeStore.getState().setMode('system');
 expect(useThemeStore.getState().mode).toBe('system');
 expect(useThemeStore.getState().effective).toBe('dark');
 });

 it('setMode调 config.set("theme", mode)', () => {
 const mock = installTabulaMock();
 useThemeStore.getState().setMode('dark');
 return new Promise<void>((resolve) => {
 setTimeout(() => {
 expect(mock.config.set).toHaveBeenCalledWith('theme', 'dark');
 resolve();
 },0);
 });
 });
 });

 describe('setAccent', () => {
 it('setAccent同步 state + DOM --accent', () => {
 installTabulaMock();
 useThemeStore.getState().setAccent('#ec4899');
 expect(useThemeStore.getState().accentColor).toBe('#ec4899');
 expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ec4899');
 });

 it('setAccent调 config.set("accentColor", color)', () => {
 const mock = installTabulaMock();
 useThemeStore.getState().setAccent('#ec4899');
 return new Promise<void>((resolve) => {
 setTimeout(() => {
 expect(mock.config.set).toHaveBeenCalledWith('accentColor', '#ec4899');
 resolve();
 },0);
 });
 });
 });

 describe('setEffective (内部)', () => {
 it('只改 effective + DOM data-theme,不调 config.set', () => {
 const mock = installTabulaMock();
 useThemeStore.getState().setEffective('light');
 expect(useThemeStore.getState().effective).toBe('light');
 expect(document.documentElement.getAttribute('data-theme')).toBe('light');
 return new Promise<void>((resolve) => {
 setTimeout(() => {
 // 不应触发 config.set
 expect(mock.config.set).not.toHaveBeenCalled();
 resolve();
 },0);
 });
 });
 });
});
