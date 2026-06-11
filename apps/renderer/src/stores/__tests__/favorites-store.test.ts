/**
 * favorites-store 单测。
 *
 *覆盖:
 * - addFavorite 去重:同 path第二次 add 不重复,可选更新 label
 * - addFavorite 默认 label来自 path末段
 * - removeFavorite真的从列表里删除
 * - renameFavorite 更新 label,空字符串忽略
 * - reorderFavorites边界:from === to不动 /越界不动 /正常重排
 * - recordVisit 去重(同样 path移到队首)、超 HISTORY_MAX截断
 * - clearHistory 清空 + persist
 * - isFavorite同步读 state
 * - toggleFavorite 在已/未收藏之间切换
 * - hydrate 从持久化恢复 favorites/history
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
import { installTabulaMock } from './setup';
import { useFavoritesStore } from '../favorites-store';

describe('favorites-store', () => {
 //每个 case前手动 reset store state,确保测试独立
 beforeEach(() => {
 useFavoritesStore.setState({
 favorites: [],
 history: [],
 hydrated: false,
 });
 });

 it('默认值:favorites / history 都为空数组,hdrated=false', () => {
 const s = useFavoritesStore.getState();
 expect(s.favorites).toEqual([]);
 expect(s.history).toEqual([]);
 expect(s.hydrated).toBe(false);
 });

 describe('addFavorite / removeFavorite / renameFavorite', () => {
 it('addFavorite 返回新加的 item, state包含它', () => {
 installTabulaMock();
 const item = useFavoritesStore.getState().addFavorite('C:\\Users\\me', 'My Home');
 expect(item).not.toBeNull();
 expect(item!.path).toBe('C:\\Users\\me');
 expect(item!.label).toBe('My Home');
 expect(item!.addedAt).toBeGreaterThan(0);
 expect(useFavoritesStore.getState().favorites).toHaveLength(1);
 });

 it('addFavorite 默认 label来自 path末段', () => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\Users\\me\\Projects');
 expect(useFavoritesStore.getState().favorites[0]!.label).toBe('Projects');
 });

 it('addFavorite 同 path第二次 add 不重复, 只更新可选 label', () => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\a', 'Alpha');
 useFavoritesStore.getState().addFavorite('C:\\a', 'Alpha v2');

 const favs = useFavoritesStore.getState().favorites;
 expect(favs).toHaveLength(1);
 expect(favs[0]!.label).toBe('Alpha v2');
 });

 it('addFavorite 同 path 不传 label 时保留原 label', () => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\a', 'Alpha');
 useFavoritesStore.getState().addFavorite('C:\\a'); // 不传 label
 expect(useFavoritesStore.getState().favorites[0]!.label).toBe('Alpha');
 });

 it('removeFavorite真的从列表里删除', () => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\a');
 useFavoritesStore.getState().addFavorite('C:\\b');
 useFavoritesStore.getState().removeFavorite('C:\\a');

 const favs = useFavoritesStore.getState().favorites;
 expect(favs).toHaveLength(1);
 expect(favs[0]!.path).toBe('C:\\b');
 });

 it('removeFavorite path不存在时不报错', () => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\a');
 expect(() => useFavoritesStore.getState().removeFavorite('C:\\nonexistent')).not.toThrow();
 expect(useFavoritesStore.getState().favorites).toHaveLength(1);
 });

 it('renameFavorite 更新 label', () => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\a', 'old');
 useFavoritesStore.getState().renameFavorite('C:\\a', 'new');
 expect(useFavoritesStore.getState().favorites[0]!.label).toBe('new');
 });

 it('renameFavorite 空字符串忽略', () => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\a', 'old');
 useFavoritesStore.getState().renameFavorite('C:\\a', ' ');
 expect(useFavoritesStore.getState().favorites[0]!.label).toBe('old');
 });

 it('isFavorite同步读 state', () => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\a');
 expect(useFavoritesStore.getState().isFavorite('C:\\a')).toBe(true);
 expect(useFavoritesStore.getState().isFavorite('C:\\b')).toBe(false);
 });

 it('toggleFavorite 在已/未收藏之间切换', () => {
 installTabulaMock();
 // 未收藏 → add
 expect(useFavoritesStore.getState().toggleFavorite('C:\\a')).toBe(true);
 expect(useFavoritesStore.getState().isFavorite('C:\\a')).toBe(true);
 // 已收藏 → remove
 expect(useFavoritesStore.getState().toggleFavorite('C:\\a')).toBe(false);
 expect(useFavoritesStore.getState().isFavorite('C:\\a')).toBe(false);
 });
 });

 describe('reorderFavorites', () => {
 beforeEach(() => {
 installTabulaMock();
 useFavoritesStore.getState().addFavorite('C:\\a');
 useFavoritesStore.getState().addFavorite('C:\\b');
 useFavoritesStore.getState().addFavorite('C:\\c');
 });

 it('from === to 不动', () => {
 const before = useFavoritesStore.getState().favorites.map((f) => f.path);
 useFavoritesStore.getState().reorderFavorites(1,1);
 const after = useFavoritesStore.getState().favorites.map((f) => f.path);
 expect(after).toEqual(before);
 });

 it('from越界 (负数 / >= length) 不动', () => {
 const before = useFavoritesStore.getState().favorites.map((f) => f.path);
 useFavoritesStore.getState().reorderFavorites(-1,0);
 useFavoritesStore.getState().reorderFavorites(99,0);
 const after = useFavoritesStore.getState().favorites.map((f) => f.path);
 expect(after).toEqual(before);
 });

 it('to越界 不动', () => {
 const before = useFavoritesStore.getState().favorites.map((f) => f.path);
 useFavoritesStore.getState().reorderFavorites(0,99);
 const after = useFavoritesStore.getState().favorites.map((f) => f.path);
 expect(after).toEqual(before);
 });

 it('正常重排:把0移到2', () => {
 useFavoritesStore.getState().reorderFavorites(0,2);
 expect(useFavoritesStore.getState().favorites.map((f) => f.path)).toEqual([
 'C:\\b',
 'C:\\c',
 'C:\\a',
 ]);
 });

 it('正常重排:把2移到0', () => {
 useFavoritesStore.getState().reorderFavorites(2,0);
 expect(useFavoritesStore.getState().favorites.map((f) => f.path)).toEqual([
 'C:\\c',
 'C:\\a',
 'C:\\b',
 ]);
 });
 });

 describe('recordVisit / clearHistory', () => {
 it('recordVisit 把 path 加到队首', () => {
 installTabulaMock();
 useFavoritesStore.getState().recordVisit('C:\\a');
 useFavoritesStore.getState().recordVisit('C:\\b');

 const hist = useFavoritesStore.getState().history;
 expect(hist.map((h) => h.path)).toEqual(['C:\\b', 'C:\\a']);
 });

 it('recordVisit 同 path第二次 →移到队首, 不重复', () => {
 installTabulaMock();
 useFavoritesStore.getState().recordVisit('C:\\a');
 useFavoritesStore.getState().recordVisit('C:\\b');
 useFavoritesStore.getState().recordVisit('C:\\a'); //第二次访问 a

 const hist = useFavoritesStore.getState().history;
 expect(hist.map((h) => h.path)).toEqual(['C:\\a', 'C:\\b']);
 expect(hist).toHaveLength(2);
 });

 it('recordVisit 超 HISTORY_MAX(100)截断,保留最新100 条', () => {
 installTabulaMock();
 for (let i =0; i <110; i +=1) {
 useFavoritesStore.getState().recordVisit(`C:\\dir-${i}`);
 }
 const hist = useFavoritesStore.getState().history;
 expect(hist).toHaveLength(100);
 // 最新访问的 (i=109)应该在队首
 expect(hist[0]!.path).toBe('C:\\dir-109');
 // 最旧的在尾部
 expect(hist[hist.length -1]!.path).toBe('C:\\dir-10');
 });

 it('recordVisit写入持久化', () => {
 const mock = installTabulaMock();
 useFavoritesStore.getState().recordVisit('C:\\a');
 // persistK 是 fire-and-forget,但 set仍然被调
 // 给 microtask 一拍
 return new Promise<void>((resolve) => {
 setTimeout(() => {
 expect(mock.config.set).toHaveBeenCalledWith('history', expect.any(Array));
 resolve();
 },0);
 });
 });

 it('clearHistory 清空 + persist', () => {
 const mock = installTabulaMock();
 useFavoritesStore.getState().recordVisit('C:\\a');
 useFavoritesStore.getState().clearHistory();
 expect(useFavoritesStore.getState().history).toEqual([]);
 // 给 persist 一拍
 return new Promise<void>((resolve) => {
 setTimeout(() => {
 expect(mock.config.set).toHaveBeenCalledWith('history', []);
 resolve();
 },0);
 });
 });
 });

 describe('hydrate', () => {
 it('从持久化恢复 favorites + history', async () => {
 installTabulaMock({
 configGet: {
 favorites: [
 { id: 'fav-x', path: 'C:\\a', label: 'A', addedAt:1 },
 ],
 history: [{ path: 'C:\\b', visitedAt:2 }],
 },
 });
 await useFavoritesStore.getState().hydrate();
 const s = useFavoritesStore.getState();
 expect(s.favorites).toEqual([
 { id: 'fav-x', path: 'C:\\a', label: 'A', addedAt:1 },
 ]);
 expect(s.history).toEqual([{ path: 'C:\\b', visitedAt:2 }]);
 expect(s.hydrated).toBe(true);
 });

 it('持久化的非数组值走 fallback', async () => {
 installTabulaMock({
 configGet: {
 favorites: 'not-an-array' as unknown as never,
 history: null as unknown as never,
 },
 });
 await useFavoritesStore.getState().hydrate();
 const s = useFavoritesStore.getState();
 expect(s.favorites).toEqual([]);
 expect(s.history).toEqual([]);
 expect(s.hydrated).toBe(true);
 });

 it('持久化的 history 超100 自动截断', async () => {
 const oversized: Array<{ path: string; visitedAt: number }> = [];
 for (let i =0; i <150; i +=1) {
 oversized.push({ path: `C:\\d-${i}`, visitedAt: i });
 }
 installTabulaMock({
 configGet: {
 favorites: [],
 history: oversized,
 },
 });
 await useFavoritesStore.getState().hydrate();
 expect(useFavoritesStore.getState().history).toHaveLength(100);
 });
 });
});
